const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_reference_frame");

function createFixture() {
  const group = { uiId: "attack" };
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
