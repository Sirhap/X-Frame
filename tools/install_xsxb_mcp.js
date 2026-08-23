#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { installXsxbMcp } = require("./xsxb_mcp_installer");

const args = new Set(process.argv.slice(2));
const sourceRoot = path.resolve(__dirname, "..");
try {
  const result = installXsxbMcp({
    sourceRoot,
    projectRoot: process.env.XSXB_ROOT || sourceRoot,
    installRoot: process.env.XSXB_MCP_INSTALL_ROOT,
    register: args.has("--register"),
    dryRun: args.has("--dry-run"),
    codexBinary: process.env.CODEX_CLI || "codex",
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}
