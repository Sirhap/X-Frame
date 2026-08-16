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
  const state = {
    config: {
      activeProject: { name: "Demo", workspacePath: "/tmp/demo" },
      groups: [{ name: "Idle", frames: [{}, {}] }],
      profiles: [{ id: "hero" }],
    },
    currentGroup: { name: "Idle", uiId: "idle" },
    selectedFrame: 1,
  };
  const controller = createController({
    getCurrentGroup: () => state.currentGroup,
    getSelectedFrame: () => state.selectedFrame,
    getActiveProjectId: () => "project-1",
    translate: (key) =>
      ({
        homeCutoutTitle: "Cutout",
        homeImportTitle: "Import",
        homeOrganizerTitle: "Organizer",
      })[key] || key,
    groupLabel: (group) => group?.name || "",
    windowRef,
    documentRef,
    storage,
  });
  return { controller, documentRef, state, storage, windowRef };
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
  assert.equal(
    createControllerFixture("http://localhost/tools/organizer").controller.currentWorkbenchRoute(),
    "import",
  );
  assert.equal(
    createControllerFixture("http://localhost/workspace/tools/organizer").controller.currentWorkbenchRoute(),
    "organizer",
  );
  assert.equal(
    createControllerFixture("http://localhost/tools/scatter-slice").controller.currentWorkbenchRoute(),
    "scatter",
  );
  assert.equal(
    createControllerFixture("http://localhost/tools/export").controller.currentWorkbenchRoute(),
    "export",
  );
  assert.equal(createControllerFixture("http://localhost/unknown").controller.currentWorkbenchRoute(), "");
});

test("standalone cutout consumes a retained temporary workset", async () => {
  const windowRef = createWindow("http://localhost/tools/cutout");
  const events = [];
  const workset = { name: "run", frames: [{ id: "a", image: {} }] };
  const controller = createController({
    windowRef,
    documentRef: { title: "" },
    getTemporaryWorkset: () => workset,
    openTemporaryCutout: (value) => {
      events.push(value);
      return true;
    },
    getBatchCutout: () => ({ isOpen: () => false, open: () => events.push("empty") }),
  });

  assert.equal(await controller.applyWorkbenchRoute(), true);
  assert.deepEqual(events, [workset]);
});

test("project resource route opens import mode when the project has no frames", async () => {
  const windowRef = createWindow("http://localhost/workspace/resources/import");
  const events = [];
  const controller = createController({
    windowRef,
    documentRef: { title: "" },
    getCurrentGroup: () => null,
    getFrameOrganizer: () => ({
      isOpen: () => false,
      open: () => events.push("edit"),
      openImport: () => events.push("import"),
    }),
  });

  assert.equal(await controller.applyWorkbenchRoute(), true);
  assert.deepEqual(events, ["import"]);
});

test("routing distinguishes project and standalone navigation domains", () => {
  assert.equal(
    createControllerFixture("http://localhost/workspace/tools/cutout").controller.currentNavigationContext(),
    "project",
  );
  assert.equal(
    createControllerFixture("http://localhost/tools/cutout").controller.currentNavigationContext(),
    "standalone",
  );
});

test("routing updates the document title from the active animation", () => {
  const { controller, documentRef } = createControllerFixture();

  controller.updateDocumentTitle();

  assert.equal(documentRef.title, "Idle · XSXB Frame Tuner");
});

test("route and selection synchronization preserve URL state", () => {
  const { controller, storage, windowRef } = createControllerFixture("http://localhost/?legacy=1");

  controller.syncWorkbenchRoute("cutout", { push: true });
  assert.equal(windowRef.location.pathname, "/tools/cutout");
  assert.equal(storage.value("xsxbFrameTuner.recentWorkbench"), "cutout");
  assert.equal(windowRef.historyCalls[0].method, "pushState");

  controller.syncWorkbenchRoute("cutout", { context: "project" });
  assert.equal(windowRef.location.pathname, "/workspace/resources/cutout");

  controller.syncUrlState({ push: true });
  assert.equal(windowRef.location.search, "?legacy=1&project=project-1&group=idle&frame=1");
  assert.equal(windowRef.historyCalls[2].state.xsxbSelection, true);
});

test("standalone route synchronization removes workspace selection parameters", () => {
  const { controller, windowRef } = createControllerFixture(
    "http://localhost/workspace?project=project-1&group=idle&frame=1&legacy=1",
  );

  controller.syncWorkbenchRoute("tools", { push: true });

  assert.equal(windowRef.location.pathname, "/tools");
  assert.equal(windowRef.location.search, "?legacy=1");
});

test("workspace selection synchronization keeps project animation state", () => {
  const { controller, windowRef } = createControllerFixture(
    "http://localhost/workspace?animation=hero%2Fidle",
  );

  controller.syncUrlState();

  assert.equal(windowRef.location.search, "?project=project-1&group=idle&frame=1");
});

test("returning to the workspace route restores the frame editor", () => {
  const { controller, windowRef } = createControllerFixture("http://localhost/tools/cutout");

  controller.syncWorkbenchRoute("");

  assert.equal(windowRef.location.pathname, "/workspace");
});

test("applying the workspace URL keeps the frame editor route active", async () => {
  const { controller, windowRef } = createControllerFixture("http://localhost/workspace");

  assert.equal(await controller.applyWorkbenchRoute(), true);
  assert.equal(windowRef.location.pathname, "/workspace");
});

test("cancelling a standalone tool switch restores the project workspace", async () => {
  const windowRef = createWindow("http://localhost/tools");
  const controller = createController({
    windowRef,
    documentRef: { title: "" },
    getWorkspaceDirty: () => true,
    requestWorkspaceDecision: async () => "cancel",
  });

  assert.equal(await controller.applyWorkbenchRoute(), false);
  assert.equal(windowRef.location.pathname, "/workspace");
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
  assert.equal(windowRef.location.pathname, "/tools");
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
  assert.equal(windowRef.location.pathname, "/tools/organizer");
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
  assert.equal(windowRef.location.pathname, "/tools");
});

test("workspace route guard saves dirty tuning before opening a tool", async () => {
  const windowRef = createWindow("http://localhost/tools/cutout");
  const events = [];
  const controller = createController({
    windowRef,
    documentRef: { title: "" },
    getWorkspaceDirty: () => true,
    requestWorkspaceDecision: async () => {
      events.push("decide");
      return "save";
    },
    saveWorkspace: async () => events.push("save"),
    getBatchCutout: () => ({
      isOpen: () => false,
      open: () => events.push("open-cutout"),
    }),
  });

  assert.equal(await controller.applyWorkbenchRoute(), true);
  assert.deepEqual(events, ["decide", "save", "open-cutout"]);
});

test("workspace route guard discards or cancels dirty tuning explicitly", async () => {
  const discardWindow = createWindow("http://localhost/workspace/tools/organizer");
  const discardEvents = [];
  const discardController = createController({
    windowRef: discardWindow,
    documentRef: { title: "" },
    getCurrentGroup: () => ({ frames: [{}] }),
    getWorkspaceDirty: () => true,
    requestWorkspaceDecision: async () => "discard",
    discardWorkspaceChanges: async () => discardEvents.push("discard"),
    getFrameOrganizer: () => ({
      isOpen: () => false,
      open: () => discardEvents.push("open-organizer"),
    }),
  });
  assert.equal(await discardController.applyWorkbenchRoute(), true);
  assert.deepEqual(discardEvents, ["discard", "open-organizer"]);

  const cancelWindow = createWindow("http://localhost/tools/cutout");
  const cancelController = createController({
    windowRef: cancelWindow,
    documentRef: { title: "" },
    getWorkspaceDirty: () => true,
    requestWorkspaceDecision: async () => "cancel",
    getBatchCutout: () => ({ isOpen: () => false, open() {} }),
  });
  assert.equal(await cancelController.applyWorkbenchRoute(), false);
  assert.equal(cancelWindow.location.pathname, "/workspace");
});
