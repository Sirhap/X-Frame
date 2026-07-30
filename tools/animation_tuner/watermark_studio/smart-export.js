import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { buildBrightLogoMask, repairSmartLogoFrame } from "./smart-logo-utils.js";
import { probeVideo } from "./video-utils.js";

const DEFAULT_FONT_FILE = "/System/Library/Fonts/STHeiti Medium.ttc";
const FFMPEG_BINARY = process.env.XSXB_FFMPEG || "ffmpeg";
const MIN_REGION_SIZE = 8;
const MAX_TITLE_LENGTH = 100;

/**
 * @typedef {{width: number, height: number, duration: number, fps: number}} VideoMetadata
 * @typedef {{x: number, y: number, width: number, height: number}} SmartRegion
 * @typedef {{text: string, startTime: number, fontFile: string, fontSize: number, borderWidth: number, x: number, y: number, fontColor: string}} SmartTitle
 * @typedef {{referenceTime: number, region: SmartRegion, title: SmartTitle|null}} SmartOptions
 */

/**
 * Validates browser or CLI options against the active video.
 * @param {unknown} input Candidate smart-repair configuration.
 * @param {VideoMetadata} video Active video metadata.
 * @returns {SmartOptions}
 */
export function normalizeSmartOptions(input, video) {
  if (!input || typeof input !== "object") throw new Error("缺少智能修复参数");
  const candidate = /** @type {Record<string, unknown>} */ (input);
  const referenceTime = readFiniteNumber(candidate.referenceTime, "参考帧时间");
  if (referenceTime < 0 || referenceTime > video.duration) {
    throw new Error(`参考帧时间必须在 0—${video.duration.toFixed(2)} 秒之间`);
  }

  const regionInput = candidate.region;
  if (!regionInput || typeof regionInput !== "object") throw new Error("请框选一个智能修复区域");
  const regionCandidate = /** @type {Record<string, unknown>} */ (regionInput);
  const x = Math.round(readFiniteNumber(regionCandidate.x, "区域 X"));
  const y = Math.round(readFiniteNumber(regionCandidate.y, "区域 Y"));
  const width = Math.round(readFiniteNumber(regionCandidate.width, "区域宽度"));
  const height = Math.round(readFiniteNumber(regionCandidate.height, "区域高度"));
  if (width < MIN_REGION_SIZE || height < MIN_REGION_SIZE) {
    throw new Error(`智能修复区域至少需要 ${MIN_REGION_SIZE}×${MIN_REGION_SIZE} 像素`);
  }
  if (x < 0 || y < 0 || x + width > video.width || y + height > video.height) {
    throw new Error("智能修复区域超出视频画面");
  }

  const title = candidate.title ? normalizeTitle(candidate.title, video) : null;
  return { referenceTime, region: { x, y, width, height }, title };
}

/**
 * Repairs a fixed bright logo frame-by-frame and optionally redraws a foreground title.
 * @param {{inputPath: string, outputPath: string, options: unknown, previewTime?: number|null, onProgress?: (progress: number) => void}} request Export request.
 * @returns {Promise<{frameCount: number, metadata: VideoMetadata, preview: boolean}>}
 */
export async function exportSmartLogo(request) {
  const metadata = await probeVideo(request.inputPath);
  const options = normalizeSmartOptions(request.options, metadata);
  const previewTime = request.previewTime ?? null;
  if (
    previewTime !== null &&
    (!Number.isFinite(previewTime) || previewTime < 0 || previewTime > metadata.duration)
  ) {
    throw new Error("预览时间超出视频时长");
  }

  await mkdir(dirname(request.outputPath), { recursive: true });
  request.onProgress?.(1);
  const referenceFrame = await captureRgbFrame(
    request.inputPath,
    options.referenceTime,
    metadata.width,
    metadata.height,
  );
  const logoMask = buildBrightLogoMask(referenceFrame, metadata.width, options.region);
  request.onProgress?.(3);

  if (previewTime !== null) {
    const previewFrame = await captureRgbFrame(
      request.inputPath,
      previewTime,
      metadata.width,
      metadata.height,
    );
    const repairedFrame = repairSmartLogoFrame(previewFrame, metadata.width, options.region, logoMask);
    const previewFilter =
      options.title && previewTime >= options.title.startTime
        ? buildTitleFilter({ ...options.title, startTime: 0 })
        : null;
    await encodePreview(repairedFrame, metadata.width, metadata.height, request.outputPath, previewFilter);
    request.onProgress?.(100);
    return { frameCount: 1, metadata, preview: true };
  }

  const temporaryVideoPath = `${request.outputPath}.video-only.tmp.mp4`;
  const temporaryOutputPath = `${request.outputPath}.muxed.tmp.mp4`;
  try {
    const frameCount = await encodeRepairedVideo({
      inputPath: request.inputPath,
      outputPath: temporaryVideoPath,
      metadata,
      region: options.region,
      logoMask,
      videoFilter: options.title ? buildTitleFilter(options.title) : null,
      onProgress: request.onProgress,
    });
    request.onProgress?.(96);
    await remuxAudio(temporaryVideoPath, request.inputPath, temporaryOutputPath);
    request.onProgress?.(99);
    await rename(temporaryOutputPath, request.outputPath);
    request.onProgress?.(100);
    return { frameCount, metadata, preview: false };
  } finally {
    await Promise.all([
      unlink(temporaryVideoPath).catch(() => {}),
      unlink(temporaryOutputPath).catch(() => {}),
    ]);
  }
}

/** Validates and normalizes a foreground title configuration. */
function normalizeTitle(input, video) {
  if (!input || typeof input !== "object") throw new Error("标题参数无效");
  const candidate = /** @type {Record<string, unknown>} */ (input);
  const text = String(candidate.text ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim();
  if (!text) throw new Error("请输入需要重绘的标题文字");
  if (text.length > MAX_TITLE_LENGTH) throw new Error(`标题不能超过 ${MAX_TITLE_LENGTH} 个字符`);
  const startTime = readFiniteNumber(candidate.startTime, "标题开始时间");
  if (startTime < 0 || startTime > video.duration) throw new Error("标题开始时间超出视频时长");
  const fontSize = readIntegerInRange(candidate.fontSize, "标题字号", 8, 400);
  const borderWidth = readIntegerInRange(candidate.borderWidth, "标题描边", 0, 50);
  const x = readIntegerInRange(candidate.x, "标题 X", 0, video.width);
  const y = readIntegerInRange(candidate.y, "标题 Y", 0, video.height);
  const fontColor = normalizeFontColor(candidate.fontColor);
  const fontFile = DEFAULT_FONT_FILE;
  return { text, startTime, fontFile, fontSize, borderWidth, x, y, fontColor };
}

/** Reads one required finite numeric value. */
function readFiniteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label}不是有效数字`);
  return number;
}

/** Reads an integer constrained to an inclusive range. */
function readIntegerInRange(value, label, minimum, maximum) {
  const number = Math.round(readFiniteNumber(value, label));
  if (number < minimum || number > maximum) {
    throw new Error(`${label}必须在 ${minimum}—${maximum} 之间`);
  }
  return number;
}

/** Accepts an RGB HTML color or FFmpeg hexadecimal color. */
function normalizeFontColor(value) {
  const color = String(value ?? "0xffdf22");
  if (/^#[\da-f]{6}$/i.test(color)) return `0x${color.slice(1)}`;
  if (/^0x[\da-f]{6}(?:[\da-f]{2})?$/i.test(color)) return color;
  throw new Error("标题颜色必须是六位十六进制颜色");
}

/** Captures one RGB24 frame at the requested timestamp. */
async function captureRgbFrame(inputPath, time, width, height) {
  const output = await captureProcess(FFMPEG_BINARY, [
    "-v",
    "error",
    "-ss",
    String(time),
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "pipe:1",
  ]);
  const expectedLength = width * height * 3;
  if (output.length !== expectedLength) {
    throw new Error(`参考帧大小异常：期望 ${expectedLength} 字节，实际 ${output.length} 字节`);
  }
  return output;
}

/** Encodes one RGB24 frame as a PNG preview. */
async function encodePreview(frame, width, height, outputPath, videoFilter) {
  const argumentsList = [
    "-y",
    "-v",
    "error",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-s",
    `${width}x${height}`,
    "-i",
    "pipe:0",
  ];
  if (videoFilter) argumentsList.push("-vf", videoFilter);
  argumentsList.push("-frames:v", "1", outputPath);
  await runProcessWithInput(FFMPEG_BINARY, argumentsList, frame);
}

/** Streams decoded frames through the smart repair algorithm and into H.264. */
async function encodeRepairedVideo(request) {
  const frameSize = request.metadata.width * request.metadata.height * 3;
  const estimatedFrameCount = Math.max(1, request.metadata.duration * request.metadata.fps);
  const decoder = spawn(
    FFMPEG_BINARY,
    [
      "-v",
      "error",
      "-i",
      request.inputPath,
      "-map",
      "0:v:0",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const encoderArguments = [
    "-y",
    "-v",
    "error",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-s",
    `${request.metadata.width}x${request.metadata.height}`,
    "-r",
    String(request.metadata.fps),
    "-i",
    "pipe:0",
    "-an",
  ];
  if (request.videoFilter) encoderArguments.push("-vf", request.videoFilter);
  encoderArguments.push(
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    request.outputPath,
  );
  const encoder = spawn(FFMPEG_BINARY, encoderArguments, { stdio: ["pipe", "ignore", "pipe"] });
  const decoderError = collectText(decoder.stderr);
  const encoderError = collectText(encoder.stderr);
  const decoderClosed = once(decoder, "close");
  const encoderClosed = once(encoder, "close");
  let pending = Buffer.alloc(0);
  let frameCount = 0;

  try {
    for await (const chunk of decoder.stdout) {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= frameSize) {
        const sourceFrame = pending.subarray(0, frameSize);
        pending = pending.subarray(frameSize);
        const repairedFrame = repairSmartLogoFrame(
          sourceFrame,
          request.metadata.width,
          request.region,
          request.logoMask,
        );
        if (!encoder.stdin.write(repairedFrame)) await once(encoder.stdin, "drain");
        frameCount += 1;
        if (frameCount % 4 === 0) {
          request.onProgress?.(Math.min(95, 3 + Math.round((frameCount / estimatedFrameCount) * 92)));
        }
      }
    }
    if (pending.length) throw new Error(`解码尾部包含 ${pending.length} 个不完整字节`);
    encoder.stdin.end();
    const [[decoderCode], [encoderCode]] = await Promise.all([decoderClosed, encoderClosed]);
    if (decoderCode !== 0) throw new Error(`FFmpeg 解码失败：${await decoderError}`);
    if (encoderCode !== 0) throw new Error(`FFmpeg 编码失败：${await encoderError}`);
    if (!frameCount) throw new Error("没有解码到任何视频帧");
    return frameCount;
  } catch (error) {
    decoder.kill("SIGTERM");
    encoder.kill("SIGTERM");
    encoder.stdin.destroy();
    throw error;
  }
}

/** Remuxes source audio without another video encode. */
async function remuxAudio(videoPath, inputPath, outputPath) {
  await runProcessWithInput(FFMPEG_BINARY, [
    "-y",
    "-v",
    "error",
    "-i",
    videoPath,
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a?",
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

/** Builds an escaped FFmpeg drawtext filter for a reconstructed title. */
function buildTitleFilter(options) {
  return [
    `drawtext=fontfile='${escapeFilterValue(options.fontFile)}'`,
    `text='${escapeFilterValue(options.text)}'`,
    "expansion=none",
    `fontcolor=${options.fontColor}`,
    "bordercolor=black",
    `borderw=${options.borderWidth}`,
    `fontsize=${options.fontSize}`,
    `x=${options.x}`,
    `y=${options.y}`,
    `enable='gte(t,${options.startTime})'`,
  ].join(":");
}

/** Escapes a literal used inside a single-quoted FFmpeg filter value. */
function escapeFilterValue(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("'", "\\'");
}

/** Captures binary stdout while surfacing stderr on failure. */
async function captureProcess(command, argumentsList) {
  const child = spawn(command, argumentsList, { stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = collectText(child.stderr);
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  const [code] = await once(child, "close");
  if (code !== 0) throw new Error(`${command} 执行失败：${await stderr}`);
  return Buffer.concat(stdout);
}

/** Runs a process with optional binary stdin and contextual failure output. */
async function runProcessWithInput(command, argumentsList, input = null) {
  const child = spawn(command, argumentsList, { stdio: ["pipe", "ignore", "pipe"] });
  const stderr = collectText(child.stderr);
  child.stdin.end(input ?? undefined);
  const [code] = await once(child, "close");
  if (code !== 0) throw new Error(`${command} 执行失败：${await stderr}`);
}

/** Collects one UTF-8 diagnostic stream. */
async function collectText(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}
