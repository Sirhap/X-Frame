const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_save_controller");

function response(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

function createFixture(overrides = {}) {
  const state = {
    config: { dataRevision: "r1", groups: [] },
    saveInFlight: false,
    editRevision: 4,
    dirty: true,
  };
  const events = [];
  const requests = [];
  const controller = createController({
    getConfig: () => state.config,
    getSaveInFlight: () => state.saveInFlight,
    setSaveInFlight: (value) => {
      state.saveInFlight = value;
      events.push(`in-flight:${value}`);
    },
    getEditRevision: () => state.editRevision,
    setDirty: (value) => {
      state.dirty = value;
    },
    getActiveProjectId: () => "project-a",
    updateSaveState: () => events.push("save-state"),
    updateAdjustmentFromInputs: () => events.push("adjustment"),
    pruneNoopFrameOverrides: () => events.push("prune"),
    collectFrameAudioBindingsForSave: async () => {
      events.push("audio");
      return [{ frame: 1 }];
    },
    collectTuningValues: () => ({ scale: 1 }),
    collectBossTuningValues: () => ({ scale: 2 }),
    collectAct2StatueBossTuningValues: () => ({ scale: 3 }),
    collectHuangXianTuningValues: () => ({ scale: 4 }),
    collectSoulTuningValues: () => ({ scale: 5 }),
    collectYechengPropTuningValues: () => ({ scale: 6 }),
    collectSceneSettings: () => ({ scene: "main" }),
    collectFrameImageAttachmentsForSave: () => [{ id: "attachment" }],
    getFrameOverrides: () => ({ frame: 1 }),
    getVfxFrameOverrides: () => ({ vfx: 2 }),
    getFramePlaybackOverrides: () => ({ playback: 3 }),
    getVfxPlaybackOverrides: () => ({ vfxPlayback: 4 }),
    getFrameBoxOverrides: () => ({ box: 5 }),
    getBossFrameOverrides: () => ({ boss: 6 }),
    getBossPlaybackOverrides: () => ({ bossPlayback: 7 }),
    getAct2StatueBossFrameOverrides: () => ({ act2: 8 }),
    getAct2StatueBossPlaybackOverrides: () => ({ act2Playback: 9 }),
    getHuangXianFrameOverrides: () => ({ huang: 10 }),
    getHuangXianPlaybackOverrides: () => ({ huangPlayback: 11 }),
    getSoulFrameOverrides: () => ({ soul: 12 }),
    getSoulPlaybackOverrides: () => ({ soulPlayback: 13 }),
    getSoulFrameBoxOverrides: () => ({ soulBox: 14 }),
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return response({ dataRevision: "r2", warnings: ["warning"] });
    },
    markClean: () => events.push("clean"),
    status: (message) => events.push(`status:${message}`),
    translate: (key, variables = {}) => `${key}:${variables.warnings || ""}`,
    ...overrides,
  });
  return { controller, events, requests, state };
}

test("save preserves payload shape and revision lifecycle", async () => {
  const fixture = createFixture();
  await fixture.controller.save();

  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.requests[0].url, "/api/save");
  assert.deepEqual(JSON.parse(fixture.requests[0].options.body), {
    projectId: "project-a",
    baseRevision: "r1",
    values: { scale: 1 },
    scene_settings: { scene: "main" },
    frame_audio_bindings: [{ frame: 1 }],
    frame_image_attachments: [{ id: "attachment" }],
    frame_visual_overrides: { frame: 1 },
    attack_vfx_frame_overrides: { vfx: 2 },
    frame_playback_overrides: { playback: 3 },
    attack_vfx_playback_overrides: { vfxPlayback: 4 },
    frame_box_overrides: { box: 5 },
    boss: {
      values: { scale: 2 },
      boss_frame_visual_overrides: { boss: 6 },
      boss_frame_playback_overrides: { bossPlayback: 7 },
    },
    act2StatueBoss: {
      values: { scale: 3 },
      frame_visual_overrides: { act2: 8 },
      frame_playback_overrides: { act2Playback: 9 },
    },
    huangXian: {
      values: { scale: 4 },
      frame_visual_overrides: { huang: 10 },
      frame_playback_overrides: { huangPlayback: 11 },
    },
    soul: {
      values: { scale: 5 },
      frame_visual_overrides: { soul: 12 },
      frame_playback_overrides: { soulPlayback: 13 },
      frame_box_overrides: { soulBox: 14 },
    },
    yechengProps: { values: { scale: 6 } },
  });
  assert.equal(fixture.state.config.dataRevision, "r2");
  assert.equal(fixture.state.saveInFlight, false);
  assert.ok(fixture.events.indexOf("adjustment") < fixture.events.indexOf("audio"));
  assert.ok(fixture.events.includes("clean"));
  assert.ok(fixture.events.includes("status:warnings:warning"));
});

test("save resets in-flight state when the request fails", async () => {
  const fixture = createFixture({
    fetchImpl: async () => {
      throw new Error("network failed");
    },
  });

  await assert.rejects(() => fixture.controller.save(), /network failed/);
  assert.equal(fixture.state.saveInFlight, false);
  assert.equal(fixture.events.filter((event) => event === "save-state").length, 2);
});

test("save keeps advanced edits available without requesting export activation", async () => {
  const prompts = [];
  const fixture = createFixture({
    premiumFeatures: {
      detectTunerFeatures: () => ["tuner.frame-audio"],
    },
    ensurePremiumActivated: async (featureIds) => {
      prompts.push(featureIds);
      return false;
    },
  });

  await fixture.controller.save();

  assert.deepEqual(prompts, []);
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.state.saveInFlight, false);
  assert.equal(fixture.events.includes("clean"), true);
});

test("save locks before asynchronous preparation and ignores concurrent requests", async () => {
  let releaseAudio;
  let audioCollections = 0;
  const audioReady = new Promise((resolve) => {
    releaseAudio = resolve;
  });
  const fixture = createFixture({
    collectFrameAudioBindingsForSave: async () => {
      audioCollections += 1;
      await audioReady;
      return [];
    },
  });

  const firstSave = fixture.controller.save();
  assert.equal(fixture.state.saveInFlight, true);
  await fixture.controller.save();
  assert.equal(audioCollections, 1);
  assert.equal(fixture.requests.length, 0);
  releaseAudio();
  await firstSave;

  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.state.saveInFlight, false);
  assert.deepEqual(
    fixture.events.filter((event) => event.startsWith("in-flight:")),
    ["in-flight:true", "in-flight:false"],
  );
});

test("collision box preparation keeps existing values and fills missing fields", async () => {
  const stores = new Map();
  const fixture = createFixture({
    getCurrentGroup: () => ({ uiId: "other" }),
    getImages: () => [],
    mapWithConcurrency: async (items, worker) => Promise.all(items.map(worker)),
    loadImageCached: async (frame) => ({ frame }),
    canEditBox: () => true,
    boxOverrideStore: (group) => {
      if (!stores.has(group.uiId)) stores.set(group.uiId, {});
      return stores.get(group.uiId);
    },
    frameBoxKey: (index, group) => `${group.uiId}:${index}`,
    defaultCollisionBox: (index) => ({
      offset: { x: index, y: index },
      size: { x: 10, y: 20 },
      enabled: true,
    }),
    normalizeFrameBox: (_boxName, value) => ({ ...value, normalized: true }),
  });
  fixture.state.config.groups = [{ uiId: "group-a", frames: [{ id: 1 }, { id: 2 }] }];
  const store = stores.get("group-a") || {};
  store["group-a:0"] = { collisionbox: { offset: { x: 9, y: 9 } } };
  stores.set("group-a", store);

  await fixture.controller.ensureCollisionBoxOverridesForSave();
  assert.deepEqual(stores.get("group-a"), {
    "group-a:0": {
      collisionbox: {
        offset: { x: 9, y: 9 },
        size: { x: 10, y: 20 },
        rotation: 0,
        enabled: true,
        normalized: true,
      },
    },
    "group-a:1": {
      collisionbox: {
        offset: { x: 1, y: 1 },
        size: { x: 10, y: 20 },
        rotation: 0,
        enabled: true,
        normalized: true,
      },
    },
  });
});
