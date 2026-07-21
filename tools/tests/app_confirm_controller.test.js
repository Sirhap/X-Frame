"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/app_confirm_controller");

/**
 * Creates a minimal event-capable DOM element for confirmation-controller tests.
 * @param {object} documentRef Shared document fixture.
 * @returns {object} Element fixture.
 */
function createElement(documentRef) {
  const listeners = new Map();
  return {
    hidden: false,
    inert: false,
    isConnected: true,
    offsetParent: {},
    dataset: {},
    children: [],
    textContent: "",
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    append(...children) {
      this.children.push(...children);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener({ target: this, ...event });
    },
    focus() {
      documentRef.activeElement = this;
    },
    querySelectorAll() {
      return [];
    },
    removeAttribute(name) {
      if (name === "data-tone") delete this.dataset.tone;
    },
    replaceChildren() {
      this.children = [];
    },
  };
}

/**
 * Creates the main-workbench confirmation fixture.
 * @returns {{controller:object,documentRef:object,elements:object,app:object,origin:object}}
 */
function createFixture() {
  const documentListeners = new Map();
  const documentRef = {
    activeElement: null,
    addEventListener(type, listener) {
      const entries = documentListeners.get(type) || [];
      entries.push(listener);
      documentListeners.set(type, entries);
    },
    createElement() {
      return createElement(documentRef);
    },
    dispatch(type, event) {
      for (const listener of documentListeners.get(type) || []) listener(event);
    },
    querySelector(selector) {
      return selector === ".app" ? app : null;
    },
  };
  const app = createElement(documentRef);
  const origin = createElement(documentRef);
  const elements = {
    panel: createElement(documentRef),
    card: createElement(documentRef),
    title: createElement(documentRef),
    message: createElement(documentRef),
    details: createElement(documentRef),
    cancel: createElement(documentRef),
    accept: createElement(documentRef),
  };
  elements.panel.hidden = true;
  elements.panel.querySelectorAll = () => [elements.cancel, elements.accept];
  documentRef.activeElement = origin;
  const controller = createController({
    elements,
    documentRef,
    windowRef: { setTimeout: (callback) => callback() },
  });
  return { app, controller, documentRef, elements, origin };
}

test("app confirmation renders details, locks the workbench, and restores focus", async () => {
  const fixture = createFixture();
  const resultPromise = fixture.controller.requestConfirmation("Delete the project?", [["Project", "Demo"]], {
    title: "Confirm delete",
    confirmLabel: "Delete",
    cancelLabel: "Keep",
    tone: "danger",
  });

  assert.equal(fixture.controller.isOpen(), true);
  assert.equal(fixture.app.inert, true);
  assert.equal(fixture.elements.title.textContent, "Confirm delete");
  assert.equal(fixture.elements.accept.textContent, "Delete");
  assert.equal(fixture.elements.details.children.length, 2);
  assert.equal(fixture.elements.card.dataset.tone, "danger");
  assert.equal(fixture.documentRef.activeElement, fixture.elements.cancel);
  fixture.elements.accept.dispatch("click");

  assert.equal(await resultPromise, true);
  assert.equal(fixture.controller.isOpen(), false);
  assert.equal(fixture.app.inert, false);
  assert.equal(fixture.documentRef.activeElement, fixture.origin);
});

test("app confirmation focuses acceptance for reversible warnings", async () => {
  const fixture = createFixture();
  const resultPromise = fixture.controller.requestConfirmation("Discard local changes?", [], {
    tone: "warning",
  });

  assert.equal(fixture.documentRef.activeElement, fixture.elements.accept);
  fixture.elements.cancel.dispatch("click");
  assert.equal(await resultPromise, false);
});

test("app confirmation cancels with Escape and resolves an existing request safely", async () => {
  const fixture = createFixture();
  const firstPromise = fixture.controller.requestConfirmation("First request");
  const secondPromise = fixture.controller.requestConfirmation("Second request");

  assert.equal(await firstPromise, false);
  let prevented = false;
  fixture.documentRef.dispatch("keydown", {
    key: "Escape",
    preventDefault() {
      prevented = true;
    },
  });

  assert.equal(await secondPromise, false);
  assert.equal(prevented, true);
  assert.equal(fixture.app.inert, false);
});
