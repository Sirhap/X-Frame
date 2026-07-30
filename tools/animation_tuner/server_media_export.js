"use strict";

const defaultFs = require("node:fs");
const defaultPath = require("node:path");
const { spawn: defaultSpawn } = require("node:child_process");
const { randomUUID: defaultRandomUuid } = require("node:crypto");
const { clearInterval: clearIntervalTimer, setInterval: setIntervalTimer } = require("node:timers");

const MAX_FRAMES = 240;
const MAX_FRAME_BYTES = 48 * 1024 * 1024;
const MAX_JOB_BYTES = 512 * 1024 * 1024;
const MAX_JOB_COUNT = 64;
const MAX_CANVAS_DIMENSION = 8192;
const JOB_TTL_MS = 60 * 60 * 1000;
const PROCESS_TIMEOUT_MS = 30 * 60 * 1000;
const PROCESS_KILL_GRACE_MS = 2_000;
const CAPABILITY_TIMEOUT_MS = 5_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_VALID_DEPTHS = Object.freeze({
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
});
const JOB_METADATA_FILENAME = "job.json";
const JOB_METADATA_SCHEMA = 1;
const JOB_STATUSES = new Set(["uploading", "queued", "running", "completed", "failed", "cancelled"]);

/** Creates an HTTP-compatible error. @param {number} status Status code. @param {string} message Message. */
function mediaExportError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/** Sanitizes an output filename stem. @param {unknown} value Candidate stem. */
function safeStem(value) {
  const stem = String(value || "animation")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
  return stem && !/^\.{1,2}$/.test(stem) ? stem : "animation";
}

/**
 * Parses a structurally valid PNG and returns its IHDR dimensions.
 * Pixel decoding remains FFmpeg's responsibility, but malformed chunk lengths,
 * missing image data, trailing data, and invalid IHDR fields are rejected early.
 * @param {Buffer} bytes PNG bytes.
 * @returns {{width:number,height:number}}
 */
function pngSize(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 45 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw mediaExportError(400, "Frame payload is not a valid PNG.");
  }
  let offset = 8;
  let dimensions = null;
  let hasImageData = false;
  while (offset + 12 <= bytes.length) {
    const chunkLength = bytes.readUInt32BE(offset);
    const chunkEnd = offset + 12 + chunkLength;
    if (chunkEnd > bytes.length) throw mediaExportError(400, "PNG contains a truncated chunk.");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dataOffset = offset + 8;
    if (!dimensions && type !== "IHDR") {
      throw mediaExportError(400, "PNG must begin with an IHDR chunk.");
    }
    if (type === "IHDR") {
      if (dimensions || chunkLength !== 13) {
        throw mediaExportError(400, "PNG contains an invalid IHDR chunk.");
      }
      const width = bytes.readUInt32BE(dataOffset);
      const height = bytes.readUInt32BE(dataOffset + 4);
      const bitDepth = bytes[dataOffset + 8];
      const colorType = bytes[dataOffset + 9];
      if (
        !width ||
        !height ||
        !PNG_VALID_DEPTHS[colorType]?.includes(bitDepth) ||
        bytes[dataOffset + 10] !== 0 ||
        bytes[dataOffset + 11] !== 0 ||
        ![0, 1].includes(bytes[dataOffset + 12])
      ) {
        throw mediaExportError(400, "PNG contains unsupported IHDR values.");
      }
      dimensions = { width, height };
    } else if (type === "IDAT") {
      hasImageData = hasImageData || chunkLength > 0;
    } else if (type === "IEND") {
      if (chunkLength !== 0 || !dimensions || !hasImageData || chunkEnd !== bytes.length) {
        throw mediaExportError(400, "PNG is missing complete image data.");
      }
      return dimensions;
    }
    offset = chunkEnd;
  }
  throw mediaExportError(400, "PNG is missing its IEND chunk.");
}

/**
 * Creates the queued local FFmpeg export service.
 * @param {{root:string,fsApi?:typeof import("node:fs"),pathApi?:typeof import("node:path"),spawnImpl?:Function,randomUUID?:()=>string,now?:()=>number,ffmpegBinary?:string,processTimeoutMs?:number,processKillGraceMs?:number,jobTtlMs?:number,cleanupIntervalMs?:number}} options Service dependencies.
 */
function createMediaExportService(options) {
  if (!options?.root) throw new TypeError("Media export root is required.");
  const fsApi = options.fsApi || defaultFs;
  const pathApi = options.pathApi || defaultPath;
  const spawnImpl = options.spawnImpl || defaultSpawn;
  const randomUUID = options.randomUUID || defaultRandomUuid;
  const now = options.now || Date.now;
  const ffmpegBinary = options.ffmpegBinary || process.env.XSXB_FFMPEG || "ffmpeg";
  const processTimeoutMs = Math.max(1, Number(options.processTimeoutMs) || PROCESS_TIMEOUT_MS);
  const processKillGraceMs = Math.max(1, Number(options.processKillGraceMs) || PROCESS_KILL_GRACE_MS);
  const jobTtlMs = Math.max(1, Number(options.jobTtlMs) || JOB_TTL_MS);
  const cleanupIntervalMs = Math.max(1, Number(options.cleanupIntervalMs) || 10 * 60 * 1000);
  const exportRoot = pathApi.join(options.root, "output", "media-exports");
  const jobs = new Map();
  const queue = [];
  let activeJob = null;
  let capabilityPromise = null;
  let metadataSequence = 0;
  let disposed = false;
  fsApi.mkdirSync(exportRoot, { recursive: true });

  /** Removes one job directory while allowing periodic cleanup to retry failures. */
  function removeJobFiles(job) {
    try {
      fsApi.rmSync(job.directory, { recursive: true, force: true });
      return true;
    } catch (error) {
      job.error ||= `Unable to clean media export files: ${error?.message || error}`;
      return false;
    }
  }

  /** Returns public metadata shared by create and status responses. */
  function publicJobMetadata(job) {
    return {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      expiresAt: job.expiresAt,
      formats: [...job.formats],
      animationName: job.animationName,
      errorCode: job.errorCode,
    };
  }

  /** Advances persisted activity timestamps without extending jobs through status polling. */
  function touchJob(job) {
    job.updatedAt = now();
    job.expiresAt = job.updatedAt + jobTtlMs;
  }

  /** Serializes a job without filesystem paths, process references, or frame payloads. */
  function serializeJob(job) {
    return {
      schemaVersion: JOB_METADATA_SCHEMA,
      ...publicJobMetadata(job),
      frameCount: job.frameCount,
      fps: job.fps,
      width: job.width,
      height: job.height,
      bytes: job.bytes,
      uploaded: [...job.uploaded].sort((left, right) => left - right),
      progress: job.progress,
      error: job.error,
      outputs: job.outputs.map((output) => ({ ...output })),
    };
  }

  /** Atomically replaces one job metadata file in its own directory. */
  function persistJob(job) {
    const metadataFile = pathApi.join(job.directory, JOB_METADATA_FILENAME);
    const temporaryFile = pathApi.join(
      job.directory,
      `.${JOB_METADATA_FILENAME}.${process.pid}.${metadataSequence++}.tmp`,
    );
    try {
      fsApi.writeFileSync(temporaryFile, `${JSON.stringify(serializeJob(job), null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      fsApi.renameSync(temporaryFile, metadataFile);
    } catch (error) {
      try {
        fsApi.rmSync(temporaryFile, { force: true });
      } catch (_cleanupError) {
        // A later orphan cleanup removes an abandoned temporary metadata file.
      }
      throw mediaExportError(500, `Unable to persist media export job: ${error?.message || error}`);
    }
  }

  /** Removes uploaded frames and palette scratch data after successful encoding. */
  function removeTemporaryInputs(job) {
    fsApi.rmSync(job.frameDirectory, { recursive: true, force: true });
    fsApi.rmSync(pathApi.join(job.directory, "palette.png"), { force: true });
  }

  /** Normalizes a display name while ensuring persisted metadata cannot contain an absolute path. */
  function safeAnimationName(value) {
    const name = String(value || "animation")
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .trim()
      .slice(0, 160);
    if (!name) return "animation";
    return pathApi.isAbsolute(name) || /^[a-zA-Z]:[\\/]/.test(name) ? safeStem(name) : name;
  }

  /** Runs a child process without a shell and captures bounded process output. */
  function runProcess(command, args, job = null, timeoutMs = processTimeoutMs) {
    return new Promise((resolve, reject) => {
      const child = spawnImpl(command, args, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (job) job.child = child;
      let stdout = "";
      let stderr = "";
      let settled = false;
      let terminationError = null;
      let forceKillTimer = null;

      /** Completes this process once and releases job process references. */
      function settle(error, result) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearTimeout(forceKillTimer);
        if (job?.child === child) job.child = null;
        if (job?.stopProcess === terminate) job.stopProcess = null;
        if (error) reject(error);
        else resolve(result);
      }

      /** Requests graceful termination, then guarantees settlement after a hard kill. */
      function terminate(error) {
        if (settled || terminationError) return;
        terminationError = error;
        forceKillTimer = setTimeout(() => {
          try {
            child.kill?.("SIGKILL");
          } finally {
            settle(terminationError);
          }
        }, processKillGraceMs);
        forceKillTimer.unref?.();
        try {
          child.kill?.("SIGTERM");
        } catch (_error) {
          settle(terminationError);
        }
      }

      if (job) job.stopProcess = terminate;
      const timeout = setTimeout(
        () => terminate(mediaExportError(504, "FFmpeg export timed out.")),
        timeoutMs,
      );
      timeout.unref?.();
      child.stdout?.on("data", (chunk) => {
        stdout = `${stdout}${chunk}`.slice(-16_384);
      });
      child.stderr?.on("data", (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-16_384);
        if (job) {
          const matches = stderr.match(/frame=\s*(\d+)/g);
          const latest = matches?.at(-1)?.match(/\d+/)?.[0];
          if (latest) {
            job.progress = Math.max(
              job.progress,
              Math.min(0.98, 0.25 + (Number(latest) / job.frameCount) * 0.73),
            );
          }
        }
      });
      child.on("error", (error) => {
        settle(terminationError || error);
      });
      child.on("close", (code, signal) => {
        if (terminationError) settle(terminationError);
        else if (code === 0) settle(null, { stdout, stderr });
        else settle(mediaExportError(500, `FFmpeg failed (${signal || code}): ${stderr.trim()}`));
      });
    });
  }

  /** Resolves and caches the local FFmpeg capability. */
  async function capabilities() {
    if (!capabilityPromise) {
      capabilityPromise = runProcess(ffmpegBinary, ["-version"], null, CAPABILITY_TIMEOUT_MS)
        .then(async ({ stdout, stderr }) => {
          const versionOutput = `${stdout}\n${stderr}`;
          let encoders = "";
          try {
            const result = await runProcess(
              ffmpegBinary,
              ["-hide_banner", "-encoders"],
              null,
              CAPABILITY_TIMEOUT_MS,
            );
            encoders = `${result.stdout}\n${result.stderr}`;
          } catch (_error) {
            // FFmpeg itself remains available, but formats stay disabled when probing fails.
          }
          const hasEncoder = (name) => new RegExp(`^\\s*[A-Z.]{6}\\s+${name}(?:\\s|$)`, "m").test(encoders);
          return {
            ffmpeg: {
              available: true,
              version: (versionOutput.match(/ffmpeg version\s+([^\s]+)/i) || [])[1] || "available",
            },
            formats: { gif: hasEncoder("gif"), mov: hasEncoder("prores_ks") },
          };
        })
        .catch(() => ({
          ffmpeg: { available: false, version: "" },
          formats: { gif: false, mov: false },
        }));
    }
    return capabilityPromise;
  }

  /** Allocates a unique, path-safe random job identifier. */
  function createJobId() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = String(randomUUID());
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) continue;
      const directory = pathApi.join(exportRoot, id);
      if (!jobs.has(id) && !fsApi.existsSync(directory)) return id;
    }
    throw mediaExportError(503, "Unable to allocate a media export job.");
  }

  /** Returns a known job or throws a safe 404. */
  function requireJob(id) {
    const job = jobs.get(String(id || ""));
    if (!job) throw mediaExportError(404, "Media export job was not found.");
    return job;
  }

  /** Creates a bounded frame upload job. */
  function createJob(payload = {}) {
    cleanup();
    if (jobs.size >= MAX_JOB_COUNT) {
      throw mediaExportError(429, "Too many media export jobs are active. Try again later.");
    }
    if (
      !Array.isArray(payload.formats) ||
      payload.formats.some((format) => !["gif", "mov"].includes(format))
    ) {
      throw mediaExportError(400, "Only GIF and MOV formats are supported locally.");
    }
    const formats = Array.from(new Set(payload.formats));
    const frameCount = Number(payload.frameCount);
    const fps = payload.fps == null ? 12 : Number(payload.fps);
    const width = Number(payload.width);
    const height = Number(payload.height);
    if (!formats.length) throw mediaExportError(400, "GIF or MOV format is required.");
    if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > MAX_FRAMES) {
      throw mediaExportError(400, `Frame count must be between 1 and ${MAX_FRAMES}.`);
    }
    if (!Number.isFinite(fps) || fps < 1 || fps > 120) {
      throw mediaExportError(400, "FPS must be between 1 and 120.");
    }
    if (
      ![width, height].every((value) => Number.isInteger(value) && value > 0 && value <= MAX_CANVAS_DIMENSION)
    ) {
      throw mediaExportError(400, `Export canvas must be between 1 and ${MAX_CANVAS_DIMENSION} pixels.`);
    }
    const id = createJobId();
    const directory = pathApi.join(exportRoot, id);
    const frameDirectory = pathApi.join(directory, "frames");
    fsApi.mkdirSync(frameDirectory, { recursive: true });
    const createdAt = now();
    const job = {
      id,
      directory,
      frameDirectory,
      formats,
      frameCount,
      fps,
      width,
      height,
      stem: safeStem(payload.animationName),
      animationName: safeAnimationName(payload.animationName),
      bytes: 0,
      uploaded: new Set(),
      status: "uploading",
      progress: 0,
      error: "",
      errorCode: "",
      outputs: [],
      child: null,
      stopProcess: null,
      createdAt,
      updatedAt: createdAt,
      expiresAt: createdAt + jobTtlMs,
    };
    try {
      persistJob(job);
      jobs.set(id, job);
    } catch (error) {
      removeJobFiles(job);
      throw error;
    }
    return {
      ...publicJobMetadata(job),
      frameCount,
      fps,
      width,
      height,
      limits: { frameBytes: MAX_FRAME_BYTES, jobBytes: MAX_JOB_BYTES },
    };
  }

  /** Saves one verified PNG frame at its deterministic index. */
  function uploadFrame(payload = {}) {
    const job = requireJob(payload.jobId);
    if (job.status !== "uploading")
      throw mediaExportError(409, "Media export is no longer accepting frames.");
    const index = Number(payload.index);
    if (!Number.isInteger(index) || index < 0 || index >= job.frameCount) {
      throw mediaExportError(400, "Frame index is outside the export range.");
    }
    if (job.uploaded.has(index)) throw mediaExportError(409, `Frame ${index} was already uploaded.`);
    const data = String(payload.data || "");
    if (data.length > Math.ceil((MAX_FRAME_BYTES * 4) / 3) + 64) {
      throw mediaExportError(413, "Media export frame exceeds its byte limit.");
    }
    const match = /^data:image\/png;base64,((?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?)$/i.exec(
      data,
    );
    if (!match) throw mediaExportError(400, "Frame must be a base64 PNG data URL.");
    const bytes = Buffer.from(match[1], "base64");
    if (!bytes.length || bytes.length > MAX_FRAME_BYTES || job.bytes + bytes.length > MAX_JOB_BYTES) {
      throw mediaExportError(413, "Media export frame or job exceeds its byte limit.");
    }
    const dimensions = pngSize(bytes);
    if (dimensions.width !== job.width || dimensions.height !== job.height) {
      throw mediaExportError(
        400,
        `Frame ${index} is ${dimensions.width}×${dimensions.height}; expected ${job.width}×${job.height}.`,
      );
    }
    const filename = `frame_${String(index + 1).padStart(4, "0")}.png`;
    const frameFile = pathApi.join(job.frameDirectory, filename);
    fsApi.writeFileSync(frameFile, bytes, { flag: "wx" });
    const previousProgress = job.progress;
    const previousUpdatedAt = job.updatedAt;
    const previousExpiresAt = job.expiresAt;
    job.bytes += bytes.length;
    job.uploaded.add(index);
    touchJob(job);
    job.progress = (job.uploaded.size / job.frameCount) * 0.25;
    try {
      persistJob(job);
    } catch (error) {
      job.bytes -= bytes.length;
      job.uploaded.delete(index);
      job.progress = previousProgress;
      job.updatedAt = previousUpdatedAt;
      job.expiresAt = previousExpiresAt;
      fsApi.rmSync(frameFile, { force: true });
      throw error;
    }
    return { uploaded: job.uploaded.size, frameCount: job.frameCount };
  }

  /** Starts a job after ensuring every index is present. */
  function finishJob(payload = {}) {
    const job = requireJob(payload.jobId);
    if (job.status !== "uploading") throw mediaExportError(409, "Media export cannot be finished twice.");
    if (job.uploaded.size !== job.frameCount) {
      throw mediaExportError(409, `Expected ${job.frameCount} frames, received ${job.uploaded.size}.`);
    }
    const previousUpdatedAt = job.updatedAt;
    const previousExpiresAt = job.expiresAt;
    job.status = "queued";
    touchJob(job);
    try {
      persistJob(job);
    } catch (error) {
      job.status = "uploading";
      job.updatedAt = previousUpdatedAt;
      job.expiresAt = previousExpiresAt;
      throw error;
    }
    queue.push(job);
    void processQueue();
    return publicJobMetadata(job);
  }

  /** Encodes one queued job and records downloadable output files. */
  async function encodeJob(job) {
    const capability = await capabilities();
    if (!capability.ffmpeg.available) throw mediaExportError(503, "FFmpeg is not available.");
    const unsupported = job.formats.filter((format) => !capability.formats[format]);
    if (unsupported.length) {
      throw mediaExportError(503, `FFmpeg does not provide the required ${unsupported.join("/")} encoder.`);
    }
    if (job.status === "cancelled") throw mediaExportError(409, "Media export was cancelled.");
    const inputPattern = pathApi.join(job.frameDirectory, "frame_%04d.png");
    if (job.formats.includes("gif")) {
      const palette = pathApi.join(job.directory, "palette.png");
      const output = pathApi.join(job.directory, `${job.stem}.gif`);
      await runProcess(
        ffmpegBinary,
        [
          "-y",
          "-framerate",
          String(job.fps),
          "-start_number",
          "1",
          "-i",
          inputPattern,
          "-vf",
          "palettegen=reserve_transparent=1:stats_mode=diff",
          palette,
        ],
        job,
      );
      if (job.status === "cancelled") throw mediaExportError(409, "Media export was cancelled.");
      await runProcess(
        ffmpegBinary,
        [
          "-y",
          "-framerate",
          String(job.fps),
          "-start_number",
          "1",
          "-i",
          inputPattern,
          "-i",
          palette,
          "-lavfi",
          "paletteuse=dither=sierra2_4a:alpha_threshold=128",
          "-loop",
          "0",
          output,
        ],
        job,
      );
      if (job.status === "cancelled") throw mediaExportError(409, "Media export was cancelled.");
      job.outputs.push({ filename: pathApi.basename(output), label: "GIF", contentType: "image/gif" });
    }
    if (job.formats.includes("mov")) {
      if (job.status === "cancelled") throw mediaExportError(409, "Media export was cancelled.");
      const output = pathApi.join(job.directory, `${job.stem}.mov`);
      await runProcess(
        ffmpegBinary,
        [
          "-y",
          "-framerate",
          String(job.fps),
          "-start_number",
          "1",
          "-i",
          inputPattern,
          "-c:v",
          "prores_ks",
          "-profile:v",
          "4",
          "-pix_fmt",
          "yuva444p10le",
          output,
        ],
        job,
      );
      if (job.status === "cancelled") throw mediaExportError(409, "Media export was cancelled.");
      job.outputs.push({
        filename: pathApi.basename(output),
        label: "透明 MOV",
        contentType: "video/quicktime",
      });
    }
  }

  /** Serially drains the FFmpeg queue. */
  async function processQueue() {
    if (disposed || activeJob || !queue.length) return;
    const job = queue.shift();
    activeJob = job;
    job.status = "running";
    job.progress = 0.26;
    touchJob(job);
    try {
      persistJob(job);
      await encodeJob(job);
      if (job.status !== "cancelled") {
        removeTemporaryInputs(job);
        job.status = "completed";
        job.progress = 1;
        job.error = "";
        job.errorCode = "";
      }
    } catch (error) {
      if (!disposed && job.status !== "cancelled") {
        job.status = "failed";
        job.error = error?.message || String(error);
        job.errorCode = error?.status === 504 ? "encoding_timeout" : "encoding_failed";
      }
    } finally {
      job.child = null;
      job.stopProcess = null;
      touchJob(job);
      if (job.status === "cancelled") removeJobFiles(job);
      else {
        try {
          persistJob(job);
        } catch (error) {
          job.status = "failed";
          job.error = error?.message || String(error);
          job.errorCode = "metadata_write_failed";
        }
      }
      activeJob = null;
      void processQueue();
    }
  }

  /** Returns a public status snapshot without filesystem paths. */
  function status(id) {
    const job = requireJob(id);
    return {
      ...publicJobMetadata(job),
      progress: job.progress,
      uploaded: job.uploaded.size,
      frameCount: job.frameCount,
      fps: job.fps,
      width: job.width,
      height: job.height,
      error: job.error,
      downloads:
        job.status === "completed"
          ? job.outputs.map((output) => ({
              filename: output.filename,
              label: output.label,
              url: `/api/media-export/file?job=${encodeURIComponent(job.id)}&name=${encodeURIComponent(output.filename)}`,
            }))
          : [],
    };
  }

  /** Cancels queued or active work and removes its directory. */
  function cancel(payload = {}) {
    const job = requireJob(payload.jobId);
    if (job.status === "cancelled") return { id: job.id, status: job.status };
    job.status = "cancelled";
    touchJob(job);
    job.stopProcess?.(mediaExportError(409, "Media export was cancelled."));
    const queueIndex = queue.indexOf(job);
    if (queueIndex >= 0) queue.splice(queueIndex, 1);
    if (activeJob !== job) removeJobFiles(job);
    return publicJobMetadata(job);
  }

  /** Resolves one whitelisted completed output for streaming. */
  function outputFile(id, name) {
    const job = requireJob(id);
    if (job.status !== "completed") throw mediaExportError(409, "Media export is not complete.");
    const output = job.outputs.find((candidate) => candidate.filename === String(name || ""));
    if (!output) throw mediaExportError(404, "Media export file was not found.");
    const filename = pathApi.resolve(job.directory, output.filename);
    const relative = pathApi.relative(job.directory, filename);
    if (relative.startsWith("..") || pathApi.isAbsolute(relative)) {
      throw mediaExportError(404, "Media export file was not found.");
    }
    let fileStat;
    try {
      fileStat = fsApi.lstatSync(filename);
    } catch (_error) {
      throw mediaExportError(404, "Media export file was removed.");
    }
    if (!fileStat.isFile()) throw mediaExportError(404, "Media export file was removed.");
    return { ...output, filename, size: fileStat.size };
  }

  /** Validates and hydrates one persisted job using only paths derived from its safe directory ID. */
  function hydratePersistedJob(id, directory, metadata) {
    const formats = Array.isArray(metadata.formats) ? metadata.formats : [];
    const uploaded = Array.isArray(metadata.uploaded) ? metadata.uploaded : [];
    const outputs = Array.isArray(metadata.outputs) ? metadata.outputs : [];
    const numericFields = [
      metadata.frameCount,
      metadata.fps,
      metadata.width,
      metadata.height,
      metadata.bytes,
      metadata.progress,
      metadata.createdAt,
      metadata.updatedAt,
      metadata.expiresAt,
    ];
    if (
      metadata.schemaVersion !== JOB_METADATA_SCHEMA ||
      metadata.id !== id ||
      !JOB_STATUSES.has(metadata.status) ||
      !formats.length ||
      formats.some((format) => !["gif", "mov"].includes(format)) ||
      new Set(formats).size !== formats.length ||
      !numericFields.every(Number.isFinite) ||
      !Number.isInteger(metadata.frameCount) ||
      metadata.frameCount < 1 ||
      metadata.frameCount > MAX_FRAMES ||
      !Number.isFinite(metadata.fps) ||
      metadata.fps < 1 ||
      metadata.fps > 120 ||
      ![metadata.width, metadata.height].every(
        (value) => Number.isInteger(value) && value > 0 && value <= MAX_CANVAS_DIMENSION,
      ) ||
      !Number.isInteger(metadata.bytes) ||
      metadata.bytes < 0 ||
      metadata.bytes > MAX_JOB_BYTES ||
      metadata.progress < 0 ||
      metadata.progress > 1 ||
      !uploaded.every((index) => Number.isInteger(index) && index >= 0 && index < metadata.frameCount) ||
      new Set(uploaded).size !== uploaded.length
    ) {
      throw new Error("Invalid media export job metadata.");
    }
    if (
      outputs.length > formats.length ||
      new Set(outputs.map((output) => output?.filename)).size !== outputs.length
    ) {
      throw new Error("Invalid media export output metadata.");
    }
    const hydratedOutputs = outputs.map((output) => {
      const filename = String(output?.filename || "");
      const isGif =
        output?.contentType === "image/gif" && formats.includes("gif") && filename.endsWith(".gif");
      const isMov =
        output?.contentType === "video/quicktime" && formats.includes("mov") && filename.endsWith(".mov");
      if (!filename || filename !== pathApi.basename(filename) || (!isGif && !isMov)) {
        throw new Error("Invalid media export output metadata.");
      }
      return {
        filename,
        label: String(output.label || filename).slice(0, 80),
        contentType: output.contentType,
      };
    });
    if (metadata.status === "completed") {
      const completeFormats = formats.every((format) =>
        hydratedOutputs.some((output) =>
          format === "gif" ? output.contentType === "image/gif" : output.contentType === "video/quicktime",
        ),
      );
      if (!completeFormats) throw new Error("Completed media export has incomplete outputs.");
      for (const output of hydratedOutputs) {
        const outputPath = pathApi.join(directory, output.filename);
        const outputStat = fsApi.lstatSync(outputPath);
        if (!outputStat.isFile()) throw new Error("Completed media export output is missing.");
      }
    }
    return {
      id,
      directory,
      frameDirectory: pathApi.join(directory, "frames"),
      formats,
      frameCount: metadata.frameCount,
      fps: metadata.fps,
      width: metadata.width,
      height: metadata.height,
      stem: safeStem(metadata.animationName),
      animationName: safeAnimationName(metadata.animationName),
      bytes: metadata.bytes,
      uploaded: new Set(uploaded),
      status: metadata.status,
      progress: metadata.progress,
      error: String(metadata.error || "").slice(0, 16_384),
      errorCode: String(metadata.errorCode || "").slice(0, 80),
      outputs: hydratedOutputs,
      child: null,
      stopProcess: null,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      expiresAt: metadata.expiresAt,
    };
  }

  /** Restores valid recent jobs and marks interrupted work as failed after service restart. */
  function recoverJobs() {
    let entries = [];
    try {
      entries = fsApi.readdirSync(exportRoot, { withFileTypes: true });
    } catch (_error) {
      return;
    }
    for (const entry of entries) {
      const directory = pathApi.join(exportRoot, entry.name);
      if (!entry.isDirectory() || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(entry.name)) {
        try {
          fsApi.rmSync(directory, { recursive: entry.isDirectory(), force: true });
        } catch (_cleanupError) {
          // Periodic cleanup retries transient filesystem failures.
        }
        continue;
      }
      try {
        const metadataFile = pathApi.join(directory, JOB_METADATA_FILENAME);
        const metadataStat = fsApi.lstatSync(metadataFile);
        if (!metadataStat.isFile()) throw new Error("Media export metadata is not a file.");
        const metadata = JSON.parse(fsApi.readFileSync(metadataFile, "utf8"));
        const job = hydratePersistedJob(entry.name, directory, metadata);
        if (job.expiresAt <= now() || job.status === "cancelled") {
          removeJobFiles(job);
          continue;
        }
        if (["uploading", "queued", "running"].includes(job.status)) {
          job.status = "failed";
          job.progress = Math.min(job.progress, 0.99);
          job.error = "Media export was interrupted because the local service restarted.";
          job.errorCode = "server_restarted";
          touchJob(job);
          persistJob(job);
        }
        jobs.set(job.id, job);
      } catch (_error) {
        try {
          fsApi.rmSync(directory, { recursive: true, force: true });
        } catch (_cleanupError) {
          // Periodic cleanup retries transient filesystem failures.
        }
      }
    }
  }

  /** Deletes expired non-running jobs and their files. */
  function cleanup() {
    const currentTime = now();
    const cutoff = currentTime - jobTtlMs;
    for (const [id, job] of jobs) {
      if (job === activeJob || job.status === "queued" || job.expiresAt > currentTime) continue;
      if (removeJobFiles(job)) jobs.delete(id);
    }
    let entries = [];
    try {
      entries = fsApi.readdirSync(exportRoot, { withFileTypes: true });
    } catch (_error) {
      return;
    }
    for (const entry of entries) {
      if (jobs.has(entry.name)) continue;
      const orphanPath = pathApi.join(exportRoot, entry.name);
      try {
        const orphanStat = fsApi.lstatSync(orphanPath);
        if (orphanStat.mtimeMs < cutoff) {
          fsApi.rmSync(orphanPath, { recursive: true, force: true });
        }
      } catch (_error) {
        // A later cleanup pass retries transient filesystem failures.
      }
    }
  }

  recoverJobs();
  cleanup();
  const cleanupTimer = setIntervalTimer(cleanup, cleanupIntervalMs);
  cleanupTimer.unref?.();
  return Object.freeze({
    cancel,
    capabilities,
    cleanup,
    createJob,
    finishJob,
    outputFile,
    status,
    uploadFrame,
    dispose() {
      disposed = true;
      clearIntervalTimer(cleanupTimer);
      queue.splice(0);
      if (activeJob) {
        activeJob.stopProcess?.(mediaExportError(409, "Media export service stopped."));
      }
    },
  });
}

module.exports = {
  MAX_FRAME_BYTES,
  MAX_FRAMES,
  MAX_JOB_BYTES,
  MAX_CANVAS_DIMENSION,
  MAX_JOB_COUNT,
  createMediaExportService,
  mediaExportError,
  pngSize,
  safeStem,
};
