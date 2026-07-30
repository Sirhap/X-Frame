"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/app_attachment_manipulation");

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
