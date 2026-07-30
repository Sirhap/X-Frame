"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { requestedGroup } = require("../animation_tuner/public/app_project_lifecycle");

test("stable animation deep links resolve independently of generated UI ids", () => {
  const groups = [
    { uiId: "actor:idle:0", profileId: "hero", animationId: "idle" },
    { uiId: "actor:run:1", profileId: "hero", animationId: "run" },
  ];
  const urlState = new URLSearchParams("animation=hero%2Frun&group=actor%3Aidle%3A0");
  assert.equal(requestedGroup(groups, urlState), groups[1]);
});

test("generated group ids remain a compatible fallback", () => {
  const groups = [{ uiId: "actor:idle:0", profileId: "hero", animationId: "idle" }];
  assert.equal(requestedGroup(groups, new URLSearchParams(), "actor:idle:0"), groups[0]);
});
