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

test("syncUrlState keeps animation=profile/id with the live group uiId", () => {
  const { controller, state, windowRef } = createControllerFixture(
    "http://localhost/workspace?animation=sidekick%2Fidle",
  );
  state.currentGroup = {
    uiId: "player:actor:idle:3",
    profileId: "hero",
    animationId: "idle",
    name: "idle",
  };

  controller.syncUrlState();

  const params = new URLSearchParams(windowRef.location.search);
  assert.equal(params.get("project"), "project-1");
  assert.equal(params.get("group"), "player:actor:idle:3");
  assert.equal(params.get("frame"), "1");
  assert.equal(
    params.get("animation"),
    "hero/idle",
    "live bookmark must keep the current group's animation= even if the URL had a stale value",
  );
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

test("resource, animation, and export stage switches do not ask about unsaved edits", async () => {
  const events = [];
  const controller = createController({
    windowRef: createWindow("http://localhost/workspace/resources/import"),
    documentRef: { title: "" },
    getWorkspaceDirty: () => true,
    requestWorkspaceDecision: async () => {
      events.push("prompt");
      return "cancel";
    },
  });

  assert.equal(await controller.confirmWorkspaceLeave("export"), true);
  assert.equal(await controller.confirmWorkspaceLeave("animation"), true);
  assert.equal(await controller.confirmWorkspaceLeave("organizer"), true);
  assert.equal(await controller.confirmWorkspaceLeave("cutout"), true);
  assert.deepEqual(events, []);
});

test("same-stage workspace tab switches do not ask about unsaved edits", async () => {
  const events = [];
  const windowRef = createWindow("http://localhost/workspace/animation/boxes");
  const controller = createController({
    windowRef,
    documentRef: { title: "" },
    getWorkspaceDirty: () => true,
    requestWorkspaceDecision: async () => {
      events.push("prompt");
      return "cancel";
    },
    activateWorkspaceRoute: (route) => events.push(`activate:${route}`),
  });

  assert.equal(await controller.applyWorkbenchRoute(), true);
  assert.deepEqual(events, ["activate:boxes"]);
  assert.equal(windowRef.location.pathname, "/workspace/animation/boxes");
});

test("skipDirtyPrompt opens a contextual tool without asking about unsaved edits", async () => {
  const windowRef = createWindow("http://localhost/workspace/resources/cutout");
  const events = [];
  const controller = createController({
    windowRef,
    documentRef: { title: "" },
    getWorkspaceDirty: () => true,
    requestWorkspaceDecision: async () => {
      events.push("prompt");
      return "cancel";
    },
    getBatchCutout: () => ({
      isOpen: () => false,
      open() {
        events.push("open-cutout");
      },
    }),
  });

  assert.equal(await controller.applyWorkbenchRoute({ skipDirtyPrompt: true }), true);
  assert.deepEqual(events, ["open-cutout"]);
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

test("route application force-closes the organizer when switching stages", async () => {
  const windowRef = createWindow("http://localhost/workspace/delivery/export");
  const events = [];
  const controller = createController({
    windowRef,
    documentRef: { title: "" },
    getWorkspaceDirty: () => true,
    requestWorkspaceDecision: async () => {
      events.push("prompt");
      return "cancel";
    },
    getFrameOrganizer: () => ({
      isOpen: () => true,
      getMode: () => "edit",
      hasUnsavedChanges: () => false,
      async requestClose(options) {
        events.push(options?.force ? "force-close" : "ask-close");
        return Boolean(options?.force);
      },
    }),
    activateWorkspaceRoute: (route) => events.push(`activate:${route}`),
  });

  assert.equal(await controller.applyWorkbenchRoute(), true);
  assert.equal(windowRef.location.pathname, "/workspace/delivery/export");
  assert.deepEqual(events, ["force-close", "activate:export"]);
});

test("stage switching cannot force-close an unsaved import workset", async () => {
  const windowRef = createWindow("http://localhost/workspace/animation/transform");
  const events = [];
  const controller = createController({
    windowRef,
    documentRef: { title: "" },
    getFrameOrganizer: () => ({
      isOpen: () => true,
      getMode: () => "import",
      hasUnsavedChanges: () => true,
      async requestClose(options) {
        events.push(options?.force ? "force-close" : "protected-close");
        return false;
      },
    }),
    activateWorkspaceRoute: (route) => events.push(`activate:${route}`),
  });

  assert.equal(await controller.applyWorkbenchRoute(), false);
  assert.equal(windowRef.location.pathname, "/workspace/resources/import");
  assert.deepEqual(events, ["protected-close"]);
});

test("returning to projects asks before discarding organizer work", async () => {
  const windowRef = createWindow("http://localhost/projects");
  const events = [];
  const controller = createController({
    windowRef,
    documentRef: { title: "" },
    getWorkspaceDirty: () => false,
    getFrameOrganizer: () => ({
      isOpen: () => true,
      getMode: () => "edit",
      async requestClose(options) {
        events.push(options?.force ? "force-close" : "ask-close");
        return !options?.force;
      },
    }),
  });

  assert.equal(await controller.applyWorkbenchRoute(), true);
  assert.equal(windowRef.location.pathname, "/projects");
  assert.deepEqual(events, ["ask-close"]);
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

test("workspace route guard opens a tool without saving dirty tuning first", async () => {
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
  assert.deepEqual(events, ["open-cutout"]);
});

test("confirmWorkspaceLeave asks while the URL is still on the workbench", async () => {
  const windowRef = createWindow("http://localhost/workspace/animation/transform");
  const events = [];
  const controller = createController({
    windowRef,
    documentRef: { title: "" },
    getWorkspaceDirty: () => true,
    requestWorkspaceDecision: async () => {
      events.push(`decide:${windowRef.location.pathname}`);
      return "cancel";
    },
    discardWorkspaceChanges: async () => events.push("discard"),
    saveWorkspace: async () => events.push("save"),
  });

  assert.equal(await controller.confirmWorkspaceLeave("tools"), false);
  assert.deepEqual(events, ["decide:/workspace/animation/transform"]);
  assert.equal(windowRef.location.pathname, "/workspace/animation/transform");
});

test("confirmWorkspaceLeave discard restores before the caller may change the URL", async () => {
  const windowRef = createWindow("http://localhost/workspace/animation/transform");
  const events = [];
  const controller = createController({
    windowRef,
    documentRef: { title: "" },
    getWorkspaceDirty: () => true,
    requestWorkspaceDecision: async () => {
      events.push(`decide:${windowRef.location.pathname}`);
      return "discard";
    },
    discardWorkspaceChanges: async () => events.push("discard"),
  });

  assert.equal(await controller.confirmWorkspaceLeave("tools"), true);
  assert.deepEqual(events, ["decide:/workspace/animation/transform", "discard"]);
  assert.equal(windowRef.location.pathname, "/workspace/animation/transform");
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
  assert.deepEqual(discardEvents, ["open-organizer"]);

  const cancelWindow = createWindow("http://localhost/tools/cutout");
  const cancelEvents = [];
  const cancelController = createController({
    windowRef: cancelWindow,
    documentRef: { title: "" },
    getWorkspaceDirty: () => true,
    requestWorkspaceDecision: async () => {
      cancelEvents.push("prompt");
      return "cancel";
    },
    getBatchCutout: () => ({
      isOpen: () => false,
      open() {
        cancelEvents.push("open-cutout");
      },
    }),
  });
  assert.equal(await cancelController.applyWorkbenchRoute(), true);
  assert.equal(cancelWindow.location.pathname, "/tools/cutout");
  assert.deepEqual(cancelEvents, ["open-cutout"]);
});

test("project cutout route copies the current animation frames into the batch", async () => {
  const windowRef = createWindow(
    "http://localhost/workspace/resources/cutout?project=p0test2&group=player%3Aactor%3Aassassin_jump%3A0&frame=0",
  );
  const events = [];
  const controller = createController({
    windowRef,
    documentRef: { title: "" },
    getCurrentGroup: () => ({
      name: "assassin_jump",
      frames: Array.from({ length: 72 }, (_, index) => ({ id: `frame-${index}` })),
    }),
    getBatchCutout: () => ({
      isOpen: () => false,
      open() {
        events.push("open");
      },
      async loadCurrentGroup() {
        events.push("load-current");
      },
    }),
  });

  assert.equal(await controller.applyWorkbenchRoute(), true);
  assert.deepEqual(events, ["open", "load-current"]);
});

test("scatter route stays put when a leftover organizer refuses to close", async () => {
  const windowRef = createWindow("http://localhost/tools/scatter-slice");
  const events = [];
  const controller = createController({
    windowRef,
    documentRef: { title: "" },
    getWorkspaceDirty: () => true,
    requestWorkspaceDecision: async () => {
      events.push("prompt");
      return "cancel";
    },
    getFrameOrganizer: () => ({
      isOpen: () => true,
      getMode: () => "import",
      async requestClose(closeOptions) {
        events.push(closeOptions?.force ? "force-close" : "cancel-close");
        return false;
      },
      openImport: () => events.push("open-import"),
      openWorkset: () => events.push("open-workset"),
    }),
    getTemporaryWorkset: () => ({ name: "leftover", frames: [{ id: "a" }] }),
  });

  assert.equal(await controller.applyWorkbenchRoute(), true);
  assert.equal(windowRef.location.pathname, "/tools/scatter-slice");
  assert.deepEqual(events, ["force-close"]);
});

test("project scatter restores the import route when an unsaved workset stays open", async () => {
  const windowRef = createWindow("http://localhost/workspace/resources/scatter");
  const events = [];
  const controller = createController({
    windowRef,
    documentRef: { title: "" },
    getFrameOrganizer: () => ({
      isOpen: () => true,
      getMode: () => "import",
      hasUnsavedChanges: () => true,
      async requestClose(options) {
        events.push(options?.force ? "force-close" : "protected-close");
        return false;
      },
    }),
  });

  assert.equal(await controller.applyWorkbenchRoute(), false);
  assert.equal(windowRef.location.pathname, "/workspace/resources/import");
  assert.deepEqual(events, ["protected-close"]);
});

test("choosing scatter from a dirty workspace does not ask before leaving tuning", async () => {
  const events = [];
  const controller = createController({
    windowRef: createWindow("http://localhost/workspace/animation/transform"),
    documentRef: { title: "" },
    getWorkspaceDirty: () => true,
    requestWorkspaceDecision: async () => {
      events.push("prompt");
      return "cancel";
    },
  });

  assert.equal(await controller.confirmWorkspaceLeave("scatter"), true);
  assert.deepEqual(events, []);
});

test("reconciling scatter after a slow config load does not open organizer", async () => {
  const windowRef = createWindow("http://localhost/tools/scatter-slice");
  const events = [];
  const controller = createController({
    windowRef,
    documentRef: { title: "" },
    getWorkspaceDirty: () => true,
    requestWorkspaceDecision: async () => {
      events.push("prompt");
      return "discard";
    },
    discardWorkspaceChanges: async () => events.push("discard"),
    getFrameOrganizer: () => ({
      isOpen: () => false,
      getMode: () => "import",
      openImport: () => events.push("open-import"),
      openWorkset: () => events.push("open-workset"),
    }),
    getTemporaryWorkset: () => ({ name: "leftover", frames: [{ id: "a" }] }),
  });

  assert.equal(await controller.applyWorkbenchRoute(), true);
  assert.equal(await controller.applyWorkbenchRoute(), true);
  assert.equal(windowRef.location.pathname, "/tools/scatter-slice");
  assert.deepEqual(events, []);
});

test("standalone cutout stays empty when there is no temporary workset", async () => {
  const windowRef = createWindow("http://localhost/tools/cutout");
  const events = [];
  const controller = createController({
    windowRef,
    documentRef: { title: "" },
    getCurrentGroup: () => ({ frames: [{ id: "idle-1" }, { id: "idle-2" }] }),
    getBatchCutout: () => ({
      isOpen: () => false,
      open() {
        events.push("open");
      },
      async loadCurrentGroup() {
        events.push("load-current");
      },
    }),
  });

  assert.equal(await controller.applyWorkbenchRoute(), true);
  assert.deepEqual(events, ["open"]);
});
