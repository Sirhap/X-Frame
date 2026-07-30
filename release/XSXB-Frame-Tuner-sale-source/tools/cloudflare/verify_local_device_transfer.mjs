import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createController } = require("../animation_tuner/public/device_identity.js");

/** @returns {{get:()=>Promise<object|null>,put:(value:object)=>Promise<void>}} Isolated browser storage. */
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

/** @param {string} baseUrl Worker base URL. @returns {typeof fetch} Cookie-aware same-origin fetch. */
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

/** @param {string} baseUrl Worker URL. @param {string} name Device name. @returns {object} Device client. */
function createBrowser(baseUrl, name) {
  return createController({
    fetchImpl: createLocalFetch(baseUrl),
    cryptoApi: globalThis.crypto,
    storage: createMemoryStorage(),
    navigatorRef: { platform: name },
    fingerprintCollector: async () => ({
      platform: "macOS",
      userAgent: `${name}/local-verification`,
    }),
  });
}

/** @returns {Promise<void>} Verifies explicit multi-device replacement and self-unbind. */
async function main() {
  const baseUrl = String(process.env.XSXB_LOCAL_WORKER_URL || "http://127.0.0.1:8799");
  const activationCode = String(process.env.XSXB_LOCAL_TEST_CODE || "");
  if (!activationCode) throw new Error("XSXB_LOCAL_TEST_CODE is required.");
  const studioBrowser = createBrowser(baseUrl, "Studio Mac");
  const renderBrowser = createBrowser(baseUrl, "Render PC");
  const travelBrowser = createBrowser(baseUrl, "Travel Mac");
  const studioActivation = await studioBrowser.activate(activationCode);
  const renderActivation = await renderBrowser.activate(activationCode);

  let limitError = null;
  try {
    await travelBrowser.activate(activationCode);
  } catch (error) {
    limitError = error;
  }
  if (limitError?.code !== "DEVICE_LIMIT_REACHED" || limitError?.details?.devices?.length !== 2) {
    throw new Error("The full code did not return two replaceable devices.");
  }
  await assertReplacementRejected(travelBrowser, activationCode, "missing-device");
  if (!(await studioBrowser.renew())?.activated || !(await renderBrowser.renew())?.activated) {
    throw new Error("A stale replacement selection invalidated an existing device.");
  }
  const transferred = await travelBrowser.activate(activationCode, {
    replaceDeviceId: studioActivation.deviceId,
  });
  if (!transferred.activated || transferred.deviceId === studioActivation.deviceId) {
    throw new Error("The selected device was not replaced by the new browser.");
  }
  await assertRenewalRejected(studioBrowser);
  if (!(await renderBrowser.renew())?.activated) {
    throw new Error("An unselected device was incorrectly invalidated.");
  }
  const unbound = await travelBrowser.unbind();
  if (!unbound.unbound || (await travelBrowser.renew()) !== null) {
    throw new Error("The current browser did not clear its binding after self-unbind.");
  }
  process.stdout.write(
    `${JSON.stringify({
      activated: true,
      replacedDeviceId: studioActivation.deviceId,
      preservedDeviceId: renderActivation.deviceId,
      currentDeviceId: transferred.deviceId,
      staleSelectionRejected: true,
      oldDeviceRejected: true,
      selfUnbindVerified: true,
    })}\n`,
  );
}

/**
 * @param {object} browser Device client.
 * @param {string} activationCode Activation code.
 * @param {string} replacementDeviceId Invalid device selection.
 * @returns {Promise<void>}
 */
async function assertReplacementRejected(browser, activationCode, replacementDeviceId) {
  try {
    await browser.activate(activationCode, { replaceDeviceId: replacementDeviceId });
  } catch (error) {
    if (error?.code === "DEVICE_LIMIT_REACHED") return;
    throw error;
  }
  throw new Error("A stale replacement selection was unexpectedly accepted.");
}

/** @param {object} browser Device client. @returns {Promise<void>} */
async function assertRenewalRejected(browser) {
  try {
    await browser.renew();
  } catch (_error) {
    return;
  }
  throw new Error("The replaced device could still renew its authorization.");
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
