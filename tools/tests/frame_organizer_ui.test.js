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

test("loop finder lives in the analysis group and empty import keeps edit tools", () => {
  const html = fs.readFileSync(path.join(__dirname, "../animation_tuner/public/index.html"), "utf8");
  const analysisStart = html.indexOf('class="organizerToolGroup organizerAnalysisTools"');
  const analysisEnd = html.indexOf('class="organizerToolGroup organizerDangerTools"');
  const loopFinderPosition = html.indexOf('id="organizerFindLoop"');
  const editTools = html.indexOf('class="organizerToolGroup organizerEditTools"');

  assert.ok(analysisStart >= 0);
  assert.ok(analysisEnd > analysisStart);
  assert.ok(loopFinderPosition > analysisStart);
  assert.ok(loopFinderPosition < analysisEnd);
  assert.ok(editTools >= 0);
  assert.ok(!html.includes('id="organizerMoreTools"'));
  assert.ok(html.includes('id="workspaceFlowBack"'));
  assert.ok(!html.includes('class="organizerHeader"'));
});

test("import settings reveal project fields and frames are reordered by drag instead of order buttons", () => {
  const html = fs.readFileSync(path.join(__dirname, "../animation_tuner/public/index.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../animation_tuner/public/organizer_shell.css"), "utf8");
  const feedbackBlock = html.slice(
    html.indexOf('id="organizerAnalysisFeedback"'),
    html.indexOf("</output>", html.indexOf('id="organizerAnalysisFeedback"')),
  );

  assert.match(css, /\.organizerWorkbench\.importMode\.showImportSetup \.organizerProjectMetadata/);
  assert.ok(!html.includes('id="organizerOrderFilename"'));
  assert.ok(!html.includes('id="organizerOrderSelection"'));
  assert.ok(html.includes('id="organizerAutoSort"'));
  assert.ok(!feedbackBlock.includes('data-organizer-i18n="analysisReady"'));
});

test("empty import keeps the preview column and does not collapse the toolbar", () => {
  const css = [
    fs.readFileSync(path.join(__dirname, "../animation_tuner/public/responsive.css"), "utf8"),
    fs.readFileSync(path.join(__dirname, "../animation_tuner/public/organizer_workspace.css"), "utf8"),
  ].join("\n");

  assert.doesNotMatch(
    css,
    /\.organizerWorkbench\.importMode:not\(:has\(\.organizerFrame\)\) \.organizerPreviewPanel/,
  );
  assert.doesNotMatch(
    css,
    /\.organizerWorkbench\.importMode:not\(:has\(\.organizerFrame\)\) \.organizerToolbarPrimary/,
  );
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
