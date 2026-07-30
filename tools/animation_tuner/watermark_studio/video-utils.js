import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_REGIONS = 8;
const MIN_REGION_SIZE = 8;
const DELOGO_SAFE_BORDER = 1;

/**
 * Runs ffprobe and returns the metadata needed by the editor.
 * @param {string} filePath Absolute path to a video file.
 * @param {{ffprobeBinary?:string}} [options] Optional local binary override.
 * @returns {Promise<{width: number, height: number, duration: number, fps: number}>}
 */
export async function probeVideo(filePath, options = {}) {
  const { stdout } = await execFileAsync(options.ffprobeBinary || process.env.XSXB_FFPROBE || "ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,r_frame_rate:format=duration",
    "-of",
    "json",
    filePath,
  ]);
  const result = JSON.parse(stdout);
  const stream = result.streams?.[0];
  if (!stream?.width || !stream?.height) {
    throw new Error("未检测到有效的视频轨道");
  }

  const [numerator, denominator] = String(stream.r_frame_rate ?? "0/1")
    .split("/")
    .map(Number);
  return {
    width: stream.width,
    height: stream.height,
    duration: Number(result.format?.duration ?? 0),
    fps: denominator ? numerator / denominator : 0,
  };
}

/**
 * Clamps and normalizes user-created regions to safe integer pixel bounds.
 * @param {unknown} input Candidate region list.
 * @param {{width: number, height: number, duration: number}} video Video dimensions and duration.
 * @returns {Array<{x: number, y: number, width: number, height: number, startTime: number, endTime: number}>}
 */
export function normalizeRegions(input, video) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("请至少框选一个水印区域");
  }
  if (input.length > MAX_REGIONS) {
    throw new Error(`最多支持 ${MAX_REGIONS} 个水印区域`);
  }
  if (!Number.isInteger(video.width) || !Number.isInteger(video.height)) {
    throw new Error("视频尺寸无效");
  }
  if (
    video.width < MIN_REGION_SIZE + DELOGO_SAFE_BORDER * 2 ||
    video.height < MIN_REGION_SIZE + DELOGO_SAFE_BORDER * 2
  ) {
    throw new Error(
      `视频尺寸过小，至少需要 ${MIN_REGION_SIZE + DELOGO_SAFE_BORDER * 2}×${MIN_REGION_SIZE + DELOGO_SAFE_BORDER * 2} 像素`,
    );
  }

  return input.map((region, index) => {
    const values = [
      region?.x,
      region?.y,
      region?.width,
      region?.height,
      region?.startTime,
      region?.endTime,
    ].map(Number);
    if (values.some((value) => !Number.isFinite(value))) {
      throw new Error(`区域 ${index + 1} 包含无效坐标`);
    }

    const maximumX = video.width - MIN_REGION_SIZE - DELOGO_SAFE_BORDER;
    const maximumY = video.height - MIN_REGION_SIZE - DELOGO_SAFE_BORDER;
    const x = clamp(Math.round(values[0]), DELOGO_SAFE_BORDER, maximumX);
    const y = clamp(Math.round(values[1]), DELOGO_SAFE_BORDER, maximumY);
    const width = clamp(Math.round(values[2]), MIN_REGION_SIZE, video.width - x - DELOGO_SAFE_BORDER);
    const height = clamp(Math.round(values[3]), MIN_REGION_SIZE, video.height - y - DELOGO_SAFE_BORDER);
    if (values[2] < MIN_REGION_SIZE || values[3] < MIN_REGION_SIZE) {
      throw new Error(`区域 ${index + 1} 太小，请框选至少 ${MIN_REGION_SIZE}×${MIN_REGION_SIZE} 像素`);
    }
    const startTime = roundMilliseconds(clamp(values[4], 0, video.duration));
    const endTime = roundMilliseconds(clamp(values[5], 0, video.duration));
    if (endTime - startTime < 0.04) {
      throw new Error(`区域 ${index + 1} 的生效时间太短或顺序错误`);
    }
    return { x, y, width, height, startTime, endTime };
  });
}

/**
 * Builds a comma-separated FFmpeg filter graph for all selected regions.
 * @param {Array<{x: number, y: number, width: number, height: number, startTime: number, endTime: number}>} regions Valid regions.
 * @returns {string}
 */
export function buildDelogoFilter(regions) {
  return regions
    .map(
      ({ x, y, width, height, startTime, endTime }) =>
        `delogo=x=${x}:y=${y}:w=${width}:h=${height}:show=0:enable='between(t,${startTime},${endTime})'`,
    )
    .join(",");
}

/** Rounds time values to milliseconds for stable FFmpeg expressions. */
function roundMilliseconds(value) {
  return Math.round(value * 1000) / 1000;
}

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
