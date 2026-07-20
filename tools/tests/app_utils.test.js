const assert = require("node:assert/strict");
const test = require("node:test");

const {
  clampInteger,
  clampNumber,
  cloneScaleVector,
  cloneVector,
  escapeHtml,
  groupLabel,
  mapWithConcurrency,
  nearlyEqual,
  round,
  scaleVectorFromTransform,
} = require("../animation_tuner/public/app_utils");

test("app utility functions normalize values consistently", () => {
  assert.deepEqual(cloneVector({ x: "2", y: null }), { x: 2, y: 0 });
  assert.deepEqual(cloneScaleVector(null, 3), { x: 3, y: 3 });
  assert.deepEqual(scaleVectorFromTransform({ scale: 2, scaleY: 4 }), { x: 2, y: 4 });
  assert.equal(round(2.5), "2.5");
  assert.equal(clampNumber("bad", 1, 4), 1);
  assert.equal(clampNumber(9, 1, 4), 4);
  assert.equal(clampInteger(2.6, 1, 4), 3);
  assert.equal(nearlyEqual(1, 1.00005), true);
});

test("app utility functions escape HTML and label groups", () => {
  assert.equal(escapeHtml(`<img src="x">`), "&lt;img src=&quot;x&quot;&gt;");
  assert.equal(
    groupLabel({
      name: "idle",
      type: "vfx",
      profileLabel: "Hero",
      runtimeAnimation: "idle_fx",
      skillName: "skill",
      previewOwner: "body",
    }),
    "Hero VFX - idle (idle_fx) -> body",
  );
});

test("mapWithConcurrency preserves order and propagates mapper failures", async () => {
  const values = await mapWithConcurrency(
    [1, 2, 3],
    async (value) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return value * 2;
    },
    2,
  );
  assert.deepEqual(values, [2, 4, 6]);

  await assert.rejects(
    () =>
      mapWithConcurrency([1, 2], async (value) => {
        if (value === 2) throw new Error("mapper failed");
        return value;
      }),
    /mapper failed/,
  );
});
