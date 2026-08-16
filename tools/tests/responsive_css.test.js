"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("mobile shell removes desktop rail padding when the rail becomes a top bar", () => {
  const css = fs.readFileSync(path.join(__dirname, "../animation_tuner/public/app_shell.css"), "utf8");
  assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*?\.app,[\s\S]*?padding-left:\s*0;/u);
});

test("disabled workbench controls keep readable text and announce their disabled state", () => {
  const css = fs.readFileSync(path.join(__dirname, "../animation_tuner/public/controls_inputs.css"), "utf8");
  assert.match(css, /button:disabled\s*\{[\s\S]*?color:\s*var\(--muted\)/u);
  assert.match(css, /button:disabled\s*\{[\s\S]*?cursor:\s*not-allowed/u);
});
