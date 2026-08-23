#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const toolFiles = fs
  .readdirSync(path.join(root, "tools"))
  .filter(
    (name) =>
      (/^xsxb_mcp_.*\.js$/u.test(name) ||
        ["xsxb_frame_semantics.js", "install_xsxb_mcp.js", "check_xsxb_mcp.js"].includes(name)) &&
      !name.endsWith(".test.js"),
  )
  .map((name) => `tools/${name}`)
  .sort();
const testFiles = fs
  .readdirSync(path.join(root, "tools", "tests"))
  .filter((name) => /^xsxb_(?:mcp_|frame_semantics).*\.test\.js$/u.test(name))
  .map((name) => `tools/tests/${name}`)
  .sort();
const extraTests = ["tools/tests/attack_trails_path.test.js"];

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

for (const filePath of toolFiles) run(process.execPath, ["--check", filePath]);
run(process.platform === "win32" ? "npx.cmd" : "npx", [
  "prettier",
  "--check",
  ...toolFiles,
  ...testFiles,
  ...extraTests,
]);
run(process.execPath, ["--test", ...testFiles, ...extraTests]);
