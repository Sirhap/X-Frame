"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const runtimeSetup = require("../animation_tuner/public/batch_cutout_runtime_setup.js");

test("runtime setup creates the batch controller state without shared mutable fields", () => {
  const english = runtimeSetup.createInitialState("en");
  const chinese = runtimeSetup.createInitialState("zh");

  assert.equal(english.language, "en");
  assert.equal(chinese.language, "zh");
  assert.notStrictEqual(english.selectedIds, chinese.selectedIds);
  assert.deepEqual(english.items, []);
  assert.equal(english.sessionMode, "batch");
  assert.equal(english.previewBackground, "light");
  assert.equal(english.batchTrayCollapsed, true);
});

test("runtime setup keeps bounded concurrency result ordering and element names", async () => {
  const elements = runtimeSetup.collectElements({
    querySelector(selector) {
      return selector === "#cutoutOpen" ? "open" : null;
    },
  });
  assert.equal(elements.cutoutOpen, "open");
  assert.equal(elements.cutoutModal, null);
  assert.equal(Object.hasOwn(elements, "cutoutCandidateGenerate"), false);

  const results = await runtimeSetup.mapSettledWithConcurrency(
    [20, 5, 10],
    async (value) => {
      await new Promise((resolve) => setTimeout(resolve, value));
      if (value === 5) throw new Error("expected test rejection");
      return value * 2;
    },
    2,
  );
  assert.deepEqual(
    results.map((result) => result.status),
    ["fulfilled", "rejected", "fulfilled"],
  );
  assert.equal(results[0].value, 40);
  assert.equal(results[2].value, 20);
});
