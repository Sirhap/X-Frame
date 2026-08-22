const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_attachment_state");
const { attachmentMatchesFrame } = require("../animation_tuner/public/app_attachment_utils");

function createFixture() {
  const group = { frames: [{}, {}] };
  const state = {
    config: {
      frameImageAttachments: [
        { id: "keep", key: "frame:0", path: "/keep.png", layerOrder: 1 },
        { id: "drop", key: "", path: "/drop.png" },
      ],
      attachmentAssets: [{ assetHash: "hash", path: "/asset.png", name: "Asset" }],
    },
    attachments: [],
    assets: [],
    selectedAttachmentId: "missing",
    selectedFrame: 0,
  };
  const controller = createController({
    getConfig: () => state.config,
    getAttachments: () => state.attachments,
    setAttachments: (value) => {
      state.attachments = value;
    },
    getAssets: () => state.assets,
    setAssets: (value) => {
      state.assets = value;
    },
    getSelectedAttachmentId: () => state.selectedAttachmentId,
    setSelectedAttachmentId: (value) => {
      state.selectedAttachmentId = value;
    },
    getSelectedFrame: () => state.selectedFrame,
    getCurrentGroup: () => group,
    getFrameKey: (index) => `frame:${index}`,
    getFrameMetadata: (index) => ({
      projectId: "bind-test",
      profileId: "mcp_imports",
      animation: "mcp_imports/walk",
      frame: index,
    }),
    matchesFrame: attachmentMatchesFrame,
    normalizeAttachment: (raw) => ({
      ...raw,
      id: String(raw.id),
      layerOrder: Number(raw.layerOrder || 1),
    }),
    newLocalId: (prefix) => `${prefix}:generated`,
    attachmentLayerOrder: (attachment) => Number(attachment.layerOrder || 0),
    selectedFrameIndexes: () => [state.selectedFrame],
    clampFrameIndex: (index, currentGroup) => Math.max(0, Math.min(index, currentGroup.frames.length - 1)),
  });
  return { controller, group, state };
}

test("attachment state loads valid records and reusable assets", () => {
  const { controller, state } = createFixture();

  controller.loadFromProject();
  controller.loadAssetsFromProject();

  assert.deepEqual(state.attachments, [{ id: "keep", key: "frame:0", path: "/keep.png", layerOrder: 1 }]);
  assert.equal(state.selectedAttachmentId, "");
  assert.deepEqual(state.assets, [
    {
      id: "hash",
      name: "Asset",
      path: "/asset.png",
      assetHash: "hash",
      type: "image/png",
      width: 0,
      height: 0,
      groupKey: "",
    },
  ]);
});

test("attachment state orders layers around the main frame", () => {
  const { controller, group, state } = createFixture();
  state.attachments = [
    { id: "below-2", key: "frame:0", layerOrder: -2 },
    { id: "above-2", key: "frame:0", layerOrder: 2 },
    { id: "above-1", key: "frame:0", layerOrder: 1 },
    { id: "below-1", key: "frame:0", layerOrder: -1 },
  ];

  assert.deepEqual(
    controller.layerStackItems(0, group).map((entry) => entry.id),
    ["above-2", "above-1", "main", "below-1", "below-2"],
  );
  assert.deepEqual(
    controller.drawableForFrame(0, "above", group).map((attachment) => attachment.id),
    ["above-1", "above-2"],
  );
  assert.equal(controller.nextAboveLayerOrder(0, group), 3);
});

test("attachment state resolves direct manipulation and metadata frame indexes", () => {
  const { controller, group, state } = createFixture();
  state.attachments = [{ id: "selected", key: "frame:1", metadata: { displayFrame: 1 }, layerOrder: 1 }];
  state.selectedAttachmentId = "selected";
  state.selectedFrame = 1;

  assert.equal(controller.selectedAttachment().id, "selected");
  assert.equal(controller.attachmentFrameIndex(state.attachments[0], group), 1);
  assert.equal(controller.directManipulationAttachment().id, "selected");
});

test("attachment state matches a metadata-owned legacy key and upgrades it for the workbench", () => {
  const { controller, group, state } = createFixture();
  state.attachments = [
    {
      id: "legacy-sword",
      key: "mcp_imports/walk:1",
      metadata: {
        projectId: "bind-test",
        profileId: "mcp_imports",
        animation: "mcp_imports/walk",
        frame: 1,
      },
      layerOrder: 1,
    },
  ];

  const matched = controller.forFrame(1, group);

  assert.equal(matched.length, 1);
  assert.equal(matched[0].key, "frame:1");
  assert.equal(matched[0].frameKey, "frame:1");
});
