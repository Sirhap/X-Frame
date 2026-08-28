"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createController } = require("../animation_tuner/public/app_attachment_manipulation");
const { createController: createTransformRuntime } = require("../animation_tuner/public/app_transform_runtime");
const { createController: createFrameEditState } = require("../animation_tuner/public/app_frame_edit_state");
const { createController: createLayerRenderer } = require("../animation_tuner/public/app_canvas_renderer_layers");
const { rotatePoint, rotateVector } = require("../animation_tuner/public/app_box_geometry");
const { normalizeAttachmentTransform } = require("../animation_tuner/public/app_attachment_utils");

/** Creates a deterministic geometry fixture for direct attachment edits. */
function createFixture() {
  const group = { uiId: "group-1", frames: [{}] };
  const attachment = {
    path: "attachment.png",
    transform: { scale: 1, scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 },
  };
  const keys = new Set();
  const undoLabels = [];
  const clearedTimers = [];
  const controller = createController({
    getCurrentGroup: () => group,
    getImages: () => [{}],
    getSelectedFrame: () => 0,
    getView: () => ({ zoom: 1 }),
    getDevicePixelRatio: () => 1,
    getHeldAttachmentTransformKeys: () => keys,
    attachmentFrameIndex: () => 0,
    directManipulationAttachment: () => attachment,
    selectedFrameAttachment: () => attachment,
    cachedImageForFrame: () => ({ width: 10, height: 20 }),
    frameTransform: () => ({ scaleX: 2, scaleY: 2, offset: { x: 0, y: 0 }, rotation: 0 }),
    frameScreenRect: () => ({ originX: 100, originY: 200 }),
    renderTransformForGroup: (transform) => transform,
    runtimeBaseScaleForGroup: () => 1,
    normalizeAttachmentTransform: (value) => ({
      scale: 1,
      scaleX: 1,
      scaleY: 1,
      offset: { x: 0, y: 0 },
      rotation: 0,
      ...value,
    }),
    rotatePoint: (point, _angle, origin) => ({ x: point.x + origin.x, y: point.y + origin.y }),
    rotateVector: (vector) => vector,
    stagePoint: () => ({ x: 100, y: 200 }),
    pushUndo: (label) => undoLabels.push(label),
    windowRef: {
      setTimeout: () => "timer-1",
      clearTimeout: (timer) => clearedTimers.push(timer),
    },
  });
  return { attachment, clearedTimers, controller, group, keys, undoLabels };
}

test("attachment geometry keeps screen bounds and local delta semantics", () => {
  const { controller } = createFixture();
  assert.deepEqual(controller.frameImageAttachmentScreenRect({ path: "attachment.png", transform: {} }), {
    x: 90,
    y: 180,
    originX: 100,
    originY: 200,
    width: 20,
    height: 40,
    halfWidth: 10,
    halfHeight: 20,
    rotation: 0,
    drawWidth: 20,
    drawHeight: 40,
    flipH: false,
    img: { width: 10, height: 20 },
  });
  assert.deepEqual(controller.attachmentOffsetDeltaFromClientDelta(4, -6), { x: 2, y: -3 });
  assert.equal(
    controller.pointInAttachmentRect(
      { x: 100, y: 200 },
      controller.frameImageAttachmentScreenRect({ path: "attachment.png", transform: {} }),
    ),
    true,
  );
});

test("attachment wheel edits preserve rotation, undo coalescing, and scale clamping", () => {
  const { attachment, clearedTimers, controller, keys, undoLabels } = createFixture();
  keys.add("r");
  assert.equal(controller.applySelectedAttachmentWheel({ deltaY: -1 }), true);
  assert.equal(attachment.transform.rotation, 2);
  assert.deepEqual(undoLabels, ["rotate attached image"]);
  assert.deepEqual(clearedTimers, [null]);

  keys.delete("r");
  keys.add("z");
  attachment.transform.scale = 19.99;
  attachment.transform.scaleX = 19.99;
  attachment.transform.scaleY = 19.99;
  assert.equal(controller.applySelectedAttachmentWheel({ deltaY: -1 }), true);
  assert.equal(attachment.transform.scale, 20);
  assert.equal(attachment.transform.scaleX, 20);
  assert.equal(attachment.transform.scaleY, 20);
  assert.equal(controller.clampAttachmentScale(Number.NaN), 1);
});

test("attachment wheel without a hit leaves the event for the main sprite", () => {
  const controller = createController({
    getHeldAttachmentTransformKeys: () => new Set(["z"]),
    directManipulationAttachment: () => null,
    getCurrentGroup: () => ({ frames: [{}] }),
    getImages: () => [{}],
    getSelectedFrame: () => 0,
    getView: () => ({ zoom: 1 }),
    stagePoint: () => ({ x: 0, y: 0 }),
  });
  assert.equal(controller.applySelectedAttachmentWheel({ deltaY: -1 }), false);
});

function assertApproxEqual(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < 1e-6,
    `${message}: expected ${expected}, got ${actual}`,
  );
}

test("attachment screen origin rotates local offset with owner rotation", () => {
  const ownerRotation = 90;
  const localOffset = { x: 10, y: 0 };
  const controller = createController({
    getCurrentGroup: () => ({ uiId: "g", frames: [{}] }),
    getImages: () => [{}],
    getSelectedFrame: () => 0,
    getView: () => ({ zoom: 1 }),
    getDevicePixelRatio: () => 1,
    cachedImageForFrame: () => ({ width: 10, height: 10 }),
    frameTransform: () => ({ scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: ownerRotation }),
    frameScreenRect: () => ({ originX: 0, originY: 0 }),
    renderTransformForGroup: (transform) => transform,
    runtimeBaseScaleForGroup: () => 1,
    effectiveFlipH: () => false,
    normalizeAttachmentTransform: (value) => ({
      scale: 1,
      scaleX: 1,
      scaleY: 1,
      offset: { x: 0, y: 0 },
      rotation: 0,
      ...value,
      offset: value?.offset || { x: 0, y: 0 },
    }),
    rotatePoint,
    rotateVector,
  });

  const rect = controller.frameImageAttachmentScreenRect({
    path: "attachment.png",
    transform: { offset: localOffset, rotation: 0, scaleX: 1, scaleY: 1 },
  });
  assertApproxEqual(rect.originX, 0, "owner rot 90 maps local (10,0) to screen x");
  assertApproxEqual(rect.originY, 10, "owner rot 90 maps local (10,0) to screen y");
  assert.ok(
    Math.abs(rect.originX - 10) > 1 || Math.abs(rect.originY - 0) > 1,
    "unrotated Tuner axes must not keep origin at (10, 0)",
  );

  const localDelta = controller.attachmentOffsetDeltaFromClientDelta(0, 10);
  assertApproxEqual(localDelta.x, 10, "screen (0,10) at 90 deg inverts to local x");
  assertApproxEqual(localDelta.y, 0, "screen (0,10) at 90 deg inverts to local y");
});

const APP_JS = path.resolve(__dirname, "../animation_tuner/public/app.js");

/**
 * Extracts one function declaration from app.js by name.
 * @param {string} source File contents.
 * @param {string} name Function name.
 * @returns {string}
 */
function extractFunction(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `${name} should exist`);
  let depth = 0;
  const start = match.index;
  let i = source.indexOf("{", start);
  for (; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail(`${name} is unclosed`);
  return "";
}

/**
 * Runs live app.js updateBaseFromInputs (当前动画 / 变换 panel) in a vm bag.
 * @param {object} bag Closures the extracted function reads.
 * @param {object} transform Panel transform (rotation in degrees).
 * @returns {void}
 */
function applyLivePanelGroupTransform(bag, transform) {
  const source = fs.readFileSync(APP_JS, "utf8");
  const fnSrc = extractFunction(source, "updateBaseFromInputs");
  vm.createContext(bag);
  bag.__panelTransform = transform;
  vm.runInContext(`${fnSrc}\nupdateBaseFromInputs(__panelTransform)`, bag);
}

/**
 * Wires the live VFX transform path used by the 变换 panel + attachment draw.
 * frameTransform and renderTransformForGroup are the real modules — nothing injects 90.
 */
function createVfxAttachmentRotationHarness(options = {}) {
  const values = {
    "profiles.vfxchar.character.visual_size": 1,
    ...(options.values || {}),
  };
  const vfxFrameOverrides = {
    "vfxchar/00:0": {
      visual_size: 1,
      offset: { x: 0, y: 0 },
      rotation: 0,
      ...(options.frameOverride || {}),
    },
  };
  const group = {
    uiId: "player:vfx:00:1",
    name: "00",
    animationId: "00",
    runtimeAnimation: "vfxchar/00",
    type: "vfx",
    frames: [{}],
    scale: "profiles.vfxchar.groups.00.visual_size",
    scaleVector: "profiles.vfxchar.groups.00.visual_scale",
    offset: "profiles.vfxchar.groups.00.offset",
    rotation: "profiles.vfxchar.groups.00.rotation",
    defaultScale: 1,
    defaultRotation: 0,
    characterScale: "profiles.vfxchar.character.visual_size",
    characterScaleVector: "profiles.vfxchar.character.visual_scale",
    characterOffset: "profiles.vfxchar.character.offset",
    characterRotation: "profiles.vfxchar.character.rotation",
    characterBaseScale: 1,
    characterBaseRotation: 0,
    flipH: options.flipH === true,
  };
  const cloneScaleVector = (value, fallback = 1) => {
    if (value && typeof value === "object") {
      return { x: Number(value.x ?? fallback), y: Number(value.y ?? fallback) };
    }
    return { x: Number(fallback), y: Number(fallback) };
  };
  const cloneVector = (value, fallback = { x: 0, y: 0 }) => ({
    x: Number(value?.x ?? fallback.x ?? 0),
    y: Number(value?.y ?? fallback.y ?? 0),
  });
  const transformRuntime = createTransformRuntime({
    getCurrentGroup: () => group,
    getValueStore: () => values,
    getOpaqueRectForImage: () => ({ x: 0, y: 0, width: 1, height: 1 }),
    cloneScaleVector,
    cloneVector,
  });
  const frameEdit = createFrameEditState({
    getCurrentGroup: () => group,
    getSelectedFrame: () => 0,
    baseTransform: transformRuntime.baseTransform,
    overrideStore: (target = group) => (target?.type === "vfx" ? vfxFrameOverrides : {}),
    tuningFrameKey: (index, target) => `${target.runtimeAnimation}:${index}`,
  });
  const bag = {
    canEditGroupTransform: () => true,
    valueStore: () => values,
    baseEditSnapshot: null,
    currentGroup: group,
    baseTransform: transformRuntime.baseTransform,
    overrideStore: (target = group) => (target?.type === "vfx" ? vfxFrameOverrides : {}),
    tuningAnimationName: (target = group) => target.runtimeAnimation || target.name,
    structuredClone,
    cloneScaleVector,
    nearlyEqual: (left, right) => Math.abs(Number(left) - Number(right)) < 0.0001,
    cloneVector,
    markDirty() {},
    syncFrameInputs() {},
    renderFilmstrip() {},
    updateGroupMeta() {},
    draw() {},
  };
  if (options.storeOnly) {
    values[group.rotation] = Number(options.groupRotation ?? 90);
  } else {
    applyLivePanelGroupTransform(bag, {
      scale: 1,
      scaleX: 1,
      scaleY: 1,
      offset: { x: 0, y: 0 },
      rotation: options.groupRotation ?? 90,
    });
  }
  const marker = { width: options.markerWidth ?? 40, height: options.markerHeight ?? 10 };
  const controller = createController({
    getCurrentGroup: () => group,
    getImages: () => [{ width: 48, height: 48 }],
    getSelectedFrame: () => 0,
    getView: () => ({ zoom: 1 }),
    getDevicePixelRatio: () => 1,
    cachedImageForFrame: () => marker,
    frameTransform: frameEdit.frameTransform,
    baseTransform: transformRuntime.baseTransform,
    frameScreenRect: () => ({ originX: 0, originY: 0 }),
    renderTransformForGroup: transformRuntime.renderTransformForGroup,
    runtimeBaseScaleForGroup: () => 1,
    effectiveFlipH: () => group.flipH === true,
    normalizeAttachmentTransform,
    rotatePoint,
    rotateVector,
  });
  return { controller, frameEdit, group, marker, transformRuntime, values, vfxFrameOverrides };
}

test("app.js wires live frameTransform and renderTransformForGroup into attachment manipulation", () => {
  const source = fs.readFileSync(APP_JS, "utf8");
  const start = source.indexOf("attachmentManipulationModule.createController");
  assert.ok(start >= 0, "app.js must construct the attachment controller");
  const chunk = source.slice(start, start + 1800);
  assert.match(chunk, /\n\s*frameTransform,/);
  assert.match(chunk, /\n\s*renderTransformForGroup,/);
  assert.doesNotMatch(chunk, /rotation:\s*90/);
});

test("当前动画 rotation 90 uses live frameTransform+renderTransformForGroup to rotate a wide VFX marker", () => {
  const { controller, frameEdit, group, transformRuntime, values } = createVfxAttachmentRotationHarness();
  assert.equal(values["profiles.vfxchar.groups.00.rotation"], 90, "变换 panel wrote group.rotation");
  const owner = frameEdit.frameTransform(0, group);
  const rendered = transformRuntime.renderTransformForGroup(owner, group);
  assert.ok(
    Math.abs(rendered.rotation - 90) < 1e-6,
    `live renderTransformForGroup(frameTransform()) must be 90 after updateBaseFromInputs, got ${rendered.rotation}`,
  );

  const rect = controller.frameImageAttachmentScreenRect({
    path: "magenta-marker.png",
    transform: { offset: { x: 0, y: 0 }, rotation: 0, scaleX: 1, scaleY: 1 },
  });
  const expectedRadians = Math.PI / 2;
  assert.ok(
    Math.abs(rect.rotation - expectedRadians) < 1e-6,
    `attachment screen rotation must be ~90deg (radians), got ${rect.rotation}`,
  );
  assert.ok(rect.height > rect.width, "wide 40x10 marker AABB must become tall after 90deg owner rotation");

  const offsetRect = controller.frameImageAttachmentScreenRect({
    path: "magenta-marker.png",
    transform: { offset: { x: 10, y: 0 }, rotation: 0, scaleX: 1, scaleY: 1 },
  });
  assertApproxEqual(offsetRect.originX, 0, "owner rot 90 maps local (10,0) to screen x");
  assertApproxEqual(offsetRect.originY, 10, "owner rot 90 maps local (10,0) to screen y");
});

test("value-store 当前动画 rotation rotates a VFX attachment when a frame override pins 0", () => {
  const { controller, frameEdit, group } = createVfxAttachmentRotationHarness({ storeOnly: true });
  assert.equal(frameEdit.frameTransform(0, group).rotation, 0, "override pin keeps frameTransform at 0");
  const rect = controller.frameImageAttachmentScreenRect({
    path: "magenta-marker.png",
    transform: { offset: { x: 0, y: 0 }, rotation: 0, scaleX: 1, scaleY: 1 },
  });
  assert.ok(
    Math.abs(rect.rotation - Math.PI / 2) < 1e-6,
    `attachment must still follow group rotation 90, got ${rect.rotation}`,
  );
  assert.ok(rect.height > rect.width, "wide marker must become tall");
});

test("attachment draw path rotates with rect.rotation from the live owner transform", () => {
  const layersSource = fs.readFileSync(
    path.resolve(__dirname, "../animation_tuner/public/app_canvas_renderer_layers.js"),
    "utf8",
  );
  assert.match(layersSource, /ctx\.rotate\(rect\.rotation\)/);

  const { controller, group, marker } = createVfxAttachmentRotationHarness();
  const attachment = {
    id: "att-1",
    path: "magenta-marker.png",
    transform: { offset: { x: 0, y: 0 }, rotation: 0, scaleX: 1, scaleY: 1 },
  };
  const rotateCalls = [];
  const ctx = {
    save() {},
    restore() {},
    translate() {},
    rotate(value) {
      rotateCalls.push(value);
    },
    scale() {},
    drawImage() {},
    strokeRect() {},
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    strokeStyle: "",
    lineWidth: 1,
  };
  const layers = createLayerRenderer({
    context: ctx,
    getState: () => ({
      currentGroup: group,
      images: [{ width: 48, height: 48 }],
      view: { zoom: 1 },
      selectedAttachmentId: "",
      playing: false,
    }),
    getDevicePixelRatio: () => 1,
    drawableFrameAttachments: (_index, layer) => (layer === "above" ? [attachment] : []),
    frameImageAttachmentScreenRect: (...args) => controller.frameImageAttachmentScreenRect(...args),
    frameScreenRect: () => ({ originX: 0, originY: 0, width: 48, height: 48 }),
    frameTransform: () => ({ scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 }),
    renderTransformForGroup: (transform) => transform,
    runtimeBaseScaleForGroup: () => 1,
    cloneVector: (value) => ({ x: Number(value?.x || 0), y: Number(value?.y || 0) }),
    valueStore: () => ({}),
  });
  layers.drawCompositeFrame(0, 1, false);
  assert.ok(rotateCalls.length >= 1, "layer renderer must rotate the attachment");
  assert.ok(
    rotateCalls.some((value) => Math.abs(value - Math.PI / 2) < 1e-6),
    `ctx.rotate must use rect.rotation ~pi/2, got ${rotateCalls.join(",")}`,
  );
  assert.equal(marker.width, 40);
});

test("live owner rotation still honors flipH and an explicit per-frame rotation override", () => {
  const flipped = createVfxAttachmentRotationHarness({ flipH: true });
  const flippedRect = flipped.controller.frameImageAttachmentScreenRect({
    path: "magenta-marker.png",
    transform: { offset: { x: 10, y: 0 }, rotation: 0, scaleX: 1, scaleY: 1 },
  });
  assert.equal(flippedRect.flipH, true);
  assert.ok(
    Math.abs(flippedRect.rotation + Math.PI / 2) < 1e-6,
    `flipH must mirror owner rotation, got ${flippedRect.rotation}`,
  );

  const overridden = createVfxAttachmentRotationHarness({
    groupRotation: 90,
    frameOverride: { rotation: 15, visual_size: 1, offset: { x: 0, y: 0 } },
  });
  const owner = overridden.frameEdit.frameTransform(0, overridden.group);
  assert.ok(
    Math.abs(owner.rotation - 105) < 1e-6,
    `per-frame 15 plus group 90 must stay on the override after the panel delta, got ${owner.rotation}`,
  );
});
