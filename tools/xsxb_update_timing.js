"use strict";

const { createXsxbMcpService } = require("./xsxb_mcp_service");

module.exports = async function xsxb_update_timing(args = {}) {
  return createXsxbMcpService().call("xsxb_update_timing", args);
};

module.exports.description = "Update animation FPS and optional per-frame duration.";
module.exports.inputSchema = {
  type: "object",
  properties: {
    project_id: { type: "string" },
    profile_id: { type: "string" },
    animation_id: { type: "string" },
    fps: { type: "number" },
    frame: { type: "integer" },
    duration_ms: { type: "number" },
    duration: { type: "number" },
    disabled: { type: "boolean" },
    sync: { type: "boolean" },
  },
};
