const assert = require("node:assert/strict");
const test = require("node:test");

const {
  BOX_MIN_SIZE,
  BOX_NUDGE_STEP,
  collisionOffsetYForHeight,
  isCollisionBox,
  normalizeFrameBox,
  nudgeFrameBox,
  pointInBoxRect,
  pointInRect,
  resizeFrameBox,
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

test("keyboard nudge moves only x/y by the exported step", () => {
  const box = { offset: { x: 8, y: -4 }, size: { x: 12, y: 16 }, rotation: 0, enabled: true };
  assert.equal(BOX_NUDGE_STEP, 1);
  assert.deepEqual(nudgeFrameBox("hurtbox", box, BOX_NUDGE_STEP, 0).offset, { x: 9, y: -4 });
  assert.deepEqual(nudgeFrameBox("hurtbox", box, 0, -BOX_NUDGE_STEP).offset, { x: 8, y: -5 });
  assert.deepEqual(nudgeFrameBox("hurtbox", box, BOX_NUDGE_STEP, -BOX_NUDGE_STEP).size, box.size);
});

test("shrinking a handle cannot produce width or height below 1 or non-finite values", () => {
  const box = { offset: { x: 10, y: 20 }, size: { x: 40, y: 30 }, rotation: 0, enabled: true };
  const squeezed = resizeFrameBox("hurtbox", box, "e", { x: -400, y: 50 });
  assert.equal(squeezed.size.x, BOX_MIN_SIZE);
  assert.equal(squeezed.size.y, 30);
  assert.ok(Number.isFinite(squeezed.offset.x));
  assert.ok(Number.isFinite(squeezed.offset.y));
  assert.ok(Number.isFinite(squeezed.size.x));
  assert.ok(Number.isFinite(squeezed.size.y));
  assert.ok(squeezed.size.x >= BOX_MIN_SIZE);
  assert.ok(squeezed.size.y >= BOX_MIN_SIZE);

  const poisoned = resizeFrameBox(
    "hurtbox",
    { offset: { x: Number.NaN, y: Number.POSITIVE_INFINITY }, size: { x: Number.NaN, y: 0 } },
    "se",
    { x: Number.NaN, y: Number.POSITIVE_INFINITY },
  );
  assert.ok(Number.isFinite(poisoned.offset.x));
  assert.ok(Number.isFinite(poisoned.offset.y));
  assert.ok(Number.isFinite(poisoned.size.x));
  assert.ok(Number.isFinite(poisoned.size.y));
  assert.ok(poisoned.size.x >= BOX_MIN_SIZE);
  assert.ok(poisoned.size.y >= BOX_MIN_SIZE);

  const fromRight = resizeFrameBox("hurtbox", box, "e", { x: -12, y: 0 });
  assert.equal(fromRight.size.x, 28);
  assert.ok(Math.abs(fromRight.offset.x - 4) < 0.0001);
  assert.equal(fromRight.offset.y, 20);
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
