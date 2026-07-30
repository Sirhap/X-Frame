const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_box_transform");

function createFixture() {
  const group = { uiId: "attack", characterScale: "hero" };
  const stores = { "attack:0": { hitbox: { offset: { x: 1, y: 2 } } } };
  const events = [];
  const controller = createController({
    getCurrentGroup: () => group,
    getSelectedFrame: () => 0,
    getConfig: () => ({ groups: [group] }),
    getAdjustmentMode: () => "group",
    getBoxEditSnapshot: () => null,
    frameTransform: () => ({ scale: 2, scaleX: 2, scaleY: 3, offset: { x: 4, y: 5 }, rotation: 90 }),
    baseTransform: () => ({ scale: 1, offset: { x: 0, y: 0 }, rotation: 0 }),
    characterTransform: () => ({ scale: 2, scaleX: 2, scaleY: 2, offset: { x: 0, y: 0 }, rotation: 0 }),
    renderTransformForGroup: (transform) => transform,
    runtimeBaseScaleForGroup: () => 2,
    combatBoxFacingForGroup: () => -1,
    getBoxOverrideStore: () => stores,
    createBoxEditSnapshot: () => ({
      mode: "group",
      groupUiIds: [group.uiId],
      transforms: { attack: { scale: 1, scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 } },
      boxes: { attack: { "attack:0": { index: 0, boxes: { hitbox: { offset: { x: 1, y: 2 } } } } } },
    }),
    transformHasDelta: (before, after) => before.scale !== after.scale,
    transformBoxByDelta: (_boxName, box, _before, after) => ({
      ...box,
      offset: { x: after.offset.x, y: after.offset.y },
    }),
    rotateVector: (value, radians) => {
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      return { x: value.x * cos - value.y * sin, y: value.x * sin + value.y * cos };
    },
    markDirty: () => events.push("dirty"),
  });
  return { controller, events, group, stores };
}

test("box transform applies facing, scale, and rotation", () => {
  const { controller, group } = createFixture();
  assert.deepEqual(controller.boxAutoTransform(0, group), {
    facing: -1,
    scaleX: -4,
    scaleY: 6,
    offset: { x: -8, y: 10 },
    rotation: -Math.PI / 2,
  });
  assert.deepEqual(controller.transformForAdjustmentMode("frame", group, 0), {
    scale: 2,
    scaleX: 2,
    scaleY: 3,
    offset: { x: 4, y: 5 },
    rotation: 90,
  });
});

test("box transform converts screen movement into local coordinates", () => {
  const { controller, group } = createFixture();
  const offset = controller.boxOffsetDeltaFromScreenDelta({ x: 6, y: 0 }, 0, group);
  assert.ok(Math.abs(offset.x) < 0.000001);
  assert.ok(Math.abs(offset.y - 1) < 0.000001);
  const resize = controller.boxResizeDeltaFromScreenDelta({ x: 6, y: 0 }, 90, 0, group);
  assert.ok(Math.abs(resize.x - 1) < 0.000001);
  assert.ok(Math.abs(resize.y) < 0.000001);
});

test("box transform updates captured entries and reports changes", () => {
  const { controller, events, group, stores } = createFixture();
  const changed = controller.applyBoxTransformDelta("group", {
    scale: 2,
    scaleX: 2,
    scaleY: 2,
    offset: { x: 8, y: 9 },
    rotation: 0,
  });

  assert.equal(changed, true);
  assert.deepEqual(stores["attack:0"].hitbox.offset, { x: 16, y: 18 });
  assert.deepEqual(events, ["dirty"]);
});
