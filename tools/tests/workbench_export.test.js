"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/workbench_export");

/** @param {{features?:string[],activated?:boolean}} options Fixture options. @returns {object} Export fixture. */
function createFixture(options = {}) {
  const calls = { activation: [], authorization: [], exports: [], statuses: [] };
  const group = {
    animationId: "idle",
    name: "Idle",
    profileId: "hero",
    profileLabel: "Hero",
    type: "actor",
    speed: 12,
    anchorMode: "canvas_bottom_center",
    premiumFeatures: options.features || [],
    frames: [{ name: "idle.png", path: "data:image/png;base64,AA==" }],
  };
  const controller = createController({
    browserRuntime: {
      async exportWorkbenchPackage(metadata, items, workbench, dependencies) {
        calls.exports.push({ metadata, items, workbench, dependencies });
        return { filename: "idle.zip", frameCount: items.length };
      },
    },
    premiumFeatures: {
      normalizeFeatureIds(featureIds) {
        return [...new Set(featureIds)];
      },
      detectExportFeatures(snapshot) {
        return snapshot.sourceFeatures || [];
      },
    },
    async ensureActivated(featureIds) {
      calls.activation.push(featureIds);
      return options.activated !== false;
    },
    async fetchImpl(path, request) {
      calls.authorization.push({ path, request: JSON.parse(request.body) });
      return {
        ok: true,
        async json() {
          return { authorized: true, permit: "signed-export-permit" };
        },
      };
    },
    getCurrentGroup: () => group,
    getTuningSnapshot: () => ({ values: { scale: 1.1 } }),
    getAttachmentAssets: () => [
      { id: "same", groupKey: "hero/idle", path: "data:image/png;base64,AQ==" },
      { id: "other", groupKey: "hero/run", path: "data:image/png;base64,Ag==" },
    ],
    status: (message) => calls.statuses.push(message),
    translate: (key, variables = {}) => `${key}:${variables.count || ""}`,
  });
  return { calls, controller };
}

test("basic workbench export stays free and skips activation", async () => {
  const fixture = createFixture();
  const result = await fixture.controller.exportCurrentAnimation();

  assert.equal(result.frameCount, 1);
  assert.deepEqual(fixture.calls.activation, []);
  assert.equal(fixture.calls.exports.length, 1);
  assert.equal(fixture.calls.exports[0].workbench.attachmentAssets.length, 1);
  assert.deepEqual(fixture.calls.exports[0].workbench.premiumFeatures, []);
  assert.equal(fixture.calls.exports[0].dependencies.authorization.premium, false);
  assert.deepEqual(fixture.calls.authorization, []);
  assert.deepEqual(fixture.calls.statuses, ["exportPreparing:", "exportComplete:1"]);
});

test("premium workbench export waits for activation and preserves the edit", async () => {
  const fixture = createFixture({ features: ["tuner.collision-boxes"], activated: false });
  const result = await fixture.controller.exportCurrentAnimation();

  assert.equal(result, null);
  assert.deepEqual(fixture.calls.activation, [["tuner.collision-boxes"]]);
  assert.equal(fixture.calls.exports.length, 0);
  assert.deepEqual(fixture.calls.authorization, []);
});

test("activated premium export obtains and forwards a short-lived server permit", async () => {
  const fixture = createFixture({ features: ["tuner.collision-boxes"] });

  await fixture.controller.exportCurrentAnimation();

  assert.deepEqual(fixture.calls.authorization[0], {
    path: "/api/export/authorize",
    request: { features: ["tuner.collision-boxes"] },
  });
  assert.equal(fixture.calls.exports[0].dependencies.authorization.permit, "signed-export-permit");
});
