import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createController } = require("../animation_tuner/public/device_identity.js");

/** @returns {{get:()=>Promise<object|null>,put:(value:object)=>Promise<void>}} In-memory identity storage. */
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

/** @param {string} baseUrl Worker base URL. @returns {{fetchImpl:typeof fetch,getCookie:()=>string}} Cookie-aware local fetch. */
function createLocalFetch(baseUrl) {
  let cookie = "";
  return {
    async fetchImpl(input, init = {}) {
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
    },
    getCookie() {
      return cookie;
    },
  };
}

/** @returns {Promise<void>} Validates the complete challenge/signature/cookie flow. */
async function main() {
  const baseUrl = String(process.env.XSXB_LOCAL_WORKER_URL || "http://127.0.0.1:8799");
  const activationCode = String(process.env.XSXB_LOCAL_TEST_CODE || "");
  if (!activationCode) throw new Error("XSXB_LOCAL_TEST_CODE is required.");
  const localFetch = createLocalFetch(baseUrl);
  const controller = createController({
    fetchImpl: localFetch.fetchImpl,
    cryptoApi: globalThis.crypto,
    storage: createMemoryStorage(),
    navigatorRef: { platform: "Local verification" },
  });
  const activation = await controller.activate(activationCode);
  if (Object.hasOwn(activation, "token")) {
    throw new Error("Activation JSON exposed the HttpOnly session token.");
  }
  const statusResponse = await localFetch.fetchImpl("/api/activation", {
    headers: { accept: "application/json" },
  });
  const status = await statusResponse.json().catch(() => ({}));
  if (!statusResponse.ok || !status.activated || !localFetch.getCookie()) {
    throw new Error("Local activation status did not accept the issued cookie.");
  }
  process.stdout.write(
    `${JSON.stringify({
      activated: true,
      deviceId: activation.deviceId,
      expiresAt: activation.expiresAt,
      cookieIssued: true,
    })}\n`,
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
