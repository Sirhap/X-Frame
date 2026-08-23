"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProjectStore } = require("../project_store");
const { PLAN_RETENTION_MS, createReviewedPlanStore } = require("../xsxb_mcp_plan_store");

test("reviewed plan store survives process recreation and rejects expired plans", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-plan-store-"));
  try {
    const projectStore = createProjectStore(root);
    projectStore.addProject({ id: "plan", label: "Plan" });
    const project = projectStore.activeProject("plan");
    let now = 1000;
    let removed = 0;
    const original = createReviewedPlanStore({
      projectStore,
      now: () => now,
      onRemove: () => {
        removed += 1;
      },
    }).save(project, {
      planId: "weapon_1234567890abcdef12345678",
      projectId: "plan",
      schemaVersion: 2,
    });
    now += 1000;
    const same = createReviewedPlanStore({ projectStore, now: () => now }).save(project, {
      planId: "weapon_1234567890abcdef12345678",
      projectId: "plan",
      schemaVersion: 2,
    });
    assert.equal(same.createdAtMs, original.createdAtMs);
    assert.equal(same.expiresAtMs, original.expiresAtMs);
    assert.throws(
      () =>
        createReviewedPlanStore({ projectStore, now: () => now }).save(project, {
          planId: "weapon_1234567890abcdef12345678",
          projectId: "different",
          schemaVersion: 2,
        }),
      /collision|different content/iu,
    );
    const restarted = createReviewedPlanStore({
      projectStore,
      now: () => now,
      onRemove: () => {
        removed += 1;
      },
    });
    assert.equal(restarted.load(project, "weapon_1234567890abcdef12345678").schemaVersion, 2);
    now += PLAN_RETENTION_MS + 1;
    assert.throws(() => restarted.load(project, "weapon_1234567890abcdef12345678"), /expired/u);
    assert.equal(removed, 1);
    assert.throws(() => restarted.load(project, "weapon_1234567890abcdef12345678"), /not found/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
