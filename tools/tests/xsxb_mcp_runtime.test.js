"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ensureCodexTimeouts, installXsxbMcp } = require("../xsxb_mcp_installer");
const { createRuntimeInfo, runtimeContentHash } = require("../xsxb_mcp_runtime");
const { toolDefinitions } = require("../xsxb_mcp_tool_catalog");

const ROOT = path.resolve(__dirname, "../..");

test("runtime info exposes build, schema, data, and root identities", () => {
  const info = createRuntimeInfo(ROOT, toolDefinitions());
  assert.equal(info.name, "xsxb-frame-tuner");
  assert.match(info._meta["xsxb/buildId"], /^0\.1\.0\+/u);
  assert.match(info._meta["xsxb/toolSchemaRevision"], /^[a-f0-9]{16}$/u);
  assert.match(info._meta["xsxb/runtimeContentHash"], /^[a-f0-9]{64}$/u);
  assert.equal(info._meta["xsxb/projectDataVersion"], 1);
  assert.match(info._meta["xsxb/rootIdentity"], /^[a-f0-9]{24}$/u);
});

test("runtime content identity changes when copied server bytes change", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-runtime-hash-"));
  try {
    fs.mkdirSync(path.join(root, "tools"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), '{"version":"1.0.0"}\n');
    fs.writeFileSync(path.join(root, "tools", "server.js"), "module.exports = 1;\n");
    const before = runtimeContentHash(root);
    fs.writeFileSync(path.join(root, "tools", "server.js"), "module.exports = 2;\n");
    const after = runtimeContentHash(root);
    assert.notEqual(after, before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("installer timeout update preserves unrelated Codex configuration", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-codex-config-"));
  try {
    const configPath = path.join(root, "config.toml");
    fs.writeFileSync(
      configPath,
      'model = "gpt-test"\n\n[mcp_servers.xsxb-frame-tuner]\ncommand = "node"\nargs = ["server.js"]\n',
    );
    assert.equal(ensureCodexTimeouts(configPath), true);
    const text = fs.readFileSync(configPath, "utf8");
    assert.match(text, /model = "gpt-test"/u);
    assert.match(text, /enabled = true/u);
    assert.match(text, /startup_timeout_sec = 30/u);
    assert.match(text, /tool_timeout_sec = 300/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("installer atomically switches current and self-checks all 34 tools", () => {
  const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-mcp-install-"));
  try {
    const installed = installXsxbMcp({ sourceRoot: ROOT, projectRoot: ROOT, installRoot });
    assert.equal(installed.installed, true);
    assert.equal(installed.registered, false);
    assert.equal(installed.selfCheck.ok, true);
    assert.equal(installed.selfCheck.toolCount, 34);
    assert.equal(fs.lstatSync(path.join(installRoot, "current")).isSymbolicLink(), true);
    assert.equal(
      fs.lstatSync(path.join(installed.buildDirectory, "node_modules", "playwright")).isSymbolicLink(),
      false,
    );
    const repeated = installXsxbMcp({ sourceRoot: ROOT, projectRoot: ROOT, installRoot });
    assert.equal(repeated.buildDirectory, installed.buildDirectory);
  } finally {
    fs.rmSync(installRoot, { recursive: true, force: true });
  }
});

test("failed Codex registration restores configuration and the previous runtime", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-mcp-register-rollback-"));
  try {
    const installRoot = path.join(root, "install");
    const first = installXsxbMcp({ sourceRoot: ROOT, projectRoot: ROOT, installRoot });
    const previousBuild = fs.realpathSync(path.join(installRoot, "current"));
    const configPath = path.join(root, "codex", "config.toml");
    const configText = 'model = "keep-me"\n';
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, configText);
    const fakeCodex = path.join(root, "fake-codex.sh");
    fs.writeFileSync(
      fakeCodex,
      `#!/bin/sh\nif [ "$2" = "remove" ]; then : > '${configPath}'; exit 0; fi\nexit 1\n`,
      { mode: 0o755 },
    );
    assert.throws(
      () =>
        installXsxbMcp({
          sourceRoot: ROOT,
          projectRoot: ROOT,
          installRoot,
          register: true,
          codexBinary: fakeCodex,
          configPath,
        }),
      /Command failed/iu,
    );
    assert.equal(fs.readFileSync(configPath, "utf8"), configText);
    assert.equal(fs.realpathSync(path.join(installRoot, "current")), previousBuild);
    assert.equal(fs.realpathSync(first.buildDirectory), previousBuild);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("installer refuses a legacy non-symlink current directory without deleting it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-mcp-legacy-current-"));
  try {
    const installRoot = path.join(root, "install");
    const current = path.join(installRoot, "current");
    fs.mkdirSync(current, { recursive: true });
    const sentinel = path.join(current, "keep.txt");
    fs.writeFileSync(sentinel, "legacy-runtime");
    assert.throws(
      () => installXsxbMcp({ sourceRoot: ROOT, projectRoot: ROOT, installRoot }),
      /current.*symbolic link|legacy.*current/iu,
    );
    assert.equal(fs.lstatSync(current).isDirectory(), true);
    assert.equal(fs.lstatSync(current).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(sentinel, "utf8"), "legacy-runtime");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
