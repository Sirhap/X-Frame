"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createController: createMutations } = require("../animation_tuner/public/app_project_mutations");
const { createController: createRouting } = require("../animation_tuner/public/app_routing");

const APP_JS = path.resolve(__dirname, "../animation_tuner/public/app.js");

/**
 * Reads a source slice between two unique markers.
 * @param {string} source File contents.
 * @param {string} startMarker Inclusive start.
 * @param {string} endMarker Exclusive end.
 * @returns {string}
 */
function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `markers missing: ${startMarker}`);
  return source.slice(start, end);
}

/**
 * Builds a requestNavigation eval environment matching app.js closures.
 * @param {{dirtyTuning?:boolean,dirtyScatter?:boolean,dirtyTools?:boolean,language?:string,confirm?:boolean,decision?:string}} spec Surfaces and dialog answers.
 * @returns {object}
 */
function createLeaveEnv(spec = {}) {
  const dialogs = [];
  const env = {
    dirty: Boolean(spec.dirtyTuning),
    language: spec.language || "en",
    saveCalls: 0,
    scatterDiscarded: false,
    dialogs,
    frameOrganizer: {
      hasUnsavedChanges: () => Boolean(spec.dirtyTools),
    },
    batchCutout: { hasUnsavedChanges: () => false },
    async save() {
      env.saveCalls += 1;
      env.dirty = false;
    },
    appConfirmation: {
      async requestConfirmation(message, _details, options = {}) {
        dialogs.push({
          api: "requestConfirmation",
          title: options.title || "",
          message: String(message || ""),
        });
        return spec.confirm === true;
      },
      async requestDecision(message, options = {}) {
        dialogs.push({
          api: "requestDecision",
          title: options.title || "",
          message: String(message || ""),
        });
        return spec.decision || "cancel";
      },
    },
    XSXBScatterSliceSession: {
      hasUnsavedChanges: () => Boolean(spec.dirtyScatter) && !env.scatterDiscarded,
      allowDiscard() {
        env.scatterDiscarded = true;
      },
    },
  };
  return env;
}

/**
 * Evaluates production requestNavigation against one dirty-surface fixture.
 * @param {object} spec Leave fixture.
 * @returns {Promise<{accepted:boolean,env:object}>}
 */
async function runRequestNavigation(spec) {
  const source = fs.readFileSync(APP_JS, "utf8");
  const extract = extractBetween(source, "  requestNavigation: async () => {", ",\n  reportError:");
  const env = createLeaveEnv(spec);
  vm.createContext(env);
  const requestNavigation = vm.runInContext(`({ ${extract} }).requestNavigation`, env);
  const accepted = await requestNavigation();
  return { accepted, env };
}

test("document leave uses scatter copy for scatter-only dirty and does not save-leave", async () => {
  const shown = await runRequestNavigation({
    dirtyScatter: true,
    confirm: true,
  });
  assert.equal(shown.env.dialogs.length, 1);
  assert.equal(shown.env.dialogs[0].title, "离开零散切片？");
  assert.match(shown.env.dialogs[0].message, /零散切片/);
  assert.equal(shown.env.dialogs[0].api, "requestConfirmation");
  assert.equal(shown.accepted, true);
  assert.equal(shown.env.saveCalls, 0);
  assert.equal(shown.env.scatterDiscarded, true);

  const saveLeave = await runRequestNavigation({
    dirtyScatter: true,
    decision: "save",
    confirm: false,
  });
  assert.equal(saveLeave.accepted, false, "scatter-only must not approve leave through tuning save");
  assert.equal(saveLeave.env.saveCalls, 0);
  assert.equal(saveLeave.env.scatterDiscarded, false);
  assert.equal(saveLeave.env.dialogs[0]?.title, "离开零散切片？");
  assert.notEqual(saveLeave.env.dialogs[0]?.message, "Your latest tuning changes have not been saved.");
});

test("document leave keeps tuning copy for tuning-only and names scatter first when both are dirty", async () => {
  const tuning = await runRequestNavigation({
    dirtyTuning: true,
    decision: "save",
  });
  assert.equal(tuning.env.dialogs.length, 1);
  assert.equal(tuning.env.dialogs[0].api, "requestDecision");
  assert.equal(tuning.env.dialogs[0].message, "Your latest tuning changes have not been saved.");
  assert.equal(tuning.accepted, true);
  assert.equal(tuning.env.saveCalls, 1);

  const both = await runRequestNavigation({
    dirtyScatter: true,
    dirtyTuning: true,
    confirm: false,
    decision: "save",
  });
  assert.equal(both.env.dialogs[0].title, "离开零散切片？");
  assert.equal(both.accepted, false);
  assert.equal(both.env.saveCalls, 0);

  const tools = await runRequestNavigation({
    dirtyTools: true,
    confirm: true,
  });
  assert.equal(tools.env.dialogs[0].api, "requestConfirmation");
  assert.match(tools.env.dialogs[0].message, /unapplied results|尚未应用/);

  const scatterThenCancelTuning = await runRequestNavigation({
    dirtyScatter: true,
    dirtyTuning: true,
    confirm: true,
    decision: "cancel",
  });
  assert.equal(scatterThenCancelTuning.accepted, false);
  assert.equal(
    scatterThenCancelTuning.env.scatterDiscarded,
    false,
    "cancelling the later tuning dialog must not silence scatter beforeunload",
  );
});

/**
 * Builds a window + activateProject fixture for the production popstate listener.
 * @param {{href:string,dirty?:boolean,accept?:boolean,activeProjectId?:string}} options History hop.
 * @returns {object}
 */
function createPopstateEnv(options) {
  const events = [];
  const listeners = new Map();
  const location = {
    href: options.href,
    get search() {
      return new URL(this.href).search;
    },
    get pathname() {
      return new URL(this.href).pathname;
    },
  };
  const windowRef = {
    location,
    history: {
      state: { xsxbSelection: true },
      replaceState(state, _title, href) {
        this.state = state;
        if (href) location.href = String(href);
        events.push(`replaceState:${location.href}`);
      },
      pushState(state, _title, href) {
        this.state = state;
        if (href) location.href = String(href);
      },
    },
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    dispatch(type, event) {
      for (const listener of listeners.get(type) || []) listener(event);
    },
  };
  const env = {
    window: windowRef,
    URLSearchParams,
    URL,
    Number,
    Math,
    selectedProfileId: "player",
    selectedProjectId: options.activeProjectId || "repro-leave-a",
    lastKnownNavigationUrl: options.lastKnownNavigationUrl || options.href,
    activeProjectId: () => options.activeProjectId || "repro-leave-a",
    dirty: Boolean(options.dirty),
    loadConfig: async () => {
      events.push(`loadConfig:${env.selectedProjectId}`);
    },
    applyWorkbenchRoute: async () => {
      events.push("applyWorkbenchRoute");
    },
    config: { groups: [] },
    selectGroup: async (group, options) => {
      events.push({
        selectGroup: group?.uiId || group,
        profileId: group?.profileId,
        animationId: group?.animationId,
        options,
      });
    },
    status() {},
    t: (key, vars = {}) => `${key}:${vars.message || ""}`,
    events,
  };
  const mutations = createMutations({
    elements: {
      clearProject: { disabled: false },
      deleteProject: { disabled: false },
      projectSelect: { disabled: false },
    },
    getConfig: () => ({
      activeProject: { id: options.activeProjectId || "repro-leave-a" },
      projects: [{ id: "repro-leave-a" }, { id: "repro-leave-b" }],
    }),
    getActiveProjectId: () => options.activeProjectId || "repro-leave-a",
    getDirty: () => Boolean(options.dirty),
    setDirty() {},
    setSelectedProjectId(value) {
      env.selectedProjectId = value;
    },
    confirm: async (message, confirmOptions) => {
      events.push({ confirm: message, options: confirmOptions });
      return options.accept === true;
    },
    fetchImpl: async (url, init) => {
      events.push({ fetch: url, method: init?.method, body: init?.body });
      return {
        ok: true,
        async text() {
          return "{}";
        },
      };
    },
    translate: (key) => key,
    projectLabel: (project) => project.id,
    resetProjectSession: () => events.push("reset"),
    loadConfig: async () => {
      events.push(`loadConfig:${env.selectedProjectId}`);
    },
    resizeCanvas: () => events.push("resize"),
    renderProjectSelect: () => events.push("render-projects"),
    status() {},
    storage: { setItem() {}, removeItem() {} },
  });
  env.activateProject = mutations.activateProject.bind(mutations);
  return env;
}

test("dirty popstate project switch confirms like activateProject and restores the URL on cancel", async () => {
  const source = fs.readFileSync(APP_JS, "utf8");
  const extract = extractBetween(
    source,
    'window.addEventListener("popstate", () => {\n  const urlState = new URLSearchParams(window.location.search);',
    '\ndocument.addEventListener("visibilitychange"',
  );
  const cancelled = createPopstateEnv({
    href: "http://127.0.0.1:5179/workspace/animation/transform?project=repro-leave-b",
    dirty: true,
    accept: false,
    activeProjectId: "repro-leave-a",
  });
  vm.createContext(cancelled);
  vm.runInContext(extract, cancelled);
  cancelled.window.dispatch("popstate", { state: { xsxbSelection: true } });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    cancelled.events.filter((event) => event && event.confirm),
    [{ confirm: "projectSwitchConfirm", options: { tone: "warning" } }],
  );
  assert.equal(
    cancelled.events.some((event) => event && event.fetch === "/api/projects/active"),
    false,
    "must not POST /api/projects/active until confirmed",
  );
  assert.equal(
    cancelled.events.some((event) => typeof event === "string" && event.startsWith("loadConfig:")),
    false,
  );
  assert.equal(cancelled.selectedProjectId, "repro-leave-a");
  assert.match(cancelled.window.location.href, /project=repro-leave-a/);

  const accepted = createPopstateEnv({
    href: "http://127.0.0.1:5179/workspace/animation/transform?project=repro-leave-b",
    dirty: true,
    accept: true,
    activeProjectId: "repro-leave-a",
  });
  vm.createContext(accepted);
  vm.runInContext(extract, accepted);
  accepted.window.dispatch("popstate", { state: { xsxbSelection: true } });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  const post = accepted.events.find((event) => event && event.fetch === "/api/projects/active");
  assert.ok(post, "confirmed switch may POST /api/projects/active");
  assert.equal(JSON.parse(post.body).projectId, "repro-leave-b");
  assert.ok(accepted.events.includes("loadConfig:repro-leave-b"));
  assert.equal(accepted.selectedProjectId, "repro-leave-b");
});

test("dirty popstate cancel restores the full pre-hop href including group and frame", async () => {
  const source = fs.readFileSync(APP_JS, "utf8");
  const landing =
    "http://127.0.0.1:5179/workspace/animation/transform?project=repro-leave-a";
  const hop =
    "http://127.0.0.1:5179/workspace/animation/transform?project=repro-leave-b";
  const cancelled = createPopstateEnv({
    href: landing,
    dirty: true,
    accept: false,
    activeProjectId: "repro-leave-a",
  });
  cancelled.routing = createRouting({
    windowRef: cancelled.window,
    documentRef: { title: "" },
    getCurrentGroup: () => ({ uiId: "hero/idle" }),
    getSelectedFrame: () => 3,
    getActiveProjectId: () => "repro-leave-a",
  });
  vm.createContext(cancelled);
  const wrap = extractBetween(
    source,
    "const {\n  applyWorkbenchRoute,",
    "\ncutoutNavigationContext = currentNavigationContext();",
  );
  vm.runInContext(`${wrap}\nsyncUrlState();`, cancelled);

  const snapshotted = cancelled.window.location.href;
  assert.match(snapshotted, /[?&]group=hero%2Fidle/);
  assert.match(snapshotted, /[?&]frame=3/);
  assert.equal(
    cancelled.lastKnownNavigationUrl,
    snapshotted,
    "syncUrlState must snapshot lastKnown after writing group/frame",
  );

  cancelled.window.location.href = hop;
  const extract = extractBetween(
    source,
    'window.addEventListener("popstate", () => {\n  const urlState = new URLSearchParams(window.location.search);',
    '\ndocument.addEventListener("visibilitychange"',
  );
  vm.runInContext(extract, cancelled);
  cancelled.window.dispatch("popstate", { state: { xsxbSelection: true } });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(cancelled.window.location.href, snapshotted);
  const restored = new URL(cancelled.window.location.href);
  assert.equal(restored.searchParams.get("project"), "repro-leave-a");
  assert.equal(restored.searchParams.get("group"), "hero/idle");
  assert.equal(restored.searchParams.get("frame"), "3");
});

function afterInsertActorGroups() {
  return [
    {
      uiId: "player:actor:cutout-animation:0",
      profileId: "character",
      animationId: "cutout-animation",
      name: "cutout-animation",
      type: "actor",
      tuningTarget: "player",
    },
    {
      uiId: "player:actor:idle:1",
      profileId: "character",
      animationId: "idle",
      name: "idle",
      type: "actor",
      tuningTarget: "player",
    },
    {
      uiId: "player:actor:00:2",
      profileId: "character",
      animationId: "00",
      name: "00",
      type: "actor",
      tuningTarget: "player",
    },
    {
      uiId: "player:actor:idle:3",
      profileId: "hero",
      animationId: "idle",
      name: "idle",
      type: "actor",
      tuningTarget: "player",
    },
    {
      uiId: "player:actor:idle:4",
      profileId: "sidekick",
      animationId: "idle",
      name: "idle",
      type: "actor",
      tuningTarget: "player",
    },
  ];
}

test("popstate resolves groups through requestedGroup so animation= wins over exact uiId", async () => {
  const { requestedGroup } = require("../animation_tuner/public/app_project_lifecycle");
  const source = fs.readFileSync(APP_JS, "utf8");
  const extract = extractBetween(
    source,
    'window.addEventListener("popstate", () => {\n  const urlState = new URLSearchParams(window.location.search);',
    '\ndocument.addEventListener("visibilitychange"',
  );
  const groups = afterInsertActorGroups();
  const liveHero = createPopstateEnv({
    href: "http://127.0.0.1:5179/workspace/animation/transform?project=click-qa&group=player%3Aactor%3Aidle%3A3&animation=hero%2Fidle&frame=0",
    activeProjectId: "click-qa",
  });
  liveHero.config = { groups };
  liveHero.projectLifecycleModule = { requestedGroup };
  liveHero.XSXBAppProjectLifecycle = { requestedGroup };
  vm.createContext(liveHero);
  vm.runInContext(extract, liveHero);
  liveHero.window.dispatch("popstate", { state: { xsxbSelection: true } });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const liveSelected = liveHero.events.find((event) => event && event.selectGroup);
  assert.equal(liveSelected?.profileId, "hero");
  assert.equal(liveSelected?.selectGroup, "player:actor:idle:3");

  const staleSidekick = createPopstateEnv({
    href: "http://127.0.0.1:5179/workspace/animation/transform?project=click-qa&group=player%3Aactor%3Aidle%3A3&frame=0",
    activeProjectId: "click-qa",
  });
  staleSidekick.config = { groups };
  staleSidekick.projectLifecycleModule = { requestedGroup };
  staleSidekick.XSXBAppProjectLifecycle = { requestedGroup };
  vm.createContext(staleSidekick);
  vm.runInContext(extract, staleSidekick);
  staleSidekick.window.dispatch("popstate", { state: { xsxbSelection: true } });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const remapped = staleSidekick.events.find((event) => event && event.selectGroup);
  assert.equal(
    remapped?.profileId,
    "sidekick",
    "popstate must call requestedGroup; exact uiId idle:3 is now hero after insert",
  );
  assert.equal(remapped?.selectGroup, "player:actor:idle:4");
});
