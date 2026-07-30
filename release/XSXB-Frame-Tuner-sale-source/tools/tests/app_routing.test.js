const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_routing");

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) || null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    value(key) {
      return values.get(key) || "";
    },
  };
}

function createWindow(href = "http://localhost/") {
  const location = new URL(href);
  const historyCalls = [];
  const history = {};
  for (const method of ["pushState", "replaceState"]) {
    history[method] = (state, _title, nextUrl) => {
      const nextLocation = new URL(nextUrl);
      historyCalls.push({ method, state, url: nextLocation.href });
      location.href = nextLocation.href;
    };
  }
  return { history, historyCalls, location };
}

function createControllerFixture(href = "http://localhost/") {
  const windowRef = createWindow(href);
  const storage = createStorage();
  const documentRef = { title: "" };
  const values = {
    homeHub: { hidden: false },
    homeHubOpen: { setAttribute() {} },
    homeRecentProject: { textContent: "" },
    homeAnimationCount: { textContent: "" },
    homeFrameCount: { textContent: "" },
    homeProfileCount: { textContent: "" },
    homeRecentAnimation: { textContent: "" },
    homeProjectPath: { textContent: "" },
    homeLastEdited: { textContent: "" },
    homeRecentTool: { textContent: "" },
  };
  const state = {
    homeHubDismissed: false,
    config: {
      activeProject: { name: "Demo", workspacePath: "/tmp/demo" },
      groups: [{ name: "Idle", frames: [{}, {}] }],
      profiles: [{ id: "hero" }],
    },
    currentGroup: { name: "Idle", uiId: "idle" },
    selectedFrame: 1,
  };
  const controller = createController({
    elements: values,
    getConfig: () => state.config,
    getLanguage: () => "en",
    getCurrentGroup: () => state.currentGroup,
    getHomeHubDismissed: () => state.homeHubDismissed,
    setHomeHubDismissed: (dismissed) => {
      state.homeHubDismissed = dismissed;
    },
    getSelectedFrame: () => state.selectedFrame,
    getActiveProjectId: () => "project-1",
    translate: (key) =>
      ({
        homeCutoutTitle: "Cutout",
        homeImportTitle: "Import",
        homeOrganizerTitle: "Organizer",
      })[key] || key,
    projectLabel: (project) => project?.name || "",
    groupLabel: (group) => group?.name || "",
    windowRef,
    documentRef,
    storage,
  });
  return { controller, documentRef, state, storage, values, windowRef };
}

test("routing reads canonical and legacy workbench routes", () => {
  assert.equal(
    createControllerFixture("http://localhost/tools/cutout").controller.currentWorkbenchRoute(),
    "cutout",
  );
  assert.equal(
    createControllerFixture("http://localhost/?tool=organizer").controller.currentWorkbenchRoute(),
    "organizer",
  );
  assert.equal(createControllerFixture("http://localhost/unknown").controller.currentWorkbenchRoute(), "");
});

test("home hub renders project summary and document title", () => {
  const { controller, documentRef, values } = createControllerFixture();

  controller.renderHomeHub();

  assert.equal(values.homeHub.hidden, false);
  assert.equal(values.homeRecentProject.textContent, "Demo");
  assert.equal(values.homeAnimationCount.textContent, "1");
  assert.equal(values.homeFrameCount.textContent, "2");
  assert.equal(values.homeProfileCount.textContent, "1");
  assert.equal(values.homeRecentAnimation.textContent, "Idle");
  assert.equal(documentRef.title, "Idle · XSXB Frame Tuner");
});

test("route and selection synchronization preserve URL state", () => {
  const { controller, storage, windowRef } = createControllerFixture("http://localhost/?legacy=1");

  controller.syncWorkbenchRoute("cutout", { push: true });
  assert.equal(windowRef.location.pathname, "/tools/cutout");
  assert.equal(storage.value("xsxbFrameTuner.recentWorkbench"), "cutout");
  assert.equal(windowRef.historyCalls[0].method, "pushState");

  controller.syncUrlState({ push: true });
  assert.equal(windowRef.location.search, "?legacy=1&project=project-1&group=idle&frame=1");
  assert.equal(windowRef.historyCalls[1].state.xsxbSelection, true);
});

test("returning to the workspace route restores the frame editor", () => {
  const { controller, state, values, windowRef } = createControllerFixture("http://localhost/tools/cutout");

  controller.syncWorkbenchRoute("");

  assert.equal(windowRef.location.pathname, "/workspace");
  assert.equal(state.homeHubDismissed, true);
  assert.equal(values.homeHub.hidden, true);
});

test("route application closes conflicting workbench before opening target", async () => {
  const windowRef = createWindow("http://localhost/tools/cutout");
  const events = [];
  const frameOrganizer = {
    isOpen: () => true,
    getMode: () => "edit",
    async requestClose() {
      events.push("close-organizer");
      return true;
    },
  };
  const batchCutout = {
    isOpen: () => false,
    open() {
      events.push("open-cutout");
    },
  };
  const controller = createController({
    windowRef,
    documentRef: { title: "" },
    getFrameOrganizer: () => frameOrganizer,
    getBatchCutout: () => batchCutout,
  });

  assert.equal(await controller.applyWorkbenchRoute(), true);
  assert.deepEqual(events, ["close-organizer", "open-cutout"]);
});

test("route application restores home when the requested controller is unavailable", async () => {
  const windowRef = createWindow("http://localhost/tools/cutout");
  const controller = createController({
    windowRef,
    documentRef: { title: "" },
  });

  assert.equal(await controller.applyWorkbenchRoute(), false);
  assert.equal(windowRef.location.pathname, "/workspace");
});

test("route application restores the open organizer when close is cancelled", async () => {
  const windowRef = createWindow("http://localhost/tools/cutout");
  const events = [];
  const controller = createController({
    windowRef,
    documentRef: { title: "" },
    getFrameOrganizer: () => ({
      isOpen: () => true,
      getMode: () => "import",
      async requestClose() {
        events.push("cancel-close");
        return false;
      },
    }),
    getBatchCutout: () => ({
      isOpen: () => false,
      open: () => events.push("open-cutout"),
    }),
  });

  assert.equal(await controller.applyWorkbenchRoute(), false);
  assert.equal(windowRef.location.pathname, "/tools/import");
  assert.deepEqual(events, ["cancel-close"]);
});

test("route application rolls URL back when opening a workbench throws", async () => {
  const windowRef = createWindow("http://localhost/tools/cutout");
  const controller = createController({
    windowRef,
    documentRef: { title: "" },
    getBatchCutout: () => ({
      isOpen: () => false,
      open: () => {
        throw new Error("cutout failed");
      },
    }),
  });

  await assert.rejects(() => controller.applyWorkbenchRoute(), /cutout failed/);
  assert.equal(windowRef.location.pathname, "/workspace");
});
