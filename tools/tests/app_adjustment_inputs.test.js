"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  compactDisplayedNumber,
  createController,
  isIncompleteNumberInput,
  sanitizeAdjustmentNumberInput,
} = require("../animation_tuner/public/app_adjustment_inputs");

/** Creates the minimal adjustment panel fixture used by the controller test. */
function createElements() {
  const input = (id, value = "") => ({ id, value, step: "1", disabled: false, dataset: {} });
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
    clearGroup: { hidden: true, disabled: false },
    clearFrame: { hidden: true, disabled: false },
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
  assert.equal(elements.clearGroup.hidden, false);
  assert.equal(elements.clearFrame.hidden, true);
  controller.stepAdjustmentInput(elements.baseScale, 1, 2);
  assert.equal(elements.baseScale.value, 3);
  assert.equal(elements.baseScaleX.value, 3);
  assert.equal(elements.baseScaleY.value, 3);
  assert.equal(adjustmentUpdates, 1);
});

/**
 * Builds a group-scope controller whose apply path writes the full transform
 * the way the workbench does after a stepper click.
 * @param {ReturnType<typeof createElements>} elements Panel fixture.
 * @param {{offset?:{x:number,y:number}}} [store] Live transform store.
 * @returns {{controller:object,store:object,applied:object[]}} Controller and apply log.
 */
function createSteppingController(elements, store = { offset: { x: 0, y: 0 } }) {
  const applied = [];
  const body = { dataset: {} };
  const transform = () => ({
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    offset: { x: store.offset.x, y: store.offset.y },
    rotation: 0,
  });
  const controller = createController({
    elements,
    adjustmentModes: ["group"],
    getAdjustmentMode: () => "group",
    getCurrentGroup: () => ({ uiId: "group-1" }),
    canEditGroupTransform: () => true,
    groupSupports: () => true,
    baseTransform: transform,
    frameTransform: transform,
    characterTransform: transform,
    framePlayback: () => ({ disabled: false }),
    frameDurationMs: () => 100,
    groupPlaybackFps: () => 12,
    groupRootMotion: () => ({ x: 0, y: 0 }),
    updateAdjustmentFromInputs: (editedInput) => {
      const next = controller.transformFromAdjustmentInputs(editedInput);
      store.offset = { x: next.offset.x, y: next.offset.y };
      applied.push({ offset: { ...store.offset }, editedInput: editedInput?.id || null });
    },
    pushUndo: () => {},
    createBoxEditSnapshot: () => ({}),
    overrideStore: () => ({}),
    cloneValue: (value) => JSON.parse(JSON.stringify(value)),
    round: (value) => value,
    documentRef: {
      body,
      querySelector: (selector) => {
        const id = String(selector || "").replace(/^#/, "");
        return Object.values(elements).find((element) => element?.id === id) || null;
      },
      querySelectorAll: () => [],
    },
    localStorageRef: { setItem() {} },
  });
  return { controller, store, applied, body };
}

test("incrementing offset.x does not change offset.y", () => {
  const elements = createElements();
  elements.baseX.value = "0";
  elements.baseY.value = "0";
  const { controller, store, applied } = createSteppingController(elements, { offset: { x: 0, y: 0 } });

  controller.stepAdjustmentInput(elements.baseX, 1);

  assert.equal(store.offset.x, 1);
  assert.equal(store.offset.y, 0);
  assert.equal(Number(elements.baseY.value), 0);
  assert.equal(applied.at(-1).offset.y, 0);
});

test("incrementing offset.x does not commit a stale or cross-written offset.y", () => {
  const elements = createElements();
  elements.baseX.value = "0";
  elements.baseY.value = "-1";
  const { controller, store } = createSteppingController(elements, { offset: { x: 0, y: 0 } });

  controller.stepAdjustmentInput(elements.baseX, 1);

  assert.equal(store.offset.x, 1);
  assert.equal(store.offset.y, 0, "shared stepper / sibling field must not cross-write Y");
  assert.equal(Number(elements.baseY.value), 0);
});

test("incrementing offset.y does not change offset.x", () => {
  const elements = createElements();
  elements.baseX.value = "4";
  elements.baseY.value = "0";
  const { controller, store } = createSteppingController(elements, { offset: { x: 4, y: 0 } });

  controller.stepAdjustmentInput(elements.baseY, 1);

  assert.equal(store.offset.x, 4);
  assert.equal(store.offset.y, 1);
  assert.equal(Number(elements.baseX.value), 4);
});

test("committing one position field after a tab hide does not nudge the other axis", () => {
  const elements = createElements();
  elements.baseX.value = "2";
  elements.baseY.value = "1";
  const { controller, store } = createSteppingController(elements, { offset: { x: 2, y: 0 } });

  controller.commitAdjustmentField(elements.baseX);

  assert.equal(store.offset.x, 2);
  assert.equal(store.offset.y, 0, "blur/tab apply must not read a stale Y");
  assert.equal(Number(elements.baseY.value), 0);
});

test("one stepper activation applies exactly one step, not ±2", () => {
  const elements = createElements();
  elements.baseX.value = "0";
  elements.baseY.value = "0";
  const { controller, store } = createSteppingController(elements, { offset: { x: 0, y: 0 } });
  const button = { dataset: { stepTarget: "baseX", stepDir: "1" } };

  assert.equal(controller.handleAdjustmentStepClick(button), true);
  assert.equal(
    controller.handleAdjustmentStepClick(button),
    false,
    "label/queued second click must not step again",
  );
  assert.equal(store.offset.x, 1);
  assert.equal(store.offset.y, 0);

  controller.endAdjustmentStepActivation(button);
  assert.equal(controller.handleAdjustmentStepClick(button), true);
  assert.equal(store.offset.x, 2);
  assert.equal(store.offset.y, 0);
});

test("a guarded stepper click after a tab switch does not mutate offset", () => {
  const elements = createElements();
  elements.baseX.value = "0";
  elements.baseY.value = "0";
  const { controller, store } = createSteppingController(elements, { offset: { x: 0, y: 0 } });
  const button = { dataset: { stepTarget: "baseY", stepDir: "-1" } };

  controller.beginWorkbenchClickGuard();
  assert.equal(controller.handleAdjustmentStepClick(button), false);
  assert.deepEqual(store.offset, { x: 0, y: 0 });

  controller.endWorkbenchClickGuard();
  assert.equal(controller.handleAdjustmentStepClick(button), true);
  assert.deepEqual(store.offset, { x: 0, y: -1 });
});

test("releasing an unedited field after a tab hide restores store Y instead of committing -1", () => {
  const elements = createElements();
  elements.baseX.value = "0";
  elements.baseY.value = "-1";
  const { controller, store, applied } = createSteppingController(elements, { offset: { x: 0, y: 0 } });

  controller.releaseAdjustmentField(elements.baseY);

  assert.equal(store.offset.x, 0);
  assert.equal(store.offset.y, 0, "hide/show must not persist a glitched Y");
  assert.equal(Number(elements.baseY.value), 0);
  assert.equal(applied.length, 0);
});

test("position stepper commits an undo snapshot before applying the offset", () => {
  const elements = createElements();
  const undoLabels = [];
  const controller = createController({
    elements,
    adjustmentModes: ["group"],
    getAdjustmentMode: () => "group",
    getCurrentGroup: () => ({ uiId: "group-1" }),
    canEditGroupTransform: () => true,
    groupSupports: () => true,
    baseTransform: () => ({ scale: 1, scaleX: 1, scaleY: 1, offset: { x: 4, y: 0 }, rotation: 0 }),
    frameTransform: () => ({ scale: 1, scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 }),
    characterTransform: () => ({ scale: 1, scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 }),
    framePlayback: () => ({ disabled: false }),
    frameDurationMs: () => 100,
    groupPlaybackFps: () => 12,
    groupRootMotion: () => ({ x: 0, y: 0 }),
    canEditFramePlayback: () => true,
    canUseReferenceFrame: () => true,
    syncGroupTimeInputs: () => {},
    updateCanvasTitle: () => {},
    updateWorkbenchHud: () => {},
    syncBoxInputs: () => {},
    syncFrameAudioInputs: () => {},
    updateAdjustmentFromInputs: () => {},
    pushUndo: (label) => {
      undoLabels.push(label);
    },
    createBoxEditSnapshot: () => ({}),
    overrideStore: () => ({}),
    cloneValue: (value) => JSON.parse(JSON.stringify(value)),
    round: (value) => value,
    documentRef: { querySelectorAll: () => [] },
    localStorageRef: { setItem() {} },
  });

  controller.stepAdjustmentInput(elements.baseX, 1);
  controller.stepAdjustmentInput(elements.baseX, 1);
  assert.deepEqual(undoLabels, ["adjustment step", "adjustment step"]);
  assert.equal(elements.baseX.value, 5);
});

test("adjustment inputs keep the last valid number when the field is empty or invalid", () => {
  const elements = createElements();
  elements.baseScale.value = "-";
  elements.baseX.value = "";
  elements.baseRotation.value = "abc";
  const controller = createController({
    elements,
    adjustmentModes: ["group"],
    getAdjustmentMode: () => "group",
    getCurrentGroup: () => ({ uiId: "group-1" }),
    canEditGroupTransform: () => true,
    groupSupports: () => true,
    baseTransform: () => ({ scale: 1.5, scaleX: 1.5, scaleY: 1.5, offset: { x: 8, y: 9 }, rotation: 12 }),
    frameTransform: () => ({ scale: 1, scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 }),
    characterTransform: () => ({ scale: 1, scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 }),
    framePlayback: () => ({ disabled: false }),
    frameDurationMs: () => 100,
    groupPlaybackFps: () => 12,
    groupRootMotion: () => ({ x: 0, y: 0 }),
    canEditFramePlayback: () => true,
    canUseReferenceFrame: () => true,
    syncGroupTimeInputs: () => {},
    updateCanvasTitle: () => {},
    updateWorkbenchHud: () => {},
    syncBoxInputs: () => {},
    syncFrameAudioInputs: () => {},
    updateAdjustmentFromInputs: () => {},
    pushUndo: () => {},
    createBoxEditSnapshot: () => ({}),
    overrideStore: () => ({}),
    cloneValue: (value) => JSON.parse(JSON.stringify(value)),
    round: (value) => value,
    documentRef: { querySelectorAll: () => [] },
    localStorageRef: { setItem() {} },
  });

  assert.equal(controller.isIncompleteNumberInput("-"), true);
  assert.equal(controller.isIncompleteNumberInput("1."), true);
  assert.deepEqual(controller.transformFromAdjustmentInputs(), {
    scale: 1.5,
    scaleX: 2,
    scaleY: 2,
    offset: { x: 8, y: 4 },
    rotation: 12,
  });
});

/**
 * Simulates typing into a focused number field that still shows the origin,
 * including the FAIL path where the browser appends instead of replacing.
 * @param {string} origin Displayed value at focus time.
 * @param {string} typed Keys the user presses.
 * @returns {string[]} Display after each keystroke.
 */
function typeAdjustmentNumber(origin, typed) {
  let value = String(origin);
  const steps = [];
  for (let index = 0; index < typed.length; index += 1) {
    value = sanitizeAdjustmentNumberInput(origin, `${value}${typed[index]}`, {
      firstEdit: index === 0,
    });
    steps.push(value);
  }
  return steps;
}

test("SAV-014 sanitizer turns a 1.000 field + typed 1.5 into 1.5, never 11.5", () => {
  assert.equal(compactDisplayedNumber("1.000"), "1");
  assert.equal(sanitizeAdjustmentNumberInput("1.000", "1.5"), "1.5");
  assert.equal(sanitizeAdjustmentNumberInput("1", "1.5"), "1.5");
  assert.equal(sanitizeAdjustmentNumberInput("1.000", "11.5", { firstEdit: true }), "1.5");
  assert.equal(sanitizeAdjustmentNumberInput("1", "11.5", { firstEdit: true }), "1.5");
  assert.deepEqual(typeAdjustmentNumber("1", "1.5"), ["1", "1.", "1.5"]);
  assert.deepEqual(typeAdjustmentNumber("1.000", "1.5"), ["1", "1.", "1.5"]);
  assert.equal(typeAdjustmentNumber("1", "1.5").includes("11.5"), false);
});

test("SAV-014 sanitizer keeps the leading 1 while typing 1.500", () => {
  const steps = typeAdjustmentNumber("1.000", "1.500");
  assert.deepEqual(steps, ["1", "1.", "1.5", "1.50", "1.500"]);
  for (const step of steps) {
    assert.equal(step.startsWith("1"), true, `lost leading 1 at ${step}`);
    assert.notEqual(step, ".500");
    assert.notEqual(step, "11.5");
  }
  assert.equal(sanitizeAdjustmentNumberInput("1.000", "1.500"), "1.500");
  assert.equal(sanitizeAdjustmentNumberInput("1", "1.500"), "1.500");
  assert.equal(isIncompleteNumberInput("1.500"), false);
});

test("SAV-014 sanitizer unwraps concat on other transform number fields", () => {
  assert.equal(sanitizeAdjustmentNumberInput("0", "01.5", { firstEdit: true }), "1.5");
  assert.equal(sanitizeAdjustmentNumberInput("0", "1.5"), "1.5");
  assert.equal(sanitizeAdjustmentNumberInput("-12", "-12.5"), "-12.5");
  assert.equal(sanitizeAdjustmentNumberInput("0", "10", { firstEdit: true }), "10");
  assert.deepEqual(typeAdjustmentNumber("0", "1.5"), ["1", "1.", "1.5"]);
  assert.deepEqual(typeAdjustmentNumber("90", "1.5"), ["1", "1.", "1.5"]);
});

test("focused adjustment input keeps typed 1.5 after the first appended keystroke", () => {
  const elements = createElements();
  elements.baseScale.value = "1.000";
  elements.baseScale.dataset = {};
  const controller = createController({
    elements,
    adjustmentModes: ["group"],
    getAdjustmentMode: () => "group",
    getCurrentGroup: () => ({ uiId: "group-1" }),
    canEditGroupTransform: () => true,
    groupSupports: () => true,
    baseTransform: () => ({ scale: 1, scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 }),
    frameTransform: () => ({ scale: 1, scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 }),
    characterTransform: () => ({ scale: 1, scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 }),
    framePlayback: () => ({ disabled: false }),
    frameDurationMs: () => 100,
    groupPlaybackFps: () => 12,
    groupRootMotion: () => ({ x: 0, y: 0 }),
    documentRef: { querySelectorAll: () => [] },
    localStorageRef: { setItem() {} },
    round: (value) => value,
  });

  controller.beginAdjustmentNumberEdit(elements.baseScale);
  elements.baseScale.value = "11.5";
  assert.equal(controller.applyAdjustmentNumberInput(elements.baseScale), true);
  assert.equal(elements.baseScale.value, "1.5");

  elements.baseX.value = "0";
  elements.baseX.dataset = {};
  controller.beginAdjustmentNumberEdit(elements.baseX);
  elements.baseX.value = "01.5";
  controller.applyAdjustmentNumberInput(elements.baseX);
  assert.equal(elements.baseX.value, "1.5");
});
