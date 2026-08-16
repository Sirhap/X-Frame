"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createProjectStore } = require("./project_store");

module.exports = async function xsxb_open_tuner(args = {}) {
  const root = path.resolve(__dirname, "..");
  const projectStore = createProjectStore(root);
  const project = projectStore.resolveProject(projectStore.readRegistry());

  // 触发 tuner 打开逻辑（复用现有 start 脚本或工具）
  console.log(`[MCP] Opening XSXB Frame Tuner for project: ${project.id}`);
  // TODO: 调用 npm run start -- --project ${project.id} 或类似

  return {
    projectId: project.id,
    status: "tuner_started",
    url: "http://127.0.0.1:5179/workspace",
  };
};

module.exports.description = "Open the XSXB Frame Tuner web interface";
module.exports.inputSchema = { type: "object", properties: { project_id: {type:"string"} } };
