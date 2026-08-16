"use strict";

const defaultCrypto = require("node:crypto");
const defaultFs = require("node:fs");
const defaultPath = require("node:path");
const { spawn: defaultSpawn, execFile: defaultExecFile } = require("node:child_process");
const { promisify } = require("node:util");
const { pipeline } = require("node:stream/promises");
const { pathToFileURL } = require("node:url");

const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_SOURCE_COUNT = 16;
const MAX_JOB_COUNT = 64;
const RESOURCE_TTL_MS = 2 * 60 * 60 * 1000;
const PROCESS_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const VIDEO_CONTENT_TYPES = Object.freeze({
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
});
const ALLOWED_VIDEO_EXTENSIONS = new Set(Object.keys(VIDEO_CONTENT_TYPES));

/**
 * Converts deterministic job-option validation failures into client errors.
 *
 * @param {(input: unknown, metadata: object) => unknown} validator Mode-specific option validator.
 * @param {unknown} input Candidate job options.
 * @param {object} metadata Source video metadata.
 * @param {typeof Error} HttpError HTTP-aware error constructor.
 * @returns {unknown} Normalized job options.
 */
function validateJobOptions(validator, input, metadata, HttpError) {
  try {
    return validator(input, metadata);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, String(error?.message || error || "导出参数无效。"));
  }
}

/**
 * Removes one stored source unless an active export still owns it.
 * @param {{sourceId:string,sources:Map<string,object>,jobs:Map<string,object>,fsApi:typeof import("node:fs"),HttpError:typeof Error}} dependencies Source storage dependencies.
 * @returns {{removed:true,sourceId:string,removedJobs:number}} Removal result.
 */
function removeStoredSource(dependencies) {
  const sourceId = String(dependencies.sourceId || "");
  const source = dependencies.sources.get(sourceId);
  if (!source || !dependencies.fsApi.existsSync(source.filePath)) {
    throw new dependencies.HttpError(404, "视频会话已失效，请重新载入视频。");
  }
  const activeJob = Array.from(dependencies.jobs.values()).find(
    (job) => job.sourceId === sourceId && ["queued", "processing"].includes(job.status),
  );
  if (activeJob) throw new dependencies.HttpError(409, "视频正在导出，暂时不能清空。");
  let removedJobs = 0;
  for (const [jobId, job] of dependencies.jobs) {
    if (job.sourceId !== sourceId) continue;
    if (job.finalPath) dependencies.fsApi.rmSync(job.finalPath, { force: true });
    dependencies.jobs.delete(jobId);
    removedJobs += 1;
  }
  dependencies.fsApi.rmSync(source.filePath, { force: true });
  dependencies.sources.delete(sourceId);
  return { removed: true, sourceId, removedJobs };
}

/**
 * Creates the local video watermark-repair service used by the main XSXB server.
 * @param {{root:string,port:number,HttpError:typeof Error,send:Function,readJsonBody:Function,fsApi?:typeof import("node:fs"),pathApi?:typeof import("node:path"),spawnImpl?:Function,execFileImpl?:Function,randomUUID?:()=>string,now?:()=>number}} options Service dependencies.
 * @returns {{handle:(request:object,response:object,url:URL)=>Promise<boolean>,isUploadRequest:(request:object,url:URL)=>boolean,validateUploadRequest:(request:object)=>void,dispose:()=>void}}
 */
function createWatermarkStudioService(options) {
  if (!options?.root || !options?.HttpError || !options?.send || !options?.readJsonBody) {
    throw new TypeError("Watermark Studio service dependencies are required.");
  }
  const fsApi = options.fsApi || defaultFs;
  const pathApi = options.pathApi || defaultPath;
  const spawnImpl = options.spawnImpl || defaultSpawn;
  const execFileAsync = promisify(options.execFileImpl || defaultExecFile);
  const randomUUID = options.randomUUID || defaultCrypto.randomUUID;
  const now = options.now || Date.now;
  const ffmpegBinary = process.env.XSXB_FFMPEG || "ffmpeg";
  const ffprobeBinary = process.env.XSXB_FFPROBE || "ffprobe";
  const storageRoot = pathApi.join(options.root, "output", "watermark-studio");
  const uploadRoot = pathApi.join(storageRoot, "uploads");
  const exportRoot = pathApi.join(storageRoot, "exports");
  const scratchRoot = pathApi.join(storageRoot, "scratch");
  const sources = new Map();
  const jobs = new Map();
  const queue = [];
  let activeJob = null;
  let disposed = false;
  let capabilityPromise = null;

  for (const directory of [uploadRoot, exportRoot, scratchRoot]) {
    fsApi.mkdirSync(directory, { recursive: true });
  }

  const moduleRoot = pathApi.join(__dirname, "watermark_studio");
  const coreModulesPromise = Promise.all([
    import(pathToFileURL(pathApi.join(moduleRoot, "video-utils.js")).href),
    import(pathToFileURL(pathApi.join(moduleRoot, "smart-export.js")).href),
  ]).then(([videoUtils, smartExport]) => ({ ...videoUtils, ...smartExport }));

  /** Returns whether this request needs raw upload validation instead of JSON validation. */
  function isUploadRequest(request, url) {
    return request.method === "POST" && url.pathname === "/api/watermark/upload";
  }

  /** Validates a same-origin raw video upload before its stream is consumed. */
  function validateUploadRequest(request) {
    const contentType = String(request.headers["content-type"] || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!contentType.startsWith("video/") && contentType !== "application/octet-stream") {
      throw new options.HttpError(415, "请选择受支持的视频文件。");
    }
    const origin = String(request.headers.origin || "").trim();
    if (!origin) return;
    try {
      const originUrl = new URL(origin);
      if (originUrl.host.toLowerCase() === String(request.headers.host || "").toLowerCase()) return;
    } catch (_error) {
      // Malformed origins are rejected below.
    }
    throw new options.HttpError(403, "不允许跨站上传视频。");
  }

  /** Probes the locally installed FFmpeg tools once per server process. */
  function capabilities() {
    capabilityPromise ||= Promise.allSettled([
      execFileAsync(ffmpegBinary, ["-version"], { timeout: 5_000 }),
      execFileAsync(ffprobeBinary, ["-version"], { timeout: 5_000 }),
    ]).then(([ffmpeg, ffprobe]) => ({
      available: ffmpeg.status === "fulfilled" && ffprobe.status === "fulfilled",
      ffmpeg: ffmpeg.status === "fulfilled",
      ffprobe: ffprobe.status === "fulfilled",
      maxUploadBytes: MAX_UPLOAD_BYTES,
      smartRepair: true,
    }));
    return capabilityPromise;
  }

  /** Decodes and sanitizes the original upload name without trusting it as a path. */
  function uploadName(request) {
    let decoded = "video.mp4";
    try {
      decoded = decodeURIComponent(String(request.headers["x-file-name"] || decoded));
    } catch (_error) {
      throw new options.HttpError(400, "视频文件名编码无效。");
    }
    return (
      pathApi
        .basename(decoded)
        .normalize("NFKC")
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .slice(0, 180) || "video.mp4"
    );
  }

  /** Streams an uploaded video to bounded local storage and probes its metadata. */
  async function upload(request, response) {
    const declaredLength = Number(request.headers["content-length"] || 0);
    if (!Number.isFinite(declaredLength) || declaredLength <= 0) {
      request.resume();
      options.send(response, 411, { error: "无法确定视频大小，请重新选择文件。" });
      return;
    }
    if (declaredLength > MAX_UPLOAD_BYTES) {
      request.resume();
      options.send(response, 413, { error: "请选择不超过 1 GB 的视频文件。" });
      return;
    }
    if (sources.size >= MAX_SOURCE_COUNT) cleanup(true);
    if (sources.size >= MAX_SOURCE_COUNT) {
      request.resume();
      options.send(response, 429, { error: "本地视频会话过多，请稍后重试。" });
      return;
    }

    const filename = uploadName(request);
    const candidateExtension = pathApi.extname(filename).toLowerCase();
    if (!ALLOWED_VIDEO_EXTENSIONS.has(candidateExtension)) {
      request.resume();
      options.send(response, 415, { error: "请选择 MP4、M4V、MOV 或 WebM 视频。" });
      return;
    }
    const extension = candidateExtension;
    const sourceId = randomUUID();
    const filePath = pathApi.join(uploadRoot, `${sourceId}${extension}`);
    try {
      await pipeline(request, fsApi.createWriteStream(filePath, { flags: "wx" }));
      const fileSize = fsApi.statSync(filePath).size;
      if (fileSize > MAX_UPLOAD_BYTES) throw new options.HttpError(413, "视频超过 1 GB 限制。");
      const { probeVideo } = await coreModulesPromise;
      const metadata = await probeVideo(filePath, { ffprobeBinary });
      sources.set(sourceId, { id: sourceId, filePath, filename, metadata, createdAt: now() });
      options.send(response, 200, { sourceId, filename, metadata });
    } catch (error) {
      fsApi.rmSync(filePath, { force: true });
      options.send(response, Number(error.status || 400), {
        error: `无法读取视频：${error?.message || error}`,
      });
    }
  }

  /** Returns one uploaded source or throws a stable client error. */
  function requireSource(sourceId) {
    const source = sources.get(String(sourceId || ""));
    if (!source || !fsApi.existsSync(source.filePath)) {
      throw new options.HttpError(404, "视频会话已失效，请重新载入视频。");
    }
    return source;
  }

  /** Returns public job fields without exposing local paths or process handles. */
  function publicJob(job) {
    return {
      id: job.id,
      mode: job.mode,
      status: job.status,
      progress: job.progress,
      error: job.error || null,
      downloadUrl:
        job.status === "completed" ? `/api/watermark/download?job=${encodeURIComponent(job.id)}` : null,
    };
  }

  /** Creates a queued export after validating all mode-specific parameters. */
  async function createJob(payload) {
    if (jobs.size >= MAX_JOB_COUNT) cleanup(true);
    if (jobs.size >= MAX_JOB_COUNT) throw new options.HttpError(429, "导出任务过多，请稍后重试。");
    const source = requireSource(payload.sourceId);
    const modules = await coreModulesPromise;
    const mode = payload.mode === "smart" ? "smart" : "delogo";
    const normalized = validateJobOptions(
      mode === "smart" ? modules.normalizeSmartOptions : modules.normalizeRegions,
      mode === "smart" ? payload.smart : payload.regions,
      source.metadata,
      options.HttpError,
    );
    const jobId = randomUUID();
    const finalPath = pathApi.join(exportRoot, `${mode === "smart" ? "clean-smart" : "clean"}-${jobId}.mp4`);
    const job = {
      id: jobId,
      sourceId: source.id,
      mode,
      status: "queued",
      progress: 0,
      createdAt: now(),
      finalPath,
      child: null,
      task:
        mode === "smart"
          ? () => runSmartJob(job, source, normalized, modules)
          : () => runDelogoJob(job, source, normalized, modules),
    };
    jobs.set(jobId, job);
    queue.push(job);
    runNext();
    return publicJob(job);
  }

  /** Runs the next queued export serially to protect local CPU and memory. */
  function runNext() {
    if (disposed || activeJob) return;
    const job = queue.shift();
    if (!job) return;
    activeJob = job;
    job.status = "processing";
    job.progress = 1;
    Promise.resolve()
      .then(job.task)
      .then(() => {
        if (job.status === "cancelled") {
          fsApi.rmSync(job.finalPath, { force: true });
          return;
        }
        job.status = "completed";
        job.progress = 100;
      })
      .catch((error) => {
        job.status = job.status === "cancelled" ? "cancelled" : "failed";
        job.progress = 0;
        job.error = String(error?.message || error);
        fsApi.rmSync(job.finalPath, { force: true });
      })
      .finally(() => {
        job.child = null;
        job.task = null;
        activeJob = null;
        runNext();
      });
  }

  /** Runs FFmpeg's fast multi-region delogo pipeline with progress tracking. */
  async function runDelogoJob(job, source, regions, modules) {
    const temporaryPath = pathApi.join(scratchRoot, `${job.id}.mp4`);
    const args = [
      "-y",
      "-i",
      source.filePath,
      "-vf",
      modules.buildDelogoFilter(regions),
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      temporaryPath,
    ];
    try {
      await runFfmpeg(job, args, source.metadata.duration);
      fsApi.renameSync(temporaryPath, job.finalPath);
    } finally {
      fsApi.rmSync(temporaryPath, { force: true });
    }
  }

  /** Runs the imported foreground-aware smart repair pipeline. */
  async function runSmartJob(job, source, smartOptions, modules) {
    await modules.exportSmartLogo({
      inputPath: source.filePath,
      outputPath: job.finalPath,
      options: smartOptions,
      onProgress(progress) {
        job.progress = Math.max(job.progress, Math.min(99, Number(progress) || 0));
      },
    });
  }

  /** Spawns one FFmpeg process with timeout, bounded diagnostics, and parsed time progress. */
  function runFfmpeg(job, args, duration) {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawnImpl(ffmpegBinary, args, { shell: false, stdio: ["ignore", "ignore", "pipe"] });
      job.child = child;
      let diagnostics = "";
      let settled = false;
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        settle(new Error("FFmpeg 导出超时。"));
      }, PROCESS_TIMEOUT_MS);
      timeout.unref?.();

      function settle(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) rejectPromise(error);
        else resolvePromise();
      }

      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk) => {
        diagnostics = `${diagnostics}${chunk}`.slice(-8_192);
        const matches = diagnostics.match(/time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/g);
        const latest = matches?.at(-1)?.match(/(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
        if (latest && duration > 0) {
          const seconds = Number(latest[1]) * 3600 + Number(latest[2]) * 60 + Number(latest[3]);
          job.progress = Math.min(99, Math.max(job.progress, Math.round((seconds / duration) * 100)));
        }
      });
      child.once("error", settle);
      child.once("close", (code) => {
        if (job.status === "cancelled") return settle(new Error("导出已取消。"));
        if (code === 0) return settle();
        const detail = diagnostics.trim().split("\n").at(-1) || "未知错误";
        return settle(new Error(`FFmpeg 导出失败（代码 ${code}）：${detail}`));
      });
    });
  }

  /** Cancels a queued or active regular export. */
  function cancelJob(jobId) {
    const job = jobs.get(String(jobId || ""));
    if (!job) throw new options.HttpError(404, "导出任务不存在。");
    if (["completed", "failed", "cancelled"].includes(job.status)) return publicJob(job);
    if (job === activeJob && job.mode === "smart") {
      throw new options.HttpError(409, "智能白印任务正在逐帧处理，当前版本无法安全中断。");
    }
    job.status = "cancelled";
    job.error = "导出已取消。";
    const queueIndex = queue.indexOf(job);
    if (queueIndex >= 0) queue.splice(queueIndex, 1);
    job.child?.kill?.("SIGTERM");
    return publicJob(job);
  }

  /** Streams a local media file with single-range seeking support. */
  function streamFile(request, response, filePath, contentType, attachmentName = "") {
    const stats = fsApi.statSync(filePath);
    const range = String(request.headers.range || "");
    const headers = { "content-type": contentType, "accept-ranges": "bytes", "cache-control": "no-store" };
    if (attachmentName)
      headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(attachmentName)}`;
    const attachGuards = (stream) => {
      stream.on("error", (error) => {
        console.error("Watermark media stream failed:", error);
        if (!response.destroyed) response.destroy(error);
      });
      response.on("close", () => stream.destroy());
      return stream;
    };
    if (!range) {
      response.writeHead(200, { ...headers, "content-length": stats.size });
      return attachGuards(fsApi.createReadStream(filePath)).pipe(response);
    }
    const match = range.match(/^bytes=(\d+)-(\d*)$/);
    const start = Number(match?.[1]);
    const end = match?.[2] ? Number(match[2]) : stats.size - 1;
    if (
      !match ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      start > end ||
      end >= stats.size
    ) {
      response.writeHead(416, { ...headers, "content-range": `bytes */${stats.size}` });
      response.end();
      return null;
    }
    response.writeHead(206, {
      ...headers,
      "content-length": end - start + 1,
      "content-range": `bytes ${start}-${end}/${stats.size}`,
    });
    return attachGuards(fsApi.createReadStream(filePath, { start, end })).pipe(response);
  }

  /** Removes expired or terminal local resources without touching active jobs. */
  function cleanup(aggressive = false) {
    const cutoff = now() - (aggressive ? 0 : RESOURCE_TTL_MS);
    for (const [jobId, job] of jobs) {
      if (["queued", "processing"].includes(job.status) || job.createdAt > cutoff) continue;
      fsApi.rmSync(job.finalPath, { force: true });
      jobs.delete(jobId);
    }
    const activeSourceIds = new Set(Array.from(jobs.values(), (job) => job.sourceId));
    for (const [sourceId, source] of sources) {
      if (activeSourceIds.has(sourceId) || source.createdAt > cutoff) continue;
      fsApi.rmSync(source.filePath, { force: true });
      sources.delete(sourceId);
    }
  }

  /** Handles the Watermark Studio API namespace and media streams. */
  async function handle(request, response, url) {
    const pathname = url.pathname;
    if (request.method === "GET" && pathname === "/api/watermark/capabilities") {
      options.send(response, 200, await capabilities());
      return true;
    }
    if (isUploadRequest(request, url)) {
      await upload(request, response);
      return true;
    }
    if (request.method === "GET" && pathname === "/api/watermark/source") {
      const source = requireSource(url.searchParams.get("source"));
      streamFile(
        request,
        response,
        source.filePath,
        VIDEO_CONTENT_TYPES[pathApi.extname(source.filePath).toLowerCase()] || "application/octet-stream",
      );
      return true;
    }
    if (request.method === "DELETE" && pathname === "/api/watermark/source") {
      options.send(
        response,
        200,
        removeStoredSource({
          sourceId: url.searchParams.get("source"),
          sources,
          jobs,
          fsApi,
          HttpError: options.HttpError,
        }),
      );
      return true;
    }
    if (request.method === "POST" && pathname === "/api/watermark/jobs") {
      options.send(response, 202, await createJob(await options.readJsonBody(request, pathname)));
      return true;
    }
    if (request.method === "GET" && pathname.startsWith("/api/watermark/jobs/")) {
      const job = jobs.get(pathname.slice("/api/watermark/jobs/".length));
      if (!job) throw new options.HttpError(404, "导出任务不存在。");
      options.send(response, 200, publicJob(job));
      return true;
    }
    if (request.method === "POST" && pathname === "/api/watermark/cancel") {
      const payload = await options.readJsonBody(request, pathname);
      options.send(response, 200, cancelJob(payload.jobId));
      return true;
    }
    if (request.method === "GET" && pathname === "/api/watermark/download") {
      const job = jobs.get(String(url.searchParams.get("job") || ""));
      if (!job || job.status !== "completed" || !fsApi.existsSync(job.finalPath)) {
        throw new options.HttpError(404, "导出文件不存在或已过期。");
      }
      streamFile(
        request,
        response,
        job.finalPath,
        "video/mp4",
        `watermark-repaired-${job.id.slice(0, 8)}.mp4`,
      );
      return true;
    }
    return false;
  }

  const cleanupTimer = setInterval(cleanup, 10 * 60 * 1000);
  cleanupTimer.unref?.();

  /** Stops timers and active child processes during server shutdown. */
  function dispose() {
    disposed = true;
    clearInterval(cleanupTimer);
    activeJob?.child?.kill?.("SIGTERM");
  }

  return { dispose, handle, isUploadRequest, validateUploadRequest };
}

module.exports = { createWatermarkStudioService, removeStoredSource, validateJobOptions };
