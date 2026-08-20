"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/media_export_dialog");

/** Creates a minimal event-capable element for dialog controller tests. */
function element(overrides = {}) {
  const listeners = new Map();
  return {
    checked: false,
    dataset: {},
    disabled: false,
    hidden: false,
    textContent: "",
    addEventListener(type, listener) {
      const handlers = listeners.get(type) || [];
      handlers.push(listener);
      listeners.set(type, handlers);
    },
    append() {},
    dispatch(type, event = {}) {
      (listeners.get(type) || []).forEach((listener) => listener(event));
    },
    focus() {},
    querySelectorAll() {
      return [];
    },
    removeAttribute() {},
    replaceChildren() {},
    setAttribute() {},
    ...overrides,
  };
}

/** Creates the complete ID map consumed by the export dialog. */
function createElements() {
  const previewCanvas = element({
    width: 512,
    height: 512,
    getContext: () => ({ clearRect() {}, drawImage() {}, imageSmoothingEnabled: true }),
  });
  const elements = {
    mediaExportDialog: element({ hidden: true }),
    mediaExportClose: element(),
    mediaExportFrameCount: element(),
    mediaExportFps: element(),
    mediaExportCanvas: element(),
    mediaExportFrames: element({ checked: false, name: "mediaExportFormat", type: "radio", value: "frames" }),
    mediaExportSheet: element({
      checked: true,
      name: "mediaExportFormat",
      type: "radio",
      value: "spritesheet",
    }),
    mediaExportGif: element({ disabled: true, name: "mediaExportFormat", type: "radio", value: "gif" }),
    mediaExportMov: element({ disabled: true }),
    mediaExportMp4: element({ disabled: true, name: "mediaExportFormat", type: "radio", value: "mp4" }),
    mediaExportPreset: element({ value: "atlas" }),
    mediaExportCanvasMode: element({ value: "union" }),
    mediaExportWidth: element({ value: "512" }),
    mediaExportHeight: element({ value: "512" }),
    mediaExportFit: element({ value: "contain" }),
    mediaExportAnchor: element({ value: "bottom-center" }),
    mediaExportScaleXRange: element({ value: "100" }),
    mediaExportScaleX: element({ value: "100" }),
    mediaExportScaleYRange: element({ value: "100" }),
    mediaExportScaleY: element({ value: "100" }),
    mediaExportScaleLinked: element({ checked: true }),
    mediaExportOffsetXRange: element({ value: "0" }),
    mediaExportOffsetX: element({ value: "0" }),
    mediaExportOffsetYRange: element({ value: "0" }),
    mediaExportOffsetY: element({ value: "0" }),
    mediaExportPadding: element({ value: "2" }),
    mediaExportExtrude: element({ value: "1" }),
    mediaExportInterpolation: element({ value: "smooth" }),
    mediaExportBackground: element({ value: "transparent" }),
    mediaExportBackgroundColor: element({ value: "#000000" }),
    mediaExportSpeed: element({ value: "1" }),
    mediaExportColumns: element({ value: "0" }),
    mediaExportGap: element({ value: "0" }),
    mediaExportMaxTexture: element({ value: "8192" }),
    mediaExportPreviewTitle: element(),
    mediaExportPreviewSize: element(),
    mediaExportPreviewRefresh: element(),
    mediaExportPreviewCanvas: previewCanvas,
    mediaExportPreviewPrevious: element(),
    mediaExportPreviewPage: element(),
    mediaExportPreviewNext: element(),
    mediaExportPreviewFrame: element(),
    mediaExportPreviewAnimation: element(),
    mediaExportPreviewSheet: element(),
    mediaExportPreviewMeta: element(),
    mediaExportLocalHint: element(),
    mediaExportStatus: element(),
    mediaExportDownloads: element({ hidden: true }),
    mediaExportCancel: element(),
    mediaExportSubmit: element(),
  };
  Object.assign(elements, {
    mediaExportFilename: element({ value: "animation" }),
    mediaExportUseSourceName: element({ type: "checkbox" }),
    mediaExportCustomSize: element({ hidden: true }),
    mediaExportOriginalResolution: element(),
    mediaExportFitComplete: element(),
    mediaExportFillCanvas: element(),
    mediaExportOffsetXMin: element(),
    mediaExportOffsetXMax: element(),
    mediaExportOffsetYMin: element(),
    mediaExportOffsetYMax: element(),
    mediaExportFillColorRow: element({ hidden: true }),
    mediaExportFillColor: element({ value: "#f0f0f0" }),
    mediaExportFillColorValue: element(),
    mediaExportFillColorReset: element(),
    mediaExportSheetSettings: element(),
    mediaExportZipSettings: element({ hidden: true }),
    mediaExportGifSettings: element({ hidden: true }),
    mediaExportMp4Settings: element({ hidden: true }),
    mediaExportPowerOfTwo: element({ type: "checkbox" }),
    mediaExportTrimTransparent: element({ type: "checkbox" }),
    mediaExportColumnsAuto: element({ checked: true, type: "checkbox" }),
    mediaExportColumnsTotal: element(),
    mediaExportImageName: element({ value: "animation" }),
    mediaExportImageNameHint: element(),
    mediaExportMetadataJson: element({ checked: true, type: "checkbox" }),
    mediaExportMetadataGodot: element({ type: "checkbox" }),
    mediaExportMetadataUnity: element({ type: "checkbox" }),
    mediaExportMetadataPlist: element({ type: "checkbox" }),
    mediaExportQuality: element({ checked: true, name: "mediaExportQuality", type: "radio", value: "png32" }),
    mediaExportEstimate: element(),
    mediaExportZipImageName: element({ value: "animation" }),
    mediaExportZipImageNameHint: element(),
    mediaExportZipQuality: element({
      checked: true,
      name: "mediaExportZipQuality",
      type: "radio",
      value: "png32",
    }),
    mediaExportGifLoop: element({ checked: true, type: "checkbox" }),
    mediaExportGifFpsRange: element({ value: "12" }),
    mediaExportGifFps: element({ value: "12" }),
    mediaExportGifAlphaRange: element({ value: "128" }),
    mediaExportGifAlpha: element({ value: "128" }),
    mediaExportGifPalette: element({
      checked: true,
      name: "mediaExportGifPalette",
      type: "radio",
      value: "stable",
    }),
    mediaExportGifDenoise: element({
      checked: true,
      name: "mediaExportGifDenoise",
      type: "radio",
      value: "standard",
    }),
    mediaExportGifCompression: element({
      checked: true,
      name: "mediaExportGifCompression",
      type: "radio",
      value: "light",
    }),
    mediaExportGifSoften: element({
      checked: true,
      name: "mediaExportGifSoften",
      type: "radio",
      value: "off",
    }),
    mediaExportMp4FpsRange: element({ value: "30" }),
    mediaExportMp4Fps: element({ value: "30" }),
    mediaExportMp4Quality: element({
      checked: true,
      name: "mediaExportMp4Quality",
      type: "radio",
      value: "medium",
    }),
  });
  elements.mediaExportInterpolation.name = "mediaExportInterpolation";
  elements.mediaExportInterpolation.type = "radio";
  elements.mediaExportInterpolation.checked = true;
  elements.mediaExportFit.name = "mediaExportFit";
  elements.mediaExportFit.type = "radio";
  elements.mediaExportFit.checked = true;
  elements.mediaExportBackground.name = "mediaExportBackground";
  elements.mediaExportBackground.type = "radio";
  elements.mediaExportBackground.value = "edge";
  elements.mediaExportBackground.checked = true;
  elements.mediaExportMaxTexture.name = "mediaExportTextureSize";
  elements.mediaExportMaxTexture.type = "radio";
  elements.mediaExportMaxTexture.value = "2048";
  elements.mediaExportMaxTexture.checked = true;
  const resolution = element({ checked: true, name: "mediaExportResolution", type: "radio", value: "512" });
  const solidBackground = element({ name: "mediaExportBackground", type: "radio", value: "color" });
  const recipeControlIds = [
    "mediaExportFrames",
    "mediaExportSheet",
    "mediaExportGif",
    "mediaExportMov",
    "mediaExportMp4",
    "mediaExportPreset",
    "mediaExportCanvasMode",
    "mediaExportWidth",
    "mediaExportHeight",
    "mediaExportFit",
    "mediaExportAnchor",
    "mediaExportScaleXRange",
    "mediaExportScaleX",
    "mediaExportScaleYRange",
    "mediaExportScaleY",
    "mediaExportScaleLinked",
    "mediaExportOffsetXRange",
    "mediaExportOffsetX",
    "mediaExportOffsetYRange",
    "mediaExportOffsetY",
    "mediaExportPadding",
    "mediaExportExtrude",
    "mediaExportInterpolation",
    "mediaExportBackground",
    "mediaExportBackgroundColor",
    "mediaExportSpeed",
    "mediaExportColumns",
    "mediaExportGap",
    "mediaExportMaxTexture",
    "mediaExportPowerOfTwo",
    "mediaExportTrimTransparent",
    "mediaExportColumnsAuto",
    "mediaExportImageName",
    "mediaExportMetadataJson",
    "mediaExportMetadataGodot",
    "mediaExportMetadataUnity",
    "mediaExportMetadataPlist",
    "mediaExportQuality",
    "mediaExportZipImageName",
    "mediaExportZipQuality",
    "mediaExportGifLoop",
    "mediaExportGifFpsRange",
    "mediaExportGifFps",
    "mediaExportGifAlphaRange",
    "mediaExportGifAlpha",
    "mediaExportGifPalette",
    "mediaExportGifDenoise",
    "mediaExportGifCompression",
    "mediaExportGifSoften",
    "mediaExportMp4FpsRange",
    "mediaExportMp4Fps",
    "mediaExportMp4Quality",
  ];
  recipeControlIds.forEach((id) => {
    elements[id].id = id;
  });
  const namedControls = [
    elements.mediaExportFrames,
    elements.mediaExportSheet,
    elements.mediaExportGif,
    elements.mediaExportMp4,
    elements.mediaExportInterpolation,
    elements.mediaExportFit,
    elements.mediaExportBackground,
    solidBackground,
    elements.mediaExportMaxTexture,
    elements.mediaExportQuality,
    elements.mediaExportZipQuality,
    elements.mediaExportGifPalette,
    elements.mediaExportGifDenoise,
    elements.mediaExportGifCompression,
    elements.mediaExportGifSoften,
    elements.mediaExportMp4Quality,
    resolution,
  ];
  elements.mediaExportDialog.querySelectorAll = (selector) => {
    if (selector === ".mediaExportRecipe input, .mediaExportRecipe select")
      return [...recipeControlIds.map((id) => elements[id]), resolution, solidBackground];
    if (selector === 'input[name="mediaExportFormat"]')
      return [
        elements.mediaExportFrames,
        elements.mediaExportSheet,
        elements.mediaExportGif,
        elements.mediaExportMp4,
      ];
    return [];
  };
  elements.mediaExportDialog.querySelector = (selector) => {
    const selected = /^input\[name="([^"]+)"\]:checked$/.exec(selector);
    if (selected)
      return namedControls.find((control) => control.name === selected[1] && control.checked) || null;
    if (selector === 'input[name="mediaExportBackground"][value="color"]') return solidBackground;
    return null;
  };
  return elements;
}

test("media export dialog enables local formats only when FFmpeg is available", async () => {
  const originalDocument = global.document;
  global.document = {
    activeElement: null,
    addEventListener() {},
    body: { classList: { add() {}, remove() {} } },
    createElement: () => element(),
  };
  try {
    const elements = createElements();
    const controller = createController({
      elements,
      getLanguage: () => "en",
      getSummary: () => ({ frameCount: 2, fps: 12, canvas: "32×24" }),
      onExport: async () => ({ downloads: [] }),
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ ffmpeg: { available: true, version: "7.1" } }),
      }),
    });

    await controller.refreshCapabilities();

    assert.equal(elements.mediaExportGif.disabled, false);
    assert.equal(elements.mediaExportMov.disabled, false);
    assert.match(elements.mediaExportLocalHint.textContent, /FFmpeg 7\.1/);
  } finally {
    global.document = originalDocument;
  }
});

test("disabled GIF and MP4 explain that the web build cannot encode them", async () => {
  const originalDocument = global.document;
  global.document = {
    activeElement: null,
    addEventListener() {},
    body: { classList: { add() {}, remove() {} } },
    createElement: () => element(),
  };
  try {
    const elements = createElements();
    const controller = createController({
      elements,
      getLanguage: () => "en",
      getSummary: () => ({ frameCount: 2, fps: 12, canvas: "32×24" }),
      onExport: async () => ({ downloads: [] }),
      fetchImpl: async () => {
        throw new Error("LOCAL_EXPORT_UNAVAILABLE");
      },
    });

    await controller.refreshCapabilities();

    assert.equal(elements.mediaExportGif.disabled, true);
    assert.match(elements.mediaExportGif.title, /local app with FFmpeg|web/i);
    assert.equal(elements.mediaExportMp4.title, elements.mediaExportGif.title);
    assert.match(elements.mediaExportLocalHint.textContent, /GIF|FFmpeg|local app/i);
  } finally {
    global.document = originalDocument;
  }
});

test("the disabled GIF/MOV reason stays visible instead of display:none", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../animation_tuner/public/media_export_dialog.css"),
    "utf8",
  );
  const hiddenHint = css.match(/\.mediaExportLocalHint[^{]*\{[^}]*display:\s*none/u);
  assert.equal(
    hiddenHint,
    null,
    "ORG-023 needs a visible FFmpeg reason; hiding .mediaExportLocalHint with display:none hides it",
  );
});

test("media export dialog consumes Escape and restores trigger focus", () => {
  const originalDocument = global.document;
  let keydownListener = null;
  let focusedElement = null;
  const trigger = element({
    focus() {
      focusedElement = trigger;
    },
  });
  global.document = {
    activeElement: trigger,
    addEventListener(type, listener) {
      if (type === "keydown") keydownListener = listener;
    },
    body: { classList: { add() {}, remove() {} } },
    createElement: () => element(),
  };
  try {
    const elements = createElements();
    const controller = createController({
      elements,
      getLanguage: () => "en",
      getSummary: () => ({}),
      onExport: async () => ({ downloads: [] }),
      fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
    });
    controller.open();
    const event = {
      key: "Escape",
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopImmediatePropagation() {
        this.propagationStopped = true;
      },
    };

    keydownListener(event);

    assert.equal(elements.mediaExportDialog.hidden, true);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.propagationStopped, true);
    assert.equal(focusedElement, trigger);
  } finally {
    global.document = originalDocument;
  }
});

test("media export dialog supports keyboard undo and redo for recipe adjustments", () => {
  const originalDocument = global.document;
  let keydownListener = null;
  global.document = {
    activeElement: null,
    addEventListener(type, listener) {
      if (type === "keydown") keydownListener = listener;
    },
    body: { classList: { add() {}, remove() {} } },
    createElement: () => element(),
  };
  try {
    const elements = createElements();
    const controller = createController({
      elements,
      getLanguage: () => "en",
      getSummary: () => ({}),
      onExport: async () => ({ downloads: [] }),
      fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
    });
    controller.open();
    elements.mediaExportScaleX.value = "50";
    elements.mediaExportScaleX.dispatch("input");
    elements.mediaExportScaleX.dispatch("change");

    const undoEvent = {
      key: "z",
      metaKey: true,
      preventDefault() {},
      stopImmediatePropagation() {},
    };
    keydownListener(undoEvent);

    assert.equal(elements.mediaExportScaleX.value, "100");
    assert.equal(elements.mediaExportScaleY.value, "100");
    assert.equal(elements.mediaExportStatus.textContent, "Export adjustment undone.");

    keydownListener({ ...undoEvent, shiftKey: true });

    assert.equal(elements.mediaExportScaleX.value, "50");
    assert.equal(elements.mediaExportScaleY.value, "50");
    assert.equal(elements.mediaExportStatus.textContent, "Export adjustment redone.");
  } finally {
    global.document = originalDocument;
  }
});

test("media export dialog aborts an active export and restores its controls", async () => {
  const originalDocument = global.document;
  global.document = {
    activeElement: null,
    addEventListener() {},
    body: { classList: { add() {}, remove() {} } },
    createElement: () => element(),
  };
  try {
    const elements = createElements();
    let receivedSignal = null;
    const controller = createController({
      elements,
      getLanguage: () => "en",
      getSummary: () => ({}),
      onExport: ({ signal }) =>
        new Promise((_resolve, reject) => {
          receivedSignal = signal;
          signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")));
        }),
      fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
    });

    const submission = controller.submit();
    controller.close();
    await submission;

    assert.equal(receivedSignal.aborted, true);
    assert.equal(elements.mediaExportSubmit.disabled, false);
    assert.equal(elements.mediaExportFrames.disabled, false);
    assert.equal(elements.mediaExportStatus.textContent, "Export cancelled.");
  } finally {
    global.document = originalDocument;
  }
});

test("media export dialog renders restored progress and completed downloads", async () => {
  const originalDocument = global.document;
  const links = [];
  global.document = {
    activeElement: null,
    addEventListener() {},
    body: { classList: { add() {}, remove() {} } },
    createElement: () => element(),
  };
  try {
    const elements = createElements();
    elements.mediaExportDownloads.append = (link) => links.push(link);
    const observed = [];
    const controller = createController({
      elements,
      getLanguage: () => "en",
      getSummary: () => ({}),
      onExport: async () => ({ downloads: [] }),
      onRecoveryChange: (status) => observed.push(status?.status || "none"),
      resumeLastExport: async ({ onStatus }) => {
        onStatus({ id: "job-1", status: "running", progress: 0.51, downloads: [] });
        return {
          id: "job-1",
          status: "completed",
          progress: 1,
          downloads: [{ filename: "idle.gif", label: "GIF", url: "/download" }],
        };
      },
      fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
    });

    const result = await controller.restoreLastJob();

    assert.equal(result.status, "completed");
    assert.equal(controller.getRecoveredJob().id, "job-1");
    assert.deepEqual(observed, ["running", "completed"]);
    assert.equal(links[0].href, "/download");
    assert.match(elements.mediaExportStatus.textContent, /restored/i);
    assert.equal(elements.mediaExportSubmit.disabled, false);
  } finally {
    global.document = originalDocument;
  }
});

test("media export dialog exposes recovered task cancellation", async () => {
  const originalDocument = global.document;
  global.document = {
    activeElement: null,
    addEventListener() {},
    body: { classList: { add() {}, remove() {} } },
    createElement: () => element(),
  };
  try {
    const elements = createElements();
    let cancelledId = "";
    const controller = createController({
      elements,
      getLanguage: () => "en",
      getSummary: () => ({}),
      onExport: async () => ({ downloads: [] }),
      cancelRecoveredExport: async (jobId) => {
        cancelledId = jobId;
        return { id: jobId, status: "cancelled" };
      },
      fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
    });
    controller.renderRecoveredJob({
      id: "failed-job",
      status: "failed",
      progress: 0.4,
      errorCode: "server_restarted",
      downloads: [],
    });

    await controller.cancelRecoveredJob();

    assert.equal(cancelledId, "failed-job");
    assert.equal(controller.getRecoveredJob(), null);
    assert.match(elements.mediaExportStatus.textContent, /cancelled/i);
  } finally {
    global.document = originalDocument;
  }
});
