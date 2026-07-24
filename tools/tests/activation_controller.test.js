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
    inert: false,
    value: "",
    textContent: "",
    children: [],
    offsetParent: {},
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    querySelectorAll() {
      return [];
    },
    setAttribute(name, value) {
      this[name] = value;
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
    "#activationOverview",
    "#activationPlanBadge",
    "#activationRemaining",
    "#activationProgress",
    "#activationCurrent",
    "#activationFeatures",
    "#activationForm",
    "#activationCode",
    "#activationStatus",
    "#activationCancel",
    "#activationSubmit",
    "#activationTransfer",
    "#activationTransferSummary",
    "#activationTransferList",
    "#activationTransferPrevious",
    "#activationTransferNext",
    "#activationTransferBack",
    "#activationDeviceActions",
    "#activationDeviceActionsMessage",
    "#activationUnbind",
    "#activationUnbindConfirm",
    "#activationUnbindTitle",
    "#activationUnbindMessage",
    "#activationUnbindCancel",
    "#activationUnbindAccept",
    "#activationManage",
    "#activationManageLabel",
    "#activationManageStatus",
    "#organizerActivationManage",
    "#organizerActivationManageLabel",
    "#organizerActivationManageStatus",
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
    now: options.now,
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

test("activation controller automatically starts a three-day trial after renewal misses", async () => {
  let trialCalls = 0;
  const fixture = createControllerFixture({
    now: () => Date.parse("2026-07-23T00:00:00.000Z"),
    fetchImpl: async () => Response.json({ activated: false, configured: true }),
    deviceIdentity: {
      async renew() {
        return null;
      },
      async startTrial() {
        trialCalls += 1;
        return { activated: true, expiresAt: "2026-07-25T00:00:00.000Z" };
      },
    },
  });

  const status = await fixture.controller.refreshStatus();
  assert.equal(status.activated, true);
  assert.equal(status.plan, "trial");
  assert.equal(trialCalls, 1);
  assert.equal(fixture.elements["#activationManageLabel"].textContent, "3 天试用");
  assert.match(fixture.elements["#activationManageStatus"].textContent, /已开启 · 剩余 2天/u);
  assert.equal(fixture.elements["#organizerActivationManageLabel"].textContent, "3 天试用");
  assert.match(fixture.elements["#organizerActivationManageStatus"].textContent, /剩余 2天/u);
  assert.equal(fixture.elements["#activationPlanBadge"].textContent, "3 天免费试用");
  assert.match(fixture.elements["#activationProgress"].style.width, /^66\./u);
});

test("activation controller warns when a trial has less than six hours remaining", async () => {
  const fixture = createControllerFixture({
    now: () => Date.parse("2026-07-23T00:00:00.000Z"),
    fetchImpl: async () =>
      Response.json({
        activated: true,
        configured: true,
        source: "automatic_trial",
        plan: "trial",
        expiresAt: "2026-07-23T04:00:00.000Z",
      }),
  });

  await fixture.controller.refreshStatus();

  assert.equal(fixture.elements["#activationManage"].dataset.urgency, "critical");
  assert.equal(fixture.elements["#activationOverview"].dataset.urgency, "critical");
  assert.equal(fixture.elements["#activationRemaining"].textContent, "剩余 4小时");
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

test("license manager stays available for replacement and shows the expiry", async () => {
  let activationCode = "";
  const fixture = createControllerFixture({
    fetchImpl: async () =>
      Response.json({
        activated: true,
        configured: true,
        source: "automatic_trial",
        plan: "trial",
        expiresAt: "2026-07-25T00:00:00.000Z",
      }),
    deviceIdentity: {
      async activate(code) {
        activationCode = code;
        return {
          activated: true,
          source: "code",
          plan: "trial",
          expiresAt: "2027-07-25T00:00:00.000Z",
        };
      },
    },
  });

  await fixture.controller.openManager();
  assert.equal(fixture.elements["#activationPanel"].hidden, false);
  assert.match(fixture.elements["#activationMessage"].textContent, /3 天试用期间可正常导出/u);
  assert.match(fixture.elements["#activationCurrent"].textContent, /试用将在/u);
  fixture.elements["#activationCode"].value = " 自定义 激活码 / 夏季✨ ";
  await fixture.elements["#activationForm"].listener("submit")({ preventDefault() {} });

  assert.equal(activationCode, "自定义 激活码 / 夏季✨");
  assert.equal(fixture.elements["#activationPanel"].hidden, false);
  assert.match(fixture.elements["#activationCurrent"].textContent, /当前授权有效期至/u);
  assert.match(fixture.elements["#activationMessage"].textContent, /可随时输入新的激活码/u);
  assert.equal(fixture.elements["#activationManageLabel"].textContent, "授权管理");
  assert.equal(fixture.elements["#activationPlanBadge"].textContent, "已激活");
  assert.equal(fixture.elements["#activationStatus"].dataset.tone, "success");
});

test("activation form requires the user to select the exact device to replace", async () => {
  const calls = [];
  const fixture = createControllerFixture({
    fetchImpl: async () => Response.json({ activated: false, configured: true }),
    deviceIdentity: {
      async activate(code, options) {
        calls.push({ code, options });
        if (!options?.replaceDeviceId) {
          throw Object.assign(new Error("设备名额已满"), {
            code: "DEVICE_LIMIT_REACHED",
            details: {
              devices: [
                {
                  id: "device-studio",
                  name: "Studio Mac",
                  createdAt: "2026-07-20T08:00:00.000Z",
                  lastSeenAt: "2026-07-23T09:00:00.000Z",
                },
                {
                  id: "device-render",
                  name: "Render PC",
                  createdAt: "2026-07-21T08:00:00.000Z",
                  lastSeenAt: "2026-07-23T10:00:00.000Z",
                },
              ],
              total: 2,
              offset: 0,
              pageSize: 20,
              hasPrevious: false,
              hasMore: false,
            },
          });
        }
        return {
          activated: true,
          deviceId: "device-current-5678ABCD",
          source: "code",
          plan: "standard",
          expiresAt: "2027-07-25T00:00:00.000Z",
        };
      },
    },
  });
  await fixture.controller.openManager();
  fixture.elements["#activationCode"].value = "XSXB-MULTI";
  await fixture.elements["#activationForm"].listener("submit")({ preventDefault() {} });

  assert.equal(fixture.elements["#activationTransfer"].hidden, false);
  assert.equal(fixture.elements["#activationTransferList"].children.length, 2);
  assert.match(fixture.elements["#activationTransferSummary"].textContent, /2 台设备/u);

  const renderPcChoice = fixture.elements["#activationTransferList"].children[1];
  assert.match(renderPcChoice.children[1].textContent, /设备 E-RENDER/u);
  renderPcChoice.listener("click")();
  await fixture.elements["#activationForm"].listener("submit")({ preventDefault() {} });

  assert.deepEqual(calls[1], {
    code: "XSXB-MULTI",
    options: { replaceDeviceId: "device-render" },
  });
  assert.equal(fixture.controller.isActivated(), true);
  assert.match(fixture.elements["#activationStatus"].textContent, /所选设备已解绑/u);
});

test("license manager unbinds only the current code device after explicit confirmation", async () => {
  let unbindCalls = 0;
  const fixture = createControllerFixture({
    fetchImpl: async () =>
      Response.json({
        activated: true,
        configured: true,
        deviceId: "device-current-1234ABCD",
        source: "code",
        plan: "standard",
        expiresAt: "2027-07-25T00:00:00.000Z",
      }),
    deviceIdentity: {
      async unbind() {
        unbindCalls += 1;
        return { activated: false, configured: true, unbound: true };
      },
    },
  });

  await fixture.controller.openManager();
  assert.equal(fixture.elements["#activationDeviceActions"].hidden, false);
  assert.match(fixture.elements["#activationDeviceActionsMessage"].textContent, /1234ABCD/u);
  fixture.elements["#activationUnbind"].listener("click")();
  assert.equal(fixture.elements["#activationUnbindConfirm"].hidden, false);
  await fixture.elements["#activationUnbindAccept"].listener("click")();

  assert.equal(unbindCalls, 1);
  assert.equal(fixture.controller.isActivated(), false);
  assert.match(fixture.elements["#activationStatus"].textContent, /其他设备不受影响/u);
});
