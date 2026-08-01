"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { HISTORY_BASE_KEY, createController } = require("../animation_tuner/public/app_navigation_guard");

/** Creates an event target with inspectable listeners. */
function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    dispatch(type, event) {
      for (const listener of listeners.get(type) || []) listener(event);
    },
    removeEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      listeners.set(
        type,
        entries.filter((entry) => entry !== listener),
      );
    },
  };
}

/** Creates a navigation-guard fixture. */
function createFixture(options = {}) {
  const documentRef = createEventTarget();
  const windowRef = createEventTarget();
  const assigned = [];
  const historyOperations = [];
  windowRef.location = {
    href: "http://localhost/workspace",
    assign(href) {
      assigned.push(href);
    },
  };
  windowRef.history = {
    state: null,
    back() {
      historyOperations.push(["back"]);
    },
    pushState(state, _title, href) {
      this.state = state;
      historyOperations.push(["push", state, href]);
    },
    replaceState(state, _title, href) {
      this.state = state;
      historyOperations.push(["replace", state, href]);
    },
  };
  const anchor = {
    download: false,
    href: "http://localhost/",
    target: "",
  };
  const target = {
    closest(selector) {
      return selector === "[data-document-navigation]" ? anchor : null;
    },
  };
  const decisions = [];
  const errors = [];
  const controller = createController({
    documentRef,
    windowRef,
    hasUnsavedChanges: () => options.dirty !== false,
    requestNavigation: async (context) => {
      decisions.push(context);
      if (options.error) throw options.error;
      return options.accepted !== false;
    },
    reportError: (error) => errors.push(error),
  });
  return {
    anchor,
    assigned,
    controller,
    decisions,
    documentRef,
    errors,
    historyOperations,
    target,
    windowRef,
  };
}

/** Dispatches a primary click and reports whether navigation was intercepted. */
async function click(fixture, overrides = {}) {
  let prevented = false;
  fixture.documentRef.dispatch("click", {
    button: 0,
    target: fixture.target,
    preventDefault() {
      prevented = true;
    },
    ...overrides,
  });
  await Promise.resolve();
  await Promise.resolve();
  return prevented;
}

test("approved app-owned navigation bypasses the native unload prompt", async () => {
  const fixture = createFixture();

  assert.equal(await click(fixture), true);
  assert.equal(fixture.decisions.length, 1);
  assert.deepEqual(fixture.assigned, ["http://localhost/"]);
  assert.equal(fixture.controller.isNavigationApproved(), true);

  let prevented = false;
  const event = {
    preventDefault() {
      prevented = true;
    },
    returnValue: undefined,
  };
  fixture.windowRef.dispatch("beforeunload", event);
  assert.equal(prevented, false);
  assert.equal(event.returnValue, undefined);
});

test("cancelled app-owned navigation stays in the editor", async () => {
  const fixture = createFixture({ accepted: false });

  assert.equal(await click(fixture), true);
  assert.deepEqual(fixture.assigned, []);
  assert.equal(fixture.controller.isNavigationApproved(), false);
});

test("refresh and tab close still warn while changes are unsaved", () => {
  const fixture = createFixture();
  let prevented = false;
  const event = {
    preventDefault() {
      prevented = true;
    },
    returnValue: undefined,
  };

  fixture.windowRef.dispatch("beforeunload", event);

  assert.equal(prevented, true);
  assert.equal(event.returnValue, "");
});

test("browser back asks in-app before crossing the editor document boundary", async () => {
  const fixture = createFixture();
  let propagationStopped = false;

  fixture.windowRef.dispatch("popstate", {
    state: { [HISTORY_BASE_KEY]: true },
    stopImmediatePropagation() {
      propagationStopped = true;
    },
  });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(propagationStopped, true);
  assert.equal(fixture.decisions.length, 1);
  assert.equal(fixture.historyOperations.at(-1)[0], "back");
  assert.equal(fixture.controller.isNavigationApproved(), true);
});

test("cancelled browser back restores the same-document guard", async () => {
  const fixture = createFixture({ accepted: false });
  const initialPushCount = fixture.historyOperations.filter(([operation]) => operation === "push").length;

  fixture.windowRef.dispatch("popstate", { state: { [HISTORY_BASE_KEY]: true } });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(fixture.controller.isNavigationApproved(), false);
  assert.equal(
    fixture.historyOperations.filter(([operation]) => operation === "push").length,
    initialPushCount + 1,
  );
  assert.equal(
    fixture.historyOperations.some(([operation]) => operation === "back"),
    false,
  );
});

test("clean and modified-link navigation retain native browser behavior", async () => {
  const cleanFixture = createFixture({ dirty: false });
  assert.equal(await click(cleanFixture), false);
  assert.equal(cleanFixture.decisions.length, 0);

  const modifiedFixture = createFixture();
  assert.equal(await click(modifiedFixture, { metaKey: true }), false);
  assert.equal(modifiedFixture.decisions.length, 0);
});

test("navigation failures keep unload protection active and report the error", async () => {
  const fixture = createFixture({ error: new Error("save failed") });

  assert.equal(await click(fixture), true);
  assert.deepEqual(fixture.assigned, []);
  assert.equal(fixture.errors[0]?.message, "save failed");
  assert.equal(fixture.controller.isNavigationApproved(), false);
});
