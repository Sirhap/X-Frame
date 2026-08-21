const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_filmstrip_interaction");
const FILMSTRIP_SOURCE = fs.readFileSync(
  path.join(__dirname, "../animation_tuner/public/app_filmstrip_interaction.js"),
  "utf8",
);

test("filmstrip thumbs use cropped preview URLs instead of the raw atlas asset", () => {
  assert.match(FILMSTRIP_SOURCE, /framePreviewSrc\(frame,/);
});

test("filmstrip rendering clears the tray and renders the active chain", () => {
  const filmstrip = { innerHTML: "stale" };
  const group = { uiId: "main", frames: [] };
  const chain = { uiId: "chain", frames: [] };
  const rendered = [];
  let trayCalls = 0;
  let frameActionSyncCalls = 0;
  const controller = createController({
    elements: { filmstrip },
    state: { getCurrentGroup: () => group },
    handlers: {
      renderAttachmentAssetTray: () => {
        trayCalls += 1;
      },
      syncFrameActions: () => {
        frameActionSyncCalls += 1;
      },
      getPlaybackChainGroup: () => chain,
      renderFilmstripGroup: (renderedGroup, label) => rendered.push([renderedGroup, label]),
    },
    utils: { translate: (key) => key },
  });

  controller.renderFilmstrip();

  assert.equal(filmstrip.innerHTML, "");
  assert.equal(trayCalls, 1);
  assert.equal(frameActionSyncCalls, 1);
  assert.deepEqual(rendered, [
    [group, "mainLabel"],
    [chain, "thenLabel"],
  ]);
});

test("filmstrip layer controls move by one slot and restore focus", () => {
  const group = { uiId: "main", frames: [{ name: "frame" }] };
  const attachment = { type: "attachment", attachmentId: "hat", frameIndex: 0, groupUiId: "main" };
  const main = { type: "main", frameIndex: 0, groupUiId: "main" };
  let layerInfos = [attachment, main];
  let focused = false;
  let undoCalls = 0;
  const filmstrip = { innerHTML: "stale" };
  const layerCardKey = (info) => (info.type === "attachment" ? `attachment:${info.attachmentId}` : "main");
  const controller = createController({
    elements: { filmstrip },
    documentRef: {
      querySelectorAll: () => [],
      querySelector: () => ({
        focus: () => {
          focused = true;
        },
      }),
    },
    state: { getCurrentGroup: () => group },
    handlers: {
      clampFrameIndex: (index) => index,
      layerCardInfosForFrame: () => layerInfos,
      layerCardKey,
      layerCardDomKey: layerCardKey,
      movedLayerCardOrder: (dragInfo, insertionIndex) => {
        const before = layerInfos.slice();
        const dragIndex = before.findIndex((candidate) => layerCardKey(candidate) === layerCardKey(dragInfo));
        const after = before.slice();
        const [dragged] = after.splice(dragIndex, 1);
        const adjustedIndex = dragIndex < insertionIndex ? insertionIndex - 1 : insertionIndex;
        after.splice(adjustedIndex, 0, dragged);
        return { before, after };
      },
      applyFrameLayerCardOrder: (_index, _group, orderedInfos) => {
        layerInfos = orderedInfos;
        return true;
      },
      pushUndo: () => {
        undoCalls += 1;
      },
      renderFilmstripGroup: () => {},
    },
  });

  assert.equal(controller.moveFrameLayerCardByOffset(attachment, 1), true);
  assert.deepEqual(layerInfos.map(layerCardKey), ["main", "attachment:hat"]);
  assert.equal(undoCalls, 1);
  assert.equal(filmstrip.innerHTML, "");
  assert.equal(focused, true);
  assert.equal(controller.moveFrameLayerCardByOffset(attachment, 1), false);
  assert.equal(undoCalls, 1);
});

test("filmstrip rebuild restores focus to the clicked thumb", () => {
  const group = { uiId: "main", frames: [{ name: "one" }, { name: "two" }] };
  const focused = [];
  const thumb = {
    classList: { contains: (name) => name === "thumb" },
    dataset: { frameIndex: "1" },
    closest: (selector) => (selector === ".thumb" ? thumb : null),
  };
  const restored = {
    focus: (options) => {
      focused.push(options);
    },
  };
  const filmstrip = {
    innerHTML: "stale",
    contains: (element) => element === thumb,
    querySelector: (selector) => (selector === '.thumb[data-frame-index="1"]' ? restored : null),
  };
  const controller = createController({
    elements: { filmstrip },
    documentRef: { activeElement: thumb, querySelector: () => null },
    state: { getCurrentGroup: () => group },
    handlers: {
      renderAttachmentAssetTray: () => {},
      syncFrameActions: () => {},
      getPlaybackChainGroup: () => null,
      renderFilmstripGroup: () => {},
    },
    utils: { translate: (key) => key },
  });

  controller.renderFilmstrip();

  assert.deepEqual(focused, [{ preventScroll: true }]);
});

test("filmstrip cards leave Enter and Space to nested buttons", () => {
  const controller = createController();
  let clickCalls = 0;
  let preventDefaultCalls = 0;
  const card = {
    click: () => {
      clickCalls += 1;
    },
  };
  const nestedButton = {};

  assert.equal(
    controller.activateLayerCardFromKeyboard(
      {
        key: " ",
        target: nestedButton,
        currentTarget: card,
        preventDefault: () => {
          preventDefaultCalls += 1;
        },
      },
      card,
    ),
    false,
  );
  assert.equal(clickCalls, 0);
  assert.equal(preventDefaultCalls, 0);

  assert.equal(
    controller.activateLayerCardFromKeyboard(
      {
        key: "Enter",
        target: card,
        currentTarget: card,
        preventDefault: () => {
          preventDefaultCalls += 1;
        },
      },
      card,
    ),
    true,
  );
  assert.equal(clickCalls, 1);
  assert.equal(preventDefaultCalls, 1);
});
