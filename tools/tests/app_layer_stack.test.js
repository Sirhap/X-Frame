const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_layer_stack");

function createFixture() {
  const group = { uiId: "attack" };
  const attachment = { id: "cape", name: "cape" };
  const attachments = [attachment];
  const controller = createController({
    getCurrentGroup: () => group,
    getFrameLayerStackItems: () => [{ type: "attachment", attachment }, { type: "main" }],
    getFrameImageAttachments: () => attachments,
    getFrameImageAttachmentKey: (index, currentGroup) => `${currentGroup.uiId}:${index}`,
    getFrameImageAttachmentMetadata: (index, currentGroup) => ({ group: currentGroup.uiId, index }),
    clampFrameIndex: (index) => Math.min(Math.max(Number(index) || 0, 0), 1),
  });
  return { controller, attachment, group };
}

test("layer stack creates stable card identities and info", () => {
  const { controller, group, attachment } = createFixture();
  const attachmentInfo = controller.layerCardInfoForAttachment(attachment, 1, group);
  const mainInfo = controller.layerCardInfoForMain(1, group);

  assert.equal(controller.layerCardKey(attachmentInfo), "attachment:cape");
  assert.equal(controller.layerCardKey(mainInfo), "main");
  assert.equal(controller.layerCardDomKey(attachmentInfo), "attack:1:attachment:cape");
  assert.deepEqual(controller.layerCardInfosForFrame(1, group).map(controller.layerCardKey), [
    "attachment:cape",
    "main",
  ]);
});

test("layer stack calculates insertion order without mutating cards", () => {
  const { controller, group, attachment } = createFixture();
  const order = controller.movedLayerCardOrder(
    { type: "attachment", attachmentId: attachment.id, groupUiId: group.uiId, frameIndex: 1 },
    2,
    group,
  );

  assert.deepEqual(order.before.map(controller.layerCardKey), ["attachment:cape", "main"]);
  assert.deepEqual(order.after.map(controller.layerCardKey), ["main", "attachment:cape"]);
});

test("layer stack persists relative order around the main frame", () => {
  const { controller, attachment, group } = createFixture();
  const main = controller.layerCardInfoForMain(0, group);
  const attachmentInfo = controller.layerCardInfoForAttachment(attachment, 0, group);

  assert.equal(controller.applyFrameLayerCardOrder(0, group, [main, attachmentInfo]), true);
  assert.equal(attachment.layerOrder, -1);
  assert.equal(attachment.layer, "below");
  assert.equal(attachment.key, "attack:0");
  assert.deepEqual(attachment.metadata, { group: "attack", index: 0 });
});
