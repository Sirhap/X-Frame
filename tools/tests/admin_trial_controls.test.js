"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const publicRoot = path.resolve(__dirname, "../animation_tuner/public");

test("administrator console has no device controls after the email-only migration", () => {
  const markup = fs.readFileSync(path.join(publicRoot, "admin.html"), "utf8");
  const script = fs.readFileSync(path.join(publicRoot, "landing-admin.js"), "utf8");

  assert.doesNotMatch(markup, /试用设备/u);
  assert.doesNotMatch(script, /devices\/revocation/u);
  assert.doesNotMatch(script, /撤销设备/u);
  assert.match(script, /邮箱试用/u);
});

test("administrator session probe stays quiet until the user submits login", () => {
  const script = fs.readFileSync(path.join(publicRoot, "landing-admin.js"), "utf8");
  const loadSession = script.match(/async function loadSession\(\) \{[\s\S]*?\n  \}/u);
  assert.ok(loadSession, "loadSession");
  assert.match(loadSession[0], /error\.status === 401/);
  assert.match(loadSession[0], /无法识别的响应/);
  assert.match(loadSession[0], /setStatus\(elements\.loginStatus, ""/);
});
