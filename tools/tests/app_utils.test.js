const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assetUrl,
  clampInteger,
  clampNumber,
  cloneScaleVector,
  cloneVector,
  escapeHtml,
  extractFrameCrop,
  framePreviewSrc,
  groupLabel,
  mapWithConcurrency,
  readableGroupName,
  nearlyEqual,
  round,
  scaleVectorFromTransform,
  shouldExtractFrameCrop,
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

test("group labels replace legacy UUID names with a readable alias", () => {
  assert.equal(readableGroupName("idle"), "idle");
  assert.equal(readableGroupName("91edf15f-ac7f-4af0-8ac0-bc55ddcbad61"), "Unnamed animation 91ed");
  assert.equal(
    readableGroupName("91edf15f-ac7f-4af0-8ac0-bc55ddcbad61_2", (key) =>
      key === "unnamedAnimation" ? "未命名动画" : key,
    ),
    "未命名动画 91ed-2",
  );
  assert.equal(
    groupLabel(
      { name: "91edf15f-ac7f-4af0-8ac0-bc55ddcbad61", type: "actor", profileLabel: "Hero" },
      (key) => (key === "unnamedAnimation" ? "未命名动画" : key),
    ),
    "Hero - 未命名动画 91ed",
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

test("asset URL preserves browser-session image sources", () => {
  const dataUrl = "data:image/png;base64,frame";
  const blobUrl = "blob:https://example.test/frame";

  assert.equal(assetUrl({ path: dataUrl }), dataUrl);
  assert.equal(assetUrl({ path: blobUrl }), blobUrl);
  assert.equal(
    assetUrl({ path: "/assets/texture.1234567890abcdef.png" }),
    "/assets/texture.1234567890abcdef.png",
  );
  assert.match(assetUrl({ path: "frames/idle.png" }), /^\/asset\?path=frames%2Fidle\.png&v=\d+$/);
});

function createCropDocument() {
  const draws = [];
  return {
    draws,
    documentRef: {
      createElement(tag) {
        assert.equal(tag, "canvas");
        const canvas = {
          width: 0,
          height: 0,
          getContext() {
            return {
              drawImage(...args) {
                draws.push({ canvas, args });
              },
            };
          },
        };
        return canvas;
      },
    },
  };
}

test("extractFrameCrop slices one atlas cell and skips an already-cropped image", () => {
  const atlas = { width: 8, height: 4 };
  const crop = { x: 4, y: 0, width: 4, height: 4, sheetWidth: 8, sheetHeight: 4 };
  assert.equal(shouldExtractFrameCrop(atlas, crop), true);
  assert.equal(shouldExtractFrameCrop({ width: 4, height: 4 }, crop), false);

  const { documentRef, draws } = createCropDocument();
  const cell = extractFrameCrop(atlas, crop, documentRef);
  assert.equal(cell.width, 4);
  assert.equal(cell.height, 4);
  assert.equal(draws.length, 1);
  assert.deepEqual(draws[0].args, [atlas, 4, 0, 4, 4, 0, 0, 4, 4]);

  const alreadyCropped = { width: 4, height: 4 };
  assert.equal(extractFrameCrop(alreadyCropped, crop, documentRef), alreadyCropped);
  assert.equal(draws.length, 1);
});

test("extractFrameCrop returns the original image when crop is missing", () => {
  const image = { width: 16, height: 16 };
  const { documentRef, draws } = createCropDocument();
  assert.equal(extractFrameCrop(image, null, documentRef), image);
  assert.equal(draws.length, 0);
});

test("framePreviewSrc prefers a cropped canvas data URL over the atlas asset URL", () => {
  const frame = { path: "pets/lanma-duck.webp", width: 192, height: 208 };
  const cached = {
    width: 192,
    height: 208,
    toDataURL(type) {
      assert.equal(type, "image/png");
      return "data:image/png;base64,cell";
    },
  };
  assert.equal(framePreviewSrc(frame, { cachedImage: cached, assetUrl }), "data:image/png;base64,cell");
  assert.equal(cached.__xsxbPreviewSrc, "data:image/png;base64,cell");
  cached.toDataURL = () => {
    throw new Error("preview src must be cached after the first encode");
  };
  assert.equal(framePreviewSrc(frame, { cachedImage: cached, assetUrl }), "data:image/png;base64,cell");
  assert.match(framePreviewSrc(frame, { assetUrl }), /\/asset\?path=/);
});
