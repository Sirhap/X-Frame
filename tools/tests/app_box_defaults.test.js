const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_box_defaults");

function cloneVector(value, fallback = { x: 0, y: 0 }) {
  return {
    x: Number(value?.x ?? fallback.x),
    y: Number(value?.y ?? fallback.y),
  };
}

function createFixture() {
  const playbackOverrides = new Map();
  const config = {
    references: {
      playerHurtboxOffset: { x: 1, y: 2 },
      playerHurtboxSize: { x: 10, y: 20 },
      crouchHurtboxOffset: { x: 3, y: 4 },
      crouchHurtboxSize: { x: 11, y: 21 },
      soulParryHitboxOffset: { x: 30, y: -40 },
      soulParryHitboxSize: { x: 50, y: 60 },
    },
    tuningDefaults: { stand_attack_hitbox_offset: { x: 70, y: 5 } },
  };
  const controller = createController({
    getCurrentGroup: () => null,
    getSelectedFrame: () => 0,
    getValues: () => ({}),
    getConfig: () => config,
    framePlayback: (index, group) => playbackOverrides.get(`${group.name}:${index}`) || { disabled: false },
    cloneVector,
    clampNumber: (value, min, max) => Math.min(Math.max(Number(value), min), max),
    collisionOffsetYForHeight: (height) => -height / 2,
    normalizeFrameBox: (_name, box) => ({ ...box, normalized: true }),
    usesCanvasFootAnchor: (group) => group.anchorMode === "canvas_bottom_center",
    sourceBodyCenterForBox: () => ({ x: 4, y: -8, rect: { x: 0, y: 0, width: 100, height: 200 } }),
    sourceAnchorForBox: () => ({ x: 50, y: 200 }),
  });
  return { controller, config, playbackOverrides };
}

test("box defaults classify attack and non-attack groups", () => {
  const { controller } = createFixture();

  assert.equal(controller.isAttackAnimationGroup({ name: "stand_attack" }), true);
  assert.equal(controller.isAttackAnimationGroup({ name: "idle" }), false);
  assert.equal(controller.isAttackAnimationGroup({ name: "idle", hasHitbox: true }), true);
  assert.equal(controller.isAttackAnimationGroup({ name: "slash", hasHitbox: false }), false);
  assert.equal(controller.isNonAttackAnimationGroup({ name: "walk_forward" }), true);
});

test("box defaults select configured Soul hitboxes and playable guard ranges", () => {
  const { controller, playbackOverrides } = createFixture();
  const group = { name: "parry3", tuningTarget: "soul", type: "actor", frames: Array(7).fill({}) };
  playbackOverrides.set("parry3:2", { disabled: true });

  assert.deepEqual(controller.defaultSoulHitbox(group), {
    offset: { x: 30, y: -40 },
    size: { x: 50, y: 60 },
    rotation: 0,
  });
  assert.deepEqual(controller.soulRawParryGuardFrameRange(group), { start: 2, end: 6 });
  assert.deepEqual(controller.soulParryGuardFrameRange(group), { start: 3, end: 6 });
  assert.equal(controller.soulHitboxActiveByDefault(2, group), false);
  assert.equal(controller.soulHitboxActiveByDefault(4, group), true);
});

test("box defaults derive generic boxes from the frame body", () => {
  const { controller } = createFixture();
  const group = { name: "stand_attack", anchorMode: "canvas_bottom_center", frames: [{}] };

  assert.deepEqual(controller.defaultHitboxOffset(group), { x: 70, y: 5 });
  assert.deepEqual(controller.defaultHurtbox(0, group), {
    offset: { x: 4, y: -8 },
    size: { x: 88, y: 164 },
    rotation: 0,
    enabled: true,
  });
  assert.deepEqual(controller.defaultCollisionBox(0, group), {
    offset: { x: 4, y: -88 },
    size: { x: 42, y: 176 },
    rotation: 0,
    enabled: true,
    normalized: true,
  });
});
