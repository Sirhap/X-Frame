const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_reference_frame");

function createFixture() {
  const group = { uiId: "attack", profileId: "hero", animationId: "slash", frames: [{}, {}] };
  const images = [{ id: "a" }, { id: "b" }];
  let selectedFrame = 1;
  let referenceFrame = null;
  const events = [];
  const controller = createController({
    getCurrentGroup: () => group,
    getSelectedFrame: () => selectedFrame,
    getImages: () => images,
    getReferenceFrame: () => referenceFrame,
    setReferenceFrame: (value) => {
      referenceFrame = value;
    },
    frameTransform: () => ({ scale: 2, offset: { x: 3, y: 4 } }),
    renderFilmstrip: () => events.push("filmstrip"),
    draw: () => events.push("draw"),
  });
  return { controller, group, images, events, getReferenceFrame: () => referenceFrame };
}

test("reference frame captures the selected image and transform", () => {
  const { controller, group, images, events, getReferenceFrame } = createFixture();
  controller.setReferenceFrameEnabled(true);
  const reference = getReferenceFrame();

  assert.equal(controller.referenceFrameIndex(group), 1);
  assert.equal(controller.isReferenceFrame(1, group), true);
  assert.equal(reference.image, images[1]);
  assert.deepEqual(reference.transform, { scale: 2, offset: { x: 3, y: 4 } });
  assert.deepEqual(events, ["filmstrip", "draw"]);
});

test("reference frame is scoped to its group and can be cleared", () => {
  const { controller, group, events } = createFixture();
  controller.setReferenceFrameEnabled(true);
  assert.equal(controller.isReferenceFrame(1, { uiId: "other" }), false);
  controller.setReferenceFrameEnabled(false);
  assert.equal(controller.referenceFrameIndex(group), null);
  assert.deepEqual(events, ["filmstrip", "draw", "filmstrip", "draw"]);
});

test("reference frame serializes stable identity and restores its frozen snapshot", async () => {
  const { controller, group, images, getReferenceFrame } = createFixture();
  controller.setReferenceFrameEnabled(true);
  const descriptor = controller.serializeReferenceFrame();
  assert.deepEqual(descriptor, {
    profile_id: "hero",
    animation_id: "slash",
    frame_index: 1,
    transform: { scale: 2, offset: { x: 3, y: 4 } },
  });

  controller.setReferenceFrameEnabled(false);
  const restored = await controller.restoreReferenceFrame(descriptor, [group], async () => images);
  assert.equal(restored, true);
  assert.equal(getReferenceFrame().group, group);
  assert.equal(getReferenceFrame().image, images[1]);
  assert.deepEqual(getReferenceFrame().transform, descriptor.transform);
});

test("reference frame rejects stale persisted identities without throwing", async () => {
  const { controller, group, getReferenceFrame } = createFixture();
  const restored = await controller.restoreReferenceFrame(
    { profile_id: "hero", animation_id: "missing", frame_index: 99, transform: {} },
    [group],
    async () => [],
  );
  assert.equal(restored, false);
  assert.equal(getReferenceFrame(), null);
});

test("TUN-021 deleting the reference frame clears the descriptor instead of retargeting", () => {
  const { controller, group, getReferenceFrame } = createFixture();
  controller.setReferenceFrameEnabled(true);
  assert.equal(controller.serializeReferenceFrame().frame_index, 1);

  controller.forgetDeletedFrames([1], group);
  assert.equal(getReferenceFrame(), null);
  assert.equal(controller.serializeReferenceFrame(), null);
});

test("TUN-021 surviving reference index remaps when earlier frames are deleted", () => {
  const { controller, group, getReferenceFrame } = createFixture();
  controller.setReferenceFrameEnabled(true);
  controller.forgetDeletedFrames([0], group);
  assert.equal(getReferenceFrame().index, 0);
  assert.equal(controller.serializeReferenceFrame().frame_index, 0);
});
