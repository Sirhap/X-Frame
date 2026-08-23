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

test("godot runtime converts attachment group coordinates into VisualOwner local coordinates", () => {
  const script = templates.runtimeScript("demo-project");
  assert.match(script, /var group_offset: Vector2 = _vector_from_value/u);
  assert.match(script, /frame\.get\("width", fallback_width\)/u);
  assert.match(script, /frame\.get\("height", fallback_height\)/u);
  assert.match(script, /sprite\.position = group_offset \+ anchor - frame_size \* 0\.5/u);
  assert.deepEqual(
    templates.attachmentVisualOwnerLocalPosition({ x: 220, y: -333 }, "canvas_bottom_center", {
      x: 1168,
      y: 768,
    }),
    { x: 220, y: 51 },
  );
  assert.deepEqual(
    templates.attachmentVisualOwnerLocalPosition({ x: 220, y: -333 }, "canvas_left_bottom", {
      x: 1168,
      y: 768,
    }),
    { x: -364, y: 51 },
  );
});
