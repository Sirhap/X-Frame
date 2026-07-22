"use strict";

/**
 * Creates asynchronous server integration self-tests with injectable runtime dependencies.
 * @param {{assert:typeof import("node:assert/strict"),createProjectStore:Function,fetchImpl:Function,fsApi:typeof import("node:fs"),goldenPngDataUrl:string,httpApi:typeof import("node:http"),osApi:typeof import("node:os"),pathApi:typeof import("node:path"),repositoryRoot?:string,spawnProcess:Function}} options Integration test dependencies.
 * @returns {{runServerBoundaryTests:()=>Promise<void>,runAnimationReplacementIntegrationTests:()=>Promise<void>}} Integration test runners.
 */
function createIntegrationTests(options) {
  if (
    !options ||
    typeof options.assert?.equal !== "function" ||
    typeof options.createProjectStore !== "function" ||
    typeof options.fetchImpl !== "function" ||
    typeof options.fsApi?.mkdtempSync !== "function" ||
    typeof options.httpApi?.request !== "function" ||
    typeof options.osApi?.tmpdir !== "function" ||
    typeof options.pathApi?.join !== "function" ||
    typeof options.spawnProcess !== "function" ||
    typeof options.goldenPngDataUrl !== "string"
  ) {
    throw new TypeError("Server integration test dependencies are required.");
  }

  const {
    assert,
    createProjectStore,
    fetchImpl,
    fsApi,
    goldenPngDataUrl,
    httpApi,
    osApi,
    pathApi,
    spawnProcess,
  } = options;
  const repositoryRoot = options.repositoryRoot || pathApi.resolve(__dirname, "..");

  /**
   * Verifies that the local HTTP server rejects unsafe or oversized writes.
   * @returns {Promise<void>}
   */
  async function runServerBoundaryTests() {
    const port = 20000 + (process.pid % 20000);
    const child = spawnProcess(process.execPath, ["tools/animation_tuner/server.js"], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PORT: String(port),
        XSXB_ACTIVATION_CODE_HASHES: "",
        XSXB_ACTIVATION_SECRET: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Test server startup timed out.")), 5000);
        const onData = (chunk) => {
          if (!String(chunk).includes("XSXB Frame Tuner running")) return;
          clearTimeout(timer);
          resolve();
        };
        child.stdout.on("data", onData);
        child.once("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`Test server exited early with code ${code}.`));
        });
      });
      const baseUrl = `http://127.0.0.1:${port}`;
      const wrongOrigin = await fetchImpl(`${baseUrl}/api/projects/active`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
        },
        body: "{}",
      });
      assert.equal(wrongOrigin.status, 403);
      const wrongType = await fetchImpl(`${baseUrl}/api/projects/active`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      });
      assert.equal(wrongType.status, 415);
      const oversized = await fetchImpl(`${baseUrl}/api/projects/active`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ padding: "x".repeat(2 * 1024 * 1024 + 1024) }),
      });
      assert.equal(oversized.status, 413);
      const oversizedMediaStatus = await new Promise((resolve, reject) => {
        const request = httpApi.request(
          {
            hostname: "127.0.0.1",
            port,
            path: "/api/replace-animation",
            method: "POST",
            headers: {
              "content-type": "application/json",
              "content-length": String(96 * 1024 * 1024 + 1),
            },
          },
          (response) => {
            response.resume();
            response.once("end", () => resolve(response.statusCode));
          },
        );
        request.once("error", reject);
        request.end();
      });
      assert.equal(oversizedMediaStatus, 413);
      const premiumSaveBypass = await fetchImpl(`${baseUrl}/api/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ frame_audio_bindings: [{ key: "walk:0" }] }),
      });
      assert.equal(premiumSaveBypass.status, 402);
      const premiumReplacementBypass = await fetchImpl(`${baseUrl}/api/replace-animation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ frames: [], files: [] }),
      });
      assert.equal(premiumReplacementBypass.status, 402);
      const premiumWorksetBypass = await fetchImpl(`${baseUrl}/api/reorganize-animation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [] }),
      });
      assert.equal(premiumWorksetBypass.status, 402);
    } finally {
      child.kill("SIGTERM");
    }
  }

  /**
   * Verifies ordered 20-frame replacement and rollback in an isolated workspace.
   * @returns {Promise<void>}
   */
  async function runAnimationReplacementIntegrationTests() {
    const isolatedRoot = fsApi.mkdtempSync(pathApi.join(osApi.tmpdir(), "xsxb-replace-animation-test-"));
    const port = 40000 + (process.pid % 10000);
    const store = createProjectStore(isolatedRoot);
    const godotRoot = pathApi.join(isolatedRoot, "godot-project");
    fsApi.mkdirSync(godotRoot, { recursive: true });
    const registry = store.addProject({
      id: "golden-replacement",
      label: "Golden Replacement",
      projectRoot: godotRoot,
    });
    const project = store.resolveProject(registry, registry.activeProjectId);
    const workspaceDir = store.projectWorkspaceDir(project);
    const frameDir = pathApi.join(workspaceDir, "frames");
    fsApi.mkdirSync(frameDir, { recursive: true });
    const basePng = Buffer.from(goldenPngDataUrl.split(",")[1], "base64");
    const frames = [];
    const originals = [];
    const replacements = [];
    for (let index = 0; index < 20; index += 1) {
      const fileName = `frame_${String(index + 1).padStart(4, "0")}.png`;
      const fullPath = pathApi.join(frameDir, fileName);
      const original = Buffer.concat([basePng, Buffer.from(`original-${index}`)]);
      const replacement = Buffer.concat([basePng, Buffer.from(`replacement-${index}`)]);
      fsApi.writeFileSync(fullPath, original);
      frames.push({ path: pathApi.relative(isolatedRoot, fullPath).replaceAll("\\", "/") });
      originals.push(original);
      replacements.push(replacement);
    }
    const child = spawnProcess(process.execPath, ["tools/animation_tuner/server.js"], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PORT: String(port),
        XSXB_ROOT: isolatedRoot,
        XSXB_ACTIVATION_CODE_HASHES: "ccd11a14d740e9ecf27b6434bb77686182737925d98e009e92e5a1e3394162b9",
        XSXB_ACTIVATION_SECRET: "self-test-secret-with-at-least-thirty-two-characters",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Replacement test server startup timed out.")), 5000);
        child.stdout.on("data", (chunk) => {
          if (!String(chunk).includes("XSXB Frame Tuner running")) return;
          clearTimeout(timer);
          resolve();
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`Replacement test server exited early with code ${code}.`));
        });
      });
      const baseUrl = `http://127.0.0.1:${port}`;
      const activationResponse = await fetchImpl(`${baseUrl}/api/activation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "XSXB-SELF-TEST" }),
      });
      assert.equal(activationResponse.status, 200);
      const activationCookie = String(activationResponse.headers.get("set-cookie") || "").split(";", 1)[0];
      assert.match(activationCookie, /^xsxb_activation=/);
      const authorizedHeaders = { "content-type": "application/json", cookie: activationCookie };
      const invalidFiles = replacements.map((bytes) => ({
        data: `data:image/png;base64,${bytes.toString("base64")}`,
      }));
      invalidFiles[10] = { data: "data:image/png;base64,bm90LXBuZw==" };
      const failedResponse = await fetchImpl(`${baseUrl}/api/replace-animation`, {
        method: "POST",
        headers: authorizedHeaders,
        body: JSON.stringify({
          projectId: project.id,
          frames,
          files: invalidFiles,
        }),
      });
      assert.equal(failedResponse.status, 500);
      for (let index = 0; index < frames.length; index += 1) {
        assert.deepEqual(
          fsApi.readFileSync(pathApi.join(isolatedRoot, frames[index].path)),
          originals[index],
        );
      }
      const godotSyncBlocker = pathApi.join(godotRoot, "xsxb_frame_tuner");
      fsApi.writeFileSync(godotSyncBlocker, "block Godot sync directory creation", "utf8");
      const syncFailureResponse = await fetchImpl(`${baseUrl}/api/replace-animation`, {
        method: "POST",
        headers: authorizedHeaders,
        body: JSON.stringify({
          projectId: project.id,
          frames,
          files: replacements.map((bytes) => ({
            data: `data:image/png;base64,${bytes.toString("base64")}`,
          })),
        }),
      });
      assert.equal(syncFailureResponse.status, 500);
      for (let index = 0; index < frames.length; index += 1) {
        assert.deepEqual(
          fsApi.readFileSync(pathApi.join(isolatedRoot, frames[index].path)),
          originals[index],
        );
      }
      fsApi.rmSync(godotSyncBlocker, { force: true });
      const validResponse = await fetchImpl(`${baseUrl}/api/replace-animation`, {
        method: "POST",
        headers: authorizedHeaders,
        body: JSON.stringify({
          projectId: project.id,
          frames,
          files: replacements.map((bytes) => ({
            data: `data:image/png;base64,${bytes.toString("base64")}`,
          })),
        }),
      });
      assert.equal(validResponse.status, 200);
      const responseBody = await validResponse.json();
      assert.equal(responseBody.frames.length, 20);
      for (let index = 0; index < frames.length; index += 1) {
        assert.deepEqual(
          fsApi.readFileSync(pathApi.join(isolatedRoot, frames[index].path)),
          replacements[index],
        );
        assert.equal(responseBody.frames[index].path, frames[index].path);
        assert.equal(responseBody.frames[index].width, 1);
        assert.equal(responseBody.frames[index].height, 1);
      }
      const duplicateResponse = await fetchImpl(`${baseUrl}/api/replace-animation`, {
        method: "POST",
        headers: authorizedHeaders,
        body: JSON.stringify({
          projectId: project.id,
          frames: [frames[0], frames[0]],
          files: replacements.slice(0, 2).map((bytes) => ({
            data: `data:image/png;base64,${bytes.toString("base64")}`,
          })),
        }),
      });
      assert.equal(duplicateResponse.status, 500);
    } finally {
      child.kill("SIGTERM");
      fsApi.rmSync(isolatedRoot, { recursive: true, force: true });
    }
  }

  return { runServerBoundaryTests, runAnimationReplacementIntegrationTests };
}

module.exports = { createIntegrationTests };
