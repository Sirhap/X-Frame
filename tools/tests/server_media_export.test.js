"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");
const { createMediaExportService, pngSize, safeStem } = require("../animation_tuner/server_media_export");

/** Computes a PNG chunk CRC-32. @param {Buffer} bytes Chunk type and data. */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Creates one complete PNG chunk. @param {string} type Type. @param {Buffer} data Data. */
function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), chunk.length - 4);
  return chunk;
}

/** Creates a valid RGBA PNG with both opaque and transparent pixels. */
function pngBytes(width, height, frameIndex = 0) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    for (let x = 0; x < width; x += 1) {
      const pixel = row + 1 + x * 4;
      scanlines[pixel] = (x * 17 + frameIndex * 53) % 256;
      scanlines[pixel + 1] = (y * 19 + 80) % 256;
      scanlines[pixel + 2] = 220;
      scanlines[pixel + 3] = x < width / 2 ? 0 : 255;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Creates a valid PNG data URL. */
function pngDataUrl(width, height, frameIndex = 0) {
  return `data:image/png;base64,${pngBytes(width, height, frameIndex).toString("base64")}`;
}

/** Creates a successful child-process stub with realistic FFmpeg probe output. */
function successfulSpawn(_command, args) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => child.emit("close", null, "SIGTERM");
  queueMicrotask(() => {
    if (args.includes("-version")) child.stdout.emit("data", "ffmpeg version 7.1.1-test\n");
    if (args.includes("-encoders")) {
      child.stdout.emit("data", " V....D gif GIF image\n V....D prores_ks Apple ProRes\n");
    }
    child.emit("close", 0, null);
  });
  return child;
}

/** Polls until a job reaches the requested state. */
async function waitForStatus(service, jobId, expected, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = service.status(jobId);
    if (expected.includes(snapshot.status)) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Job did not reach ${expected.join("/")} before timeout.`);
}

/** Polls until an arbitrary test condition succeeds. */
async function waitForCondition(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Condition was not reached before timeout.");
}

test("media export validates PNG dimensions and duplicate frame indexes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-media-export-"));
  const service = createMediaExportService({
    root,
    randomUUID: () => "job-1",
    spawnImpl: successfulSpawn,
  });
  const job = service.createJob({
    formats: ["gif"],
    frameCount: 2,
    fps: 12,
    width: 32,
    height: 24,
    animationName: "Hero / Idle",
  });
  assert.equal(job.id, "job-1");
  assert.deepEqual(service.uploadFrame({ jobId: job.id, index: 0, data: pngDataUrl(32, 24) }), {
    uploaded: 1,
    frameCount: 2,
  });
  assert.throws(
    () => service.uploadFrame({ jobId: job.id, index: 0, data: pngDataUrl(32, 24) }),
    /already uploaded/,
  );
  assert.throws(
    () => service.uploadFrame({ jobId: job.id, index: 1, data: pngDataUrl(16, 24) }),
    /expected 32×24/,
  );
  assert.throws(() => service.finishJob({ jobId: job.id }), /Expected 2 frames/);
  service.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

test("media export rejects malformed jobs, frames, and traversal-like output requests", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-media-export-"));
  const service = createMediaExportService({
    root,
    randomUUID: () => "job-2",
    spawnImpl: successfulSpawn,
  });
  assert.throws(
    () => service.createJob({ formats: ["png"], frameCount: 1, width: 2, height: 2 }),
    /Only GIF, MP4 and MOV/,
  );
  assert.throws(
    () => service.createJob({ formats: ["mov"], frameCount: 1.5, width: 2, height: 2 }),
    /Frame count/,
  );
  assert.throws(
    () => service.createJob({ formats: ["mov"], frameCount: 1, fps: Infinity, width: 2, height: 2 }),
    /FPS/,
  );
  const job = service.createJob({ formats: ["mov"], frameCount: 1, width: 2, height: 2 });
  assert.throws(
    () => service.uploadFrame({ jobId: job.id, index: 0.5, data: pngDataUrl(2, 2) }),
    /outside the export range/,
  );
  assert.throws(
    () => service.uploadFrame({ jobId: job.id, index: 0, data: "data:image/png;base64,AAAA====" }),
    /base64 PNG/,
  );
  assert.throws(() => service.outputFile(job.id, "../secret"), /not complete/);
  service.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

test("media export rejects unsafe random IDs and oversized canvases", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-media-export-"));
  const service = createMediaExportService({
    root,
    randomUUID: () => "../escape",
    spawnImpl: successfulSpawn,
  });
  assert.throws(
    () => service.createJob({ formats: ["gif"], frameCount: 1, width: 8193, height: 1 }),
    /canvas/,
  );
  assert.throws(
    () => service.createJob({ formats: ["gif"], frameCount: 1, width: 1, height: 1 }),
    /allocate/,
  );
  assert.equal(fs.existsSync(path.join(root, "output", "escape")), false);
  service.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

test("media export helpers validate complete PNGs and preserve Unicode names", () => {
  const payload = pngBytes(48, 36);
  assert.deepEqual(pngSize(payload), { width: 48, height: 36 });
  assert.equal(safeStem(" Hero / Idle .. "), "Hero_Idle_..");
  assert.equal(safeStem("角色 待机"), "角色_待机");
  assert.equal(safeStem(".."), "animation");
  assert.throws(() => pngSize(Buffer.alloc(24)), /valid PNG/);
  assert.throws(() => pngSize(payload.subarray(0, -12)), /IEND|truncated/);
});

test("media export reads the FFmpeg version from stdout and detects encoders", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-media-export-"));
  const service = createMediaExportService({ root, spawnImpl: successfulSpawn });
  assert.deepEqual(await service.capabilities(), {
    ffmpeg: { available: true, version: "7.1.1-test" },
    formats: { gif: true, mp4: false, mov: true },
  });
  service.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

test("media export reports missing FFmpeg and isolates encoder failures", async () => {
  const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-media-export-"));
  const missingSpawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => child.emit("error", Object.assign(new Error("ENOENT"), { code: "ENOENT" })));
    return child;
  };
  const missingService = createMediaExportService({ root: missingRoot, spawnImpl: missingSpawn });
  assert.deepEqual(await missingService.capabilities(), {
    ffmpeg: { available: false, version: "" },
    formats: { gif: false, mp4: false, mov: false },
  });
  missingService.dispose();
  fs.rmSync(missingRoot, { recursive: true, force: true });

  const failureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-media-export-"));
  const failingSpawn = (command, args, options) => {
    if (args.includes("-version") || args.includes("-encoders")) {
      return successfulSpawn(command, args, options);
    }
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stderr.emit("data", "synthetic encoder failure");
      child.emit("close", 1, null);
    });
    return child;
  };
  const failureService = createMediaExportService({
    root: failureRoot,
    randomUUID: () => "failed-job",
    spawnImpl: failingSpawn,
  });
  const failedJob = failureService.createJob({ formats: ["gif"], frameCount: 1, width: 2, height: 2 });
  failureService.uploadFrame({ jobId: failedJob.id, index: 0, data: pngDataUrl(2, 2) });
  failureService.finishJob({ jobId: failedJob.id });
  const failedStatus = await waitForStatus(failureService, failedJob.id, ["failed"]);
  assert.match(failedStatus.error, /synthetic encoder failure/);
  failureService.dispose();
  fs.rmSync(failureRoot, { recursive: true, force: true });
});

test("media export cancellation terminates active FFmpeg and removes temporary files", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-media-export-"));
  const signals = [];
  let encodingStarted = false;
  const spawnImpl = (command, args, options) => {
    if (args.includes("-version") || args.includes("-encoders")) {
      return successfulSpawn(command, args, options);
    }
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    encodingStarted = true;
    child.kill = (signal) => {
      signals.push(signal);
      queueMicrotask(() => child.emit("close", null, signal));
    };
    return child;
  };
  const service = createMediaExportService({
    root,
    randomUUID: () => "cancel-job",
    spawnImpl,
    processKillGraceMs: 10,
  });
  const job = service.createJob({ formats: ["gif"], frameCount: 1, width: 8, height: 8 });
  service.uploadFrame({ jobId: job.id, index: 0, data: pngDataUrl(8, 8) });
  service.finishJob({ jobId: job.id });
  await waitForCondition(() => encodingStarted);
  assert.equal(service.cancel({ jobId: job.id }).status, "cancelled");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(signals, ["SIGTERM"]);
  assert.equal(fs.existsSync(path.join(root, "output", "media-exports", job.id)), false);
  assert.equal(service.status(job.id).status, "cancelled");
  service.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

test("media export timeout hard-kills an unresponsive process and fails the job", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-media-export-"));
  const signals = [];
  const spawnImpl = (command, args, options) => {
    if (args.includes("-version") || args.includes("-encoders")) {
      return successfulSpawn(command, args, options);
    }
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (signal) => signals.push(signal);
    return child;
  };
  const service = createMediaExportService({
    root,
    randomUUID: () => "timeout-job",
    spawnImpl,
    processTimeoutMs: 10,
    processKillGraceMs: 10,
  });
  const job = service.createJob({ formats: ["mov"], frameCount: 1, width: 8, height: 8 });
  service.uploadFrame({ jobId: job.id, index: 0, data: pngDataUrl(8, 8) });
  service.finishJob({ jobId: job.id });
  const status = await waitForStatus(service, job.id, ["failed"]);
  assert.match(status.error, /timed out/);
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  service.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

test("media export cleanup expires stale jobs and restart orphan directories", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-media-export-"));
  const exportRoot = path.join(root, "output", "media-exports");
  fs.mkdirSync(path.join(exportRoot, "stale-orphan"), { recursive: true });
  fs.utimesSync(path.join(exportRoot, "stale-orphan"), new Date(0), new Date(0));
  let time = 1_000;
  const service = createMediaExportService({
    root,
    randomUUID: () => "stale-job",
    spawnImpl: successfulSpawn,
    now: () => time,
    jobTtlMs: 100,
  });
  const job = service.createJob({ formats: ["gif"], frameCount: 1, width: 2, height: 2 });
  time += 101;
  service.cleanup();
  assert.throws(() => service.status(job.id), /not found/);
  assert.equal(fs.existsSync(path.join(exportRoot, job.id)), false);
  assert.equal(fs.existsSync(path.join(exportRoot, "stale-orphan")), false);
  service.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

test("media export persists safe atomic metadata and public lifecycle fields", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-media-export-"));
  const service = createMediaExportService({
    root,
    randomUUID: () => "metadata-job",
    spawnImpl: successfulSpawn,
  });
  const created = service.createJob({
    formats: ["gif", "mov"],
    frameCount: 1,
    fps: 24,
    width: 8,
    height: 6,
    animationName: "角色 待机",
  });
  assert.equal(created.status, "uploading");
  assert.equal(created.animationName, "角色 待机");
  assert.deepEqual(created.formats, ["gif", "mov"]);
  assert.equal(created.expiresAt - created.updatedAt, 60 * 60 * 1000);
  const directory = path.join(root, "output", "media-exports", created.id);
  const metadataText = fs.readFileSync(path.join(directory, "job.json"), "utf8");
  const metadata = JSON.parse(metadataText);
  assert.equal(metadata.schemaVersion, 1);
  assert.equal(metadata.animationName, "角色 待机");
  assert.equal(metadata.directory, undefined);
  assert.equal(metadata.frameDirectory, undefined);
  assert.equal(metadata.child, undefined);
  assert.equal(metadataText.includes(root), false);
  assert.deepEqual(
    fs.readdirSync(directory).filter((name) => name.endsWith(".tmp")),
    [],
  );
  service.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

test("media export restart recovers completed jobs and fails interrupted states", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-media-export-"));
  const first = createMediaExportService({
    root,
    randomUUID: () => "recover-job",
    spawnImpl: successfulSpawn,
  });
  const created = first.createJob({
    formats: ["gif"],
    frameCount: 1,
    width: 4,
    height: 4,
    animationName: "Recover",
  });
  first.uploadFrame({ jobId: created.id, index: 0, data: pngDataUrl(4, 4) });
  first.finishJob({ jobId: created.id });
  await waitForStatus(first, created.id, ["completed"]);
  const jobDirectory = path.join(root, "output", "media-exports", created.id);
  fs.writeFileSync(path.join(jobDirectory, "Recover.gif"), "gif-output");
  first.dispose();

  const recovered = createMediaExportService({ root, spawnImpl: successfulSpawn });
  const completed = recovered.status(created.id);
  assert.equal(completed.status, "completed");
  assert.equal(completed.downloads[0].filename, "Recover.gif");
  assert.equal(fs.existsSync(path.join(jobDirectory, "frames")), false);
  assert.equal(fs.existsSync(path.join(jobDirectory, "palette.png")), false);
  recovered.dispose();

  for (const interruptedState of ["uploading", "queued", "running"]) {
    const id = `interrupted-${interruptedState}`;
    const directory = path.join(root, "output", "media-exports", id);
    fs.cpSync(jobDirectory, directory, { recursive: true });
    const metadataFile = path.join(directory, "job.json");
    const metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
    metadata.id = id;
    metadata.status = interruptedState;
    metadata.outputs = [];
    fs.writeFileSync(metadataFile, JSON.stringify(metadata));
  }
  const restarted = createMediaExportService({ root, spawnImpl: successfulSpawn });
  for (const interruptedState of ["uploading", "queued", "running"]) {
    const status = restarted.status(`interrupted-${interruptedState}`);
    assert.equal(status.status, "failed");
    assert.equal(status.errorCode, "server_restarted");
    assert.match(status.error, /restarted/);
  }
  restarted.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

test("media export startup removes invalid and expired persisted jobs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-media-export-"));
  const exportRoot = path.join(root, "output", "media-exports");
  fs.mkdirSync(path.join(exportRoot, "invalid-job"), { recursive: true });
  fs.writeFileSync(path.join(exportRoot, "invalid-job", "job.json"), "{broken");
  const expiredDirectory = path.join(exportRoot, "expired-job");
  fs.mkdirSync(expiredDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(expiredDirectory, "job.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "expired-job",
      status: "failed",
      formats: ["gif"],
      animationName: "Expired",
      frameCount: 1,
      fps: 12,
      width: 1,
      height: 1,
      bytes: 0,
      uploaded: [],
      progress: 0,
      error: "",
      errorCode: "",
      outputs: [],
      createdAt: 1,
      updatedAt: 1,
      expiresAt: 2,
    }),
  );
  const service = createMediaExportService({ root, now: () => 10, spawnImpl: successfulSpawn });
  assert.equal(fs.existsSync(path.join(exportRoot, "invalid-job")), false);
  assert.equal(fs.existsSync(expiredDirectory), false);
  service.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

const ffmpegAvailable = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const ffprobeAvailable = spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

test(
  "media export creates probeable GIF and alpha ProRes MOV files",
  { skip: !(ffmpegAvailable && ffprobeAvailable), timeout: 15_000 },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-media-export-integration-"));
    const service = createMediaExportService({ root, randomUUID: () => "real-job" });
    const job = service.createJob({
      formats: ["gif", "mov"],
      frameCount: 3,
      fps: 12,
      width: 16,
      height: 16,
      animationName: "Real Alpha",
    });
    for (let index = 0; index < 3; index += 1) {
      service.uploadFrame({ jobId: job.id, index, data: pngDataUrl(16, 16, index) });
    }
    service.finishJob({ jobId: job.id });
    const status = await waitForStatus(service, job.id, ["completed", "failed"], 12_000);
    assert.equal(status.status, "completed", status.error);
    const gif = service.outputFile(job.id, "Real_Alpha.gif");
    const mov = service.outputFile(job.id, "Real_Alpha.mov");
    assert.throws(() => service.outputFile(job.id, "../Real_Alpha.mov"), /not found/);
    const probe = (filename) => {
      const result = spawnSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-count_frames",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=codec_name,pix_fmt,nb_read_frames:format=duration",
          "-of",
          "json",
          filename,
        ],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const gifProbe = probe(gif.filename);
    const movProbe = probe(mov.filename);
    // concat repeats the final PNG once so FFmpeg can retain its declared duration.
    assert.equal(gifProbe.streams[0].nb_read_frames, "4");
    assert.equal(movProbe.streams[0].codec_name, "prores");
    assert.equal(movProbe.streams[0].nb_read_frames, "4");
    // prores_ks accepts yuva444p10le input; FFmpeg 7 decodes the stored 4444 stream as 12-bit.
    assert.match(movProbe.streams[0].pix_fmt, /^yuva444p(?:10|12)le$/);
    assert.ok(Number(gifProbe.format.duration) > 0);
    assert.ok(Number(movProbe.format.duration) > 0);
    const decoded = spawnSync(
      "ffmpeg",
      ["-v", "error", "-i", mov.filename, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"],
      { maxBuffer: 1024 * 1024 },
    );
    assert.equal(decoded.status, 0, decoded.stderr.toString());
    const alphaValues = decoded.stdout.filter((_value, index) => index % 4 === 3);
    assert.ok(
      alphaValues.some((alpha) => alpha < 16),
      "MOV should preserve transparent pixels.",
    );
    assert.ok(
      alphaValues.some((alpha) => alpha > 239),
      "MOV should preserve opaque pixels.",
    );
    service.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  },
);
