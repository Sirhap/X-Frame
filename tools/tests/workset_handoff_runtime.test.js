"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createBrowserAdapter,
  createLocalAdapter,
  manifestFromGroups,
} = require("../animation_tuner/public/workset_handoff_runtime");

/** Returns one browser-compatible animation group. */
function group(animationId = "idle") {
  return {
    profileId: "hero",
    profileLabel: "Hero",
    profileKind: "actor",
    animationId,
    name: animationId,
    runtimeAnimation: `hero/${animationId}`,
    frames: [{ name: "old.png", path: "data:image/png;base64,b2xk" }],
  };
}

test("manifest adapter preserves profile and animation ownership", () => {
  assert.deepEqual(manifestFromGroups([group()]), {
    schemaVersion: 1,
    profiles: [
      {
        id: "hero",
        label: "Hero",
        kind: "actor",
        animations: [{ id: "idle", name: "idle", frames: group().frames }],
      },
    ],
  });
});

test("browser adapter commits a mixed workset only after every operation succeeds", async () => {
  let config = {
    groups: [group()],
    profiles: [{ id: "hero", label: "Hero", kind: "actor" }],
    tuning: {},
    frameAudioBindings: {},
    frameImageAttachments: [],
  };
  let commitCount = 0;
  const runtime = {
    createSessionAnimationGroup(metadata, items) {
      return { ...group(metadata.animationId), name: metadata.animationName, frames: items };
    },
    reorganizeSessionAnimation(target, items) {
      target.frames = items;
      return {
        frameVisualOverrides: {},
        framePlaybackOverrides: {},
        frameBoxOverrides: {},
        frameAudioBindings: {},
        frameImageAttachments: [],
        attackTrails: { schemaVersion: 8, bindings: {} },
      };
    },
  };
  const adapter = createBrowserAdapter({
    browserRuntime: runtime,
    getProjectConfig: () => config,
    commitProjectConfig: (_projectId, nextConfig) => {
      commitCount += 1;
      config = nextConfig;
    },
    createProject: () => ({}),
  });
  const operations = [
    {
      id: "create-run",
      type: "create",
      profileLabel: "Hero",
      animationName: "run",
      items: [{ data: "data:image/png;base64,cnVu" }],
    },
    {
      id: "replace-idle",
      type: "replace",
      profileId: "hero",
      animationId: "idle",
      items: [{ sourceIndex: 0, data: "data:image/png;base64,bmV3" }],
    },
  ];
  const plan = await adapter.plan({ projectId: "project-a", operations });
  const result = await adapter.apply({
    projectId: "project-a",
    baseRevision: plan.baseRevision,
    operations,
  });

  assert.equal(result.ok, true);
  assert.equal(commitCount, 1);
  assert.deepEqual(
    config.groups.map((entry) => entry.animationId),
    ["idle", "run"],
  );
  assert.equal(config.groups[0].frames[0].data, "data:image/png;base64,bmV3");
});

test("browser adapter waits for project persistence before reporting apply success", async () => {
  let releaseCommit;
  let commitFinished = false;
  const config = {
    groups: [],
    profiles: [],
    tuning: {},
  };
  const adapter = createBrowserAdapter({
    browserRuntime: {
      createSessionAnimationGroup: (metadata, items) => ({
        ...group(metadata.animationId),
        profileId: metadata.profileId,
        frames: items,
      }),
      reorganizeSessionAnimation() {},
    },
    getProjectConfig: () => config,
    commitProjectConfig: async () => {
      await new Promise((resolve) => {
        releaseCommit = resolve;
      });
      commitFinished = true;
    },
    createProject: () => ({}),
  });
  const operations = [
    {
      id: "create-slice",
      type: "create",
      profileLabel: "Hero",
      animationName: "slice",
      items: [{ data: "data:image/png;base64,c2xpY2U=" }],
    },
  ];
  const plan = await adapter.plan({ projectId: "project-a", operations });
  let applyResolved = false;
  const applying = adapter
    .apply({ projectId: "project-a", baseRevision: plan.baseRevision, operations })
    .then(() => {
      applyResolved = true;
    });

  await Promise.resolve();
  assert.equal(applyResolved, false);
  releaseCommit();
  await applying;
  assert.equal(commitFinished, true);
  assert.equal(applyResolved, true);
});

test("browser adapter rolls back the whole clone when a later operation fails", async () => {
  const original = {
    groups: [group()],
    profiles: [{ id: "hero", label: "Hero", kind: "actor" }],
    tuning: {},
  };
  let committed = false;
  const adapter = createBrowserAdapter({
    browserRuntime: {
      createSessionAnimationGroup: (metadata, items) => ({
        ...group(metadata.animationId),
        frames: items,
      }),
      reorganizeSessionAnimation() {
        throw new Error("simulated browser mutation failure");
      },
    },
    getProjectConfig: () => original,
    commitProjectConfig: () => {
      committed = true;
    },
    createProject: () => ({}),
  });
  const operations = [
    {
      type: "create",
      profileLabel: "Hero",
      animationName: "run",
      items: [{ data: "data:image/png;base64,cnVu" }],
    },
    {
      type: "replace",
      profileId: "hero",
      animationId: "idle",
      items: [{ sourceIndex: 0, data: "data:image/png;base64,bmV3" }],
    },
  ];
  const plan = await adapter.plan({ projectId: "project-a", operations });

  await assert.rejects(
    adapter.apply({ projectId: "project-a", baseRevision: plan.baseRevision, operations }),
    /simulated browser mutation failure/,
  );
  assert.equal(committed, false);
  assert.equal(original.groups.length, 1);
  assert.equal(original.groups[0].frames[0].name, "old.png");
});

test("browser adapter invalidates preflight after an external binding edit", async () => {
  const config = {
    groups: [group()],
    profiles: [{ id: "hero", label: "Hero", kind: "actor" }],
    tuning: {},
  };
  const adapter = createBrowserAdapter({
    browserRuntime: {
      createSessionAnimationGroup() {},
      reorganizeSessionAnimation() {},
    },
    getProjectConfig: () => config,
    commitProjectConfig() {},
    createProject: () => ({}),
  });
  const operations = [
    {
      type: "replace",
      profileId: "hero",
      profileLabel: "Hero",
      animationId: "idle",
      animationName: "idle",
      items: [{ sourceIndex: 0, data: "data:image/png;base64,bmV3" }],
    },
  ];
  const plan = await adapter.plan({ projectId: "project-a", operations });
  config.tuning.frame_visual_overrides = { "hero/idle:0": { offset: { x: 2, y: 0 } } };

  await assert.rejects(
    adapter.apply({ projectId: "project-a", baseRevision: plan.baseRevision, operations }),
    /Project data changed/,
  );
});

test("local adapter preserves structured API failures", async () => {
  const adapter = createLocalAdapter({
    fetchImpl: async () => ({
      ok: false,
      status: 409,
      json: async () => ({ conflicts: [{ message: "名称冲突" }] }),
    }),
  });
  await assert.rejects(adapter.plan({ projectId: "p", operations: [] }), /名称冲突/);
});
