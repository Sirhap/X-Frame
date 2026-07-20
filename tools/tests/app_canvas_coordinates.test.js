const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_canvas_coordinates");

function createFixture() {
  const view = { x: 10, y: 20, zoom: 2 };
  const group = { type: "character" };
  const config = { references: { playerFloorTopOffsetY: 30, bossFloorTopOffsetY: 50 } };
  const controller = createController({
    getCurrentGroup: () => group,
    getSelectedFrame: () => 0,
    getImages: () => [],
    getView: () => view,
    getDevicePixelRatio: () => 2,
    getConfig: () => config,
    runtimeBaseScaleForGroup: () => 3,
  });
  return { controller, group };
}

test("canvas coordinates convert runtime units using view and runtime scale", () => {
  const { controller, group } = createFixture();
  assert.equal(controller.coordinateScreenScale(0, group), 12);
  assert.deepEqual(controller.groupOriginScreen(0, group), { x: 10, y: 20 });
  assert.deepEqual(controller.coordinateToScreen({ x: 2, y: -1 }, 0, group), { x: 34, y: 8 });
  assert.deepEqual(controller.screenToCoordinate({ x: 34, y: 8 }, 0, group), { x: 2, y: -1 });
});

test("canvas coordinates apply floor alignment by group type", () => {
  const { controller, group } = createFixture();
  const boss = { tuningTarget: "boss", type: "actor" };
  assert.equal(controller.floorReferenceLabel(group), "Floor top");
  assert.equal(controller.floorReferenceLabel({ tuningTarget: "soul" }), "Soul runtime floor");
  assert.equal(controller.floorTopReferenceOffset(0, group), 30);
  assert.equal(controller.floorTopReferenceOffset(0, boss), 50);
  assert.equal(controller.floorAlignmentDelta(0, boss), -20);
  assert.deepEqual(controller.groupOriginScreen(0, boss, [], true), { x: 10, y: -60 });
});

test("canvas coordinates choose readable grid intervals", () => {
  const { controller } = createFixture();
  assert.equal(controller.coordinateGridStep(1), 200);
  assert.equal(controller.coordinateGridStep(100), 2);
});
