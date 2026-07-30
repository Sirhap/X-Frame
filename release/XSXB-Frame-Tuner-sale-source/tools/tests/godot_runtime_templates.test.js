"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const runtime = require("../godot_runtime.js");
const templates = require("../godot_runtime_templates.js");

test("godot runtime keeps the generated script helper as a compatibility forward", () => {
  assert.strictEqual(runtime.runtimeScript, templates.runtimeScript);
});

test("godot runtime templates preserve generated project and scene identifiers", () => {
  const script = templates.runtimeScript("demo-project");
  const actor = templates.actorScene("demo-project", {
    profileId: "profile-a",
    animationId: "idle",
  });
  const smokeTest = templates.testScene();

  assert.match(script, /const XSXB_PROJECT_ID: String = "demo-project"/);
  assert.match(actor, /frame_profile_id = "profile-a"/);
  assert.match(actor, /frame_animation = "idle"/);
  assert.match(smokeTest, /node name="XSXBRuntimeTest"/);
});
