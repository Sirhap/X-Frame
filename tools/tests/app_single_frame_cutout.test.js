"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/app_single_frame_cutout");

/** Creates a minimal event-capable button. */
function createButton() {
  const listeners = new Map();
  return {
    attributes: {},
    disabled: false,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
  };
}

test("single-frame cutout opens one selected frame and writes back only its output", async () => {
  const button = createButton();
  const image = { width: 512, height: 512 };
  const output = { data: "data:image/png;base64,AQ==" };
  const outputs = [output];
  Object.defineProperty(outputs, "premiumFeatures", { value: ["cutout.edge-refinement"] });
  const opened = [];
  const applied = [];
  const messages = [];
  let returned = 0;
  const controller = createController({
    button,
    getCurrentGroup: () => ({
      name: "Run",
      frames: [{ name: "run-1.png" }, { name: "run-2.png", path: "frames/run-2.png" }],
    }),
    getSelectedFrame: () => 1,
    getFrameImage: async () => image,
    getBatchCutout: () => ({
      openWorkset: async (workset) => {
        opened.push(workset);
        return outputs;
      },
    }),
    applyOutput: async (...args) => applied.push(args),
    onReturn: () => {
      returned += 1;
    },
    translate: (key, variables = {}) =>
      key === "cutoutCurrentFrameApplied" ? `applied:${variables.frame}` : key,
    status: (message) => messages.push(message),
  });

  assert.equal(await controller.open(), true);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].mode, "single");
  assert.equal(opened[0].items.length, 1);
  assert.equal(opened[0].items[0].image, image);
  assert.equal(opened[0].items[0].frame.sourceIndex, 1);
  assert.deepEqual(applied, [[output, { frameIndex: 1, premiumFeatures: ["cutout.edge-refinement"] }]]);
  assert.deepEqual(messages, ["applied:2"]);
  assert.equal(button.disabled, false);
  assert.equal(button.attributes["aria-busy"], undefined);
  assert.equal(returned, 1);
});

test("single-frame cutout reports an unavailable animation without opening a tool", async () => {
  const messages = [];
  let opened = false;
  const controller = createController({
    getCurrentGroup: () => null,
    getBatchCutout: () => ({
      openWorkset: async () => {
        opened = true;
      },
    }),
    translate: (key) => key,
    status: (message) => messages.push(message),
  });

  assert.equal(await controller.open(), false);
  assert.equal(opened, false);
  assert.deepEqual(messages, ["cutoutCurrentFrameUnavailable"]);
});
