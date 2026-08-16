"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createProjectStore } = require("./project_store");

module.exports = async function xsxb_health(args = {}) {
  const root = path.resolve(__dirname, "..");
  const projectStore = createProjectStore(root);
  const project = projectStore.resolveProject(projectStore.readRegistry());

  const health = {
    projectId: project.id,
    status: "ok",
    version: "0.1.0",
    lastSync: new Date().toISOString(),
    tools: [
      "xsxb_import_animation",
      "xsxb_update_frame_boxes",
      "xsxb_update_timing",
      "xsxb_sync_godot",
      "xsxb_get_project",
      "xsxb_delete_animation",
      "xsxb_open_tuner",
      "xsxb_health",
    ],
  };

  // 额外健康检查
  try {
    const manifest = projectStore.readJson(projectStore.projectPaths(project).manifest);
    health.manifestValid = !!manifest;
  } catch {
    health.status = "warning";
  }

  return health;
};

module.exports.description = "MCP Health check";
module.exports.inputSchema = { type: "object", properties: {} };
