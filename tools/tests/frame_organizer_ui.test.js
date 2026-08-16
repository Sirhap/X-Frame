"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createController, openCurrentAnimation } = require("../animation_tuner/public/frame_organizer_ui");

test("current-animation launcher loads the existing workset", async () => {
  let openCalls = 0;

  await openCurrentAnimation(async () => {
    openCalls += 1;
  });

  assert.equal(openCalls, 1);
  await assert.rejects(() => openCurrentAnimation(null), /loader is required/);
});

test("organizer UI controller preserves baseline change detection", () => {
  const state = {
    mode: "edit",
    frames: [],
    baselineFrameIds: [],
    videoExtracting: false,
  };
  const controller = createController({ elements: {}, state, text: () => "" });

  assert.equal(controller.hasUnsavedChanges(), false);
  state.frames.push({ uid: "frame-1", imported: false, flipped: false, included: true, tag: "" });
  assert.equal(controller.hasUnsavedChanges(), true);
  state.baselineFrameIds = ["frame-1"];
  assert.equal(controller.hasUnsavedChanges(), false);
  state.frames[0].tag = "hero";
  assert.equal(controller.hasUnsavedChanges(), true);
});

test("organizer UI exposes normalized image order strategy selection", () => {
  const state = { importOrderStrategy: "filename" };
  const controller = createController({ elements: {}, state, text: () => "" });

  controller.setImportOrderStrategy("selection");
  assert.equal(state.importOrderStrategy, "selection");
  controller.setImportOrderStrategy("unsupported");
  assert.equal(state.importOrderStrategy, "filename");
});

test("organizer exposes a dedicated confirmed workset clear action", () => {
  const html = fs.readFileSync(path.join(__dirname, "../animation_tuner/public/index.html"), "utf8");
  const script = fs.readFileSync(
    path.join(__dirname, "../animation_tuner/public/frame_organizer_ui.js"),
    "utf8",
  );

  assert.match(html, /id="organizerClearWorkset"/);
  assert.match(script, /async function clearWorkset\(\)/);
  assert.match(script, /requestConfirmation\(/);
  assert.match(script, /offerDeleteUndo\(snapshot\)/);
});

test("loop finder stays in the visible primary toolbar actions", () => {
  const html = fs.readFileSync(path.join(__dirname, "../animation_tuner/public/index.html"), "utf8");
  const primaryActionsStart = html.indexOf('class="organizerToolbarActions"');
  const secondaryToolbarStart = html.indexOf('class="organizerToolbarRow organizerToolbarSecondary"');
  const loopFinderPosition = html.indexOf('id="organizerFindLoop"');

  assert.ok(primaryActionsStart >= 0);
  assert.ok(secondaryToolbarStart > primaryActionsStart);
  assert.ok(loopFinderPosition > primaryActionsStart);
  assert.ok(loopFinderPosition < secondaryToolbarStart);
});

/** Creates the import fields needed to verify project-intent defaults. */
function createImportContextFixture() {
  const location = new URL("http://localhost/tools/organizer?createProject=1&source=projects");
  const replaceCalls = [];
  const workbenchClasses = new Set();
  const projectSelect = {
    _options: [],
    value: "",
    get innerHTML() {
      return "";
    },
    set innerHTML(_value) {
      this._options = [];
      this.value = "";
    },
    get options() {
      return this._options;
    },
    appendChild(option) {
      this._options.push(option);
    },
  };
  const field = (value = "") => ({ value });
  const elements = {
    organizerAnimationName: field(),
    organizerAnimationType: field(),
    organizerProfileName: field(),
    organizerProjectName: field(),
    organizerProjectNameField: { hidden: true },
    organizerProjectSelect: projectSelect,
    organizerImportSetup: {
      closest: () => ({
        classList: {
          toggle(name, enabled) {
            if (enabled) workbenchClasses.add(name);
            else workbenchClasses.delete(name);
          },
        },
      }),
    },
  };
  const document = {
    createElement: () => ({ textContent: "", value: "" }),
  };
  const window = {
    history: {
      state: { xsxbWorkbench: "import" },
      replaceState(state, _title, nextUrl) {
        replaceCalls.push({ state, url: String(nextUrl) });
        location.href = String(nextUrl);
      },
    },
    location,
  };
  const controller = createController({
    document,
    elements,
    hooks: {
      getImportContext: () => ({
        activeProject: { id: "project-1", label: "Existing Project" },
        profiles: [{ id: "hero", label: "Hero", kind: "actor" }],
      }),
    },
    state: { language: "en" },
    text: (key) => key,
    window,
  });
  return { controller, elements, location, replaceCalls, workbenchClasses };
}

test("organizer consumes the one-shot create-project navigation intent", () => {
  const fixture = createImportContextFixture();

  fixture.controller.renderImportContext(true);

  assert.equal(fixture.elements.organizerProjectSelect.value, "__new__");
  assert.equal(fixture.location.search, "?source=projects");
  assert.equal(fixture.replaceCalls.length, 1);
  assert.deepEqual(fixture.replaceCalls[0].state, { xsxbWorkbench: "import" });
  assert.equal(fixture.workbenchClasses.has("createProjectMode"), true);

  fixture.controller.renderImportContext(true);

  assert.equal(fixture.elements.organizerProjectSelect.value, "project-1");
  assert.equal(fixture.replaceCalls.length, 1);
  assert.equal(fixture.workbenchClasses.has("createProjectMode"), false);
});
