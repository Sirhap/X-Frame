"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const activationModule = require("../animation_tuner/public/activation_controller.js");

/** @returns {object} Minimal DOM element. */
function createElement() {
  const listeners = new Map();
  return {
    dataset: {},
    hidden: true,
    disabled: false,
    inert: false,
    value: "",
    textContent: "",
    offsetParent: {},
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    append() {},
    replaceChildren() {},
    querySelectorAll() {
      return [];
    },
    focus() {},
    listener(type) {
      return listeners.get(type);
    },
  };
}

/** @returns {{documentRef:object,elements:Record<string,object>}} Activation DOM fixture. */
function createDocumentFixture() {
  const selectors = [
    "#activationPanel",
    "#activationCard",
    "#activationTitle",
    "#activationMessage",
    "#activationFeatures",
    "#activationForm",
    "#activationCode",
    "#activationStatus",
    "#activationCancel",
    "#activationSubmit",
    ".app",
  ];
  const elements = Object.fromEntries(selectors.map((selector) => [selector, createElement()]));
  return {
    elements,
    documentRef: {
      activeElement: null,
      createElement,
      querySelector(selector) {
        return elements[selector] || null;
      },
      addEventListener() {},
    },
  };
}

/** @param {object} options Controller overrides. @returns {object} Controller fixture. */
function createControllerFixture(options = {}) {
  const fixture = createDocumentFixture();
  const controller = activationModule.createController({
    documentRef: fixture.documentRef,
    windowRef: { setTimeout: (callback) => callback() },
    fetchImpl: options.fetchImpl,
    deviceIdentity: options.deviceIdentity,
    premiumFeatures: {
      describeFeatures: () => [],
      normalizeFeatureIds: (featureIds) => featureIds,
    },
  });
  return { ...fixture, controller };
}

test("activation controller silently renews an expired Cookie with the device key", async () => {
  let renewCalls = 0;
  const fixture = createControllerFixture({
    fetchImpl: async () => Response.json({ activated: false, configured: true }),
    deviceIdentity: {
      async renew() {
        renewCalls += 1;
        return { activated: true, expiresAt: "2026-07-25T00:00:00.000Z" };
      },
    },
  });

  const status = await fixture.controller.refreshStatus();
  assert.equal(status.activated, true);
  assert.equal(fixture.controller.isActivated(), true);
  assert.equal(renewCalls, 1);
});

test("activation form delegates code redemption to the browser device protocol", async () => {
  let activationCode = "";
  const fixture = createControllerFixture({
    fetchImpl: async () => Response.json({ activated: false, configured: true }),
    deviceIdentity: {
      async activate(code) {
        activationCode = code;
        return { activated: true, expiresAt: "2026-07-25T00:00:00.000Z" };
      },
    },
  });
  fixture.elements["#activationCode"].value = " XSXB-TRIAL-TEST ";
  await fixture.elements["#activationForm"].listener("submit")({ preventDefault() {} });

  assert.equal(activationCode, "XSXB-TRIAL-TEST");
  assert.equal(fixture.controller.isActivated(), true);
  assert.equal(fixture.elements["#activationStatus"].dataset.tone, "success");
});
