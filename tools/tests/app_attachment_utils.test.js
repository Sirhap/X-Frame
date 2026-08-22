const assert = require("node:assert/strict");
const test = require("node:test");

const {
  attachmentLayerOrder,
  attachmentMatchesFrame,
  canonicalAttachmentFrameKey,
  frameImageAttachmentClipboardItem,
  normalizeAttachmentLayerOrder,
  normalizeAttachmentTransform,
  normalizeFrameImageAttachment,
} = require("../animation_tuner/public/app_attachment_utils");

test("attachment identity uses the workbench frame key and accepts metadata-backed legacy keys", () => {
  const identity = {
    projectId: "bind-test",
    tuningTarget: "player",
    profileId: "mcp_imports",
    groupType: "actor",
    groupName: "walk",
    animation: "mcp_imports/walk",
    source: "workspace/projects/bind-test/assets/mcp_imports/walk",
    frame: 1,
  };
  const key =
    "bind-test:player:mcp_imports:actor:walk:workspace/projects/bind-test/assets/mcp_imports/walk:1";

  assert.equal(canonicalAttachmentFrameKey(identity), key);
  assert.equal(attachmentMatchesFrame({ key }, key, identity), true);
  assert.equal(
    attachmentMatchesFrame(
      {
        key: "mcp_imports/walk:1",
        metadata: {
          projectId: "bind-test",
          profileId: "mcp_imports",
          animation: "mcp_imports/walk",
          frame: 1,
        },
      },
      key,
      identity,
    ),
    true,
  );
  assert.equal(
    attachmentMatchesFrame(
      { key: "mcp_imports/walk:0", metadata: { animation: "mcp_imports/walk", frame: 0 } },
      key,
      identity,
    ),
    false,
  );
});

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
