const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_box_selection");

function createFixture(initial = ["hurtbox", "hitbox"]) {
  const selectedBoxes = new Set(initial);
  let selectedBox = initial[0] || "";
  const values = new Map();
  const controller = createController({
    boxNames: ["hurtbox", "hitbox", "collisionbox"],
    boxPrefKeys: { show: "show", only: "only", selected: "selected", checked: "checked" },
    getSelectedBoxes: () => selectedBoxes,
    getSelectedBox: () => selectedBox,
    setSelectedBox: (value) => {
      selectedBox = value;
    },
    canEditBox: (boxName, group) => group?.editable?.includes(boxName) === true,
    getShowBoxes: () => true,
    storage: {
      setItem(key, value) {
        values.set(key, value);
      },
    },
  });
  return { controller, selectedBoxes, values, getSelectedBox: () => selectedBox };
}

test("box selection normalizes unsupported entries and chooses an editable box", () => {
  const { controller, selectedBoxes, getSelectedBox } = createFixture(["hitbox", "collisionbox"]);
  const group = { editable: ["hurtbox", "collisionbox"] };

  assert.equal(controller.normalizeBoxSelectionForGroup(group), true);
  assert.deepEqual([...selectedBoxes], ["collisionbox"]);
  assert.equal(getSelectedBox(), "collisionbox");
  assert.deepEqual(controller.selectedBoxNames(), ["collisionbox"]);
});

test("box selection persists visibility, active box, and checked order", () => {
  const { controller, values } = createFixture(["hitbox", "hurtbox"]);

  controller.saveBoxViewPrefs();

  assert.equal(values.get("show"), "true");
  assert.equal(values.get("only"), "false");
  assert.equal(values.get("selected"), "hitbox");
  assert.equal(values.get("checked"), "hurtbox,hitbox");
});

test("box selection survives storage write failures", () => {
  const { controller } = createFixture();
  const storage = {
    setItem() {
      throw new Error("storage blocked");
    },
  };
  const safeController = createController({
    boxNames: ["hurtbox"],
    boxPrefKeys: { show: "show", only: "only", selected: "selected", checked: "checked" },
    getSelectedBoxes: () => new Set(["hurtbox"]),
    getSelectedBox: () => "hurtbox",
    setSelectedBox: () => {},
    canEditBox: () => true,
    storage,
  });

  assert.doesNotThrow(() => safeController.saveBoxViewPrefs());
  assert.ok(controller);
});
