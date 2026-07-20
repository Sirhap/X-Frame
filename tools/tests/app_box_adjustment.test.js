const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_box_adjustment");

function rotateVector(value, radians) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: value.x * cos - value.y * sin, y: value.x * sin + value.y * cos };
}

function rotatePoint(point, radians, origin) {
  const rotated = rotateVector(point, radians);
  return { x: rotated.x + origin.x, y: rotated.y + origin.y };
}

function createFixture() {
  const group = { uiId: "attack", frames: [{}, {}, {}] };
  const selectedBoxes = new Set(["hitbox"]);
  const choices = [];
  const overrides = [];
  const classState = [];
  const choice = {
    dataset: { boxChoice: "hitbox" },
    closest: () => ({
      classList: {
        toggle: (name, enabled) => classState.push([name, enabled]),
      },
    }),
  };
  choices.push(choice);
  const elements = {
    stage: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    showBoxes: {},
    boxOnlyMode: {},
    boxChoiceInputs: choices,
    boxEnabled: {},
    deleteBox: {},
    clearBox: {},
  };
  const controller = createController({
    elements,
    getCurrentGroup: () => group,
    getSelectedFrame: () => 0,
    getSelectedBox: () => "hitbox",
    getSelectedBoxes: () => selectedBoxes,
    getShowBoxes: () => true,
    getImages: () => [],
    getView: () => ({ zoom: 2 }),
    getDevicePixelRatio: () => 1,
    boxDrawOrder: ["hitbox", "hurtbox"],
    collisionBoxHandles: new Set(["n", "s"]),
    boxExistsOnFrame: () => true,
    frameBox: () => ({
      offset: { x: 1, y: 2 },
      size: { x: 10, y: 20 },
      rotation: 0,
      enabled: true,
    }),
    boxAutoTransform: () => ({
      scaleX: 2,
      scaleY: 3,
      offset: { x: 4, y: 5 },
      rotation: 0,
      facing: 1,
    }),
    groupOriginScreen: () => ({ x: 100, y: 200 }),
    isCollisionBox: (boxName) => boxName === "collisionbox",
    rotateVector,
    rotatePoint,
    pointInRect: (point, rect) =>
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height,
    pointInBoxRect: (point, rect, padding = 0) =>
      point.x >= rect.left - padding &&
      point.x <= rect.right + padding &&
      point.y >= rect.top - padding &&
      point.y <= rect.bottom + padding,
    canEditBoxes: () => true,
    canEditBox: () => true,
    normalizeBoxSelectionForGroup: () => false,
    saveBoxViewPrefs: () => {},
    selectedFrameIndexes: () => [0, 2],
    cloneVector: (value) => ({ x: value.x, y: value.y }),
    collisionOffsetYForHeight: (height) => -height / 2,
    setBoxOverride: (...args) => overrides.push(args),
    renderFilmstrip: () => {},
    draw: () => {},
  });
  return { controller, elements, group, overrides, classState };
}

test("box adjustment calculates screen rects and hit-tests selected boxes", () => {
  const { controller } = createFixture();
  const rect = controller.boxScreenRect("hitbox");
  assert.equal(rect.centerX, 112);
  assert.equal(rect.centerY, 222);
  assert.equal(rect.width, 40);
  assert.equal(rect.height, 120);
  assert.deepEqual(controller.stagePoint({ clientX: 112, clientY: 222 }), { x: 112, y: 222 });
  assert.deepEqual(
    { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
    {
      left: 92,
      right: 132,
      top: 162,
      bottom: 282,
    },
  );
  const hit = controller.hitTestBoxes({ clientX: 112, clientY: 222 });
  assert.deepEqual(hit, { boxName: "hitbox", mode: "box-move" });
});

test("box adjustment filters collision handles and synchronizes controls", () => {
  const { controller, elements, classState } = createFixture();
  const handles = controller.editableBoxHandleRects("collisionbox", {
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
  });
  assert.deepEqual(
    handles.map((handle) => handle.name),
    ["n", "s"],
  );
  controller.syncBoxInputs();
  assert.equal(elements.showBoxes.checked, true);
  assert.equal(elements.boxEnabled.disabled, false);
  assert.deepEqual(classState, [
    ["activeBoxChoice", true],
    ["disabled", false],
  ]);
});

test("box adjustment writes selected box values to every selected frame", () => {
  const { controller, group, elements, overrides } = createFixture();
  elements.boxEnabled.checked = false;
  controller.updateSelectedBoxFromInputs();
  assert.equal(overrides.length, 2);
  assert.deepEqual(
    overrides.map((entry) => entry[2]),
    [0, 2],
  );
  assert.equal(overrides[0][3], group);
  assert.equal(overrides[0][1].enabled, false);
});
