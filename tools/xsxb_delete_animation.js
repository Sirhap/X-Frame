"use strict";

const { createXsxbMcpService } = require("./xsxb_mcp_service");

module.exports = async function xsxb_delete_animation(args = {}) {
  return createXsxbMcpService().call("xsxb_delete_animation", args);
};

module.exports.description = "Delete an imported animation. Supports dry_run.";
module.exports.inputSchema = {
  type: "object",
  properties: {
    project_id: { type: "string" },
    profile_id: { type: "string" },
    animation_id: { type: "string" },
    dry_run: { type: "boolean" },
    sync: { type: "boolean" },
  },
};
