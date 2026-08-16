"use strict";

const { createXsxbMcpService } = require("./xsxb_mcp_service");

module.exports = async function xsxb_sync_godot(args = {}) {
  return createXsxbMcpService().call("xsxb_sync_godot", args);
};

module.exports.description = "Synchronize the current project to Godot without changing animation data.";
module.exports.inputSchema = {
  type: "object",
  properties: { project_id: { type: "string" }, force: { type: "boolean" } },
};
