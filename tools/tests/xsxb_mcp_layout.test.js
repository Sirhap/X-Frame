"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const REPO = path.join(__dirname, "../..");
const MCP_DIR = path.join(REPO, "mcp");
const TOOLS_DIR = path.join(REPO, "tools");
const FRONTEND_SESSION = path.join(TOOLS_DIR, "animation_tuner/public/batch_cutout_session_controller.js");

const MCP_MODULES = [
  "xsxb_mcp_arguments",
  "xsxb_mcp_cutout",
  "xsxb_mcp_loop",
  "xsxb_mcp_place",
  "xsxb_mcp_place_brief",
  "xsxb_mcp_processes",
  "xsxb_mcp_schema",
  "xsxb_mcp_server",
  "xsxb_mcp_service",
  "xsxb_mcp_smear_brief",
  "xsxb_mcp_tool_catalog",
  "xsxb_mcp_tool_usability",
  "xsxb_mcp_trail_preview",
  "xsxb_mcp_visual_qa",
];

test("MCP implementations live under mcp/ and tools/ only re-exports", () => {
  for (const name of MCP_MODULES) {
    const impl = fs.readFileSync(path.join(MCP_DIR, `${name}.js`), "utf8");
    const shim = fs.readFileSync(path.join(TOOLS_DIR, `${name}.js`), "utf8");
    assert.match(impl, /module\.exports/, `${name} implementation must export`);
    assert.doesNotMatch(impl, /Compatibility shim/, `${name} implementation is not a shim`);
    assert.match(shim, /Compatibility shim/, `${name} tools/ file is a shim`);
    assert.match(shim, new RegExp(`\\.\\./mcp/${name}`), `${name} shim points at mcp/`);
  }
});

test("frontend still requires the tools/ cutout shim path, not mcp/", () => {
  const src = fs.readFileSync(FRONTEND_SESSION, "utf8");
  assert.match(src, /require\("\.\.\/\.\.\/xsxb_mcp_cutout"\)/);
  assert.doesNotMatch(src, /require\("\.\.\/\.\.\/mcp\//);
  const { alreadyCutOut } = require("../xsxb_mcp_cutout");
  assert.equal(typeof alreadyCutOut, "function");
});
