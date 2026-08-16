const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_project_lifecycle");

function configResponse(config) {
  return {
    ok: true,
    async json() {
      return config;
    },
  };
}

test("project lifecycle loads config, selects the first group, and resets session state", async () => {
  const group = {
    name: "stand_attack",
    type: "animation",
    profileId: "hero",
    animationId: "idle",
    frames: [{ path: "frame-0.png" }],
  };
  const state = {
    config: null,
    selectedProjectId: "project-a",
    currentGroup: null,
    selectedFrame: 4,
    selectedFrames: new Set([4]),
    selectionAnchorFrame: 4,
    playing: true,
    images: [],
    chainImages: [],
    attachedLayerImageSets: new Map([["layer", []]]),
    imageCache: new Map([["frame-0.png", {}]]),
    elements: {
      playPause: {},
      filmstrip: {},
      canvasTitle: {},
      selectionHud: {},
      coordHud: {},
      groupSearch: {},
      groupSelect: {},
    },
  };
  const events = [];
  const storage = new Map();
  const controller = createController({
    state,
    elements: state.elements,
    fetchImpl: async () =>
      configResponse({
        activeProjectId: "project-a",
        groups: [group],
        scenes: [],
        tuning: {
          reference_frame: {
            profile_id: "hero",
            animation_id: "idle",
            frame_index: 0,
            transform: { scale: 1.5, offset: { x: 2, y: 3 }, rotation: 4 },
          },
        },
      }),
    storage: {
      getItem: (key) => storage.get(key) || "",
      setItem: (key, value) => storage.set(key, value),
    },
    windowRef: { location: { search: "" } },
    structuredCloneImpl: (value) => JSON.parse(JSON.stringify(value)),
    loadImagesBounded: async (frames) => frames.map((frame) => ({ path: frame.path })),
    restoreReferenceFrame: async (descriptor, groups, loadImages) => {
      const referenceGroup = groups.find(
        (entry) => entry.profileId === descriptor.profile_id && entry.animationId === descriptor.animation_id,
      );
      const referenceImages = await loadImages(referenceGroup.frames);
      state.referenceFrame = {
        group: referenceGroup,
        index: descriptor.frame_index,
        image: referenceImages[descriptor.frame_index],
        images: referenceImages,
        transform: descriptor.transform,
      };
      return true;
    },
    loadCompositeContextImpl: async () => events.push("composite"),
    loadFrameImageAttachmentsForGroupImpl: async () => events.push("attachments"),
    loadChainImagesImpl: async () => events.push("chain"),
    setSingleFrameSelection: (...args) => events.push(["single", ...args]),
    updateCanvasTitle: () => events.push("title"),
    renderFilmstrip: () => events.push("filmstrip"),
    onGroupSelected: (selectedGroup) => events.push(["workspace", selectedGroup.uiId]),
    status: () => {},
  });

  await controller.loadConfig();
  assert.equal(state.config.groups[0].uiId, "player:animation:stand_attack:0");
  assert.equal(state.currentGroup, group);
  assert.deepEqual(state.images, [{ path: "frame-0.png" }]);
  assert.equal(state.referenceFrame.group, group);
  assert.equal(state.referenceFrame.index, 0);
  assert.deepEqual(state.referenceFrame.transform, {
    scale: 1.5,
    offset: { x: 2, y: 3 },
    rotation: 4,
  });
  assert.deepEqual(events, [
    "composite",
    "attachments",
    ["single", 0, group],
    "chain",
    "title",
    "filmstrip",
    ["workspace", "player:animation:stand_attack:0"],
    "filmstrip",
  ]);
  assert.equal(storage.get("animationTuner.groupUiId"), group.uiId);

  controller.resetProjectSession();
  assert.equal(state.currentGroup, null);
  assert.equal(state.playing, false);
  assert.equal(state.selectedFrame, 0);
  assert.deepEqual(state.selectedFrames, new Set([0]));
  assert.equal(state.attachedLayerImageSets.size, 0);
  assert.equal(state.imageCache.size, 0);
});
