"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const { createProjectStore } = require("../project_store");

/**
 * Starts an isolated tuner server and waits for readiness.
 * @param {string} root Isolated workspace root.
 * @param {number} port HTTP port.
 * @returns {Promise<import("node:child_process").ChildProcess>} Server process.
 */
function startServer(root, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tools/animation_tuner/server.js"], {
      cwd: path.resolve(__dirname, "..", ".."),
      env: { ...process.env, PORT: String(port), XSXB_ROOT: root },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Isolated server startup timed out.\n${stderr}`));
    }, 5000);
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("XSXB Frame Tuner running")) return;
      clearTimeout(timer);
      resolve(child);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Isolated server exited with code ${code}.\n${stderr}`));
    });
  });
}

test("concurrent saves serialize and reject stale revisions", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-concurrency-"));
  const port = 30000 + Math.floor(Math.random() * 10000);
  const store = createProjectStore(root);
  const registry = store.addProject({ id: "concurrency", label: "Concurrency" });
  const project = store.resolveProject(registry, registry.activeProjectId);
  const child = await startServer(root, port);
  context.after(() => {
    child.kill("SIGTERM");
    fs.rmSync(root, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const configResponse = await fetch(`${baseUrl}/api/config?project=${project.id}`);
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert.match(config.dataRevision, /^[0-9a-f]{64}$/);

  const savePayload = (marker) => ({
    projectId: project.id,
    baseRevision: config.dataRevision,
    values: { marker },
    scene_settings: {},
    frame_visual_overrides: {},
    frame_playback_overrides: {},
    frame_box_overrides: {},
  });
  const responses = await Promise.all([
    fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(savePayload("first")),
    }),
    fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(savePayload("second")),
    }),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const conflict = await responses.find((response) => response.status === 409).json();
  assert.equal(conflict.code, "revision_conflict");
  assert.match(conflict.dataRevision, /^[0-9a-f]{64}$/);
});
