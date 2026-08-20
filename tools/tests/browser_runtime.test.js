"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const browserRuntime = require("../animation_tuner/public/browser_runtime.js");
const mediaExportCore = require("../animation_tuner/public/media_export_core.js");

test("browser runtime creates an isolated empty project shell", async () => {
  const response = await browserRuntime.fetchConfig();
  const config = await response.json();
  assert.equal(response.ok, true);
  assert.equal(config.activeProjectId, "browser-session");
  assert.deepEqual(config.groups, []);
  assert.deepEqual(config.scenes, []);
});

test("browser runtime discards an abandoned transient project", async () => {
  const created = await browserRuntime.createSessionProject("Throwaway");
  assert.ok(browserRuntime.getSessionProjectConfig(created.projectId));
  assert.equal(await browserRuntime.discardSessionProject(created.projectId), true);
  assert.equal(browserRuntime.getSessionProjectConfig(created.projectId), null);
});

/** Builds an in-memory project snapshot store for isolated runtime tests. */
function memoryProjectStorage() {
  let persisted = null;
  return {
    snapshot: () => persisted,
    store: require("../animation_tuner/public/browser_project_storage").createStore({
      adapter: {
        read: async () => persisted,
        write: async (snapshot) => {
          persisted = snapshot;
        },
      },
    }),
  };
}

test("ORG-005 createSessionProject does not persist a name longer than the role-name cap", async () => {
  const html = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../animation_tuner/public/index.html"),
    "utf8",
  );
  const maxLength = Number(html.match(/id="organizerProfileName"[\s\S]*?maxlength="(\d+)"/u)[1]);
  const memory = memoryProjectStorage();
  const runtime = browserRuntime.createRuntime({ projectStorage: memory.store });
  try {
    const longName = "a".repeat(maxLength + 1);
    let created;
    try {
      created = await runtime.createSessionProject(longName);
    } catch (error) {
      assert.match(String(error.message), /name|length|required/i);
      assert.equal(
        memory.snapshot()?.registry?.projects?.some((project) => project.label === longName),
        false,
      );
      return;
    }
    const config = runtime.getSessionProjectConfig(created.projectId);
    assert.ok(config?.activeProject?.label);
    assert.ok(
      config.activeProject.label.length <= maxLength,
      `ORG-005 stored ${config.activeProject.label.length} chars; cap is ${maxLength}`,
    );
    assert.notEqual(config.activeProject.label, longName);
  } finally {
    browserRuntime.createRuntime();
  }
});

test("ORG-005 createSessionProject accepts an 80-character name and still rejects whitespace", async () => {
  const html = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../animation_tuner/public/index.html"),
    "utf8",
  );
  const maxLength = Number(html.match(/id="organizerProfileName"[\s\S]*?maxlength="(\d+)"/u)[1]);
  const memory = memoryProjectStorage();
  const runtime = browserRuntime.createRuntime({ projectStorage: memory.store });
  try {
    const label = "c".repeat(maxLength);
    const created = await runtime.createSessionProject(label);
    assert.equal(runtime.getSessionProjectConfig(created.projectId).activeProject.label, label);
    await assert.rejects(() => runtime.createSessionProject("   "), /Project name is required/);
  } finally {
    browserRuntime.createRuntime();
  }
});

test("createSessionProject persists so a rehydrated runtime keeps the project label", async () => {
  const memory = memoryProjectStorage();
  const runtime = browserRuntime.createRuntime({ projectStorage: memory.store });
  try {
    const created = await runtime.createSessionProject("P0test1");
    assert.equal(created.projectId, "p0test1");
    assert.ok(
      memory.snapshot()?.registry?.projects?.some((project) => project.id === "p0test1"),
      "createSessionProject must write the shell into the snapshot store",
    );

    const reloaded = browserRuntime.createRuntime({ projectStorage: memory.store });
    const response = await reloaded.fetchConfig("/api/config?project=p0test1");
    assert.equal(response.ok, true);
    const config = await response.json();
    assert.equal(config.activeProjectId, "p0test1");
    assert.equal(config.activeProject.label, "P0test1");
    assert.deepEqual(config.groups, []);
  } finally {
    browserRuntime.createRuntime();
  }
});

test("fetchConfig auto-creates and persists an unregistered project instead of 404", async () => {
  const memory = memoryProjectStorage();
  const runtime = browserRuntime.createRuntime({ projectStorage: memory.store });
  try {
    const response = await runtime.fetchConfig("/api/config?project=p0test1");
    assert.equal(response.status, 200);
    const config = await response.json();
    assert.equal(config.activeProjectId, "p0test1");
    assert.ok(Array.isArray(config.groups));
    assert.equal((await response.text()).includes("Project not found"), false);

    const reloaded = browserRuntime.createRuntime({ projectStorage: memory.store });
    const again = await reloaded.fetchConfig("/api/config?project=p0test1");
    assert.equal(again.ok, true);
    assert.equal((await again.json()).activeProjectId, "p0test1");
  } finally {
    browserRuntime.createRuntime();
  }
});

test("first commit on an unregistered project auto-creates the session shell and persists frames", async () => {
  const memory = memoryProjectStorage();
  const runtime = browserRuntime.createRuntime({ projectStorage: memory.store });
  try {
    await runtime.commitSessionProjectConfig("p0test1", {
      groups: [{ animationId: "jump", frames: [{ name: "jump_0001.png" }] }],
      profiles: [{ id: "browser-character", label: "新角色" }],
      tuning: {},
    });

    const reloaded = browserRuntime.createRuntime({ projectStorage: memory.store });
    const response = await reloaded.fetchConfig("/api/config?project=p0test1");
    assert.equal(response.ok, true);
    const config = await response.json();
    assert.equal(config.groups[0].animationId, "jump");
    assert.equal(config.groups[0].frames[0].name, "jump_0001.png");
  } finally {
    browserRuntime.createRuntime();
  }
});

test("browser runtime exposes animation group counts in project summaries", () => {
  const summaries = browserRuntime.projectSummaries(
    [
      { id: "ready", label: "Ready" },
      { id: "empty", label: "Empty" },
    ],
    new Map([
      ["ready", { groups: [{ name: "idle" }] }],
      ["empty", { groups: [] }],
    ]),
  );

  assert.deepEqual(
    summaries.map((project) => [project.id, project.animationGroupCount]),
    [
      ["ready", 1],
      ["empty", 0],
    ],
  );
});

test("browser runtime builds a portable animation package", async () => {
  let capturedEntries = [];
  const result = await browserRuntime.exportAnimationPackage(
    {
      animationName: "Walk / East",
      profileLabel: "Hero",
      animationType: "actor",
      fps: 12,
      anchorMode: "canvas_bottom_center",
    },
    [{ name: "walk.png", data: "data:image/png;base64,AA==", flipped: false }],
    {
      batchZip: {
        async buildZip(entries) {
          capturedEntries = entries;
          return new Blob(["zip"]);
        },
      },
      now: () => new Date("2026-07-22T00:00:00.000Z"),
      mediaExportCore,
    },
  );

  assert.equal(result.filename, "Walk-East-xsxb.zip");
  assert.equal(result.frameCount, 1);
  assert.equal(capturedEntries[0].name, "frames/Walk-East1.png");
  assert.ok(capturedEntries.some((entry) => entry.name === "frames.json"));
  const manifest = JSON.parse(capturedEntries.find((entry) => entry.name === "xsxb-animation.json").data);
  assert.equal(manifest.godotImport.enabled, false);
  assert.equal(manifest.animation.frames[0].file, "frames/Walk-East1.png");
});

test("sprite-sheet-only export downloads PNG files instead of a zip package", async () => {
  const downloads = [];
  const documentApi = {
    body: {
      append(node) {
        this.last = node;
      },
    },
    createElement() {
      return {
        hidden: true,
        click() {
          downloads.push({ href: this.href, download: this.download });
        },
        remove() {},
      };
    },
  };
  let zipBuilds = 0;
  const sheetBlob = new Blob(["png"]);
  const result = await browserRuntime.exportAnimationPackage(
    { animationName: "Walk / East", exportRecipe: { metadataJson: false } },
    [
      {
        name: "walk.png",
        data: "data:image/png;base64,AA==",
        image: { width: 8, height: 8 },
        width: 8,
        height: 8,
      },
    ],
    {
      formats: { frames: false, spritesheet: true },
      batchZip: {
        async buildZip() {
          zipBuilds += 1;
          return new Blob(["zip"]);
        },
      },
      mediaExportCore: {
        ...mediaExportCore,
        async renderSpriteSheetEntries() {
          return [{ name: "spritesheets/Walk-East.png", data: sheetBlob }];
        },
        createAtlasManifest() {
          return { sheets: [{ file: "spritesheets/Walk-East.png" }] };
        },
        planSpriteSheets() {
          return { pages: [{ index: 0, width: 8, height: 8 }], placements: [] };
        },
      },
      document: documentApi,
      urlApi: {
        createObjectURL: () => "blob:sheet",
        revokeObjectURL() {},
      },
    },
  );

  assert.equal(zipBuilds, 0);
  assert.equal(result.filename, "Walk-East.png");
  assert.equal(downloads[0].download, "Walk-East.png");
});

test("browser runtime rejects frames without processed PNG data", async () => {
  await assert.rejects(
    browserRuntime.exportAnimationPackage({ animationName: "Idle" }, [{ data: "" }], {
      batchZip: { buildZip: async () => new Blob() },
    }),
    /missing processed PNG data/,
  );
});

test("browser runtime rejects organizer ZIP output without a verified permit", async () => {
  await assert.rejects(
    browserRuntime.exportAnimationPackage(
      { animationName: "Idle" },
      [{ data: "data:image/png;base64,AA==" }],
      {
        premiumFeatures: ["organizer.output"],
        batchZip: { buildZip: async () => new Blob() },
      },
    ),
    /verified Pro export permit/,
  );
});

test("browser runtime creates organizer ZIP output after permit verification", async () => {
  const verificationRequests = [];
  const result = await browserRuntime.exportAnimationPackage(
    { animationName: "Idle" },
    [{ data: "data:image/png;base64,AA==" }],
    {
      authorization: { permit: "signed-permit" },
      premiumFeatures: ["organizer.output"],
      async fetchImpl(path, request) {
        verificationRequests.push({ path, body: JSON.parse(request.body) });
        return {
          ok: true,
          async json() {
            return { authorized: true };
          },
        };
      },
      batchZip: { buildZip: async () => new Blob(["zip"]) },
      mediaExportCore,
    },
  );

  assert.equal(result.frameCount, 1);
  assert.deepEqual(verificationRequests, [
    {
      path: "/api/export/verify",
      body: { features: ["organizer.output"], permit: "signed-permit" },
    },
  ]);
});

test("browser runtime builds a sprite-sheet-only package without dangling PNG paths", async () => {
  let zipBuilds = 0;
  const downloads = [];
  const drawCalls = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      clearRect() {},
      drawImage: (...args) => drawCalls.push(args),
    }),
    toBlob: (callback) => callback(new Blob(["sheet"])),
  };

  const result = await browserRuntime.exportAnimationPackage(
    { animationName: "Idle", fps: 10 },
    [
      {
        name: "idle.png",
        data: "data:image/png;base64,AA==",
        image: { id: "idle" },
        width: 32,
        height: 24,
      },
    ],
    {
      formats: { frames: false, spritesheet: true },
      mediaExportCore,
      urlApi: {
        createObjectURL: () => "blob:sheet",
        revokeObjectURL() {},
      },
      document: {
        body: {
          append(node) {
            this.last = node;
          },
        },
        createElement: (tagName) =>
          tagName === "canvas"
            ? canvas
            : {
                hidden: true,
                click() {
                  downloads.push({ href: this.href, download: this.download });
                },
                remove() {},
              },
      },
      batchZip: {
        async buildZip() {
          zipBuilds += 1;
          return new Blob(["zip"]);
        },
      },
    },
  );

  assert.equal(zipBuilds, 1);
  assert.match(result.filename, /-xsxb\.zip$/i);
  assert.equal(downloads[0].download, result.filename);
  assert.deepEqual(drawCalls[0], [{ id: "idle" }, 0, 0, 32, 24]);
});

test("browser runtime stops before ZIP creation when export is cancelled", async () => {
  const abortController = new AbortController();
  abortController.abort();
  let zipBuilds = 0;

  await assert.rejects(
    browserRuntime.exportAnimationPackage(
      { animationName: "Idle" },
      [{ data: "data:image/png;base64,AA==" }],
      {
        signal: abortController.signal,
        mediaExportCore,
        batchZip: {
          async buildZip() {
            zipBuilds += 1;
            return new Blob(["zip"]);
          },
        },
      },
    ),
    { name: "AbortError" },
  );

  assert.equal(zipBuilds, 0);
});

test("browser runtime builds uniquely named transient tuning groups", () => {
  const group = browserRuntime.createSessionAnimationGroup(
    {
      animationName: "Idle",
      profileLabel: "Hero",
      animationType: "actor",
      fps: 12,
      premiumFeatures: ["cutout.edge-refinement"],
    },
    [{ name: "idle.png", data: "data:image/png;base64,AA==" }],
    [{ animationId: "idle", profileId: "browser-character" }],
    "en",
  );

  assert.equal(group.animationId, "idle-2");
  assert.equal(group.profileLabel, "Hero");
  assert.equal(group.speed, 12);
  assert.equal(group.frames[0].path, "data:image/png;base64,AA==");
  assert.deepEqual(group.premiumFeatures, ["cutout.edge-refinement"]);
  assert.match(group.uiId, /^browser-session:actor:idle-2:/);
  assert.throws(
    () => browserRuntime.createSessionAnimationGroup({ animationName: "Bad" }, [{ data: "" }], []),
    /PNG/,
  );
});

test("browser session frames preserve stable ids and asset revisions across reorder and replacement", () => {
  const group = browserRuntime.createSessionAnimationGroup(
    { animationName: "Run", profileLabel: "Hero" },
    [
      { frameId: "scatter:run:a", name: "a.png", data: "data:image/png;base64,AQ==", assetRevision: 2 },
      { frameId: "scatter:run:b", name: "b.png", data: "data:image/png;base64,Ag==", assetRevision: 0 },
    ],
    [],
  );
  assert.deepEqual(
    group.frames.map(({ id, assetRevision }) => [id, assetRevision]),
    [
      ["scatter:run:a", 2],
      ["scatter:run:b", 0],
    ],
  );

  browserRuntime.reorganizeSessionAnimation(group, [
    { sourceIndex: 1, name: "b.png" },
    { sourceIndex: 0, name: "a.png" },
  ]);
  assert.deepEqual(
    group.frames.map((frame) => frame.id),
    ["scatter:run:b", "scatter:run:a"],
  );

  browserRuntime.replaceSessionAnimationFrame(group, 0, { data: "data:image/png;base64,Aw==" });
  assert.equal(group.frames[0].id, "scatter:run:b");
  assert.equal(group.frames[0].assetRevision, 1);
  assert.equal(group.frames[1].assetRevision, 2);
});

test("browser runtime scopes animation names to one profile", () => {
  const group = browserRuntime.createSessionAnimationGroup(
    { animationName: "Idle", profileId: "villain", profileLabel: "Villain" },
    [{ name: "idle.png", data: "data:image/png;base64,AA==" }],
    [{ animationId: "idle", profileId: "hero" }],
    "en",
  );
  assert.equal(group.animationId, "idle");
  assert.equal(group.runtimeAnimation, "villain/idle");
});

test("browser runtime reorganizes one session group and remaps its frame-owned state", () => {
  const group = browserRuntime.createSessionAnimationGroup(
    { animationName: "Idle", profileLabel: "Hero" },
    [
      { name: "one.png", data: "data:image/png;base64,AQ==" },
      { name: "two.png", data: "data:image/png;base64,Ag==" },
    ],
    [],
  );
  const prefix = `${group.runtimeAnimation}:`;
  const result = browserRuntime.reorganizeSessionAnimation(
    group,
    [
      { sourceIndex: 1, name: "two.png", flipped: true, data: "data:image/png;base64,Aw==" },
      { sourceIndex: 0, name: "one.png" },
    ],
    {
      frameVisualOverrides: { [`${prefix}0`]: { x: 10 }, [`${prefix}1`]: { x: 20 } },
      framePlaybackOverrides: { [`${prefix}0`]: { duration: 90 } },
      frameBoxOverrides: { [`${prefix}1`]: { hitbox: { offset: { x: 5 }, rotation: 12 } } },
      frameAudioBindings: {
        "browser-session:player:browser-character:actor:Idle:browser-session:1": {
          key: "browser-session:player:browser-character:actor:Idle:browser-session:1",
          metadata: { animation: group.runtimeAnimation, frame: 1 },
        },
      },
      frameImageAttachments: [
        { key: `${prefix}0`, metadata: { animation: group.runtimeAnimation, frame: 0 } },
      ],
      attackTrails: {
        schemaVersion: 8,
        bindings: {
          [group.runtimeAnimation]: [
            {
              id: "slash",
              sticks: [
                { id: "frame-zero-late", frame: 0, framePhase: 0.8, order: 1 },
                { id: "frame-one", frame: 1, framePhase: 0.5, order: 2 },
                { id: "frame-zero-early", frame: 0, framePhase: 0.2, order: 0 },
              ],
            },
          ],
        },
      },
      premiumFeatures: ["organizer.sequence-analysis"],
    },
  );

  assert.equal(group.frames[0].path, "data:image/png;base64,Aw==");
  assert.deepEqual(result.frameVisualOverrides[`${prefix}0`], { x: 20 });
  assert.deepEqual(result.frameVisualOverrides[`${prefix}1`], { x: 10 });
  assert.equal(result.frameBoxOverrides[`${prefix}0`].hitbox.offset.x, -5);
  assert.equal(result.frameBoxOverrides[`${prefix}0`].hitbox.rotation, -12);
  assert.equal(Object.values(result.frameAudioBindings)[0].metadata.frame, 0);
  assert.equal(result.frameImageAttachments[0].metadata.frame, 1);
  assert.deepEqual(
    result.attackTrails.bindings[group.runtimeAnimation][0].sticks.map(({ id, frame, order }) => ({
      id,
      frame,
      order,
    })),
    [
      { id: "frame-one", frame: 0, order: 0 },
      { id: "frame-zero-early", frame: 1, order: 1 },
      { id: "frame-zero-late", frame: 1, order: 2 },
    ],
  );
  assert.deepEqual(group.premiumFeatures, ["organizer.sequence-analysis"]);
});

test("TUN-021 committed session frame delete survives reload with the reference cleared", async () => {
  const memory = memoryProjectStorage();
  const runtime = browserRuntime.createRuntime({ projectStorage: memory.store });
  try {
    const group = runtime.createSessionAnimationGroup(
      { animationName: "assassin_jump", profileLabel: "新角色" },
      [
        { name: "one.png", data: "data:image/png;base64,AQ==" },
        { name: "two.png", data: "data:image/png;base64,Ag==" },
        { name: "three.png", data: "data:image/png;base64,Aw==" },
      ],
      [],
    );
    await runtime.commitSessionProjectConfig("p0test2", {
      groups: [group],
      profiles: [{ id: group.profileId, label: group.profileLabel }],
      tuning: {
        reference_frame: {
          profile_id: group.profileId,
          animation_id: group.animationId,
          frame_index: 2,
          transform: {},
        },
      },
    });

    const working = runtime.getSessionProjectConfig("p0test2");
    runtime.deleteSessionAnimationFrames(working.groups[0], [2]);
    await runtime.commitSessionProjectConfig("p0test2", {
      ...working,
      tuning: { ...working.tuning, reference_frame: null },
    });

    const reloaded = browserRuntime.createRuntime({ projectStorage: memory.store });
    const restored = await reloaded.fetchConfig("/api/config?project=p0test2");
    const config = await restored.json();
    assert.equal(config.groups[0].frames.length, 2);
    assert.equal(config.tuning.reference_frame, null);
  } finally {
    browserRuntime.createRuntime();
  }
});

test("browser runtime deletes selected session frames and remaps owned bindings and trails", () => {
  const group = browserRuntime.createSessionAnimationGroup(
    { animationName: "Attack", profileLabel: "Hero" },
    [
      { name: "one.png", data: "data:image/png;base64,AQ==" },
      { name: "two.png", data: "data:image/png;base64,Ag==" },
      { name: "three.png", data: "data:image/png;base64,Aw==" },
    ],
    [],
  );
  const prefix = `${group.runtimeAnimation}:`;
  const result = browserRuntime.deleteSessionAnimationFrames(group, [1], {
    frameVisualOverrides: {
      [`${prefix}0`]: { x: 10 },
      [`${prefix}1`]: { x: 20 },
      [`${prefix}2`]: { x: 30 },
    },
    framePlaybackOverrides: { [`${prefix}2`]: { duration: 90 } },
    frameBoxOverrides: { [`${prefix}1`]: { hitbox: {} } },
    frameAudioBindings: {
      [`${prefix}1`]: { path: "removed.wav" },
      [`${prefix}2`]: { path: "kept.wav" },
    },
    frameImageAttachments: [
      { key: `${prefix}0`, metadata: { animation: group.runtimeAnimation, frame: 0 } },
      { key: `${prefix}1`, metadata: { animation: group.runtimeAnimation, frame: 1 } },
    ],
    attackTrails: {
      schemaVersion: 8,
      bindings: {
        [group.runtimeAnimation]: [{ id: "slash", sticks: [{ frame: 0 }, { frame: 1 }, { frame: 2 }] }],
      },
    },
  });

  assert.deepEqual(
    group.frames.map((frame) => frame.name),
    ["one.png", "three.png"],
  );
  assert.deepEqual(result.frameVisualOverrides, {
    [`${prefix}0`]: { x: 10 },
    [`${prefix}1`]: { x: 30 },
  });
  assert.deepEqual(result.framePlaybackOverrides, { [`${prefix}1`]: { duration: 90 } });
  assert.deepEqual(result.frameBoxOverrides, {});
  assert.deepEqual(result.frameAudioBindings, { [`${prefix}1`]: { path: "kept.wav" } });
  assert.equal(result.frameImageAttachments.length, 1);
  assert.deepEqual(
    result.attackTrails.bindings[group.runtimeAnimation][0].sticks.map((stick) => stick.frame),
    [0, 1],
  );
});

test("browser runtime deletes a complete session animation without leaking owned state", () => {
  const attack = browserRuntime.createSessionAnimationGroup(
    { animationName: "Attack", profileId: "hero", profileLabel: "Hero" },
    [{ name: "attack.png", data: "data:image/png;base64,AQ==" }],
    [],
  );
  const idle = browserRuntime.createSessionAnimationGroup(
    { animationName: "Idle", profileId: "npc", profileLabel: "NPC" },
    [{ name: "idle.png", data: "data:image/png;base64,Ag==" }],
    [attack],
  );
  const result = browserRuntime.deleteSessionAnimation(
    {
      groups: [attack, idle],
      profiles: [
        { id: "hero", label: "Hero" },
        { id: "npc", label: "NPC" },
      ],
      attackTrails: {},
    },
    attack,
    {
      values: {
        [attack.scale]: 1.5,
        [attack.characterScale]: 1.2,
        [idle.scale]: 0.8,
        [idle.characterScale]: 0.9,
      },
      frameVisualOverrides: {
        [`${attack.runtimeAnimation}:0`]: { x: 1 },
        [`${idle.runtimeAnimation}:0`]: { x: 2 },
      },
      framePlaybackOverrides: {
        [`${attack.runtimeAnimation}:__group`]: { loop: true },
        [`${idle.runtimeAnimation}:0`]: { duration: 100 },
      },
      frameBoxOverrides: { [`${attack.runtimeAnimation}:0`]: { hitbox: {} } },
      frameAudioBindings: {
        [`${attack.runtimeAnimation}:0`]: { path: "attack.wav" },
        [`${idle.runtimeAnimation}:0`]: { path: "idle.wav" },
      },
      frameImageAttachments: [{ key: `${attack.runtimeAnimation}:0` }, { key: `${idle.runtimeAnimation}:0` }],
      attachmentAssets: [
        { id: "slash", groupKey: attack.runtimeAnimation },
        { id: "aura", groupKey: idle.runtimeAnimation },
      ],
      attackTrails: {
        schemaVersion: 8,
        bindings: {
          [attack.runtimeAnimation]: [{ id: "slash", sticks: [] }],
          [idle.runtimeAnimation]: [{ id: "aura", sticks: [] }],
        },
      },
    },
  );

  assert.deepEqual(result.config.groups, [idle]);
  assert.deepEqual(result.config.profiles, [{ id: "npc", label: "NPC" }]);
  assert.equal(result.nextGroup, idle);
  assert.deepEqual(result.values, {
    [idle.scale]: 0.8,
    [idle.characterScale]: 0.9,
  });
  assert.deepEqual(result.frameVisualOverrides, {
    [`${idle.runtimeAnimation}:0`]: { x: 2 },
  });
  assert.deepEqual(result.framePlaybackOverrides, {
    [`${idle.runtimeAnimation}:0`]: { duration: 100 },
  });
  assert.deepEqual(result.frameBoxOverrides, {});
  assert.deepEqual(result.frameAudioBindings, {
    [`${idle.runtimeAnimation}:0`]: { path: "idle.wav" },
  });
  assert.deepEqual(result.frameImageAttachments, [{ key: `${idle.runtimeAnimation}:0` }]);
  assert.deepEqual(result.attachmentAssets, [{ id: "aura", groupKey: idle.runtimeAnimation }]);
  assert.deepEqual(Object.keys(result.attackTrails.bindings), [idle.runtimeAnimation]);
});

test("browser runtime replaces current pixels and scopes export state to one group", () => {
  const idle = browserRuntime.createSessionAnimationGroup(
    { animationName: "Idle", profileLabel: "Hero" },
    [{ name: "idle.png", data: "data:image/png;base64,AQ==" }],
    [],
  );
  const run = browserRuntime.createSessionAnimationGroup(
    { animationName: "Run", profileLabel: "Hero" },
    [{ name: "run.png", data: "data:image/png;base64,Ag==" }],
    [idle],
  );
  browserRuntime.replaceSessionAnimationFrames(
    idle,
    [{ data: "data:image/png;base64,Aw==" }],
    ["cutout.edge-refinement"],
  );
  const snapshot = browserRuntime.createSessionExportSnapshot(idle, {
    values: { [idle.scale]: 1.2, [run.scale]: 2 },
    frameVisualOverrides: {
      [`${idle.runtimeAnimation}:0`]: { x: 1 },
      [`${run.runtimeAnimation}:0`]: { x: 2 },
    },
    framePlaybackOverrides: {},
    frameBoxOverrides: {},
    frameAudioBindings: {},
    frameImageAttachments: [],
  });

  assert.equal(idle.frames[0].path, "data:image/png;base64,Aw==");
  assert.deepEqual(idle.premiumFeatures, ["cutout.edge-refinement"]);
  assert.deepEqual(snapshot.values, { [idle.scale]: 1.2 });
  assert.deepEqual(snapshot.frameVisualOverrides, { [`${idle.runtimeAnimation}:0`]: { x: 1 } });
});

test("browser runtime replaces only one selected animation frame", () => {
  const group = browserRuntime.createSessionAnimationGroup(
    { animationName: "Run", profileLabel: "Hero" },
    [
      { name: "run-1.png", data: "data:image/png;base64,AQ==" },
      { name: "run-2.png", data: "data:image/png;base64,Ag==" },
    ],
    [],
  );
  const firstFrame = group.frames[0];

  const updated = browserRuntime.replaceSessionAnimationFrame(
    group,
    1,
    { data: "data:image/png;base64,Aw==" },
    ["cutout.edge-refinement"],
  );

  assert.equal(group.frames[0], firstFrame);
  assert.equal(group.frames[1], updated);
  assert.equal(group.frames[1].path, "data:image/png;base64,Aw==");
  assert.deepEqual(group.premiumFeatures, ["cutout.edge-refinement"]);
});

test("browser runtime exports tuned animation metadata and attachment assets", async () => {
  let capturedEntries = [];
  const result = await browserRuntime.exportWorkbenchPackage(
    { animationName: "Idle", animationId: "idle", profileLabel: "Hero", fps: 12 },
    [{ name: "idle.png", data: "data:image/png;base64,AA==" }],
    {
      tuning: { values: { scale: 1.2 } },
      premiumFeatures: ["tuner.collision-boxes"],
      attachmentAssets: [{ name: "spark.png", path: "data:image/png;base64,AQ==" }],
    },
    {
      authorization: { permit: "signed-export-permit" },
      batchZip: {
        async buildZip(entries) {
          capturedEntries = entries;
          return new Blob(["zip"]);
        },
      },
      fetchImpl: async () => ({ ok: true, json: async () => ({ authorized: true }) }),
      now: () => new Date("2026-07-22T00:00:00.000Z"),
    },
  );

  const manifest = JSON.parse(capturedEntries.find((entry) => entry.name === "xsxb-animation.json").data);
  assert.equal(result.filename, "Idle-tuned-xsxb.zip");
  assert.equal(
    capturedEntries.some((entry) => entry.name === "attachments/asset_0001.png"),
    true,
  );
  assert.equal(manifest.workbench.tuning.values.scale, 1.2);
  assert.deepEqual(manifest.workbench.premiumFeatures, ["tuner.collision-boxes"]);
});

test("SAV-004 persist snapshot keeps typed offset 1 instead of the stale loaded 0", () => {
  const offsetKey = "profiles.hero.groups.jump.offset";
  const scaleKey = "profiles.hero.groups.jump.visual_size";
  const config = {
    tuning: {
      [offsetKey]: { x: 0, y: 0 },
      [scaleKey]: 1,
    },
  };
  const values = {
    [offsetKey]: { x: 1, y: 0 },
    [scaleKey]: 1,
  };

  const snapshot = browserRuntime.mergeLiveTuningIntoConfig(config, {
    values,
    referenceFrame: { profile_id: "hero", animation_id: "jump", frame_index: 4 },
    frameVisualOverrides: {},
    framePlaybackOverrides: {},
    frameBoxOverrides: {},
  });

  assert.equal(
    snapshot.tuning[offsetKey].x,
    1,
    "autosave must persist the live typed 水平位置, not config.tuning's leftover 0",
  );
  assert.equal(snapshot.tuning[offsetKey].y, 0);
  assert.equal(snapshot.tuning[scaleKey], 1);
  assert.equal(snapshot.tuning.reference_frame.frame_index, 4);
});
