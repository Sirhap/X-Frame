import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createController } = require("../animation_tuner/public/device_identity.js");

/** @returns {{get:()=>Promise<object|null>,put:(value:object)=>Promise<void>}} In-memory browser storage. */
function createMemoryStorage() {
  let value = null;
  return {
    async get() {
      return value;
    },
    async put(nextValue) {
      value = nextValue;
    },
  };
}

/** @param {string} baseUrl Worker base URL. @returns {typeof fetch} Same-origin fetch adapter. */
function createLocalFetch(baseUrl) {
  let cookie = "";
  return async (input, init = {}) => {
    try {
      const headers = new Headers(init.headers);
      if (cookie) headers.set("cookie", cookie);
      headers.set("origin", baseUrl);
      const response = await fetch(new URL(String(input), baseUrl), { ...init, headers });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";", 1)[0];
      return response;
    } catch (error) {
      throw new Error("Unable to reach the local activation Worker.", { cause: error });
    }
  };
}

/** @param {string} userAgent Browser-specific user agent. @returns {object} Stable physical-device signals. */
function createFingerprint(userAgent) {
  return {
    version: 2,
    platform: "macOS",
    userAgent,
    language: "zh-CN",
    languages: ["zh-CN", "zh"],
    timezone: "Asia/Shanghai",
    hardwareConcurrency: 12,
    maxTouchPoints: 0,
    screen: { width: 1728, height: 1117, colorDepth: 30, pixelRatio: 2 },
    userAgentData: {},
    webgl: {},
  };
}

/**
 * Creates one isolated browser client.
 * @param {string} baseUrl Worker base URL.
 * @param {string} browserName Browser label.
 * @returns {object} Device identity controller.
 */
function createBrowser(baseUrl, browserName) {
  return createController({
    fetchImpl: createLocalFetch(baseUrl),
    cryptoApi: globalThis.crypto,
    storage: createMemoryStorage(),
    navigatorRef: { platform: browserName },
    fingerprintCollector: async () => createFingerprint(`${browserName}/local-verification`),
  });
}

/** @returns {Promise<void>} Verifies cross-browser trial inheritance against a real local D1 Worker. */
async function main() {
  const baseUrl = String(process.env.XSXB_LOCAL_WORKER_URL || "http://127.0.0.1:8799");
  const firstBrowser = createBrowser(baseUrl, "Chrome");
  const secondBrowser = createBrowser(baseUrl, "Safari");
  const firstActivation = await firstBrowser.startTrial();
  const inheritedActivation = await secondBrowser.startTrial();
  if (firstActivation.deviceId === inheritedActivation.deviceId) {
    throw new Error("Each browser must receive its own signing-key binding.");
  }
  if (firstActivation.expiresAt !== inheritedActivation.expiresAt) {
    throw new Error("The inherited browser did not preserve the original trial expiry.");
  }
  const renewal = await secondBrowser.renew();
  if (!renewal?.activated || renewal.expiresAt !== firstActivation.expiresAt) {
    throw new Error("The inherited browser could not renew the shared trial.");
  }
  process.stdout.write(
    `${JSON.stringify({
      activated: true,
      originalDeviceId: firstActivation.deviceId,
      inheritedDeviceId: inheritedActivation.deviceId,
      expiresAt: firstActivation.expiresAt,
      renewalVerified: true,
    })}\n`,
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
