"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/app_filmstrip");

/**
 * Creates the minimal DOM surface needed by the attachment asset tray renderer.
 * @param {object} documentRef Mutable fake document.
 * @returns {object} Fake element with query, event, and focus support.
 */
function createElement(documentRef) {
  const listeners = new Map();
  const selectorMap = new Map();
  const attributes = new Map();
  const children = [];
  let html = "";
  const element = {
    attributes,
    children,
    className: "",
    dataset: {},
    disabled: false,
    draggable: false,
    files: [],
    focused: false,
    appendChild(child) {
      children.push(child);
      return child;
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    click() {
      const event = {
        currentTarget: element,
        target: element,
        stopPropagation() {},
      };
      for (const listener of listeners.get("click") || []) listener(event);
    },
    dispatch(type, values = {}) {
      const event = {
        currentTarget: element,
        target: element,
        stopPropagation() {},
        ...values,
      };
      for (const listener of listeners.get(type) || []) listener(event);
    },
    focus() {
      documentRef.activeElement = element;
      element.focused = true;
    },
    querySelector(selector) {
      if (selectorMap.has(selector)) return selectorMap.get(selector);
      for (const child of children) {
        const match = child.querySelector?.(selector);
        if (match) return match;
      }
      return null;
    },
    querySelectorAll(selector) {
      const matches = [];
      for (const child of children) {
        if (
          selector.startsWith(".") &&
          child.className.split(/\s+/).filter(Boolean).includes(selector.slice(1))
        ) {
          matches.push(child);
        }
        matches.push(...(child.querySelectorAll?.(selector) || []));
      }
      return matches;
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
  };
  Object.defineProperty(element, "innerHTML", {
    get: () => html,
    set: (value) => {
      html = String(value || "");
      children.length = 0;
      selectorMap.clear();
      const tagPattern = /<([a-z][\w-]*)\b([^>]*\bclass="([^"]+)"[^>]*)>/gi;
      for (const match of html.matchAll(tagPattern)) {
        const child = createElement(documentRef);
        child.className = match[3];
        child.checked = /\bchecked\b/i.test(match[2]);
        child.disabled = /\bdisabled\b/i.test(match[2]);
        const assetId = match[2].match(/\bdata-asset-id="([^"]*)"/i)?.[1];
        if (assetId !== undefined) child.dataset.assetId = assetId;
        children.push(child);
        for (const className of child.className.split(/\s+/).filter(Boolean)) {
          if (!selectorMap.has(`.${className}`)) selectorMap.set(`.${className}`, child);
        }
      }
    },
  });
  return element;
}

/** Waits for voided async event handlers to finish. @returns {Promise<void>} */
async function flushEvents() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("filmstrip controller rejects missing DOM dependencies", () => {
  assert.throws(() => createController(), /dependencies are required/);
  assert.throws(() => createController({}), /dependencies are required/);
});

test("asset tray exposes single and bulk removal with one-step undo and focus recovery", async () => {
  const documentRef = { activeElement: null };
  documentRef.createElement = () => createElement(documentRef);
  const host = createElement(documentRef);
  const originalAssets = [
    { id: "asset-a", name: "a.png", path: "/a.png", groupKey: "hero/run" },
    { id: "asset-b", name: "b.png", path: "/b.png", groupKey: "hero/run" },
  ];
  let assets = originalAssets.slice();
  let removedSnapshot = [];
  let undoFailure = null;
  const removals = [];
  const controller = createController({
    filmstrip: createElement(documentRef),
    attachmentAssetTrayHost: host,
    attachmentAssetDragType: "application/x-test-asset",
    getAttachmentAssets: () => assets,
    getCurrentGroup: () => ({ profileId: "hero", animationId: "run", frames: [{}] }),
    getAttachmentAssetGroupKey: () => "hero/run",
    translate: (key, values = {}) => `${key}:${values.name || values.assetCount || ""}`,
    escapeHtml: (value) => String(value),
    assetUrl: (asset) => asset.path,
    getSelectedFrameCount: () => 1,
    applyAttachmentAsset: () => 0,
    applyAttachmentAssetSequence: async () => 0,
    removeAttachmentAssets: async (assetIds, groupKey) => {
      const ids = new Set(assetIds);
      removals.push({ ids: [...ids], groupKey });
      removedSnapshot = assets.filter((asset) => ids.has(asset.id));
      assets = assets.filter((asset) => !ids.has(asset.id));
      return removedSnapshot.length;
    },
    undoAttachmentAssetRemoval: async () => {
      if (undoFailure) throw undoFailure;
      assets = [...removedSnapshot, ...assets].sort((left, right) => left.id.localeCompare(right.id));
      const restored = removedSnapshot.length;
      removedSnapshot = [];
      return restored;
    },
    canUndoAttachmentAssetRemoval: () => removedSnapshot.length > 0,
    readFileAsDataUrl: async () => "",
    addImagesToCurrentGroupAssets: async () => 0,
    status: () => {},
    deleteSelectedAnimationFrames: async () => {},
    clearCurrentAnimation: async () => {},
    document: documentRef,
  });

  controller.renderAttachmentAssetTray();
  const firstSequenceChoice = host.querySelector(".attachmentAssetSequenceChoice");
  firstSequenceChoice.focus();
  firstSequenceChoice.checked = true;
  firstSequenceChoice.dispatch("change");
  assert.equal(
    host
      .querySelectorAll(".attachmentAssetSequenceChoice")
      .find((choice) => choice.dataset.assetId === "asset-a").focused,
    true,
  );

  const firstRemove = host.querySelector(".attachmentAssetRemove");
  assert.ok(firstRemove);
  firstRemove.click();
  await flushEvents();

  assert.deepEqual(removals[0], { ids: ["asset-a"], groupKey: "hero/run" });
  assert.deepEqual(
    assets.map((asset) => asset.id),
    ["asset-b"],
  );
  assert.equal(host.querySelector(".attachmentAssetUndo").focused, true);

  host.querySelector(".attachmentAssetUndo").click();
  await flushEvents();
  assert.deepEqual(
    assets.map((asset) => asset.id),
    ["asset-a", "asset-b"],
  );
  assert.equal(host.querySelector(".assetImportButton").focused, true);

  host.querySelector(".assetSequenceSelectAll").click();
  assert.equal(host.querySelector(".assetSequenceSelectAll").focused, true);
  const bulkRemove = host.querySelector(".assetSequenceRemove");
  assert.equal(bulkRemove.disabled, false);
  bulkRemove.click();
  await flushEvents();

  assert.deepEqual(removals[1], {
    ids: ["asset-a", "asset-b"],
    groupKey: "hero/run",
  });
  assert.deepEqual(assets, []);
  assert.equal(host.querySelector(".attachmentAssetUndo").focused, true);

  undoFailure = new Error("restore conflict");
  host.querySelector(".attachmentAssetUndo").click();
  await flushEvents();
  assert.equal(host.querySelector(".attachmentAssetUndo").focused, true);
});
