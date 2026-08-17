"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  START_TIMEOUT_MS,
  createOverlay,
  parseProgress,
  progressLabel,
  shouldKeepVisible,
} = require("../animation_tuner/public/organizer_progress_overlay");

/**
 * Builds the minimal organizer DOM the overlay observes.
 * @returns {{overlay:object,harness:object}}
 */
function createHarness() {
  const nodes = {
    "#organizerBatchCutout": { textContent: "智能抠图", disabled: false, listeners: {} },
    "#organizerSmartCutoutProgress": { hidden: true },
    "#organizerSmartCutoutProgressText": { textContent: "" },
    "#organizerModal": { hidden: false },
    "#organizerStatus": { textContent: "" },
  };
  const button = nodes["#organizerBatchCutout"];
  button.addEventListener = (type, handler) => {
    button.listeners[type] = handler;
  };
  const state = { frames: 0, time: 0, observers: 0, disconnects: 0, pending: [] };
  const documentApi = {
    body: {},
    querySelector: (selector) => nodes[selector] || null,
    querySelectorAll: () => ({ length: state.frames }),
  };
  const windowApi = {
    Date: { now: () => state.time },
    requestAnimationFrame: (callback) => state.pending.push(callback),
    MutationObserver: class {
      /** @param {Function} callback Mutation handler. */
      constructor(callback) {
        this.callback = callback;
        state.observers += 1;
      }
      /** Records observation without a live DOM. @returns {void} */
      observe() {}
      /** Tracks teardown so leaks are visible to tests. @returns {void} */
      disconnect() {
        state.disconnects += 1;
      }
    },
  };
  const harness = {
    nodes,
    state,
    click: () => button.listeners.click(),
    /** Drains queued animation frames once. @returns {void} */
    tick: () => {
      const queued = state.pending.splice(0, state.pending.length);
      for (const callback of queued) callback();
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
  assert.equal(harness.state.pending.length, 0);
  assert.equal(harness.state.disconnects, 1);
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

test("overlay reports missing organizer markup instead of throwing", () => {
  const overlay = createOverlay({
    documentApi: { querySelector: () => null, querySelectorAll: () => ({ length: 0 }), body: {} },
    windowApi: { requestAnimationFrame: () => {}, MutationObserver: class {} },
  });
  assert.equal(overlay.attach(), false);
});
