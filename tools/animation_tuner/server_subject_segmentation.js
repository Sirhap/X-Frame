"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const SOURCE_PATH = path.join(__dirname, "native", "subject_segmenter.m");
let compilationPromise = null;

/** Runs a child process with bounded diagnostics and a hard timeout. */
function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "ignore", "pipe"] });
    let diagnostics = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${path.basename(command)} timed out.`));
    }, 30_000);
    child.stderr.on("data", (chunk) => {
      if (diagnostics.length < 16_384) diagnostics += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(diagnostics.trim() || `${path.basename(command)} exited with code ${code}.`));
    });
  });
}

/** Compiles and caches the macOS Vision helper outside the project tree. */
async function compiledHelperPath() {
  if (process.platform !== "darwin") throw new Error("Native subject detection requires macOS.");
  if (compilationPromise) return compilationPromise;
  compilationPromise = (async () => {
    const source = await fs.promises.readFile(SOURCE_PATH);
    const revision = crypto.createHash("sha256").update(source).digest("hex").slice(0, 16);
    const cacheDirectory = path.join(os.tmpdir(), "xsxb-subject-segmentation");
    const helperPath = path.join(cacheDirectory, `subject-segmenter-${revision}`);
    if (fs.existsSync(helperPath)) return helperPath;
    await fs.promises.mkdir(cacheDirectory, { recursive: true });
    await runProcess(
      "clang",
      [
        "-fobjc-arc",
        "-framework",
        "Foundation",
        "-framework",
        "AppKit",
        "-framework",
        "Vision",
        "-framework",
        "CoreImage",
        "-framework",
        "CoreVideo",
        SOURCE_PATH,
        "-o",
        helperPath,
      ],
      {
        env: { ...process.env, CLANG_MODULE_CACHE_PATH: path.join(cacheDirectory, "module-cache") },
      },
    );
    return helperPath;
  })().catch((error) => {
    compilationPromise = null;
    throw error;
  });
  return compilationPromise;
}

/**
 * Segments every foreground instance from a PNG/JPEG data URL.
 * @param {string} imageDataUrl Cropped source image.
 * @returns {Promise<string>} Transparent PNG data URL.
 */
async function segmentSubject(imageDataUrl) {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(imageDataUrl || ""));
  if (!match) throw new TypeError("Expected a PNG or JPEG data URL.");
  const input = Buffer.from(match[2], "base64");
  if (!input.length || input.length > 48 * 1024 * 1024)
    throw new RangeError("Subject image is empty or too large.");

  const temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "xsxb-subject-"));
  const inputPath = path.join(temporaryDirectory, `input.${match[1] === "jpeg" ? "jpg" : "png"}`);
  const outputPath = path.join(temporaryDirectory, "subject.png");
  try {
    await fs.promises.writeFile(inputPath, input);
    await runProcess(await compiledHelperPath(), [inputPath, outputPath]);
    const output = await fs.promises.readFile(outputPath);
    return `data:image/png;base64,${output.toString("base64")}`;
  } finally {
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

module.exports = { segmentSubject };
