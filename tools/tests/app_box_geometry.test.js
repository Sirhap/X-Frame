const assert = require("node:assert/strict");
const test = require("node:test");

const {
  collisionOffsetYForHeight,
  isCollisionBox,
  normalizeFrameBox,
  pointInBoxRect,
  pointInRect,
  rotatePoint,
  transformBoxByDelta,
  transformHasDelta,
} = require("../animation_tuner/public/app_box_geometry");

test("box geometry preserves collision-box invariants", () => {
  assert.equal(isCollisionBox("collisionbox"), true);
  assert.equal(collisionOffsetYForHeight(20), -10);
  assert.deepEqual(
    normalizeFrameBox("collisionbox", {
      offset: { x: 4, y: 99 },
      size: { x: 8, y: 20 },
      rotation: 45,
    }),
    {
      offset: { x: 4, y: -10 },
      size: { x: 8, y: 20 },
      rotation: 0,
      enabled: true,
    },
  );
});

test("box geometry applies scale and rotation deltas", () => {
  assert.equal(transformHasDelta({ scale: 1 }, { scale: 2 }), true);
  const transformed = transformBoxByDelta(
    "hurtbox",
    { offset: { x: 2, y: 0 }, size: { x: 10, y: 4 }, rotation: 0 },
    { scale: 1, offset: { x: 0, y: 0 }, rotation: 0 },
    { scale: 2, offset: { x: 1, y: 3 }, rotation: 90 },
  );
  assert.ok(Math.abs(transformed.offset.x - 1) < 0.0001);
  assert.equal(transformed.offset.y, 7);
  assert.deepEqual(transformed.size, { x: 20, y: 8 });
  assert.equal(transformed.rotation, 90);
  assert.equal(transformed.enabled, true);
});

test("box geometry handles rotated point tests", () => {
  assert.deepEqual(rotatePoint({ x: 1, y: 0 }, Math.PI / 2).x.toFixed(4), "0.0000");
  assert.equal(pointInRect({ x: 5, y: 5 }, { x: 0, y: 0, width: 10, height: 10 }), true);
  assert.equal(
    pointInBoxRect(
      { x: 0, y: 5 },
      { centerX: 0, centerY: 0, halfWidth: 10, halfHeight: 2, rotation: Math.PI / 2 },
    ),
    true,
  );
});
