"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/app_adjustment_inputs");

/** Creates the minimal adjustment panel fixture used by the controller test. */
function createElements() {
  const input = (id, value = "") => ({ id, value, step: "1", disabled: false });
  return {
    baseScale: input("baseScale", "2"),
    baseScaleX: input("baseScaleX", "2"),
    baseScaleY: input("baseScaleY", "2"),
    baseX: input("baseX", "3"),
    baseY: input("baseY", "4"),
    baseRotation: input("baseRotation", "5"),
    adjustCharacter: { checked: false },
    adjustGroup: { checked: false },
    adjustFrame: { checked: false },
    applyBaseToFrame: { hidden: false, disabled: false },
    characterBaseScale: input("characterBaseScale"),
    characterBaseSource: input("characterBaseSource"),
    frameScale: input("frameScale"),
    frameScaleX: input("frameScaleX"),
    frameScaleY: input("frameScaleY"),
    frameX: input("frameX"),
    frameY: input("frameY"),
    frameRotation: input("frameRotation"),
    frameDuration: input("frameDuration"),
    frameReference: { checked: false, disabled: false },
    frameDisabled: { checked: false, disabled: false, parentElement: { classList: { toggle() {} } } },
    fps: input("fps"),
    fpsValue: { textContent: "" },
    rootMotionX: input("rootMotionX"),
    rootMotionY: input("rootMotionY"),
  };
}

test("adjustment input controller preserves mode, transform, and step semantics", () => {
  const elements = createElements();
  let mode = "group";
  let adjustmentUpdates = 0;
  const controller = createController({
    elements,
    adjustmentModes: ["character", "group", "frame"],
    getAdjustmentMode: () => mode,
    setAdjustmentMode: (value) => {
      mode = value;
    },
    getCurrentGroup: () => ({ uiId: "group-1", frames: [{}, {}] }),
    getSelectedFrame: () => 0,
    canEditGroupTransform: () => true,
    canEditFrameTransform: () => false,
    groupSupports: () => true,
    baseTransform: () => ({ scale: 1, scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 }),
    frameTransform: () => ({ scale: 3, scaleX: 3, scaleY: 3, offset: { x: 1, y: 2 }, rotation: 4 }),
    characterTransform: () => ({ scale: 2, scaleX: 2, scaleY: 2, offset: { x: 5, y: 6 }, rotation: 7 }),
    framePlayback: () => ({ disabled: false }),
    frameDurationMs: () => 120,
    groupPlaybackFps: () => 12,
    groupRootMotion: () => ({ x: 8, y: 9 }),
    canEditFramePlayback: () => true,
    canUseReferenceFrame: () => true,
    syncGroupTimeInputs: () => {},
    updateCanvasTitle: () => {},
    updateWorkbenchHud: () => {},
    syncBoxInputs: () => {},
    syncFrameAudioInputs: () => {},
    updateAdjustmentFromInputs: () => {
      adjustmentUpdates += 1;
    },
    pushUndo: () => {},
    createBoxEditSnapshot: () => ({}),
    overrideStore: () => ({ key: { value: 1 } }),
    cloneValue: (value) => JSON.parse(JSON.stringify(value)),
    round: (value) => Math.round(Number(value) * 100) / 100,
    documentRef: { querySelectorAll: () => [] },
    localStorageRef: { setItem() {} },
  });

  assert.deepEqual(controller.adjustmentTransform(), {
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    offset: { x: 0, y: 0 },
    rotation: 0,
  });
  assert.deepEqual(controller.transformFromAdjustmentInputs(), {
    scale: 2,
    scaleX: 2,
    scaleY: 2,
    offset: { x: 3, y: 4 },
    rotation: 5,
  });
  controller.syncAdjustmentInputs();
  assert.equal(elements.adjustGroup.checked, true);
  assert.equal(elements.baseScale.disabled, false);
  controller.stepAdjustmentInput(elements.baseScale, 1, 2);
  assert.equal(elements.baseScale.value, 3);
  assert.equal(elements.baseScaleX.value, 3);
  assert.equal(elements.baseScaleY.value, 3);
  assert.equal(adjustmentUpdates, 1);
});
