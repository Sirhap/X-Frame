"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  START_TIMEOUT_MS,
  createOverlay,
  parseProgress,
  progressLabel,
  scheduleAttach,
  shouldKeepVisible,
  writeCaption,
  writeProgress,
} = require("../animation_tuner/public/organizer_progress_overlay");

/**
 * Counts organizer cards the way the overlay queries them.
 * Unset `state.included` means every card is included, matching the all-checked fixture.
 * @param {{frames?:number,included?:number|null}} state Card counts.
 * @param {string} selector Overlay querySelectorAll argument.
 * @returns {number}
 */
function frameCountForSelector(state, selector) {
  const all = Number(state.frames) || 0;
  const included = state.included == null ? all : Number(state.included) || 0;
  const selectedIncluded = Number(state.selectedIncluded) || 0;
  if (String(selector || "") === ".organizerFrame.included.selected") return selectedIncluded;
  if (String(selector || "") === ".organizerFrame.included") return included;
  if (String(selector || "") === ".organizerFrame") return all;
  return 0;
}

/**
 * Builds the minimal organizer DOM the overlay observes.
 * @returns {{overlay:object,harness:object}}
 */
function createHarness() {
  const state = {
    frames: 0,
    included: null,
    selectedIncluded: 0,
    time: 0,
    observers: 0,
    observerInstances: [],
    disconnects: 0,
    timers: [],
    timerSequence: 0,
  };
  let captionText = "";
  const nodes = {
    "#organizerBatchCutout": { textContent: "智能抠图", disabled: false, listeners: {} },
    "#organizerSmartCutoutProgress": { hidden: true },
    "#organizerSmartCutoutProgressText": {
      get textContent() {
        return captionText;
      },
      set textContent(value) {
        captionText = String(value);
      },
    },
    "#organizerSmartCutoutProgressBar": { max: 1, value: 0, removeAttribute() {} },
    "#organizerSmartCutoutCancel": {
      disabled: false,
      listeners: {},
      addEventListener(type, handler) {
        this.listeners[type] = handler;
      },
    },
    "#cutoutCancelProcess": {
      clicks: 0,
      click() {
        this.clicks += 1;
      },
    },
    "#organizerModal": { hidden: false },
    "#organizerStatus": { textContent: "" },
  };
  const button = nodes["#organizerBatchCutout"];
  button.addEventListener = (type, handler) => {
    button.listeners[type] = handler;
  };
  const documentApi = {
    body: {},
    querySelector: (selector) => nodes[selector] || null,
    querySelectorAll: (selector) => ({ length: frameCountForSelector(state, selector) }),
  };
  const windowApi = {
    Date: { now: () => state.time },
    requestAnimationFrame: (callback) => state.pending.push(callback),
    MutationObserver: class {
      /** @param {Function} callback Mutation handler. */
      constructor(callback) {
        this.callback = callback;
        this.active = true;
        state.observers += 1;
        state.observerInstances.push(this);
      }
      /** Records observation without a live DOM. @returns {void} */
      observe() {}
      /** Tracks teardown so leaks are visible to tests. @returns {void} */
      disconnect() {
        this.active = false;
        state.disconnects += 1;
      }
    },
    setTimeout(callback, delay) {
      const id = ++state.timerSequence;
      state.timers.push({ id, at: state.time + Number(delay || 0), callback });
      return id;
    },
    clearTimeout(id) {
      state.timers = state.timers.filter((timer) => timer.id !== id);
    },
  };
  const harness = {
    nodes,
    state,
    click: () => button.listeners.click(),
    /** Delivers observed mutations and expired timers once. @returns {void} */
    tick: () => {
      for (const observer of state.observerInstances) {
        if (observer.active) observer.callback();
      }
      const due = state.timers.filter((timer) => timer.at <= state.time);
      state.timers = state.timers.filter((timer) => timer.at > state.time);
      for (const timer of due) timer.callback();
    },
    /** @param {number} ms Milliseconds to advance the injected clock. @returns {void} */
    advance: (ms) => {
      state.time += ms;
    },
  };
  return { overlay: createOverlay({ documentApi, windowApi }), harness };
}

test("overlay parses frame progress from button and status text", () => {
  assert.deepEqual(parseProgress("正在处理 7 / 42"), { current: 7, total: 42 });
  assert.deepEqual(parseProgress("no numbers here"), { current: 0, total: 0 });
  assert.equal(progressLabel({ current: 7, total: 42 }), "智能抠图处理中 · 7 / 42 帧");
  assert.equal(progressLabel({ total: 42 }), "智能抠图处理中 · 共 42 帧");
  assert.equal(progressLabel({}), "智能抠图处理中");
});

test("overlay caption and meter writes are idempotent", () => {
  const caption = { textContent: "智能抠图处理中" };
  const meter = {
    max: 1,
    value: 0,
    removed: false,
    removeAttribute() {
      this.removed = true;
    },
  };
  assert.equal(writeCaption(caption, "智能抠图处理中"), false);
  assert.equal(writeCaption(caption, "智能抠图处理中 · 1 / 2 帧"), true);
  writeProgress(meter, { current: 1, total: 2 });
  assert.deepEqual({ max: meter.max, value: meter.value }, { max: 2, value: 1 });
  writeProgress(meter, {});
  assert.equal(meter.removed, true);
});

test("overlay stays visible for a long run once the button reports busy", () => {
  const signals = { organizerHidden: false, statusText: "处理中 3 / 90", busy: true, sawBusy: true };
  assert.equal(shouldKeepVisible({ ...signals, elapsedMs: 1000 }), true);
  assert.equal(shouldKeepVisible({ ...signals, elapsedMs: 600000 }), true);
  assert.equal(shouldKeepVisible({ ...signals, busy: false, elapsedMs: 1000 }), false);
});

test("overlay gives up only when the run never started", () => {
  const idle = { organizerHidden: false, statusText: "", busy: false, sawBusy: false };
  assert.equal(shouldKeepVisible({ ...idle, elapsedMs: START_TIMEOUT_MS - 1 }), true);
  assert.equal(shouldKeepVisible({ ...idle, elapsedMs: START_TIMEOUT_MS + 1 }), false);
});

test("overlay survives a batch that runs far past the old sixty second cutoff", () => {
  const { overlay, harness } = createHarness();
  assert.equal(overlay.attach(), true);
  harness.state.frames = 90;

  harness.click();
  assert.equal(harness.nodes["#organizerSmartCutoutProgress"].hidden, false);
  assert.equal(harness.nodes["#organizerSmartCutoutProgressText"].textContent, "智能抠图处理中 · 共 90 帧");

  harness.nodes["#organizerBatchCutout"].disabled = true;
  for (let elapsed = 0; elapsed < 300000; elapsed += 10000) {
    harness.nodes["#organizerStatus"].textContent = `处理中 ${elapsed / 10000} / 90`;
    harness.advance(10000);
    harness.tick();
    assert.equal(harness.nodes["#organizerSmartCutoutProgress"].hidden, false);
  }
  assert.equal(harness.nodes["#organizerSmartCutoutProgressText"].textContent, "智能抠图处理中 · 29 / 90 帧");

  harness.nodes["#organizerBatchCutout"].disabled = false;
  harness.tick();
  assert.equal(harness.nodes["#organizerSmartCutoutProgress"].hidden, true);
  assert.equal(harness.state.timers.length, 0);
  assert.equal(harness.state.disconnects, 1);
});

test("overlay cancel forwards to the active cutout controller", () => {
  const { overlay, harness } = createHarness();
  overlay.attach();
  harness.click();
  harness.nodes["#organizerSmartCutoutCancel"].listeners.click();
  assert.equal(harness.nodes["#organizerSmartCutoutCancel"].disabled, true);
  assert.equal(harness.nodes["#cutoutCancelProcess"].clicks, 1);
  assert.equal(harness.nodes["#organizerSmartCutoutProgressText"].textContent, "正在取消智能抠图…");
});

test("overlay hides when the organizer closes mid-run", () => {
  const { overlay, harness } = createHarness();
  overlay.attach();
  harness.click();
  harness.nodes["#organizerBatchCutout"].disabled = true;
  harness.tick();
  assert.equal(harness.nodes["#organizerSmartCutoutProgress"].hidden, false);

  harness.nodes["#organizerModal"].hidden = true;
  harness.tick();
  assert.equal(harness.nodes["#organizerSmartCutoutProgress"].hidden, true);
});

test("overlay clears itself when a click never produces work", () => {
  const { overlay, harness } = createHarness();
  overlay.attach();
  harness.click();

  harness.advance(START_TIMEOUT_MS - 1);
  harness.tick();
  assert.equal(harness.nodes["#organizerSmartCutoutProgress"].hidden, false);

  harness.advance(2);
  harness.tick();
  assert.equal(harness.nodes["#organizerSmartCutoutProgress"].hidden, true);
});

test("scheduleAttach waits until DOMContentLoaded when the document is still loading", () => {
  const { harness } = createHarness();
  const listeners = [];
  const documentApi = {
    readyState: "loading",
    body: {},
    querySelector: (selector) => harness.nodes[selector] || null,
    querySelectorAll: (selector) => ({ length: frameCountForSelector(harness.state, selector) }),
    addEventListener: (type, handler) => listeners.push({ type, handler }),
  };
  const api = {
    createOverlay: () =>
      createOverlay({
        documentApi,
        windowApi: { requestAnimationFrame() {}, MutationObserver: class {} },
      }),
  };

  assert.equal(scheduleAttach(api, documentApi, {}), true);
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].type, "DOMContentLoaded");
  assert.equal(harness.nodes["#organizerBatchCutout"].listeners.click, undefined);

  listeners[0].handler();
  assert.equal(typeof harness.nodes["#organizerBatchCutout"].listeners.click, "function");
});

test("scheduleAttach is a no-op the second time so production boot cannot double-bind", () => {
  const { harness } = createHarness();
  const windowApi = { requestAnimationFrame() {}, MutationObserver: class {} };
  const documentApi = {
    readyState: "complete",
    body: {},
    querySelector: (selector) => harness.nodes[selector] || null,
    querySelectorAll: (selector) => ({ length: frameCountForSelector(harness.state, selector) }),
  };
  let clicks = 0;
  harness.nodes["#organizerBatchCutout"].addEventListener = (type, handler) => {
    clicks += 1;
    harness.nodes["#organizerBatchCutout"].listeners[type] = handler;
  };
  const api = { createOverlay: () => createOverlay({ documentApi, windowApi }) };

  assert.equal(scheduleAttach(api, documentApi, windowApi), true);
  assert.equal(scheduleAttach(api, documentApi, windowApi), true);
  assert.equal(clicks, 1);
});

test("overlay first paint uses selected included cards the same way process does", () => {
  const { overlay, harness } = createHarness();
  overlay.attach();
  harness.state.frames = 10;
  harness.state.included = 3;
  harness.state.selectedIncluded = 1;

  harness.click();

  assert.equal(
    harness.nodes["#organizerSmartCutoutProgressText"].textContent,
    "智能抠图处理中 · 共 1 帧",
    "first paint must match process selected∩included, not all included cards",
  );
  assert.equal(harness.nodes["#organizerSmartCutoutProgressBar"].max, 1);
});

test("overlay first paint counts included frames only when some cards are excluded", () => {
  const { overlay, harness } = createHarness();
  overlay.attach();
  harness.state.frames = 10;
  harness.state.included = 3;

  harness.click();

  assert.equal(harness.nodes["#organizerSmartCutoutProgressText"].textContent, "智能抠图处理中 · 共 3 帧");
  assert.deepEqual(
    {
      hidden: harness.nodes["#organizerSmartCutoutProgress"].hidden,
      max: harness.nodes["#organizerSmartCutoutProgressBar"].max,
      value: harness.nodes["#organizerSmartCutoutProgressBar"].value,
    },
    { hidden: false, max: 3, value: 0 },
  );

  harness.nodes["#organizerBatchCutout"].disabled = true;
  harness.nodes["#organizerStatus"].textContent = "智能抠图 0 / 3 帧";
  harness.tick();
  assert.equal(harness.nodes["#organizerSmartCutoutProgressText"].textContent, "智能抠图处理中 · 共 3 帧");
  assert.deepEqual(
    {
      max: harness.nodes["#organizerSmartCutoutProgressBar"].max,
      value: harness.nodes["#organizerSmartCutoutProgressBar"].value,
    },
    { max: 3, value: 0 },
  );

  harness.nodes["#organizerStatus"].textContent = "智能抠图 3 / 3 帧";
  harness.tick();
  assert.equal(harness.nodes["#organizerSmartCutoutProgressText"].textContent, "智能抠图处理中 · 3 / 3 帧");
  assert.deepEqual(
    {
      max: harness.nodes["#organizerSmartCutoutProgressBar"].max,
      value: harness.nodes["#organizerSmartCutoutProgressBar"].value,
    },
    { max: 3, value: 3 },
  );
});

test("overlay reports missing organizer markup instead of throwing", () => {
  const overlay = createOverlay({
    documentApi: { querySelector: () => null, querySelectorAll: () => ({ length: 0 }), body: {} },
    windowApi: { requestAnimationFrame: () => {}, MutationObserver: class {} },
  });
  assert.equal(overlay.attach(), false);
});
