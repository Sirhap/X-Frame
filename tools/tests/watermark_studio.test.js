"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const { HttpError } = require("../animation_tuner/server_http");
const {
  createWatermarkStudioService,
  validateJobOptions,
} = require("../animation_tuner/server_watermark_studio");

const videoUtilsPromise = import(
  pathToFileURL(path.join(__dirname, "../animation_tuner/watermark_studio/video-utils.js")).href
);
const smartLogoUtilsPromise = import(
  pathToFileURL(path.join(__dirname, "../animation_tuner/watermark_studio/smart-logo-utils.js")).href
);
const smartExportPromise = import(
  pathToFileURL(path.join(__dirname, "../animation_tuner/watermark_studio/smart-export.js")).href
);
const smartControlsPromise = fs.promises
  .readFile(path.join(__dirname, "../animation_tuner/public/watermark_smart_controls.js"), "utf8")
  .then((source) => import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`));

test("smart watermark reference time stays inside the final decodable frame", async () => {
  const { safeReferenceTime } = await smartControlsPromise;
  assert.equal(safeReferenceTime({ duration: 2, fps: 24 }), 1.95);
  assert.equal(safeReferenceTime({ duration: 20, fps: 30 }), 5);
  assert.equal(safeReferenceTime({ duration: 0.02, fps: 25 }), 0);
  assert.equal(safeReferenceTime({ duration: Number.NaN, fps: 0 }), 0);
});

test("watermark regions clamp to FFmpeg-safe video bounds", async () => {
  const { normalizeRegions } = await videoUtilsPromise;
  assert.deepEqual(
    normalizeRegions([{ x: 0, y: 0, width: 1280, height: 720, startTime: 0, endTime: 1 }], {
      width: 1280,
      height: 720,
      duration: 10,
    }),
    [{ x: 1, y: 1, width: 1278, height: 718, startTime: 0, endTime: 1 }],
  );
});

test("watermark regions reject unsafe sizes, counts, and time ranges", async () => {
  const { normalizeRegions } = await videoUtilsPromise;
  const video = { width: 1280, height: 720, duration: 10 };
  assert.throws(
    () => normalizeRegions([{ x: 10, y: 10, width: 4, height: 4, startTime: 0, endTime: 1 }], video),
    /太小/,
  );
  assert.throws(
    () => normalizeRegions([{ x: 10, y: 10, width: 20, height: 20, startTime: 6, endTime: 5 }], video),
    /生效时间/,
  );
  assert.throws(
    () =>
      normalizeRegions(
        Array.from({ length: 9 }, () => ({ x: 10, y: 10, width: 20, height: 20, startTime: 0, endTime: 1 })),
        video,
      ),
    /最多支持 8 个/,
  );
});

test("watermark delogo filter preserves deterministic region order", async () => {
  const { buildDelogoFilter } = await videoUtilsPromise;
  assert.equal(
    buildDelogoFilter([
      { x: 10, y: 20, width: 120, height: 40, startTime: 0, endTime: 3 },
      { x: 900, y: 650, width: 200, height: 50, startTime: 12.5, endTime: 18 },
    ]),
    "delogo=x=10:y=20:w=120:h=40:show=0:enable='between(t,0,3)',delogo=x=900:y=650:w=200:h=50:show=0:enable='between(t,12.5,18)'",
  );
});

test("smart watermark mask ignores saturated foreground colors", async () => {
  const { buildBrightLogoMask } = await smartLogoUtilsPromise;
  const frame = Buffer.from([20, 20, 20, 240, 240, 240, 255, 210, 20]);
  assert.deepEqual(
    Array.from(buildBrightLogoMask(frame, 3, { x: 0, y: 0, width: 3, height: 1 }, { dilationRadius: 0 })),
    [0, 1, 0],
  );
});

test("smart watermark repair diffuses neighboring pixels into a logo hole", async () => {
  const { inpaintMaskedRegion } = await smartLogoUtilsPromise;
  const frame = Buffer.from([10, 20, 30, 255, 255, 255, 30, 40, 50]);
  inpaintMaskedRegion(frame, 3, { x: 0, y: 0, width: 3, height: 1 }, Uint8Array.from([0, 1, 0]));
  assert.deepEqual(Array.from(frame), [10, 20, 30, 20, 30, 40, 30, 40, 50]);
});

test("smart watermark options sanitize title text and ignore caller font paths", async () => {
  const { normalizeSmartOptions } = await smartExportPromise;
  const options = normalizeSmartOptions(
    {
      referenceTime: 0.5,
      region: { x: 10, y: 10, width: 80, height: 30 },
      title: {
        text: "line\nvalue",
        startTime: 0.5,
        fontFile: "/tmp/untrusted.ttf",
        fontSize: 24,
        borderWidth: 2,
        x: 12,
        y: 20,
        fontColor: "#ffdf22",
      },
    },
    { width: 320, height: 180, duration: 1, fps: 25 },
  );
  assert.equal(options.title.text, "line value");
  assert.equal(options.title.fontFile, "/System/Library/Fonts/STHeiti Medium.ttc");
});

test("watermark raw uploads require local video requests", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-watermark-test-"));
  const service = createWatermarkStudioService({
    root,
    port: 5179,
    HttpError,
    send() {},
    async readJsonBody() {
      return {};
    },
  });
  try {
    assert.throws(
      () => service.validateUploadRequest({ headers: { "content-type": "text/plain" } }),
      (error) => error.status === 415,
    );
    assert.throws(
      () =>
        service.validateUploadRequest({
          headers: {
            "content-type": "video/mp4",
            host: "127.0.0.1:5179",
            origin: "https://example.com",
          },
        }),
      (error) => error.status === 403,
    );
    assert.doesNotThrow(() =>
      service.validateUploadRequest({
        headers: {
          "content-type": "video/mp4",
          host: "127.0.0.1:5179",
          origin: "http://127.0.0.1:5179",
        },
      }),
    );
  } finally {
    service.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("watermark job validation failures are reported as client errors", () => {
  assert.throws(
    () =>
      validateJobOptions(
        () => {
          throw new Error("区域太小");
        },
        {},
        {},
        HttpError,
      ),
    (error) => error.status === 400 && error.message === "区域太小",
  );
});
