"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const fingerprintModule = require("../animation_tuner/public/device_fingerprint.js");

test("device fingerprint collects bounded stable signals without persistent identifiers", async () => {
  const fingerprint = await fingerprintModule.collect({
    navigatorRef: {
      platform: "MacIntel",
      userAgent: "Test Browser/1.0",
      language: "zh-CN",
      languages: ["zh-CN", "en-US"],
      hardwareConcurrency: 10,
      deviceMemory: 16,
      maxTouchPoints: 0,
    },
    screenRef: { width: 1728, height: 1117, colorDepth: 24 },
    devicePixelRatio: 2,
    documentRef: { createElement: () => ({ getContext: () => null }) },
  });

  assert.equal(fingerprint.platform, "MacIntel");
  assert.equal(fingerprint.screen.pixelRatio, 2);
  assert.deepEqual(fingerprint.languages, ["zh-CN", "en-US"]);
  assert.deepEqual(fingerprint.webgl, { vendor: "", renderer: "" });
  assert.equal(Object.hasOwn(fingerprint, "deviceId"), false);
});
