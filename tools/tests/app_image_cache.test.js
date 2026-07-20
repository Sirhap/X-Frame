const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_image_cache");

function createFixture() {
  const imageCache = new Map();
  const imageElements = new Map();
  const opaqueRectCache = new WeakMap();
  const loadedSources = [];
  class FakeImage {
    constructor() {
      this.width = 4;
      this.height = 3;
    }

    set src(value) {
      this._src = value;
      loadedSources.push(value);
      queueMicrotask(() => this.onload?.());
    }

    get src() {
      return this._src;
    }
  }
  const controller = createController({
    getImageCache: () => imageCache,
    getImageElements: () => imageElements,
    getOpaqueRectCache: () => opaqueRectCache,
    getConfig: () => ({ groups: [{ frames: [{ path: "b.png" }, { path: "c.png" }] }], root: "/project" }),
    mapWithConcurrency: async (items, mapper) => Promise.all(items.map(mapper)),
    assetUrl: (frame) => `/assets/${frame.path}`,
    imageConstructor: FakeImage,
    preloadFrameLimit: 2,
    preloadConcurrency: 1,
  });
  return { controller, imageCache, imageElements, loadedSources, opaqueRectCache };
}

test("image cache deduplicates hash/path loads and preserves aliases", async () => {
  const { controller, imageCache, imageElements, loadedSources } = createFixture();
  const frame = { path: "hero.png", assetHash: "hash-1" };

  const [first, second] = await Promise.all([
    controller.loadImageCached(frame),
    controller.loadImageCached(frame),
  ]);

  assert.equal(first, second);
  assert.equal(imageCache.size, 1);
  assert.equal(imageElements.get("asset:hash-1"), first);
  assert.equal(imageElements.get("hero.png"), first);
  assert.deepEqual(loadedSources, ["/assets/hero.png"]);
});

test("bounded image loading preserves frame order", async () => {
  const { controller } = createFixture();
  const images = await controller.loadImagesBounded([{ path: "a.png" }, { path: "b.png" }]);

  assert.equal(images.length, 2);
  assert.deepEqual(
    images.map((image) => image.src),
    ["/assets/a.png", "/assets/b.png"],
  );
});

test("opaque rectangle scans visible alpha and caches the result", () => {
  const { controller } = createFixture();
  const image = { width: 4, height: 3 };
  const pixels = new Uint8ClampedArray(4 * 3 * 4);
  pixels[(1 * 4 + 2) * 4 + 3] = 255;
  const documentRef = {
    createElement: () => ({
      getContext: () => ({
        clearRect() {},
        drawImage() {},
        getImageData: () => ({ data: pixels, width: 4, height: 3 }),
      }),
    }),
  };
  const cachedController = createController({
    getOpaqueRectCache: () => new WeakMap(),
    documentRef,
  });
  const first = cachedController.opaqueRectForImage(image);
  const second = cachedController.opaqueRectForImage(image);

  assert.deepEqual(first, { x: 2, y: 1, width: 1, height: 1 });
  assert.deepEqual(second, first);
});
