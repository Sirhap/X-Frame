const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { clampNumber, cloneVector } = require("../animation_tuner/public/app_utils");
const {
  BOX_MIN_SIZE,
  BOX_NUDGE_STEP,
  collisionOffsetYForHeight,
  isCollisionBox,
  isDefaultFootStubBox,
  normalizeFrameBox,
  nudgeFrameBox,
  resizeFrameBox,
} = require("../animation_tuner/public/app_box_geometry");
const { createController: createBoxDefaults } = require("../animation_tuner/public/app_box_defaults");
const { createController: createBoxModel } = require("../animation_tuner/public/app_box_model");
const { createController: createFrameEditState } = require("../animation_tuner/public/app_frame_edit_state");
const { createController: createBoxAdjustment } = require("../animation_tuner/public/app_box_adjustment");
const {
  createController: createStagePointer,
} = require("../animation_tuner/public/app_events_stage_pointer");

/**
 * Builds the workbench box stack the way /workspace/animation/boxes does:
 * restore-auto leaves no override, and the displayed box is image-derived.
 * Frame metadata is a 1×1 stub so a missing image list collapses to the foot.
 * @param {{useImages?:boolean}} [options] Whether frameBox may see the loaded frame.
 * @returns {object} Wired controllers, group, and override store.
 */
function createRestoreAutoWorkbench(options = {}) {
  const useImages = options.useImages !== false;
  const group = {
    uiId: "assassin_jump",
    name: "assassin_jump",
    type: "actor",
    anchorMode: "canvas_bottom_center",
    frames: [{ width: 1, height: 1 }],
  };
  const images = [{ width: 80, height: 160 }];
  const stores = { [group.uiId]: {} };
  const overrides = [];
  const events = [];
  const opaqueRect = { x: 10, y: 20, width: 60, height: 130 };

  const frameEdit = createFrameEditState({
    getCurrentGroup: () => group,
    getSelectedFrame: () => 0,
    getImages: () => images,
    boxOverrideStore: (target = group) => stores[target.uiId],
    frameBox: (...args) => boxModel.frameBox(...args),
    tuningFrameKey: (index) => String(index),
    normalizeFrameBox,
    isDefaultFootStubBox,
    cloneVector,
    usesCanvasBottomCenterAnchor: (target) => target?.anchorMode === "canvas_bottom_center",
    opaqueRectForImage: () => opaqueRect,
    markDirty: () => {},
  });

  const defaults = createBoxDefaults({
    getCurrentGroup: () => group,
    getSelectedFrame: () => 0,
    getValues: () => ({}),
    getConfig: () => ({ references: {} }),
    framePlayback: () => ({ disabled: false }),
    cloneVector,
    clampNumber,
    collisionOffsetYForHeight,
    normalizeFrameBox,
    usesCanvasFootAnchor: (target) => target?.anchorMode === "canvas_bottom_center",
    sourceBodyCenterForBox: (index, target, groupImages) =>
      frameEdit.sourceBodyCenterForBox(index, target, groupImages),
    sourceAnchorForBox: (index, target, groupImages) =>
      frameEdit.sourceAnchorForBox(index, target, groupImages),
  });

  const boxModel = createBoxModel({
    boxNames: ["hurtbox"],
    getCurrentGroup: () => group,
    getSelectedFrame: () => 0,
    getSelectedBox: () => "hurtbox",
    getSelectedBoxes: () => new Set(["hurtbox"]),
    getImages: () => (useImages ? images : []),
    getBoxOverrideStore: (target) => stores[target.uiId],
    getFrameBoxKey: (index) => String(index),
    defaultHitbox: defaults.defaultHitbox,
    defaultCollisionBox: defaults.defaultCollisionBox,
    defaultHurtbox: defaults.defaultHurtbox,
    isCollisionBox,
    normalizeFrameBox,
    cloneVector,
    isAttackAnimationGroup: () => false,
    selectedFrameIndexes: () => [0],
  });

  return { boxModel, defaults, frameEdit, group, images, stores, overrides, events, opaqueRect };
}

test("restored auto hurtbox is the image body, not the 1x1 foot stub", () => {
  const { boxModel, group } = createRestoreAutoWorkbench();
  // Live nudge/resize call this three-arg form after restore-auto.
  const current = boxModel.frameBox("hurtbox", 0, group);
  assert.ok(current.size.x > 20, `expected image-derived width, got ${current.size.x}`);
  assert.ok(current.size.y > 40, `expected image-derived height, got ${current.size.y}`);
  assert.ok(Math.abs(current.offset.y) > 8, `expected body offset, got ${current.offset.y}`);
  assert.ok(current.size.x >= BOX_MIN_SIZE);
  assert.ok(current.size.y >= BOX_MIN_SIZE);
});

test("frameBox without images is the foot stub that live restore-auto must not write", () => {
  const { defaults, group, frameEdit } = createRestoreAutoWorkbench();
  const stub = defaults.defaultHurtbox(0, group, []);
  const body = frameEdit.sourceBodyCenterForBox(0, group, []);
  assert.equal(body.rect.width, 1);
  assert.equal(body.rect.height, 1);
  assert.ok(stub.size.x <= 8);
  assert.ok(stub.size.y <= 8);
});

test("ArrowLeft after restore-auto nudges the displayed box and cannot jump-collapse", () => {
  const workbench = createRestoreAutoWorkbench();
  const { boxModel, group, stores } = workbench;
  const before = boxModel.frameBox("hurtbox", 0, group);
  assert.ok(before.size.x > 20, `nudge started from foot stub ${before.size.x}x${before.size.y}`);
  const next = nudgeFrameBox("hurtbox", before, -BOX_NUDGE_STEP, 0);
  assert.equal(next.size.x, before.size.x);
  assert.equal(next.size.y, before.size.y);
  assert.equal(next.offset.x, before.offset.x - BOX_NUDGE_STEP);
  assert.equal(next.offset.y, before.offset.y);
  stores[group.uiId]["0"] = { hurtbox: next };
  const written = boxModel.frameBox("hurtbox", 0, group);
  assert.equal(written.size.x, before.size.x);
  assert.equal(written.size.y, before.size.y);
  assert.notEqual(written.size.x, BOX_MIN_SIZE);
  assert.ok(Math.abs(written.offset.y - before.offset.y) < 0.0001);
});

test("west-handle resize after restore-auto moves only the left edge", () => {
  const { boxModel, group } = createRestoreAutoWorkbench();
  const displayed = boxModel.frameBox("hurtbox", 0, group);
  const right = displayed.offset.x + displayed.size.x / 2;
  const top = displayed.offset.y - displayed.size.y / 2;
  const bottom = displayed.offset.y + displayed.size.y / 2;
  const resized = resizeFrameBox("hurtbox", displayed, "w", { x: 20, y: 8 });
  assert.ok(resized.size.x < displayed.size.x);
  assert.ok(resized.size.x > 20);
  assert.equal(resized.size.y, displayed.size.y);
  assert.ok(Math.abs(resized.offset.x + resized.size.x / 2 - right) < 0.0001);
  assert.ok(Math.abs(resized.offset.y - displayed.size.y / 2 - top) < 0.0001);
  assert.ok(Math.abs(resized.offset.y + displayed.size.y / 2 - bottom) < 0.0001);
  assert.ok(resized.size.x >= BOX_MIN_SIZE);
  assert.ok(resized.size.y >= BOX_MIN_SIZE);
  assert.ok(Number.isFinite(resized.offset.x));
  assert.ok(Number.isFinite(resized.offset.y));
});

test("setBoxOverride keeps a restored auto box size instead of writing the 1x1 stub", () => {
  const { boxModel, frameEdit, group, stores } = createRestoreAutoWorkbench();
  const current = boxModel.frameBox("hurtbox", 0, group);
  assert.ok(current.size.x > 20, `override started from foot stub ${current.size.x}x${current.size.y}`);
  const nudged = nudgeFrameBox("hurtbox", current, -BOX_NUDGE_STEP, 0);
  frameEdit.setBoxOverride("hurtbox", nudged, 0, group);
  const written = stores[group.uiId]["0"].hurtbox;
  assert.equal(written.size.x, current.size.x);
  assert.equal(written.size.y, current.size.y);
  assert.equal(written.offset.x, current.offset.x - BOX_NUDGE_STEP);
});

test("stage west-handle drag uses the displayed auto box, not a missing-image stub", () => {
  const { boxModel, group, images } = createRestoreAutoWorkbench();
  const displayed = boxModel.frameBox("hurtbox", 0, group);
  const stub = boxModel.frameBox("hurtbox", 0, group, []);
  assert.ok(stub.size.x <= 8, "empty image list must still be able to produce the foot stub");
  assert.ok(displayed.size.x > stub.size.x);

  const stage = {
    classList: {
      add() {},
      remove() {},
      has() {
        return false;
      },
    },
    addEventListener(type, listener) {
      this[type] = listener;
    },
    setPointerCapture() {},
    dispatch(type, event) {
      this[type](event);
    },
  };
  const state = {
    view: { x: 0, y: 0, zoom: 1 },
    selectedBoxes: new Set(["hurtbox"]),
    selectedBox: "hurtbox",
    showBoxes: true,
  };
  const written = [];
  const undos = [];
  const controller = createStagePointer({
    stage,
    state,
    handlers: {
      stagePoint: () => ({ x: 0, y: 0 }),
      updateCoordHud: () => {},
      hitTestBoxes: () => ({ boxName: "hurtbox", mode: "box-resize", handle: "w" }),
      hitTestDirectManipulationAttachment: () => null,
      hitTestDirectManipulationFrame: () => null,
      frameBox: (boxName, index, target, groupImages) =>
        boxModel.frameBox(boxName, index, target ?? group, groupImages),
      getCurrentGroup: () => group,
      getImages: () => images,
      selectedFrameIndexes: () => [0],
      cloneVector: (value) => ({ x: value.x, y: value.y }),
      isCollisionBox,
      boxResizeDeltaFromScreenDelta: (delta) => delta,
      resizeFrameBox,
      setBoxOverride: (...args) => written.push(args),
      pushUndo: (label) => undos.push(label),
      syncBoxInputs: () => {},
      draw: () => {},
    },
  });
  controller.bind();
  stage.dispatch("pointerdown", { pointerId: 1, clientX: 40, clientY: 80, button: 0 });
  stage.dispatch("pointermove", { clientX: 60, clientY: 80 });

  assert.deepEqual(undos, ["resize box"]);
  assert.equal(state.drag.mode, "box-resize");
  assert.equal(state.drag.handle, "w");
  const next = written.at(-1)[1];
  assert.ok(next.size.x < displayed.size.x);
  assert.ok(
    next.size.x > 20,
    `west drag jumped to ${next.size.x}x${next.size.y} at ${JSON.stringify(next.offset)}`,
  );
  assert.equal(next.size.y, displayed.size.y);
  assert.ok(Math.abs(next.offset.y - displayed.offset.y) < 0.0001);
  assert.ok(
    Math.abs(next.offset.y - stub.offset.y) > 8,
    `west drag jumped to the foot origin ${JSON.stringify(next.offset)}`,
  );
});

/**
 * Wires nudgeSelectedBox to the real store-backed setBoxOverride / frameBox path.
 * @param {object} [options] Workbench options.
 * @returns {object} Workbench plus adjustment controller and undo labels.
 */
function createStoreBackedNudgeWorkbench(options = {}) {
  const workbench = createRestoreAutoWorkbench(options);
  const { boxModel, frameEdit, group, images } = workbench;
  const nudgeImages = options.emptyNudgeImages ? [] : images;
  const events = [];
  const adjustment = createBoxAdjustment({
    elements: {
      stage: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
      showBoxes: {},
      boxChoiceInputs: [],
    },
    getCurrentGroup: () => group,
    getSelectedFrame: () => 0,
    getSelectedBox: () => "hurtbox",
    getSelectedBoxes: () => new Set(["hurtbox"]),
    getShowBoxes: () => true,
    getImages: () => nudgeImages,
    getView: () => ({ zoom: 1 }),
    getDevicePixelRatio: () => 1,
    boxDrawOrder: ["hurtbox"],
    collisionBoxHandles: new Set(),
    boxExistsOnFrame: () => true,
    frameBox: (boxName, index, target, groupImages) => boxModel.frameBox(boxName, index, target, groupImages),
    boxAutoTransform: () => ({
      scaleX: 1,
      scaleY: 1,
      offset: { x: 0, y: 0 },
      rotation: 0,
      facing: 1,
    }),
    groupOriginScreen: () => ({ x: 0, y: 0 }),
    isCollisionBox,
    rotateVector: (value) => value,
    rotatePoint: (point, _radians, origin) => ({ x: point.x + origin.x, y: point.y + origin.y }),
    pointInRect: () => false,
    pointInBoxRect: () => false,
    canEditBoxes: () => true,
    canEditBox: () => true,
    normalizeBoxSelectionForGroup: () => false,
    saveBoxViewPrefs: () => {},
    selectedFrameIndexes: () => [0],
    cloneVector: (value) => ({ x: value.x, y: value.y }),
    collisionOffsetYForHeight,
    setBoxOverride: (boxName, box, index, target) => frameEdit.setBoxOverride(boxName, box, index, target),
    nudgeFrameBox,
    pushUndo: (label) => events.push(label),
    renderFilmstrip: () => {},
    draw: () => {},
  });
  return { ...workbench, adjustment, events };
}

test("nudgeSelectedBox(-1, 0) changes store-backed offset.x by -1 and keeps size", () => {
  const { adjustment, boxModel, events, group, images } = createStoreBackedNudgeWorkbench();
  const before = boxModel.frameBox("hurtbox", 0, group, images);
  const stub = boxModel.frameBox("hurtbox", 0, group, []);
  assert.ok(before.size.x > 20, `nudge started from foot stub ${before.size.x}x${before.size.y}`);
  assert.ok(Math.abs(before.offset.y - stub.offset.y) > 8, "displayed box must not already sit at the foot");
  assert.equal(adjustment.nudgeSelectedBox(-1, 0), true);
  assert.deepEqual(events, ["nudge box"]);
  const after = boxModel.frameBox("hurtbox", 0, group, images);
  assert.equal(
    after.offset.x,
    before.offset.x - 1,
    `undo-label-only is not a successful nudge; offset stayed ${after.offset.x}`,
  );
  assert.equal(after.offset.y, before.offset.y);
  assert.equal(after.size.x, before.size.x);
  assert.equal(after.size.y, before.size.y);
  assert.notEqual(after.size.x, BOX_MIN_SIZE);
  assert.ok(after.size.x > stub.size.x * 2, `one nudge collapsed size to ${after.size.x}x${after.size.y}`);
  assert.ok(
    Math.abs(after.offset.y - stub.offset.y) > 8,
    `one nudge jumped to the foot origin ${JSON.stringify(after.offset)}`,
  );
});

test("setBoxOverride refuses to persist a 1x1/8x8 foot stub over a restored auto box", () => {
  const { boxModel, frameEdit, group, images, stores } = createRestoreAutoWorkbench();
  const displayed = boxModel.frameBox("hurtbox", 0, group, images);
  const stub = boxModel.frameBox("hurtbox", 0, group, []);
  assert.ok(isDefaultFootStubBox(stub));
  assert.equal(isDefaultFootStubBox(displayed), false);
  const naive = {
    ...stub,
    offset: { x: stub.offset.x - 1, y: stub.offset.y },
    size: stub.size,
  };
  assert.equal(frameEdit.setBoxOverride("hurtbox", naive, 0, group), false);
  const after = boxModel.frameBox("hurtbox", 0, group, images);
  assert.equal(after.size.x, displayed.size.x);
  assert.equal(after.size.y, displayed.size.y);
  assert.equal(after.offset.y, displayed.offset.y);
  assert.equal(stores[group.uiId]["0"]?.hurtbox, undefined);
});

test("nudge without images cannot write the foot stub over a restored auto box", () => {
  const { adjustment, boxModel, group, images, stores } = createStoreBackedNudgeWorkbench({
    emptyNudgeImages: true,
  });
  const displayed = boxModel.frameBox("hurtbox", 0, group, images);
  assert.ok(displayed.size.x > 20);
  assert.equal(adjustment.nudgeSelectedBox(-1, 0), true);
  const after = boxModel.frameBox("hurtbox", 0, group, images);
  assert.equal(after.size.x, displayed.size.x);
  assert.equal(after.size.y, displayed.size.y);
  assert.equal(after.offset.y, displayed.offset.y);
  assert.ok(
    Math.abs(after.offset.y) > 8,
    `empty-image nudge jumped to the foot ${JSON.stringify(after.offset)}`,
  );
  assert.equal(stores[group.uiId]["0"]?.hurtbox, undefined);
});

test("frameBox rejects a box object so frameBox(box) cannot silently return the foot stub", () => {
  const { boxModel, group, images } = createRestoreAutoWorkbench();
  const displayed = boxModel.frameBox("hurtbox", 0, group, images);
  assert.throws(() => boxModel.frameBox(displayed), /box name string|not a box object/i);
});

test("nudgeSelectedBox source uses nudgeFrameBox, not a shallow offset.x +=", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../animation_tuner/public/app_box_adjustment.js"),
    "utf8",
  );
  const match = source.match(/function nudgeSelectedBox\([\s\S]*?\n    \}/);
  assert.ok(match, "nudgeSelectedBox source not found");
  const body = match[0];
  assert.match(body, /nudgeFrameBox\(selectedBox,\s*current,\s*dx,\s*dy\)/);
  assert.match(body, /displayedFrameBox\(selectedBox,\s*frameIndex,\s*getCurrentGroup\(\)\)/);
  assert.match(
    source,
    /function displayedFrameBox[\s\S]*frameBox\(boxName,\s*index,\s*group,\s*getImages\(\)\)/,
  );
  assert.match(source, /groupImages = getImages\(\)/);
  assert.match(body, /setBoxOverride\(\s*selectedBox,\s*nudgeFrameBox/);
  assert.equal(/\boffset\.x\s*\+=/.test(body), false);
});

test("setBoxOverride keeps displayed size when a live wrapper writes only a shallow offset", () => {
  const { boxModel, frameEdit, group, images } = createRestoreAutoWorkbench();
  const before = boxModel.frameBox("hurtbox", 0, group, images);
  assert.ok(before.size.x > 20);
  frameEdit.setBoxOverride("hurtbox", { offset: { x: before.offset.x - 1, y: before.offset.y } }, 0, group);
  const after = boxModel.frameBox("hurtbox", 0, group, images);
  assert.equal(after.offset.x, before.offset.x - 1);
  assert.equal(after.offset.y, before.offset.y);
  assert.equal(after.size.x, before.size.x);
  assert.equal(after.size.y, before.size.y);
  assert.ok(after.size.x > 20, `shallow offset write collapsed to ${after.size.x}x${after.size.y}`);
});

test("box adjustment nudge after restore-auto writes image size through nudgeFrameBox", () => {
  const { boxModel, group } = createRestoreAutoWorkbench();
  const before = boxModel.frameBox("hurtbox", 0, group);
  assert.ok(before.size.x > 20, `adjustment started from foot stub ${before.size.x}x${before.size.y}`);
  const written = [];
  const events = [];
  const adjustment = createBoxAdjustment({
    elements: {
      stage: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
      showBoxes: {},
      boxChoiceInputs: [],
    },
    getCurrentGroup: () => group,
    getSelectedFrame: () => 0,
    getSelectedBox: () => "hurtbox",
    getSelectedBoxes: () => new Set(["hurtbox"]),
    getShowBoxes: () => true,
    getImages: () => [{ width: 80, height: 160 }],
    getView: () => ({ zoom: 1 }),
    getDevicePixelRatio: () => 1,
    boxDrawOrder: ["hurtbox"],
    collisionBoxHandles: new Set(),
    boxExistsOnFrame: () => true,
    frameBox: (boxName, index, target, groupImages) => boxModel.frameBox(boxName, index, target, groupImages),
    boxAutoTransform: () => ({
      scaleX: 1,
      scaleY: 1,
      offset: { x: 0, y: 0 },
      rotation: 0,
      facing: 1,
    }),
    groupOriginScreen: () => ({ x: 0, y: 0 }),
    isCollisionBox,
    rotateVector: (value) => value,
    rotatePoint: (point, _radians, origin) => ({ x: point.x + origin.x, y: point.y + origin.y }),
    pointInRect: () => false,
    pointInBoxRect: () => false,
    canEditBoxes: () => true,
    canEditBox: () => true,
    normalizeBoxSelectionForGroup: () => false,
    saveBoxViewPrefs: () => {},
    selectedFrameIndexes: () => [0],
    cloneVector: (value) => ({ x: value.x, y: value.y }),
    collisionOffsetYForHeight,
    setBoxOverride: (...args) => written.push(args),
    nudgeFrameBox,
    pushUndo: (label) => events.push(label),
    renderFilmstrip: () => {},
    draw: () => {},
  });

  assert.equal(adjustment.nudgeSelectedBox(-BOX_NUDGE_STEP, 0), true);
  assert.deepEqual(events, ["nudge box"]);
  assert.equal(written.length, 1);
  assert.equal(written[0][0], "hurtbox");
  assert.equal(written[0][1].size.x, before.size.x);
  assert.equal(written[0][1].size.y, before.size.y);
  assert.equal(written[0][1].offset.x, before.offset.x - BOX_NUDGE_STEP);
});

test("app.js never resolves frameBox through the frame-edit 1x1 stub", () => {
  const source = fs.readFileSync(path.join(__dirname, "../animation_tuner/public/app.js"), "utf8");
  assert.equal(source.includes('frameEditStateCall("frameBox")'), false);
  assert.equal(source.includes("frameEditStateCall('frameBox')"), false);
  assert.match(
    source,
    /const boxModel = globalThis\.XSXBBoxModel\.createController\(\{[\s\S]*?getImages:\s*\(\)\s*=>\s*images/,
  );
  assert.match(source, /if \(name === "frameBox"\)/);
});
