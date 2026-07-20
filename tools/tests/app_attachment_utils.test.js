const assert = require("node:assert/strict");
const test = require("node:test");

const {
  attachmentLayerOrder,
  frameImageAttachmentClipboardItem,
  normalizeAttachmentLayerOrder,
  normalizeAttachmentTransform,
  normalizeFrameImageAttachment,
} = require("../animation_tuner/public/app_attachment_utils");

test("attachment utilities normalize transforms and signed layer order", () => {
  assert.deepEqual(
    normalizeAttachmentTransform({
      scale: 2,
      visual_scale: { x: 3, y: 4 },
      offset: { x: "5", y: null },
      rotation: "15",
    }),
    { scale: 2, scaleX: 3, scaleY: 4, offset: { x: 5, y: 0 }, rotation: 15 },
  );
  assert.equal(normalizeAttachmentLayerOrder({ layer: "below" }), -1);
  assert.equal(normalizeAttachmentLayerOrder({ layerOrder: 4 }), 4);
  assert.equal(attachmentLayerOrder({ layer: "above" }), 1);
});

test("attachment utilities normalize persisted records and clipboard payloads", () => {
  const attachment = normalizeFrameImageAttachment({
    id: "layer-1",
    frameKey: "frame-1",
    name: "spark",
    path: "assets/spark.png",
    layer: "below",
    width: "64",
    height: "32",
    transform: { scale: 1.5 },
  });

  assert.equal(attachment.id, "layer-1");
  assert.equal(attachment.key, "frame-1");
  assert.equal(attachment.layer, "below");
  assert.deepEqual(frameImageAttachmentClipboardItem(attachment), {
    name: "spark",
    path: "assets/spark.png",
    assetHash: "",
    type: "",
    width: 64,
    height: 32,
    layer: "below",
    layerOrder: -1,
    transform: {
      scale: 1.5,
      scaleX: 1.5,
      scaleY: 1.5,
      offset: { x: 0, y: 0 },
      rotation: 0,
    },
  });
});
