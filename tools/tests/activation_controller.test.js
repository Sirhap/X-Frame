"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const activationModule = require("../animation_tuner/public/activation_controller.js");

/** @returns {object} Minimal DOM element. */
function createElement() {
  const listeners = new Map();
  return {
    dataset: {},
    style: {},
    hidden: true,
    disabled: false,
    value: "",
    textContent: "",
    children: [],
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    focus() {},
    listener(type) {
      return listeners.get(type);
    },
  };
}

/** @param {(path:string,options:object)=>Promise<Response>} fetchImpl Fetch stub. @returns {object} Fixture. */
function createFixture(fetchImpl) {
  const selectors = [
    "#activationPanel",
    "#activationTitle",
    "#activationMessage",
    "#activationOverview",
    "#activationPlanBadge",
    "#activationRemaining",
    "#activationProgress",
    "#activationCurrent",
    "#activationFeatures",
    "#accountLoginForm",
    "#accountEmail",
    "#accountPassword",
    "#accountCredentialStep",
    "#accountChallengeStep",
    "#accountVerificationCode",
    "#accountLogin",
    "#accountVerify",
    "#accountChallengeBack",
    "#activationForm",
    "#activationCode",
    "#activationSubmit",
    "#accountLogout",
    "#activationStatus",
    "#activationCancel",
    "#activationManage",
    "#activationManageLabel",
    "#activationManageStatus",
    "#administratorConsoleLink",
    "#organizerActivationManage",
    "#organizerActivationManageLabel",
    "#organizerActivationManageStatus",
  ];
  const elements = Object.fromEntries(selectors.map((selector) => [selector, createElement()]));
  const documentRef = {
    activeElement: null,
    createElement,
    querySelector(selector) {
      return elements[selector] || null;
    },
  };
  const controller = activationModule.createController({
    documentRef,
    windowRef: { location: { assign() {} }, setTimeout: (callback) => callback() },
    fetchImpl,
    premiumFeatures: {
      describeFeatures: () => [{ label: "Pro export" }],
    },
  });
  return { controller, elements };
}

test("account controller renders authenticated Pro status", async () => {
  const fixture = createFixture(async () =>
    Response.json({
      authenticated: true,
      configured: true,
      email: "person@example.com",
      proEnabled: true,
    }),
  );
  const status = await fixture.controller.refreshStatus();
  assert.equal(status.proEnabled, true);
  assert.equal(fixture.controller.isActivated(), true);
  assert.match(fixture.elements["#activationCurrent"].textContent, /person@example\.com/u);
  assert.equal(fixture.elements["#activationPlanBadge"].textContent, "PRO 已开启");
});

test("account controller allows output when no premium features are required", async () => {
  let sessionRequests = 0;
  const fixture = createFixture(async () => {
    sessionRequests += 1;
    return Response.json({ authenticated: false, configured: true, proEnabled: false });
  });

  const result = await Promise.race([
    fixture.controller.ensureActivated([]),
    new Promise((resolve) => setTimeout(() => resolve("timed-out"), 50)),
  ]);

  assert.equal(result, true);
  assert.equal(sessionRequests, 0);
  assert.equal(fixture.elements["#activationPanel"].hidden, true);
});

test("account controller shows administration only for an administrator session", async () => {
  const fixture = createFixture(async () =>
    Response.json({
      authenticated: true,
      configured: true,
      administrator: true,
      identityLabel: "管理员 sirhao",
      proEnabled: true,
    }),
  );

  await fixture.controller.refreshStatus();
  assert.equal(fixture.elements["#administratorConsoleLink"].hidden, false);
  assert.equal(fixture.elements["#activationForm"].hidden, true);
});

test("account controller reveals email verification only after password acceptance", async () => {
  const calls = [];
  const fixture = createFixture(async (path) => {
    calls.push(path);
    if (path === "/api/auth/session") return Response.json({ authenticated: false, configured: true });
    if (path === "/api/auth/password/start")
      return Response.json({ challengeType: "email_code", challengeToken: "opaque-token" });
    return Response.json({ authenticated: true, email: "person@example.com", proEnabled: true });
  });
  fixture.elements["#accountEmail"].value = "person@example.com";
  fixture.elements["#accountPassword"].value = "correct-password";
  await fixture.elements["#accountLoginForm"].listener("submit")({ preventDefault() {} });
  assert.equal(fixture.elements["#accountChallengeStep"].hidden, false);
  fixture.elements["#accountVerificationCode"].value = "123456";
  await fixture.elements["#accountLoginForm"].listener("submit")({ preventDefault() {} });
  assert.deepEqual(calls, ["/api/auth/password/start", "/api/auth/challenge/verify"]);
  assert.equal(fixture.controller.isActivated(), true);
});

test("account controller redeems activation code for signed-in email", async () => {
  const calls = [];
  const fixture = createFixture(async (path) => {
    calls.push(path);
    return Response.json({
      authenticated: true,
      email: "person@example.com",
      proEnabled: true,
    });
  });
  fixture.elements["#activationCode"].value = "XSXB-CODE";
  await fixture.elements["#activationForm"].listener("submit")({ preventDefault() {} });
  assert.deepEqual(calls, ["/api/entitlements/redeem"]);
  assert.match(fixture.elements["#activationStatus"].textContent, /绑定当前邮箱/u);
});
