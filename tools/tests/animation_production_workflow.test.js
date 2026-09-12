const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { parseArgs, runWorkflow } = require("../animation_production_workflow");

const TUNER_ROOT = path.resolve(__dirname, "../..");

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-animation-production-"));
  const projectRoot = path.join(root, "godot-project");
  const sourceRoot = path.join(root, "frames");
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, "idle"), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, "run"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "project.godot"), '[application]\nconfig/name="Test"\n', "utf8");
  fs.writeFileSync(path.join(sourceRoot, "idle", "frame_0001.png"), "not-a-png", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "run", "frame_0001.png"), "not-a-png", "utf8");
  const contractPath = path.join(root, "animation-constraints.json");
  return { root, projectRoot, sourceRoot, contractPath };
}

function writeContract(workspace, clips) {
  fs.writeFileSync(
    workspace.contractPath,
    `${JSON.stringify(
      {
        version: 1,
        projectRoot: workspace.projectRoot,
        profile: "hero",
        clips,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function pngClip(id, sourcePath) {
  return {
    id,
    source: { kind: "png-sequence", path: sourcePath },
    frameCount: 1,
    fps: 12,
  };
}

test("parseArgs separates the command and workflow options", () => {
  const result = parseArgs([
    "import",
    "--contract",
    "job.json",
    "--project",
    "hero-game",
    "--replace",
    "--port",
    "5180",
    "--json",
  ]);

  assert.deepEqual(result, {
    command: "import",
    contract: "job.json",
    project: "hero-game",
    projectRoot: "",
    replace: true,
    port: 5180,
    json: true,
    timeoutMs: 5000,
  });
});

test("plan normalizes a contract without creating project data", async () => {
  const workspace = createWorkspace();
  try {
    writeContract(workspace, [pngClip("idle", "frames/idle")]);
    const result = await runWorkflow("plan", { contractPath: workspace.contractPath, tunerRoot: TUNER_ROOT });

    assert.equal(result.ok, true);
    assert.equal(result.stage, "plan");
    assert.equal(result.plan.clips[0].source.path, path.join(workspace.root, "frames/idle"));
    assert.equal(fs.existsSync(path.join(workspace.root, "data")), false);
  } finally {
    fs.rmSync(workspace.root, { recursive: true, force: true });
  }
});

test("inspect reports missing project and source files", async () => {
  const workspace = createWorkspace();
  try {
    fs.rmSync(path.join(workspace.projectRoot, "project.godot"));
    writeContract(workspace, [pngClip("idle", "frames/missing")]);
    const result = await runWorkflow("inspect", {
      contractPath: workspace.contractPath,
      tunerRoot: TUNER_ROOT,
    });

    assert.equal(result.ok, false);
    assert.equal(result.stage, "inspect");
    assert.match(result.errors.join("\n"), /project\.godot|source folder/i);
  } finally {
    fs.rmSync(workspace.root, { recursive: true, force: true });
  }
});

test("import uses the single-frame importer and honors explicit replace", async () => {
  const workspace = createWorkspace();
  const calls = [];
  try {
    writeContract(workspace, [pngClip("idle", "frames/idle")]);
    const result = await runWorkflow("import", {
      contractPath: workspace.contractPath,
      tunerRoot: TUNER_ROOT,
      project: "hero-game",
      replace: true,
      runProcess(file, args) {
        calls.push({ file, args });
        return { status: 0, stdout: "Imported 1 frames\n", stderr: "" };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(path.basename(calls[0].args[0]), "import_frames.js");
    assert.ok(calls[0].args.includes("--project"));
    assert.ok(calls[0].args.includes("hero-game"));
    assert.ok(calls[0].args.includes("--replace"));
  } finally {
    fs.rmSync(workspace.root, { recursive: true, force: true });
  }
});

test("import rejects mixed per-clip replace instead of applying a global --replace", async () => {
  const workspace = createWorkspace();
  const calls = [];
  try {
    writeContract(workspace, [
      { ...pngClip("idle", "frames/idle"), replace: true },
      pngClip("run", "frames/run"),
    ]);
    const result = await runWorkflow("import", {
      contractPath: workspace.contractPath,
      tunerRoot: TUNER_ROOT,
      runProcess(file, args) {
        calls.push({ file, args });
        return { status: 0, stdout: JSON.stringify({ animationCount: 2 }), stderr: "" };
      },
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /mixed replace/i);
    assert.equal(calls.length, 0);
  } finally {
    fs.rmSync(workspace.root, { recursive: true, force: true });
  }
});

test("import uses the batch importer for multiple CLI clips", async () => {
  const workspace = createWorkspace();
  const calls = [];
  try {
    writeContract(workspace, [pngClip("idle", "frames/idle"), pngClip("run", "frames/run")]);
    const result = await runWorkflow("import", {
      contractPath: workspace.contractPath,
      tunerRoot: TUNER_ROOT,
      runProcess(file, args) {
        calls.push({ file, args });
        return { status: 0, stdout: JSON.stringify({ animationCount: 2 }), stderr: "" };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(path.basename(calls[0].args[0]), "import_batch.js");
    assert.equal(calls[0].args.filter((value) => value === "--animation").length, 2);
    assert.equal(calls[0].args.includes("--replace"), false);
  } finally {
    fs.rmSync(workspace.root, { recursive: true, force: true });
  }
});

test("import reports child-process exceptions as a failed workflow result", async () => {
  const workspace = createWorkspace();
  try {
    writeContract(workspace, [pngClip("idle", "frames/idle")]);
    const result = await runWorkflow("import", {
      contractPath: workspace.contractPath,
      tunerRoot: TUNER_ROOT,
      runProcess() {
        throw new Error("spawn EACCES");
      },
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /spawn EACCES/);
  } finally {
    fs.rmSync(workspace.root, { recursive: true, force: true });
  }
});

test("validate forwards strict gameplay checks and parses validator JSON", async () => {
  const workspace = createWorkspace();
  const calls = [];
  try {
    writeContract(workspace, [pngClip("idle", "frames/idle")]);
    const result = await runWorkflow("validate", {
      contractPath: workspace.contractPath,
      tunerRoot: TUNER_ROOT,
      project: "hero-game",
      runProcess(file, args) {
        calls.push({ file, args });
        return { status: 0, stdout: JSON.stringify({ ok: true, warnings: ["visual review"] }), stderr: "" };
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.validation.warnings, ["visual review"]);
    assert.ok(calls[0].args.includes("--strict"));
    assert.ok(calls[0].args.includes("--require-gameplay"));
  } finally {
    fs.rmSync(workspace.root, { recursive: true, force: true });
  }
});

test("sync refreshes the Godot runtime for a registered XSXB project", async () => {
  const workspace = createWorkspace();
  const tunerRoot = path.join(workspace.root, "tuner");
  let syncCall;
  try {
    fs.mkdirSync(path.join(tunerRoot, "data"), { recursive: true });
    fs.writeFileSync(
      path.join(tunerRoot, "data", "projects.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        activeProjectId: "hero-game",
        projects: [{ id: "hero-game", label: "Hero Game", projectRoot: workspace.projectRoot }],
      })}\n`,
      "utf8",
    );
    writeContract(workspace, [pngClip("idle", "frames/idle")]);
    const result = await runWorkflow("sync", {
      contractPath: workspace.contractPath,
      tunerRoot,
      project: "hero-game",
      syncProject(root, projectStore, project) {
        syncCall = { root, projectStore, project };
        return { ok: true, dataDir: "x_frame/data/projects/hero-game" };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.stage, "sync");
    assert.equal(result.sync.dataDir, "x_frame/data/projects/hero-game");
    assert.equal(syncCall.project.id, "hero-game");
  } finally {
    fs.rmSync(workspace.root, { recursive: true, force: true });
  }
});

test("start reuses an already running local server", async () => {
  let starts = 0;
  const result = await runWorkflow("start", {
    contractPath: "",
    tunerRoot: TUNER_ROOT,
    port: 5180,
    isPortOpen: async () => true,
    startServer: () => {
      starts += 1;
      return { pid: 1234 };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.reused, true);
  assert.equal(result.url, "http://127.0.0.1:5180");
  assert.equal(starts, 0);
});

test("CLI exits non-zero for a missing contract", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(TUNER_ROOT, "tools", "animation_production_workflow.js"),
      "plan",
      "--contract",
      path.join(os.tmpdir(), "missing-animation-constraints.json"),
      "--json",
    ],
    { cwd: TUNER_ROOT, encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /contract file not found/i);
});
