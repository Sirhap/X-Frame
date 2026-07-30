"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const { ATLAS_HEIGHT, ATLAS_WIDTH } = require("../codex_pets");

/** @param {number} marker Distinguishing VP8X flag byte. @returns {Buffer} Minimal valid Codex pet atlas. */
function createAtlas(marker) {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUInt32LE(10, 16);
  buffer[20] = marker;
  buffer.writeUIntLE(ATLAS_WIDTH - 1, 24, 3);
  buffer.writeUIntLE(ATLAS_HEIGHT - 1, 27, 3);
  return buffer;
}

/**
 * Starts an isolated tuner server with a private Codex home.
 * @param {string} root Workspace root.
 * @param {string} codexHome Private Codex home.
 * @param {number} port HTTP port.
 * @returns {Promise<import("node:child_process").ChildProcess>} Ready child process.
 */
function startServer(root, codexHome, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tools/animation_tuner/server.js"], {
      cwd: path.resolve(__dirname, "..", ".."),
      env: { ...process.env, CODEX_HOME: codexHome, PORT: String(port), XSXB_ROOT: root },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Isolated Codex pet server startup timed out.\n${stderr}`));
    }, 5000);
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("XSXB Frame Tuner running")) return;
      clearTimeout(timeout);
      resolve(child);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Isolated Codex pet server exited with code ${code}.\n${stderr}`));
    });
  });
}

/** @param {string} url Endpoint URL. @param {object} body JSON body. @returns {Promise<{response:Response,payload:object}>} Parsed response. */
async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

test("Codex pet lifecycle HTTP routes remove, restore, recover backups, and protect the system project", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-codex-pet-server-"));
  const codexHome = path.join(root, "codex-home");
  const petDirectory = path.join(codexHome, "pets", "route-pet");
  const atlasPath = path.join(petDirectory, "spritesheet.webp");
  const backupPath = path.join(petDirectory, "spritesheet.xsxb-backup.webp");
  fs.mkdirSync(petDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(petDirectory, "pet.json"),
    `${JSON.stringify({ id: "route-pet", displayName: "Route Pet", spritesheetPath: "spritesheet.webp" })}\n`,
  );
  fs.writeFileSync(atlasPath, createAtlas(3));
  fs.writeFileSync(backupPath, createAtlas(8));

  const port = 30000 + Math.floor(Math.random() * 10000);
  const child = await startServer(root, codexHome, port);
  context.after(() => {
    child.kill("SIGTERM");
    fs.rmSync(root, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const configResponse = await fetch(`${baseUrl}/api/config?project=codex_pets`);
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert.ok(config.profiles.some((profile) => profile.id === "custom:route-pet"));

  const removal = await postJson(`${baseUrl}/api/codex-pets/remove`, {
    projectId: "codex_pets",
    profileId: "custom:route-pet",
  });
  assert.equal(removal.response.status, 200);
  assert.equal(removal.payload.removed.profileId, "custom:route-pet");
  assert.match(removal.payload.removed.token, /^[0-9a-f-]{36}$/u);
  assert.equal(fs.existsSync(petDirectory), false);

  const recovery = await postJson(`${baseUrl}/api/codex-pets/restore`, {
    projectId: "codex_pets",
    token: removal.payload.removed.token,
  });
  assert.equal(recovery.response.status, 200);
  assert.equal(recovery.payload.restored.profileId, "custom:route-pet");
  assert.equal(fs.existsSync(atlasPath), true);

  const backupRecovery = await postJson(`${baseUrl}/api/codex-pets/restore-backup`, {
    projectId: "codex_pets",
    profileId: "custom:route-pet",
  });
  assert.equal(backupRecovery.response.status, 200);
  assert.equal(backupRecovery.payload.restoredBackup.profileId, "custom:route-pet");
  assert.deepEqual(fs.readFileSync(atlasPath), fs.readFileSync(backupPath));

  const deletion = await postJson(`${baseUrl}/api/projects/delete`, {
    projectId: "codex_pets",
  });
  assert.equal(deletion.response.status, 409);
  assert.equal(deletion.payload.code, "protected_system_project");
  assert.equal(fs.existsSync(petDirectory), true);
});
