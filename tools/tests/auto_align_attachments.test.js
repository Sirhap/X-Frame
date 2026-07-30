"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { parseArgs, planSummary, readPlan, writePlan } = require("../auto_align_attachments");

test("auto-align CLI parses explicit safety flags and selectors", () => {
  assert.deepEqual(
    parseArgs([
      "--project",
      "demo",
      "--profile",
      "hero",
      "--animation",
      "attack",
      "--frames",
      "1-3",
      "--strategy",
      "active",
      "--spatial",
      "auto",
      "--direction",
      "right",
      "--confirm",
      "--no-sync",
    ]),
    {
      project: "demo",
      profile: "hero",
      animation: "attack",
      frames: "1-3",
      strategy: "active",
      spatial: "auto",
      direction: "right",
      confirm: true,
      "no-sync": true,
    },
  );
  assert.throws(() => parseArgs(["--project"]), /Missing value/);
  assert.throws(() => parseArgs(["unexpected"]), /Unexpected argument/);
});

test("plan files are atomic JSON artifacts with concise review summaries", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-align-cli-test-"));
  try {
    const planPath = path.join(directory, "plans", "attack.json");
    const plan = {
      planId: "align_test",
      projectId: "demo",
      profileId: "hero",
      animationId: "attack",
      entries: [
        { displayFrame: 1, asset: { name: "slash_1.png" } },
        { displayFrame: 2, asset: { name: "slash_2.png" } },
      ],
      canvas: { mode: "shared", shared: 2, mismatch: 0, unknown: 0 },
      mappingStrategy: "strict",
      selectedSourceFrames: [],
      mappingConfidence: 1,
      spatialMode: "identity",
      requiresVisualReview: false,
    };
    assert.equal(writePlan(planPath, plan), planPath);
    assert.deepEqual(readPlan(planPath), plan);
    assert.deepEqual(planSummary(plan), {
      planId: "align_test",
      target: "demo/hero/attack",
      entries: 2,
      frames: "1-2",
      assets: "slash_1.png -> slash_2.png",
      canvas: plan.canvas,
      mappingStrategy: "strict",
      selectedSourceFrames: [],
      mappingConfidence: 1,
      spatialMode: "identity",
      requiresVisualReview: false,
      existingAttachmentsPreserved: true,
    });
    assert.deepEqual(fs.readdirSync(path.dirname(planPath)), ["attack.json"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
