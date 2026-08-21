"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  applyEditedCanvas,
  createController,
  shouldAcceptRemoteCanvas,
  worksetSyncTopic,
} = require("../animation_tuner/public/frame_organizer_workset_sync");

test("workset sync topics stay scoped to one project animation", () => {
  assert.equal(worksetSyncTopic("pets", "idle"), "xsxb-organizer-canvas:pets:idle");
  assert.notEqual(worksetSyncTopic("pets", "idle"), worksetSyncTopic("pets", "run"));
});

test("remote canvas updates apply only to the same animation in another tab", () => {
  const state = {
    animationName: "idle",
    frames: [{ uid: "idle-1" }, { uid: "idle-2" }],
  };
  const message = {
    tabId: "tab-b",
    projectId: "pets",
    animationName: "idle",
    uid: "idle-2",
    revision: 2,
  };
  assert.equal(shouldAcceptRemoteCanvas(state, message, "tab-a"), true);
  assert.equal(shouldAcceptRemoteCanvas(state, message, "tab-b"), false);
  assert.equal(shouldAcceptRemoteCanvas({ ...state, animationName: "run" }, message, "tab-a"), false);
  assert.equal(shouldAcceptRemoteCanvas(state, { ...message, uid: "missing" }, "tab-a"), false);
});

test("applyEditedCanvas replaces the working bitmap and clears stale thumbnails", () => {
  const frame = {
    uid: "idle-1",
    editedCanvas: { width: 1 },
    hasEditedResult: false,
    assetRevision: 0,
    thumbnails: { edited: "stale" },
    signature: { width: 1 },
  };
  const canvas = { width: 8, height: 8 };
  applyEditedCanvas(frame, canvas, 3);
  assert.equal(frame.editedCanvas, canvas);
  assert.equal(frame.hasEditedResult, true);
  assert.equal(frame.assetRevision, 3);
  assert.equal(frame.thumbnails.edited, "");
  assert.equal(frame.signature, null);
});

test("workset sync publishes cutout canvases and hydrates the other tab", async () => {
  const records = new Map();
  const messages = [];
  const listeners = [];
  const storage = {
    async put(topic, uid, blob, revision) {
      records.set(`${topic}:${uid}`, { blob, revision });
    },
    async get(topic, uid) {
      return records.get(`${topic}:${uid}`) || null;
    },
  };
  const publisher = createController({
    tabId: "tab-a",
    storage,
    channel: {
      postMessage(message) {
        messages.push(message);
        for (const listener of listeners) listener({ data: message });
      },
      addEventListener() {},
    },
    canvasToBlob: async () => "blob:idle-2",
    blobToCanvas: async (blob) => ({ src: blob, width: 8, height: 8 }),
  });
  const subscriberFrames = [
    { uid: "idle-1", editedCanvas: { width: 1 }, thumbnails: { edited: "old" }, assetRevision: 0 },
    { uid: "idle-2", editedCanvas: { width: 1 }, thumbnails: { edited: "old" }, assetRevision: 0 },
  ];
  const subscriber = createController({
    tabId: "tab-b",
    storage,
    channel: {
      postMessage() {},
      addEventListener(_type, listener) {
        listeners.push(listener);
      },
    },
    blobToCanvas: async (blob) => ({ src: blob, width: 8, height: 8 }),
    getState: () => ({ animationName: "idle", frames: subscriberFrames }),
    onRemoteApply() {},
  });
  subscriber.bind();

  await publisher.publishFrame("pets", "idle", {
    uid: "idle-2",
    hasEditedResult: true,
    assetRevision: 4,
    editedCanvas: { width: 8, height: 8 },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(messages.length, 1);
  assert.equal(subscriberFrames[1].hasEditedResult, true);
  assert.equal(subscriberFrames[1].assetRevision, 4);
  assert.equal(subscriberFrames[1].editedCanvas.src, "blob:idle-2");
  assert.equal(subscriberFrames[0].hasEditedResult, undefined);

  const hydrated = [
    { uid: "idle-2", editedCanvas: { width: 1 }, thumbnails: { edited: "old" }, assetRevision: 0 },
  ];
  await publisher.hydrateFrames("pets", "idle", hydrated);
  assert.equal(hydrated[0].editedCanvas.src, "blob:idle-2");
  assert.equal(hydrated[0].assetRevision, 4);
});
