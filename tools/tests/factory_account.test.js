"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const factoryAccount = require("../animation_tuner/public/factory_account.js");

/** @returns {object} Minimal event-capable DOM element. */
function createElement() {
  const attributes = new Map();
  const listeners = new Map();
  return {
    dataset: {},
    disabled: false,
    hidden: true,
    style: {},
    textContent: "",
    value: "",
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    focus() {},
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    listener(type) {
      return listeners.get(type);
    },
    select() {},
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
  };
}

/**
 * @param {(path:string,options:object)=>Promise<Response>} fetchImpl Fetch stub.
 * @param {{storage?:{getItem:(key:string)=>string|null}}} [options] Optional language storage.
 * @returns {object} Test fixture.
 */
function createFixture(fetchImpl, options = {}) {
  const selectors = [
    "#factoryAccountDialog",
    "#factoryAccountClose",
    "#factoryAccountForm",
    "#factoryAccountEmail",
    "#factoryAccountPassword",
    "#factoryAccountCode",
    "#factoryAccountCredentials",
    "#factoryAccountChallenge",
    "#factoryAccountContinue",
    "#factoryAccountBack",
    "#factoryAccountVerify",
    "#factoryAccountSummary",
    "#factoryAccountIdentity",
    "#factoryAccountEntitlement",
    "#factoryAccountPlan",
    "#factoryAccountActions",
    "#factoryAccountLogout",
    "#factoryAccountStatus",
    "#factoryAccountCodeLabel",
  ];
  const elements = Object.fromEntries(selectors.map((selector) => [selector, createElement()]));
  const accountLabels = [createElement(), createElement()];
  const adminLinks = [createElement()];
  const openButtons = [createElement(), createElement()];
  const documentRef = {
    activeElement: null,
    body: { style: {} },
    addEventListener() {},
    querySelector(selector) {
      return elements[selector] || null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-account-label]") return accountLabels;
      if (selector === "[data-administrator-console-link]") return adminLinks;
      if (selector === "[data-account-open]") return openButtons;
      return [];
    },
  };
  const controller = factoryAccount.createController({
    documentRef,
    fetchImpl,
    windowRef: { setTimeout: (callback) => callback() },
    storage: options.storage,
  });
  return { accountLabels, adminLinks, controller, openButtons };
}

test("factory account state updates the landing header and administrator entry", async () => {
  const fixture = createFixture(async () =>
    Response.json({
      authenticated: true,
      administrator: true,
      identityLabel: "管理员 sirhao",
      proEnabled: true,
    }),
  );

  await fixture.controller.refreshSession();

  assert.deepEqual(
    fixture.accountLabels.map((label) => label.textContent),
    ["账户与授权", "账户与授权"],
  );
  assert.equal(fixture.openButtons[0].getAttribute("aria-label"), "账户与授权");
  assert.equal(fixture.adminLinks[0].hidden, false);

  fixture.controller.render({ authenticated: false });

  assert.deepEqual(
    fixture.accountLabels.map((label) => label.textContent),
    ["登录 / 注册", "登录 / 注册"],
  );
  assert.equal(fixture.openButtons[0].getAttribute("aria-label"), "登录或注册");
  assert.equal(fixture.adminLinks[0].hidden, true);
});

test("factory account copy follows an explicit English language choice", () => {
  const fixture = createFixture(async () => Response.json({ authenticated: false }), {
    storage: {
      getItem(key) {
        if (key === "xsxbFrameTuner.languageExplicit") return "true";
        if (key === "xsxbFrameTuner.language") return "en";
        return null;
      },
    },
  });

  fixture.controller.render({ authenticated: false });
  assert.equal(fixture.openButtons[0].getAttribute("aria-label"), "Sign in or register");
  assert.deepEqual(
    fixture.accountLabels.map((label) => label.textContent),
    ["Sign in / Register", "Sign in / Register"],
  );
});
