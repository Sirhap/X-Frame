"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const APP_JS = path.resolve(__dirname, "../animation_tuner/public/app.js");
const AUDIO_KEY = "demo:player:actor:animation:jump::0";

/**
 * Extracts one function declaration from app.js by name.
 * @param {string} source File contents.
 * @param {string} name Function name.
 * @returns {string}
 */
function extractFunction(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `${name} should exist`);
  let depth = 0;
  const start = match.index;
  let i = source.indexOf("{", start);
  for (; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail(`${name} is unclosed`);
  return "";
}

/**
 * Builds the clone/restore vm bag used by the S4 probe.
 * @param {object} seed Initial editor fields.
 * @returns {object}
 */
function makeCloneContext(seed) {
  const createdUrls = [];
  const ctx = {
    values: seed.values ?? { scale: 1 },
    bossValues: seed.bossValues ?? {},
    act2StatueBossValues: seed.act2StatueBossValues ?? {},
    huangXianValues: seed.huangXianValues ?? {},
    soulValues: seed.soulValues ?? {},
    yechengPropValues: seed.yechengPropValues ?? {},
    sceneSettings: seed.sceneSettings ?? {},
    selectedSceneId: seed.selectedSceneId ?? "arena",
    frameImageAttachments: seed.frameImageAttachments ?? [],
    selectedAttachmentId: seed.selectedAttachmentId ?? "",
    frameOverrides: seed.frameOverrides ?? {},
    vfxFrameOverrides: seed.vfxFrameOverrides ?? {},
    framePlaybackOverrides: seed.framePlaybackOverrides ?? {},
    vfxPlaybackOverrides: seed.vfxPlaybackOverrides ?? {},
    frameBoxOverrides: seed.frameBoxOverrides ?? {},
    attackTrailEditor: {
      snapshot() {
        return { schemaVersion: 8, bindings: {} };
      },
      restore() {},
    },
    bossFrameOverrides: seed.bossFrameOverrides ?? {},
    bossPlaybackOverrides: seed.bossPlaybackOverrides ?? {},
    act2StatueBossFrameOverrides: seed.act2StatueBossFrameOverrides ?? {},
    act2StatueBossPlaybackOverrides: seed.act2StatueBossPlaybackOverrides ?? {},
    huangXianFrameOverrides: seed.huangXianFrameOverrides ?? {},
    huangXianPlaybackOverrides: seed.huangXianPlaybackOverrides ?? {},
    soulFrameOverrides: seed.soulFrameOverrides ?? {},
    soulPlaybackOverrides: seed.soulPlaybackOverrides ?? {},
    soulFrameBoxOverrides: seed.soulFrameBoxOverrides ?? {},
    yechengPropFrameOverrides: seed.yechengPropFrameOverrides ?? {},
    selectedFrame: seed.selectedFrame ?? 0,
    selectedFrames: seed.selectedFrames ?? [0],
    selectionAnchorFrame: seed.selectionAnchorFrame ?? 0,
    currentGroup: seed.currentGroup ?? { uiId: "jump", name: "jump", frames: [{}] },
    config: seed.config ?? { groups: [{ uiId: "jump", name: "jump", frames: [{}] }] },
    frameAudioBindings: seed.frameAudioBindings ?? {},
    createdUrls,
    URL: {
      createObjectURL(value) {
        createdUrls.push(value);
        return `blob:undo/${createdUrls.length}`;
      },
      revokeObjectURL() {},
    },
    structuredClone,
    renderSceneSelect() {},
    syncSceneInputs() {},
    selectGroup() {
      return Promise.resolve();
    },
  };
  vm.createContext(ctx);
  return ctx;
}

test("cloneState snapshots audio bindings and restoreHistoryState brings them back", async () => {
  const source = fs.readFileSync(APP_JS, "utf8");
  const cloneStateSrc = extractFunction(source, "cloneState");
  const restoreHistoryStateSrc = extractFunction(source, "restoreHistoryState");
  const blob = { type: "audio/wav", size: 24 };
  const originalBinding = {
    key: AUDIO_KEY,
    name: "slash.wav",
    type: "audio/wav",
    size: 64,
    metadata: { projectId: "demo", animation: "jump", frame: 0 },
    data: "data:audio/wav;base64,UklGRg==",
    blob,
  };
  const ctx = makeCloneContext({
    frameAudioBindings: { [AUDIO_KEY]: structuredClone(originalBinding) },
    frameOverrides: { "jump:0": { offset: { x: 1, y: 2 } } },
  });
  vm.runInContext(`${cloneStateSrc}\n${restoreHistoryStateSrc}`, ctx);
  const snapshot = vm.runInContext("cloneState()", ctx);
  assert.equal(Object.hasOwn(snapshot, "frameAudioBindings"), true);
  assert.equal(snapshot.frameAudioBindings[AUDIO_KEY].name, "slash.wav");

  ctx.frameAudioBindings = {};
  ctx.__snapshot = snapshot;
  await vm.runInContext("restoreHistoryState(__snapshot)", ctx);
  assert.equal(ctx.frameAudioBindings[AUDIO_KEY].name, "slash.wav");
  assert.equal(ctx.frameOverrides["jump:0"].offset.x, 1);
  assert.ok(ctx.createdUrls.includes(blob) || ctx.createdUrls.some((value) => value?.type === "audio/wav"));
  assert.match(String(ctx.frameAudioBindings[AUDIO_KEY].url || ""), /^blob:undo\//);
});

test("bind and unbind frame audio push undo before mutating", () => {
  const source = fs.readFileSync(APP_JS, "utf8");
  const bindSrc = extractFunction(source, "bindFrameAudioFile");
  const removeSrc = extractFunction(source, "removeFrameAudioFromCard");
  assert.match(bindSrc, /pushUndo\s*\(/);
  assert.match(removeSrc, /pushUndo\s*\(/);
  const pushAt = bindSrc.indexOf("pushUndo");
  const setAt = bindSrc.search(/setFrameAudioBinding|await setFrameAudioBinding/);
  assert.ok(pushAt >= 0 && setAt >= 0 && pushAt < setAt, "pushUndo must run before bind");
  assert.equal(
    bindSrc.includes("persistBrowserSessionProject"),
    false,
    "unsaved bind must not snapshot the session",
  );
  assert.equal(
    bindSrc.includes("syncFrameAudioBindingsToGame"),
    false,
    "unsaved bind must not POST /api/frame-audio",
  );
  assert.equal(
    removeSrc.includes("persistBrowserSessionProject"),
    false,
    "unsaved clear must not snapshot the session",
  );
  assert.equal(
    removeSrc.includes("syncFrameAudioBindingsToGame"),
    false,
    "unsaved clear must not POST /api/frame-audio",
  );
});

const { createController: createFrameAudioController } = require("../animation_tuner/public/app_frame_audio");

/** In-memory IndexedDB used to prove bind is not an IDB write-through. */
function createMemoryIndexedDb() {
  const records = new Map();
  function succeed(target, result) {
    target.result = result;
    queueMicrotask(() => target.onsuccess?.({ target }));
  }
  return {
    records,
    open() {
      const request = {
        result: {
          objectStoreNames: { contains: () => true },
          transaction() {
            const tx = { oncomplete: null, onerror: null };
            queueMicrotask(() => tx.oncomplete?.());
            tx.objectStore = () => ({
              put(value) {
                records.set(value.key, value);
                const putRequest = { result: value, onsuccess: null, onerror: null };
                succeed(putRequest, value);
                return putRequest;
              },
              delete(key) {
                records.delete(key);
                const deleteRequest = { result: undefined, onsuccess: null, onerror: null };
                succeed(deleteRequest, undefined);
                return deleteRequest;
              },
              getAll() {
                const getRequest = { result: [...records.values()], onsuccess: null, onerror: null };
                succeed(getRequest, [...records.values()]);
                return getRequest;
              },
            });
            return tx;
          },
        },
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
}

/**
 * Live bindFrameAudioFile plus the persist/sync calls it makes, plus reload hydrators.
 * @returns {Promise<object>} Harness bag.
 */
async function createLiveBindHarness() {
  const source = fs.readFileSync(APP_JS, "utf8");
  const bindSrc = extractFunction(source, "bindFrameAudioFile");
  const removeSrc = extractFunction(source, "removeFrameAudioFromCard");
  const group = { uiId: "jump", animationId: "jump", frames: [{}] };
  const indexedDb = createMemoryIndexedDb();
  const bindings = {};
  const session = { frameAudioBindings: [] };
  const apiPosted = [];
  let config = {};
  const frameAudio = createFrameAudioController({
    dbName: "d2-audio",
    dbVersion: 1,
    storeName: "audio",
    getBindings: () => bindings,
    getActiveProjectId: () => "click-qa",
    getFrameAudioKey: (index, target) => `click-qa:${target.animationId}:${index}`,
    getFrameAudioMetadata: (index, target) => ({
      projectId: "click-qa",
      animation: target.animationId,
      frame: index,
    }),
    getFrameAudioMetadataFromKey: (key) => {
      const parts = String(key).split(":");
      return { projectId: parts[0], animation: parts[1], frame: Number(parts[2]) };
    },
    revokeBinding() {},
    status() {},
    translate: (key) => key,
    getConfig: () => config,
    indexedDBRef: indexedDb,
    fileReaderConstructor: class FakeFileReader {
      readAsDataURL(blob) {
        this.result = `data:${blob.type || "audio/wav"};base64,BEEF`;
        queueMicrotask(() => this.onload?.());
      }
    },
    urlApi: {
      createObjectURL: (value) => `blob:d2/${value.name || "audio"}`,
      revokeObjectURL() {},
    },
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      apiPosted.splice(0, apiPosted.length, ...(body.frameAudioBindings || []));
      return {
        ok: true,
        async json() {
          return { dataRevision: "r-d2", frameAudioCount: apiPosted.length };
        },
      };
    },
  });
  const ctx = {
    selectedFrame: 0,
    currentGroup: group,
    clampFrameIndex: (index) => index,
    pushUndo() {},
    t: (key, vars = {}) => `${key}:${vars.name || vars.message || ""}`,
    setFrameAudioBinding: frameAudio.setBinding,
    clearFrameAudioBinding: frameAudio.clearBinding,
    frameAudioBinding: (index, target) => bindings[`click-qa:${target.animationId}:${index}`] || null,
    markDirty() {},
    persistBrowserSessionProject: async () => {
      session.frameAudioBindings = Object.values(bindings).map((binding) => ({
        key: binding.key,
        name: binding.name,
        type: binding.type,
        size: binding.size,
        metadata: binding.metadata,
        blob: binding.blob,
      }));
    },
    syncFrameAudioBindingsToGame: frameAudio.syncToGame,
    collectFrameAudioBindingsForSave: async () => {
      const payload = await frameAudio.collectForSave();
      await frameAudio.persistBindingsToDb();
      return payload;
    },
    frameAudio,
    clearSelectedAttachment() {},
    els: { frameAudioFile: { value: "beep.wav" } },
    setSingleFrameSelection() {},
    syncFrameInputs() {},
    syncFrameAudioInputs() {},
    renderFilmstrip() {},
    draw() {},
    status() {},
    requestAppConfirmation: async () => true,
  };
  vm.createContext(ctx);
  vm.runInContext(`${bindSrc}\n${removeSrc}`, ctx);
  return { apiPosted, bindings, ctx, frameAudio, group, indexedDb, session };
}

/** Reloads memory the way project load hydrates frame audio (session + /api + IDB). */
async function simulateFrameAudioReload(harness) {
  for (const key of Object.keys(harness.bindings)) delete harness.bindings[key];
  for (const entry of harness.session.frameAudioBindings || []) {
    if (!entry?.key) continue;
    harness.bindings[entry.key] = { ...entry };
  }
  for (const entry of harness.apiPosted) {
    const key = entry.key || `click-qa:${entry.animation}:${entry.frame}`;
    harness.bindings[key] = { key, name: entry.name, metadata: entry, data: entry.data };
  }
  await harness.frameAudio.loadFromDb();
}

test("undo of an unsaved bindFrameAudioFile does not come back from session or /api/frame-audio", async () => {
  const harness = await createLiveBindHarness();
  const beep = { name: "beep.wav", type: "audio/wav", size: 24 };
  harness.ctx.__file = beep;
  const bound = await vm.runInContext("bindFrameAudioFile(__file, 0, currentGroup)", harness.ctx);
  assert.equal(bound, true);
  assert.equal(harness.bindings["click-qa:jump:0"]?.name, "beep.wav", "bind stays in memory");

  delete harness.bindings["click-qa:jump:0"];
  await simulateFrameAudioReload(harness);
  assert.equal(
    harness.bindings["click-qa:jump:0"],
    undefined,
    "undo of an unsaved bind must not hydrate from session persist or POST /api/frame-audio",
  );
});

test("Save after bindFrameAudioFile still restores the WAV on reload (SAV-011)", async () => {
  const harness = await createLiveBindHarness();
  const beep = { name: "beep.wav", type: "audio/wav", size: 24 };
  harness.ctx.__file = beep;
  await vm.runInContext("bindFrameAudioFile(__file, 0, currentGroup)", harness.ctx);
  await harness.ctx.collectFrameAudioBindingsForSave();
  await harness.ctx.persistBrowserSessionProject();
  await harness.ctx.syncFrameAudioBindingsToGame();

  delete harness.bindings["click-qa:jump:0"];
  await simulateFrameAudioReload(harness);
  assert.equal(
    harness.bindings["click-qa:jump:0"]?.name,
    "beep.wav",
    "explicit Save must restore after reload",
  );
});
