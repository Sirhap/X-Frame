const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_transform_runtime");

function createFixture() {
  const values = {
    idleScale: 0.5,
    idleScaleVector: { x: 0.6, y: 0.4 },
    idleOffset: { x: 2, y: -3 },
    idleRotation: 15,
    idleCharacterScale: 2,
    idleCharacterScaleVector: { x: 2.5, y: 1.5 },
    idleCharacterOffset: { x: 4, y: 5 },
    idleCharacterRotation: 10,
  };
  const group = {
    name: "idle",
    scale: "idleScale",
    scaleVector: "idleScaleVector",
    offset: "idleOffset",
    rotation: "idleRotation",
    characterScale: "idleCharacterScale",
    characterScaleVector: "idleCharacterScaleVector",
    characterOffset: "idleCharacterOffset",
    characterRotation: "idleCharacterRotation",
    anchorMode: "canvas_bottom_center",
    frames: [{ height: 100 }],
  };
  const controller = createController({
    getConfig: () => ({ groups: [group], references: { playerCanonicalIdleHeight: 100 } }),
    getCurrentGroup: () => group,
    getSelectedFrame: () => 0,
    getImages: () => [{ width: 80, height: 100 }],
    getValueStore: () => values,
    getActiveSceneScale: () => 1.5,
    getOpaqueRectForImage: () => ({ x: 10, y: 20, width: 60, height: 80 }),
    cloneScaleVector: (value, fallback) => value || { x: fallback, y: fallback },
    cloneVector: (value) => ({ x: Number(value?.x || 0), y: Number(value?.y || 0) }),
  });
  return { controller, group };
}

test("runtime transform keeps group and character scale axes", () => {
  const { controller, group } = createFixture();
  assert.deepEqual(controller.baseTransform(group), {
    scale: 0.5,
    scaleX: 0.6,
    scaleY: 0.4,
    visual_scale: { x: 0.6, y: 0.4 },
    offset: { x: 2, y: -3 },
    rotation: 15,
  });
  assert.deepEqual(controller.characterTransform(group), {
    scale: 2,
    scaleX: 2.5,
    scaleY: 1.5,
    visual_scale: { x: 2.5, y: 1.5 },
    offset: { x: 4, y: 5 },
    rotation: 10,
  });
  assert.deepEqual(controller.renderTransformForGroup(controller.baseTransform(group), group), {
    scale: 0.5,
    scaleX: 0.75,
    scaleY: 0.30000000000000004,
    offset: { x: 6, y: 2 },
    rotation: 25,
  });
});

test("runtime anchors choose canvas and source-anchor coordinates", () => {
  const { controller, group } = createFixture();
  assert.equal(controller.usesCanvasFootAnchor(group), true);
  assert.deepEqual(controller.targetHeightAnimationAnchorX(0, group), 40);
  assert.equal(controller.targetHeightAnimationAnchorY(0, group), 100);
  assert.equal(controller.runtimeBaseScaleForGroup(0, group), 3);
  group.sourceAnchor = { x: 17, y: 23 };
  assert.equal(controller.targetHeightAnimationAnchorX(0, group), 17);
  assert.equal(controller.targetHeightAnimationAnchorY(0, group), 23);
});

test("runtime transform falls back to manifest defaults after persisted group values are removed", () => {
  const group = {
    scale: "scale",
    scaleVector: "scaleVector",
    offset: "offset",
    rotation: "rotation",
    defaultScale: 1,
    defaultScaleVector: { x: 1.1, y: 0.9 },
    defaultOffset: { x: 3, y: 4 },
    defaultRotation: 5,
    baseScale: 2,
    baseScaleVector: { x: 2.2, y: 1.8 },
    baseOffset: { x: 30, y: 40 },
    baseRotation: 50,
  };
  const controller = createController({
    getCurrentGroup: () => group,
    getValueStore: () => ({}),
    getOpaqueRectForImage: () => ({ x: 0, y: 0, width: 1, height: 1 }),
    cloneScaleVector: (value, fallback) => value || { x: fallback, y: fallback },
    cloneVector: (value) => ({ x: Number(value?.x || 0), y: Number(value?.y || 0) }),
  });

  assert.deepEqual(controller.baseTransform(group), {
    scale: 1,
    scaleX: 1.1,
    scaleY: 0.9,
    visual_scale: { x: 1.1, y: 0.9 },
    offset: { x: 3, y: 4 },
    rotation: 5,
  });
});
