"use strict";

const { createXsxbMcpService } = require("./xsxb_mcp_service");

module.exports = async function xsxb_import_animation(args = {}) {
  return createXsxbMcpService().call("xsxb_import_animation", args);
};

module.exports.description =
  "Import a video, PNG sequence, SpriteFrames file, or PNG items as an XSXB animation.";
module.exports.inputSchema = {
  type: "object",
  properties: {
    source: { type: "string", enum: ["video", "png_sequence", "spriteframes", "items"] },
    file_path: { type: "string" },
    directory: { type: "string" },
    items: { type: "array" },
    profile_id: { type: "string" },
    animation_id: { type: "string" },
    fps: { type: "number" },
    sync: { type: "boolean" },
    validate: { type: "boolean" },
  },
};
