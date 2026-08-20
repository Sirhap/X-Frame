const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_box_model");

function createFixture() {
  const currentGroup = {
    uiId: "attack",
    name: "stand_attack",
    type: "actor",
    profileId: "hero",
    frames: [{}, {}],
  };
  const peerGroup = {
    uiId: "walk",
    name: "walk",
    type: "actor",
    profileId: "hero",
    frames: [{}],
  };
  const groups = [currentGroup, peerGroup];
  const stores = new Map(groups.map((group) => [group.uiId, {}]));
  const selectedBoxes = new Set(["hitbox"]);
  let selectedBox = "hitbox";
  let boxOnlyMode = true;
  const controller = createController({
    boxNames: ["collisionbox", "hurtbox", "hitbox"],
    getCurrentGroup: () => currentGroup,
    getConfig: () => ({ groups }),
    getSelectedFrame: () => 0,
    getSelectedBox: () => selectedBox,
    setSelectedBox: (value) => {
      selectedBox = value;
    },
    getSelectedBoxes: () => selectedBoxes,
    getBoxOnlyMode: () => boxOnlyMode,
    setBoxOnlyMode: (value) => {
      boxOnlyMode = value;
    },
    getAdjustmentMode: () => "character",
    getImages: () => [{ width: 80, height: 160 }],
    getBoxOverrideStore: (group) => stores.get(group.uiId),
    getFrameBoxKey: (index, group) => `${group.uiId}:${index}`,
    defaultHitbox: () => ({ offset: { x: 10, y: 20 }, size: { x: 30, y: 40 }, rotation: 0, enabled: true }),
    defaultCollisionBox: () => ({ offset: { x: 1, y: 2 }, size: { x: 3, y: 4 }, rotation: 0, enabled: true }),
    defaultHurtbox: (_index, _group, groupImages = []) =>
      groupImages.length
        ? { offset: { x: 0, y: -80 }, size: { x: 120, y: 160 }, rotation: 0, enabled: true }
        : { offset: { x: 0, y: 0 }, size: { x: 1, y: 1 }, rotation: 0, enabled: true },
    isCollisionBox: (boxName) => boxName === "collisionbox",
    normalizeFrameBox: (_name, box) => ({ ...box, normalized: true }),
    cloneVector: (value) => ({ x: Number(value?.x || 0), y: Number(value?.y || 0) }),
    isAttackAnimationGroup: (group) => ["stand_attack", "attack1"].includes(group.name),
    selectedFrameIndexes: () => [0],
    normalizeBoxSelectionForGroup: () => false,
  });
  return { controller, currentGroup, groups, selectedBoxes, stores, getSelectedBox: () => selectedBox };
}

test("box model resolves defaults and persisted overrides", () => {
  const { controller, currentGroup, stores } = createFixture();
  stores.get(currentGroup.uiId)["attack:0"] = {
    hitbox: { offset: { x: 50, y: 60 }, size: { x: 70, y: 80 }, enabled: false },
  };

  assert.deepEqual(controller.frameBox("hitbox", 0, currentGroup), {
    offset: { x: 50, y: 60 },
    size: { x: 70, y: 80 },
    rotation: 0,
    enabled: false,
    normalized: true,
  });
  assert.deepEqual(controller.boxOverride(0, currentGroup).hitbox.offset, { x: 50, y: 60 });
  assert.deepEqual(controller.frameBox("hurtbox", 0, currentGroup).size, { x: 120, y: 160 });
  assert.deepEqual(controller.frameBox("hurtbox", 0, currentGroup, []).size, { x: 1, y: 1 });
});

test("box model enforces editability and paired previews", () => {
  const { controller, currentGroup, getSelectedBox } = createFixture();
  assert.equal(controller.canEditBoxes(currentGroup), true);
  assert.equal(controller.canEditBox("hitbox", currentGroup), true);
  assert.equal(controller.canEditBox("unknown", currentGroup), false);
  assert.equal(controller.boxExistsOnFrame("hitbox", 0, currentGroup), true);

  const soulGroup = { name: "attack1", tuningTarget: "soul", type: "actor", frames: [{}] };
  assert.equal(controller.canEditBox("hitbox", soulGroup), true);
  assert.equal(controller.shouldPreviewPairedBox("hurtbox", soulGroup), true);
  assert.equal(getSelectedBox(), "hitbox");
});

test("box model resets unsupported selection and snapshots character scope", () => {
  const { controller, currentGroup, groups, selectedBoxes } = createFixture();
  controller.syncBoxSelectionForGroup({ name: "boss", tuningTarget: "boss", type: "actor" });
  assert.equal(selectedBoxes.size, 0);

  const scope = controller.boxScopeGroups("character");
  assert.deepEqual(scope, groups);
  assert.deepEqual(controller.boxScopeFrameIndexes("character", currentGroup), [0, 1]);
  const snapshot = controller.snapshotBoxEntriesForGroups(scope, "character");
  assert.deepEqual(Object.keys(snapshot), ["attack", "walk"]);
  assert.deepEqual(Object.keys(snapshot.attack), ["attack:0", "attack:1"]);
});
