"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createController,
  normalizeLoopStartFrame,
} = require("../animation_tuner/public/frame_organizer_loop");

/**
 * Creates a mutable organizer-loop element.
 * @param {object} [overrides] Element overrides.
 * @returns {object} Fake element.
 */
function element(overrides = {}) {
  const listeners = new Map();
  return {
    hidden: false,
    textContent: "",
    value: "1",
    checked: false,
    children: [],
    style: { width: "" },
    dataset: {},
    classList: { toggle() {} },
    addEventListener(type, listener) {
      const handlers = listeners.get(type) || [];
      handlers.push(listener);
      listeners.set(type, handlers);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    },
    focus() {
      this.focused = true;
    },
    replaceChildren() {
      this.children = [];
    },
    appendChild(child) {
      this.children.push(child);
    },
    ...overrides,
  };
}

/**
 * Builds a loop-finder fixture with a controllable analyzer.
 * @param {{analyze?:Function}} [options] Analyzer overrides.
 * @returns {{controller:object,elements:Record<string,object>,state:object,statuses:string[],focused:string[]}}
 */
function createFixture(options = {}) {
  const statuses = [];
  const focused = [];
  const elements = {
    organizerLoopPanel: element({ hidden: true }),
    organizerLoopStartAuto: element({ checked: true }),
    organizerLoopStartCustom: element({ checked: false }),
    organizerLoopStartRow: element({ hidden: true }),
    organizerLoopStartInput: element({
      value: "1",
      max: "",
      select() {
        this.selected = true;
      },
    }),
    organizerLoopStartMax: element({ textContent: "/ 1" }),
    organizerLoopPreference: element({
      children: [{ dataset: { loopPreference: "auto" }, classList: { toggle() {} } }],
    }),
    organizerLoopStartSearch: element({ disabled: false }),
    organizerLoopCancel: element(),
    organizerLoopClose: element(),
    organizerLoopRetry: element(),
    organizerLoopTrim: element(),
    organizerLoopParams: element(),
    organizerLoopSearch: element({ hidden: true }),
    organizerLoopResults: element({ hidden: true }),
    organizerLoopEmpty: element({ hidden: true }),
    organizerLoopResultContent: element({ hidden: true }),
    organizerLoopCandidates: element(),
    organizerLoopCanvas: element(),
    organizerLoopPlay: element(),
    organizerLoopFrameInput: element({ value: "1" }),
    organizerLoopFrameTotal: element(),
    organizerLoopFrameRange: element(),
    organizerLoopPrevious: element(),
    organizerLoopNext: element(),
    organizerLoopSpeed: element({ value: "390" }),
    organizerLoopProgressBar: element({ style: { width: "" } }),
    organizerLoopProgressText: element({ textContent: "0%" }),
    organizerLoopSearchLabel: element(),
    organizerLoopError: element({ hidden: true, textContent: "" }),
    organizerFindLoop: element({
      focus({ preventScroll: _preventScroll } = {}) {
        focused.push("organizerFindLoop");
      },
    }),
    organizerFileInput: element({
      focus({ preventScroll: _preventScroll } = {}) {
        focused.push("organizerFileInput");
      },
    }),
  };
  const state = {
    frames:
      options.frames ||
      Array.from({ length: options.frameCount || 6 }, (_, index) => ({
        uid: `f${index}`,
        included: true,
        analysisRevision: 1,
      })),
    busy: false,
    loopCancelled: false,
    loopSearchToken: 0,
    loopCandidates: [],
    loopCandidateIndex: -1,
    loopSourceEntries: [],
    loopPreference: "auto",
    loopPreviewIndex: 0,
    loopTimer: 0,
    loopStage: "params",
  };
  const analyze =
    options.analyze ||
    (async () => {
      throw new Error("worker exploded");
    });
  const controller = createController({
    elements,
    state,
    text: (key, vars = {}) => (vars.message ? `${key}:${vars.message}` : key),
    workerClient: {
      createExecutor: () => ({
        analyze,
        cancelAll() {
          this.cancelled = true;
        },
      }),
    },
    includedFrames: () => state.frames.filter((frame) => frame.included),
    frameSignature: () => ({ width: 2, height: 2, data: new Uint8Array(16) }),
    drawFrameToCanvas() {},
    selectIndexes() {},
    playbackDelay: () => 40,
    renderCounts() {},
    restartPreview() {},
    setStatus: (message) => statuses.push(message),
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    document: {
      createElement: () => element(),
    },
    window: {
      clearTimeout() {},
      setTimeout(callback) {
        callback();
        return 1;
      },
      requestAnimationFrame(callback) {
        callback();
        return 1;
      },
    },
  });
  controller.bindEvents();
  return { controller, elements, focused, state, statuses };
}

test("loop cancel always closes the dialog instead of returning to params", () => {
  const fixture = createFixture();
  fixture.controller.open();
  fixture.state.loopStage = "search";
  fixture.elements.organizerLoopPanel.hidden = false;

  fixture.elements.organizerLoopCancel.dispatch("click");

  assert.equal(fixture.elements.organizerLoopPanel.hidden, true);
  assert.equal(fixture.state.loopCancelled, true);
});

test("loop search failures stay inside the dialog instead of the hidden status bar", async () => {
  const fixture = createFixture();
  fixture.controller.open();
  fixture.elements.organizerLoopStartSearch.dispatch("click");
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(fixture.elements.organizerLoopPanel.hidden, false);
  assert.equal(fixture.elements.organizerLoopError.hidden, false);
  assert.match(fixture.elements.organizerLoopError.textContent, /worker exploded/);
  assert.equal(fixture.elements.organizerLoopSearch.hidden, true);
  assert.equal(fixture.elements.organizerLoopParams.hidden, false);
});

test("closing the loop dialog does not return focus to Find Loop", () => {
  const fixture = createFixture();
  fixture.controller.open();
  fixture.controller.close();

  assert.deepEqual(fixture.focused, ["organizerFileInput"]);
});

/**
 * Switches the fixture to a custom 1-based included start frame.
 * @param {ReturnType<typeof createFixture>} fixture Loop fixture.
 * @param {string} value Raw input value.
 * @returns {void}
 */
function chooseCustomStart(fixture, value) {
  fixture.elements.organizerLoopStartAuto.checked = false;
  fixture.elements.organizerLoopStartCustom.checked = true;
  fixture.elements.organizerLoopStartCustom.dispatch("change");
  fixture.elements.organizerLoopStartInput.value = String(value);
}

/**
 * Yields until the fixture's synchronous setTimeout awaits settle.
 * @param {number} [turns] Extra microtask turns.
 * @returns {Promise<void>}
 */
async function flushSearch(turns = 20) {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

test("ORG-018 loop start frame is a 1-based included-workset index", () => {
  assert.equal(normalizeLoopStartFrame("1", 10), 1);
  assert.equal(normalizeLoopStartFrame("10", 10), 10);
  assert.equal(normalizeLoopStartFrame("11", 10), 10);
  assert.equal(normalizeLoopStartFrame("0", 10), 1);
  assert.equal(normalizeLoopStartFrame("", 10), 1);
  assert.equal(normalizeLoopStartFrame("abc", 10), 1);
  assert.equal(normalizeLoopStartFrame(" 8 ", 10), 8);
  const frames = [
    ...Array.from({ length: 10 }, (_, index) => ({ included: true, uid: `in${index}` })),
    { included: false, uid: "out" },
    { included: false, uid: "out2" },
  ];
  const fixture = createFixture({ frames });
  fixture.controller.open();
  assert.equal(fixture.elements.organizerLoopStartInput.max, "10");
  assert.equal(fixture.elements.organizerLoopStartMax.textContent, "/ 10");
});

test("ORG-018 start=1 and start=N search with the included index", async () => {
  const analyzeCalls = [];
  const fixture = createFixture({
    frameCount: 10,
    analyze: async (_signatures, options) => {
      analyzeCalls.push(options);
      return [];
    },
  });
  fixture.controller.open();

  chooseCustomStart(fixture, "1");
  fixture.elements.organizerLoopStartSearch.dispatch("click");
  await flushSearch();
  assert.equal(analyzeCalls.length, 1);
  assert.equal(analyzeCalls[0].startFrame, 0);
  assert.equal(fixture.elements.organizerLoopResults.hidden, false);
  assert.equal(fixture.elements.organizerLoopError.hidden, true);

  fixture.elements.organizerLoopRetry.dispatch("click");
  chooseCustomStart(fixture, "10");
  fixture.elements.organizerLoopStartSearch.dispatch("click");
  await flushSearch();
  assert.equal(analyzeCalls.length, 2);
  assert.equal(analyzeCalls[1].startFrame, 9);
  assert.equal(fixture.elements.organizerLoopResults.hidden, false);
  assert.doesNotMatch(fixture.elements.organizerLoopError.textContent, /1.*10/);
});

test("ORG-018 typing start=N+1 clamps the field to N", () => {
  const fixture = createFixture({ frameCount: 10 });
  fixture.controller.open();
  chooseCustomStart(fixture, "11");
  fixture.elements.organizerLoopStartInput.dispatch("input");
  assert.equal(fixture.elements.organizerLoopStartInput.value, "10");
});

test("ORG-018 start=N+1 is rejected before search and does not keep N+1", async () => {
  const analyzeCalls = [];
  const fixture = createFixture({
    frameCount: 10,
    analyze: async (_signatures, options) => {
      analyzeCalls.push(options);
      return [];
    },
  });
  fixture.controller.open();
  chooseCustomStart(fixture, "11");
  fixture.elements.organizerLoopStartSearch.dispatch("click");

  assert.notEqual(fixture.elements.organizerLoopStartInput.value, "11");
  assert.equal(fixture.elements.organizerLoopStartInput.value, "10");
  assert.equal(fixture.elements.organizerLoopSearch.hidden, true);
  assert.equal(fixture.elements.organizerLoopParams.hidden, false);
  assert.equal(fixture.elements.organizerLoopError.hidden, false);
  assert.match(fixture.elements.organizerLoopError.textContent, /1.*10|loopStartOutOfRange/);
  assert.equal(analyzeCalls.length, 0);

  await flushSearch();
  assert.equal(analyzeCalls.length, 0);
  assert.equal(fixture.elements.organizerLoopSearch.hidden, true);
});

test("ORG-018 empty and non-numeric start frames stay safe", async () => {
  const analyzeCalls = [];
  const fixture = createFixture({
    frameCount: 10,
    analyze: async (_signatures, options) => {
      analyzeCalls.push(options);
      return [];
    },
  });
  fixture.controller.open();
  chooseCustomStart(fixture, "");
  fixture.elements.organizerLoopStartSearch.dispatch("click");
  await flushSearch();
  assert.equal(analyzeCalls.length, 1);
  assert.equal(analyzeCalls[0].startFrame, 0);
  assert.equal(fixture.elements.organizerLoopStartInput.value, "1");
  assert.equal(fixture.elements.organizerLoopError.hidden, true);

  fixture.elements.organizerLoopRetry.dispatch("click");
  chooseCustomStart(fixture, "abc");
  fixture.elements.organizerLoopStartSearch.dispatch("click");
  await flushSearch();
  assert.ok(analyzeCalls.length >= 1);
  assert.ok(analyzeCalls.every((options) => options.startFrame === 0));
  assert.equal(fixture.elements.organizerLoopStartInput.value, "1");
  assert.equal(fixture.elements.organizerLoopResults.hidden, false);
  assert.equal(fixture.elements.organizerLoopError.hidden, true);
});

test("ORG-018 focusing the start-frame field selects the existing value", () => {
  const fixture = createFixture({ frameCount: 10 });
  fixture.controller.open();
  chooseCustomStart(fixture, "10");
  fixture.elements.organizerLoopStartInput.dispatch("focus");
  assert.equal(fixture.elements.organizerLoopStartInput.selected, true);
});
