const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_composite_context");

test("composite context loads related groups and deduplicated attachment images", async () => {
  const owner = {
    uiId: "owner",
    tuningTarget: "player",
    name: "owner",
    frames: [{ path: "owner-0.png" }],
    previewOwner: "preview",
    attachedLayers: ["weapon"],
  };
  const preview = {
    uiId: "preview",
    tuningTarget: "player",
    name: "preview",
    frames: [{ path: "preview-0.png" }],
  };
  const weapon = {
    uiId: "weapon",
    tuningTarget: "player",
    name: "weapon",
    frames: [{ path: "weapon-0.png" }],
  };
  const state = {
    chainImages: [],
    previewOwnerGroup: null,
    previewOwnerImages: [],
    coordinateOwnerGroup: null,
    coordinateOwnerImages: [],
    attachedLayerImageSets: new Map(),
  };
  const imageLoads = [];
  const imagesLoader = {
    loadImagesBounded: async (frames) => {
      imageLoads.push(...frames.map((frame) => frame.path));
      return frames.map((frame) => ({ path: frame.path }));
    },
    loadImageCached: async (frame) => {
      imageLoads.push(frame.path);
      return { path: frame.path };
    },
  };
  const controller = createController({
    getConfig: () => ({ groups: [owner, preview, weapon] }),
    getCurrentGroup: () => owner,
    getChainImages: () => state.chainImages,
    setChainImages: (value) => {
      state.chainImages = value;
    },
    getPreviewOwnerGroup: () => state.previewOwnerGroup,
    setPreviewOwnerGroup: (value) => {
      state.previewOwnerGroup = value;
    },
    getPreviewOwnerImages: () => state.previewOwnerImages,
    setPreviewOwnerImages: (value) => {
      state.previewOwnerImages = value;
    },
    getCoordinateOwnerGroup: () => state.coordinateOwnerGroup,
    setCoordinateOwnerGroup: (value) => {
      state.coordinateOwnerGroup = value;
    },
    getCoordinateOwnerImages: () => state.coordinateOwnerImages,
    setCoordinateOwnerImages: (value) => {
      state.coordinateOwnerImages = value;
    },
    getAttachedLayerImageSets: () => state.attachedLayerImageSets,
    setAttachedLayerImageSets: (value) => {
      state.attachedLayerImageSets = value;
    },
    getPlaybackChainGroup: () => preview,
    getImagesLoader: () => imagesLoader,
    getAttachmentFrames: () => [{ path: "attachment.png" }, { path: "attachment.png" }],
    getImageCacheKey: (frame) => frame.path,
    mapWithConcurrency: async (items, mapper) => Promise.all(items.map(mapper)),
  });

  assert.equal(controller.findRelatedGroup(owner, "preview"), preview);
  await controller.loadCompositeContext(owner);
  assert.equal(state.previewOwnerGroup, preview);
  assert.equal(state.coordinateOwnerGroup, preview);
  assert.deepEqual(state.previewOwnerImages, [{ path: "preview-0.png" }]);
  assert.deepEqual([...state.attachedLayerImageSets.keys()], ["weapon"]);

  await controller.loadChainImages();
  assert.deepEqual(state.chainImages, [{ path: "preview-0.png" }]);
  await controller.loadFrameImageAttachmentsForGroup(owner);
  assert.equal(imageLoads.filter((path) => path === "attachment.png").length, 1);
});
