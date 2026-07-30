"use strict";

const assert = require("node:assert/strict");
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
      listeners.set(type, listener);
    },
    append() {},
    dispatch(type, event = {}) {
      listeners.get(type)?.(event);
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
  return {
    mediaExportDialog: element({ hidden: true }),
    mediaExportClose: element(),
    mediaExportFrameCount: element(),
    mediaExportFps: element(),
    mediaExportCanvas: element(),
    mediaExportFrames: element({ checked: true }),
    mediaExportSheet: element(),
    mediaExportGif: element({ disabled: true }),
    mediaExportMov: element({ disabled: true }),
    mediaExportLocalHint: element(),
    mediaExportStatus: element(),
    mediaExportDownloads: element({ hidden: true }),
    mediaExportCancel: element(),
    mediaExportSubmit: element(),
  };
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
