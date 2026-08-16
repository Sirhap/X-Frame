"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createStore } = require("../animation_tuner/public/temporary_workset_store");

test("temporary worksets retain resource identity without scheduling project saves", () => {
  const store = createStore();
  const canvas = { width: 64, height: 64 };
  store.setWorkset({ name: "run", sourceTool: "organizer", frames: [{ uid: "a", image: canvas }] });
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.frames[0].id, "a");
  assert.equal(snapshot.frames[0].image, canvas);
  assert.equal(snapshot.sourceTool, "organizer");
});

test("cutout outputs preserve frame ids and increment asset revisions", () => {
  const store = createStore();
  const output = { width: 32, height: 32 };
  store.setWorkset({
    frames: [
      { id: "a", image: {} },
      { id: "b", image: {} },
    ],
  });
  store.applyOutputs([{ canvas: output }]);
  const snapshot = store.getSnapshot();
  assert.deepEqual(
    snapshot.frames.map((frame) => frame.id),
    ["a", "b"],
  );
  assert.equal(snapshot.frames[0].image, output);
  assert.equal(snapshot.frames[0].assetRevision, 1);
  assert.equal(snapshot.frames[1].assetRevision, 0);
});

test("cutout outputs target enabled frame ids without shifting across excluded frames", () => {
  const store = createStore();
  const firstOutput = { width: 24, height: 24 };
  const thirdOutput = { width: 48, height: 48 };
  store.setWorkset({
    frames: [
      { id: "a", image: {} },
      { id: "excluded", image: {}, enabled: false },
      { id: "c", image: {} },
    ],
  });
  store.applyOutputs([{ canvas: firstOutput }, { canvas: thirdOutput }], ["a", "c"]);
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.frames[0].image, firstOutput);
  assert.equal(snapshot.frames[1].assetRevision, 0);
  assert.equal(snapshot.frames[2].image, thirdOutput);
  assert.equal(snapshot.frames[2].assetRevision, 1);
});
