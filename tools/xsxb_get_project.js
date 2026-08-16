"use strict";

const { createXsxbMcpService } = require("./xsxb_mcp_service");

module.exports = async function xsxb_get_project(args = {}) {
  return createXsxbMcpService().call("xsxb_get_project", args);
};

module.exports.description = "Get project binding, animation list, and sync status.";
module.exports.inputSchema = {
  type: "object",
  properties: { project_id: { type: "string" } },
};
