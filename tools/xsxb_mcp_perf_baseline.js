#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { cutoutFrameFiles, encodePngRgba } = require("./xsxb_mcp_cutout");
const { createCompositeSession } = require("./xsxb_mcp_trail_preview");

/** @param {number} size Edge. @param {number[]} color RGBA. @returns {Buffer} PNG. */
function solidPng(size, color) {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) rgba.set(color, offset);
  return encodePngRgba(rgba, size, size);
}

/**
 * Runs count-based MCP performance probes without elapsed-time thresholds.
 * @param {{createSessionImpl?:Function}} [options] Injectable session factory.
 * @returns {Promise<object>} Count baseline.
 */
async function runMcpPerfBaseline(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-mcp-perf-"));
  const session = (options.createSessionImpl || createCompositeSession)({ idleMs: 10_000 });
  try {
    const framePaths = [path.join(root, "frame-a.png"), path.join(root, "frame-b.png")];
    for (const filePath of framePaths) fs.writeFileSync(filePath, solidPng(16, [200, 40, 40, 255]));
    let metricPasses = 0;
    cutoutFrameFiles(framePaths, {
      tolerance: -1,
      metricsImpl() {
        metricPasses += 1;
        return { opaque: 256 };
      },
    });

    const attachmentPath = path.join(root, "attachment.png");
    fs.writeFileSync(attachmentPath, solidPng(4, [30, 240, 80, 255]));
    const job = {
      framePaths,
      frameIndexes: [0, 1],
      durations: [1 / 12, 1 / 12],
      fps: 12,
      trails: { schemaVersion: 8, bindings: {} },
      bindingKey: "mcp_imports/perf",
      root: path.resolve(__dirname, ".."),
      visualScales: [1, 1],
      attachments: [
        {
          id: "perf-attachment",
          frame: 0,
          absolutePath: attachmentPath,
          layer: "above",
          layerOrder: 1,
          transform: { scale: 1, offset: { x: 0, y: -8 }, rotation: 0 },
        },
      ],
    };
    for (let run = 0; run < 2; run += 1) {
      const composited = await session.composite(job);
      if (composited.tempDir) fs.rmSync(composited.tempDir, { recursive: true, force: true });
    }
    const result = {
      cutout: { frameCount: framePaths.length, metricPasses },
      composite: { ...session.stats },
    };
    if (
      result.cutout.metricPasses !== result.cutout.frameCount ||
      result.composite.browserLaunches !== 1 ||
      result.composite.uniqueAttachmentLoads !== 1
    ) {
      throw new Error(`MCP count baseline regressed: ${JSON.stringify(result)}`);
    }
    return result;
  } finally {
    await session.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  runMcpPerfBaseline()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = { runMcpPerfBaseline };
