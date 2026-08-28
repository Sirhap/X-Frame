"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController: createRenderer } = require("../animation_tuner/public/app_canvas_renderer");
const { createController } = require("../animation_tuner/public/app_attack_trail_mapping");

function identityTransform() {
  return { scale: 1, scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 };
}

function frameTransform(index) {
  if (index === 0) return identityTransform();
  return { scale: 2, scaleX: 2, scaleY: 2, offset: { x: 30, y: -20 }, rotation: 0 };
}

function runtimeBaseScaleForGroup(index) {
  return index === 0 ? 1 : 2;
}

function mapLocalWithFrame(renderer, point, frameIndex, group, images) {
  const transform = frameTransform(frameIndex);
  const rect = renderer.frameScreenRect(frameIndex, group, images, { transform });
  const runtimeScale = runtimeBaseScaleForGroup(frameIndex);
  const scaleX = runtimeScale * transform.scaleX;
  const scaleY = runtimeScale * transform.scaleY;
  return {
    x: rect.originX + Number(point.x) * scaleX,
    y: rect.originY + Number(point.y) * scaleY,
    rect,
  };
}

test("attack trail mapping uses the selected frame transform instead of frame 0", () => {
  const images = [
    { width: 20, height: 40 },
    { width: 80, height: 10 },
  ];
  const group = { uiId: "slash", type: "animation", frames: images };
  const renderer = createRenderer({
    context: {},
    elements: { stage: { width: 400, height: 400 } },
    getState: () => ({
      view: { zoom: 1 },
      currentGroup: group,
      images,
      selectedFrame: 1,
    }),
    frameTransform,
    renderTransformForGroup: (transform) => transform,
    runtimeBaseScaleForGroup,
    groupOriginScreen: () => ({ x: 100, y: 200 }),
    usesRuntimeFootAnchor: () => false,
    usesSceneTopLeftAnchor: () => false,
    getDevicePixelRatio: () => 1,
  });
  const controller = createController({
    getCurrentGroup: () => group,
    getImages: () => images,
    getSelectedFrame: () => 1,
    getView: () => ({ zoom: 1 }),
    getDevicePixelRatio: () => 1,
    frameTransform,
    baseTransform: () => identityTransform(),
    frameScreenRect: (...args) => renderer.frameScreenRect(...args),
    renderTransformForGroup: (transform) => transform,
    runtimeBaseScaleForGroup,
    effectiveFlipH: () => false,
  });

  const localPoint = { x: 10, y: 0 };
  const onFrame0 = mapLocalWithFrame(renderer, localPoint, 0, group, images);
  const onFrame1 = mapLocalWithFrame(renderer, localPoint, 1, group, images);
  const screen = controller.attackTrailLocalToScreen(localPoint, group, images);

  assert.deepEqual(screen, { x: onFrame1.x, y: onFrame1.y });
  assert.notDeepEqual(screen, { x: onFrame0.x, y: onFrame0.y });

  const roundTrip = controller.attackTrailScreenToLocal(screen, group, images);
  assert.ok(Math.abs(roundTrip.x - localPoint.x) < 1e-6, `round-trip x: ${roundTrip.x}`);
  assert.ok(Math.abs(roundTrip.y - localPoint.y) < 1e-6, `round-trip y: ${roundTrip.y}`);
});
