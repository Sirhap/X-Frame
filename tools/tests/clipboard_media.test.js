"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  bindPaste,
  groupFiles,
  isEditableTarget,
  mediaKind,
  readFiles,
} = require("../animation_tuner/public/clipboard_media");

/**
 * Creates a minimal event target for paste binding tests.
 * @returns {{addEventListener:(name:string,handler:Function)=>void,removeEventListener:(name:string,handler:Function)=>void,paste:(event:object)=>void}}
 */
function createEventTarget() {
  const handlers = new Map();
  return {
    addEventListener(name, handler) {
      handlers.set(name, handler);
    },
    removeEventListener(name, handler) {
      if (handlers.get(name) === handler) handlers.delete(name);
    },
    paste(event) {
      handlers.get("paste")?.(event);
    },
  };
}

test("clipboard media recognizes supported MIME types and filename fallbacks", () => {
  assert.equal(mediaKind({ type: "image/png", name: "" }), "image");
  assert.equal(mediaKind({ type: "", name: "capture.WEBP" }), "image");
  assert.equal(mediaKind({ type: "video/quicktime", name: "" }), "video");
  assert.equal(mediaKind({ type: "", name: "clip.MOV" }), "video");
  assert.equal(mediaKind({ type: "text/plain", name: "notes.txt" }), null);
});

test("clipboard media prefers file items and groups files in clipboard order", () => {
  const image = { type: "image/png", name: "image.png" };
  const video = { type: "video/mp4", name: "video.mp4" };
  const text = { type: "text/plain", name: "notes.txt" };
  const clipboardData = {
    items: [image, video, text].map((file) => ({ kind: "file", getAsFile: () => file })),
    files: [{ type: "image/jpeg", name: "fallback.jpg" }],
  };

  assert.deepEqual(readFiles(clipboardData), [image, video, text]);
  assert.deepEqual(groupFiles(clipboardData), {
    all: [image, video, text],
    images: [image],
    videos: [video],
    unsupported: [text],
  });
});

test("clipboard paste routes accepted media and preserves editable input paste", async () => {
  const target = createEventTarget();
  const image = { type: "image/png", name: "image.png" };
  const routed = [];
  let prevented = false;
  bindPaste({
    target,
    accept: ["image"],
    onPaste(media) {
      routed.push(media.images);
    },
  });

  target.paste({
    target: { tagName: "INPUT", type: "text" },
    clipboardData: { files: [image] },
    preventDefault() {
      prevented = true;
    },
  });
  target.paste({
    target: { tagName: "CANVAS" },
    clipboardData: { files: [image] },
    preventDefault() {
      prevented = true;
    },
  });
  await Promise.resolve();

  assert.equal(isEditableTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isEditableTarget({ tagName: "INPUT", type: "range" }), false);
  assert.equal(prevented, true);
  assert.deepEqual(routed, [[image]]);
});

test("clipboard paste reports media that the current tool cannot accept", () => {
  const target = createEventTarget();
  const video = { type: "video/mp4", name: "video.mp4" };
  let unsupported = null;
  let prevented = false;
  bindPaste({
    target,
    accept: ["image"],
    onPaste() {},
    onUnsupported(media) {
      unsupported = media;
    },
  });

  target.paste({
    target: { tagName: "DIV" },
    clipboardData: { files: [video] },
    preventDefault() {
      prevented = true;
    },
  });

  assert.equal(prevented, false);
  assert.deepEqual(unsupported.videos, [video]);
});

test("clipboard paste routes synchronous handler failures through the error boundary", () => {
  const target = createEventTarget();
  const expected = new Error("paste failed");
  let actual = null;
  bindPaste({
    target,
    accept: ["image"],
    onPaste() {
      throw expected;
    },
    onError(error) {
      actual = error;
    },
  });

  target.paste({
    target: { tagName: "DIV" },
    clipboardData: { files: [{ type: "image/png", name: "image.png" }] },
    preventDefault() {},
  });

  assert.equal(actual, expected);
});

test("clipboard paste leaves media untouched while its tool is inactive", () => {
  const target = createEventTarget();
  let calls = 0;
  let prevented = false;
  bindPaste({
    target,
    isActive: () => false,
    onPaste() {
      calls += 1;
    },
  });

  target.paste({
    target: { tagName: "DIV" },
    clipboardData: { files: [{ type: "image/png", name: "image.png" }] },
    preventDefault() {
      prevented = true;
    },
  });

  assert.equal(calls, 0);
  assert.equal(prevented, false);
});
