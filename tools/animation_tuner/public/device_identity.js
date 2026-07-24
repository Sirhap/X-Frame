(function attachXsxbDeviceIdentity(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBDeviceIdentity = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const DATABASE_NAME = "xsxb_device_identity";
  const STORE_NAME = "identities";
  const IDENTITY_KEY = "primary";

  /** @param {ArrayBuffer|ArrayBufferView} value Bytes to encode. @returns {string} Base64url text. */
  function bytesToBase64Url(value) {
    const bytes =
      value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return root.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
  }

  /** @param {IDBRequest} request IndexedDB request. @returns {Promise<unknown>} Request result. */
  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener(
        "error",
        () => reject(request.error || new Error("IndexedDB request failed.")),
        { once: true },
      );
    });
  }

  /** @param {IDBTransaction} transaction IndexedDB transaction. @returns {Promise<void>} Commit completion. */
  function transactionCompletion(transaction) {
    return new Promise((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve(), { once: true });
      transaction.addEventListener(
        "abort",
        () => reject(transaction.error || new Error("IndexedDB transaction was aborted.")),
        { once: true },
      );
      transaction.addEventListener(
        "error",
        () => reject(transaction.error || new Error("IndexedDB transaction failed.")),
        { once: true },
      );
    });
  }

  /**
   * Creates persistent storage for the non-extractable browser private key.
   * @param {IDBFactory} indexedDb IndexedDB implementation.
   * @returns {{get:()=>Promise<object|null>,put:(identity:object)=>Promise<void>}} Identity storage.
   */
  function createIndexedDbStorage(indexedDb) {
    if (!indexedDb?.open) throw new TypeError("IndexedDB is required for device activation.");

    /** @returns {Promise<IDBDatabase>} Open identity database. */
    async function openDatabase() {
      try {
        const request = indexedDb.open(DATABASE_NAME, 1);
        request.addEventListener("upgradeneeded", () => {
          if (!request.result.objectStoreNames.contains(STORE_NAME)) {
            request.result.createObjectStore(STORE_NAME);
          }
        });
        return /** @type {IDBDatabase} */ (await requestResult(request));
      } catch (error) {
        throw new Error("Unable to open browser device storage.", { cause: error });
      }
    }

    return Object.freeze({
      async get() {
        const database = await openDatabase();
        try {
          const transaction = database.transaction(STORE_NAME, "readonly");
          const request = transaction.objectStore(STORE_NAME).get(IDENTITY_KEY);
          const [value] = await Promise.all([requestResult(request), transactionCompletion(transaction)]);
          return value && typeof value === "object" ? value : null;
        } catch (error) {
          throw new Error("Unable to read the browser device key.", { cause: error });
        } finally {
          database.close();
        }
      },
      async put(identity) {
        const database = await openDatabase();
        try {
          const transaction = database.transaction(STORE_NAME, "readwrite");
          const request = transaction.objectStore(STORE_NAME).put(identity, IDENTITY_KEY);
          await Promise.all([requestResult(request), transactionCompletion(transaction)]);
        } catch (error) {
          throw new Error("Unable to save the browser device key.", { cause: error });
        } finally {
          database.close();
        }
      },
    });
  }

  /** @param {object|null} identity Stored identity. @returns {boolean} Whether it is usable. */
  function isUsableIdentity(identity) {
    return Boolean(
      identity?.privateKey?.type === "private" &&
        identity.privateKey.extractable === false &&
        identity.privateKey.algorithm?.name === "ECDSA" &&
        identity.privateKey.algorithm?.namedCurve === "P-256" &&
        identity.publicKey?.kty === "EC" &&
        identity.publicKey?.crv === "P-256",
    );
  }

  /**
   * Creates the browser device activation protocol client.
   * @param {{fetchImpl?:typeof fetch,cryptoApi?:Crypto,storage?:object,navigatorRef?:Navigator,fingerprintCollector?:()=>Promise<object>}} [dependencies] Runtime adapters.
   * @returns {{activate:(code:string,options?:object)=>Promise<object>,startTrial:()=>Promise<object>,renew:()=>Promise<object|null>,unbind:()=>Promise<object>,ensureIdentity:()=>Promise<object>}} Device client.
   */
  function createController(dependencies = {}) {
    const fetchImpl = dependencies.fetchImpl || root?.fetch;
    const cryptoApi = dependencies.cryptoApi || root?.crypto;
    const storage = dependencies.storage || createIndexedDbStorage(root?.indexedDB);
    const navigatorRef = dependencies.navigatorRef || root?.navigator;
    const fingerprintCollector =
      dependencies.fingerprintCollector ||
      (() =>
        root?.XSXBDeviceFingerprint?.collect?.({
          navigatorRef,
          screenRef: root?.screen,
          documentRef: root?.document,
          devicePixelRatio: root?.devicePixelRatio,
        }));
    if (typeof fetchImpl !== "function" || !cryptoApi?.subtle || !cryptoApi?.randomUUID) {
      throw new TypeError("Web Crypto and fetch are required for device activation.");
    }

    /** @returns {Promise<object>} Existing or newly generated device identity. */
    async function ensureIdentity() {
      try {
        const existing = await storage.get();
        if (isUsableIdentity(existing)) return existing;
        const keyPair = await cryptoApi.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
          "sign",
          "verify",
        ]);
        const publicKey = await cryptoApi.subtle.exportKey("jwk", keyPair.publicKey);
        const identity = {
          id: cryptoApi.randomUUID(),
          deviceId: "",
          privateKey: keyPair.privateKey,
          publicKey,
        };
        await storage.put(identity);
        return identity;
      } catch (error) {
        throw new Error("Unable to prepare this browser for activation.", { cause: error });
      }
    }

    /** @param {string} pathname API pathname. @param {object} payload JSON payload. @returns {Promise<object>} JSON result. */
    async function postJson(pathname, payload) {
      try {
        const response = await fetchImpl(pathname, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw Object.assign(new Error(String(result.error || "Activation request failed.")), {
            status: response.status,
            code: String(result.code || ""),
            details: result.details && typeof result.details === "object" ? result.details : null,
          });
        }
        return result;
      } catch (error) {
        if (error instanceof Error) throw error;
        throw new Error("Activation request failed.", { cause: error });
      }
    }

    /**
     * Verifies a challenge and sends current device signals for authenticated signature upgrades.
     * @param {object} identity Device identity.
     * @param {object} challengeResult Challenge response.
     * @param {object|null} fingerprint Current device fingerprint.
     * @returns {Promise<object>} Verified session.
     */
    async function verify(identity, challengeResult, fingerprint = null) {
      try {
        const challenge = String(challengeResult.challenge || "");
        if (!challenge) throw new Error("Activation challenge is missing.");
        const signature = await cryptoApi.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          identity.privateKey,
          new TextEncoder().encode(challenge),
        );
        const result = await postJson("/api/activation/verify", {
          challenge,
          signature: bytesToBase64Url(signature),
          ...(fingerprint ? { fingerprint } : {}),
        });
        if (!result.activated) throw new Error("Activation verification failed.");
        if (result.deviceId && identity.deviceId !== result.deviceId) {
          identity.deviceId = String(result.deviceId);
          await storage.put(identity);
        }
        return result;
      } catch (error) {
        if (error instanceof Error) throw error;
        throw new Error("Unable to prove this browser identity.", { cause: error });
      }
    }

    /** @returns {string} Human-readable browser family without exposing the full User-Agent. */
    function browserName() {
      const brands = Array.isArray(navigatorRef?.userAgentData?.brands)
        ? navigatorRef.userAgentData.brands
        : [];
      const preferredBrand = brands
        .map((entry) => String(entry?.brand || ""))
        .find((brand) => brand && !/chromium|not.?a.?brand/iu.test(brand));
      const brand = preferredBrand || "";
      if (/microsoft edge/iu.test(brand)) return "Edge";
      if (/google chrome/iu.test(brand)) return "Chrome";
      if (/opera/iu.test(brand)) return "Opera";
      if (/firefox/iu.test(brand)) return "Firefox";

      const userAgent = String(navigatorRef?.userAgent || "");
      if (/\bEdg\//u.test(userAgent)) return "Edge";
      if (/\bOPR\//u.test(userAgent)) return "Opera";
      if (/\bFirefox\//u.test(userAgent)) return "Firefox";
      if (/\bChrome\//u.test(userAgent)) return "Chrome";
      if (/\bSafari\//u.test(userAgent)) return "Safari";
      return "";
    }

    /** @returns {string} Bounded device label that distinguishes browsers on the same platform. */
    function deviceName() {
      const platform = String(
        navigatorRef?.userAgentData?.platform || navigatorRef?.platform || "Browser device",
      ).trim();
      return [browserName(), platform].filter(Boolean).join(" · ").slice(0, 80);
    }

    /** @returns {Promise<object|null>} Hashed-on-server browser fingerprint payload. */
    async function collectFingerprint() {
      if (typeof fingerprintCollector !== "function") return null;
      try {
        const fingerprint = await fingerprintCollector();
        return fingerprint && typeof fingerprint === "object" ? fingerprint : null;
      } catch (_error) {
        return null;
      }
    }

    return Object.freeze({
      async activate(code, options = {}) {
        try {
          const identity = await ensureIdentity();
          const fingerprint = await collectFingerprint();
          const challenge = await postJson("/api/activation/challenge", {
            code: String(code || ""),
            publicKey: identity.publicKey,
            deviceName: deviceName(),
            fingerprint,
            ...(options.replaceDeviceId ? { replaceDeviceId: String(options.replaceDeviceId) } : {}),
            ...(Number.isSafeInteger(options.deviceOffset) ? { deviceOffset: options.deviceOffset } : {}),
          });
          return await verify(identity, challenge, fingerprint);
        } catch (error) {
          if (error instanceof Error) throw error;
          throw new Error("Unable to activate this browser.", { cause: error });
        }
      },
      async startTrial() {
        try {
          const identity = await ensureIdentity();
          const fingerprint = await collectFingerprint();
          if (!fingerprint)
            throw new Error("Unable to collect the device information required for the trial.");
          const challenge = await postJson("/api/activation/trial-challenge", {
            publicKey: identity.publicKey,
            deviceName: deviceName(),
            fingerprint,
          });
          return await verify(identity, challenge, fingerprint);
        } catch (error) {
          if (error instanceof Error) throw error;
          throw new Error("Unable to start the three-day trial.", { cause: error });
        }
      },
      async renew() {
        try {
          const identity = await storage.get();
          if (!isUsableIdentity(identity) || !identity.deviceId) return null;
          const challenge = await postJson("/api/activation/device-challenge", {
            deviceId: identity.deviceId,
          });
          return await verify(identity, challenge, await collectFingerprint());
        } catch (error) {
          if (error instanceof Error) throw error;
          throw new Error("Unable to renew this browser session.", { cause: error });
        }
      },
      async unbind() {
        try {
          const result = await postJson("/api/activation/unbind", {});
          const identity = await storage.get();
          if (isUsableIdentity(identity) && identity.deviceId) {
            identity.deviceId = "";
            await storage.put(identity);
          }
          return result;
        } catch (error) {
          if (error instanceof Error) throw error;
          throw new Error("Unable to unbind this browser.", { cause: error });
        }
      },
      ensureIdentity,
    });
  }

  return Object.freeze({ createController, createIndexedDbStorage });
});
