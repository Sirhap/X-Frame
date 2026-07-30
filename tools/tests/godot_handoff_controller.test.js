"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createController,
  normalizeState,
  readHandoffResponse,
} = require("../animation_tuner/public/godot_handoff_controller");

/** Creates a minimal event-capable UI element. @returns {object} */
function element() {
  return {
    dataset: {},
    disabled: false,
    hidden: false,
    textContent: "",
    value: "",
    children: [],
    listeners: {},
    addEventListener(name, listener) {
      this.listeners[name] = listener;
    },
    append(child) {
      this.children.push(child);
    },
    focus() {
      this.focused = true;
    },
    replaceChildren() {
      this.children = [];
    },
  };
}

/** Creates controller elements. @returns {Record<string,object>} */
function createElements() {
  return {
    card: element(),
    badge: element(),
    rootLabel: element(),
    rootInput: element(),
    message: element(),
    blockers: element(),
    bindButton: element(),
    syncButton: element(),
    unbindButton: element(),
  };
}

test("handoff UI renders state, blockers, and hosted disabled controls", () => {
  const originalDocument = global.document;
  global.document = { activeElement: null, createElement: () => element() };
  try {
    const elements = createElements();
    const controller = createController({
      elements,
      browserOnly: true,
      getConfig: () => ({
        activeProject: { id: "demo" },
        godotHandoff: {
          state: "sync_required",
          projectRoot: "/game",
          blockers: ["Data changed"],
        },
      }),
    });
    controller.render();

    assert.equal(elements.badge.textContent, "local_only · 需要本地版");
    assert.equal(elements.rootInput.value, "/game");
    assert.equal(elements.rootInput.disabled, true);
    assert.equal(elements.bindButton.disabled, true);
    assert.equal(elements.blockers.children[0].textContent, "Data changed");
  } finally {
    global.document = originalDocument;
  }
});

test("handoff UI confirms rebind and sends revision-safe structured request", async () => {
  const originalDocument = global.document;
  global.document = { activeElement: null, createElement: () => element() };
  try {
    const elements = createElements();
    const requests = [];
    let confirmations = 0;
    let reloads = 0;
    const controller = createController({
      elements,
      getConfig: () => ({
        activeProject: { id: "demo" },
        dataRevision: "revision-1",
        godotHandoff: { state: "synced", projectRoot: "/old", blockers: [] },
      }),
      confirm: async () => {
        confirmations += 1;
        return true;
      },
      fetchImpl: async (url, options) => {
        requests.push({ url, payload: JSON.parse(options.body) });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
      reload: async () => {
        reloads += 1;
      },
    });
    controller.render();
    elements.rootInput.value = "/new";

    assert.equal(await controller.bind(), true);
    assert.equal(confirmations, 1);
    assert.equal(reloads, 1);
    assert.deepEqual(requests, [
      {
        url: "/api/projects/handoff",
        payload: {
          action: "bind",
          projectId: "demo",
          projectRoot: "/new",
          confirmRebind: true,
          baseRevision: "revision-1",
        },
      },
    ]);
  } finally {
    global.document = originalDocument;
  }
});

test("handoff response preserves structured errors and unknown states normalize safely", async () => {
  await assert.rejects(
    readHandoffResponse(
      new Response(JSON.stringify({ error: "Root conflict", code: "project_root_conflict" }), {
        status: 409,
      }),
    ),
    (error) => error.status === 409 && error.code === "project_root_conflict",
  );
  assert.equal(normalizeState("future_state"), "local_only");
});

test("handoff UI restores path focus after inline validation failure", async () => {
  const originalDocument = global.document;
  global.document = { activeElement: null, createElement: () => element() };
  try {
    const elements = createElements();
    const controller = createController({
      elements,
      getConfig: () => ({
        activeProject: { id: "demo" },
        dataRevision: "revision-1",
        godotHandoff: { state: "local_only", projectRoot: "", blockers: [] },
      }),
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: "Absolute path required" }), { status: 400 }),
    });
    controller.render();
    elements.rootInput.value = "relative/path";

    assert.equal(await controller.bind(), false);
    assert.equal(elements.rootInput.disabled, false);
    assert.equal(elements.rootInput.focused, true);
    assert.equal(elements.message.textContent, "Absolute path required");
  } finally {
    global.document = originalDocument;
  }
});
