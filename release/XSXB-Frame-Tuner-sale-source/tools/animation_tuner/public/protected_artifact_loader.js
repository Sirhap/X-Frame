(function attachProtectedArtifactLoader(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ProtectedArtifactLoader = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const DEFAULT_TIMEOUT_MS = 15_000;
  const DEFAULT_MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
  const VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
  const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

  class ProtectedArtifactError extends Error {
    /**
     * Creates a stable public artifact-loading failure.
     * @param {string} code Machine-readable error code.
     * @param {unknown} [cause] Private diagnostic cause.
     */
    constructor(code, cause) {
      super(code, cause === undefined ? undefined : { cause });
      this.name = "ProtectedArtifactError";
      this.code = code;
    }
  }

  /**
   * Throws one stable configuration error.
   * @param {boolean} condition Required invariant.
   * @returns {void}
   */
  function requireConfig(condition) {
    if (!condition) throw new ProtectedArtifactError("ENGINE_ARTIFACT_CONFIG_INVALID");
  }

  /**
   * Normalizes a URL and rejects embedded credentials or non-HTTP protocols.
   * @param {unknown} value Candidate URL.
   * @param {string} baseUrl Trusted base URL.
   * @returns {URL} Validated URL.
   */
  function normalizeHttpUrl(value, baseUrl) {
    requireConfig(typeof value === "string" && value.length > 0);
    let url;
    try {
      url = new root.URL(value, baseUrl);
    } catch (error) {
      throw new ProtectedArtifactError("ENGINE_ARTIFACT_CONFIG_INVALID", error);
    }
    requireConfig(["http:", "https:"].includes(url.protocol));
    requireConfig(url.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
    requireConfig(!url.username && !url.password);
    return url;
  }

  /**
   * Creates a child abort signal with a deterministic timeout.
   * @param {AbortSignal | undefined} callerSignal Optional caller cancellation signal.
   * @param {number} timeoutMs Timeout duration.
   * @param {object} dependencies Browser dependency adapters.
   * @returns {{signal:AbortSignal, didTimeout:()=>boolean, assertActive:()=>void, dispose:()=>void}} Timeout scope.
   */
  function createAbortScope(callerSignal, timeoutMs, dependencies) {
    const controller = new dependencies.AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort(callerSignal.reason);
    if (callerSignal?.aborted) abortFromCaller();
    else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeoutId = dependencies.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    return {
      signal: controller.signal,
      didTimeout: () => timedOut,
      assertActive() {
        if (timedOut) throw new ProtectedArtifactError("ENGINE_ARTIFACT_TIMEOUT");
        if (callerSignal?.aborted) throw new ProtectedArtifactError("ENGINE_CANCELLED");
      },
      dispose() {
        dependencies.clearTimeout(timeoutId);
        callerSignal?.removeEventListener("abort", abortFromCaller);
      },
    };
  }

  /**
   * Reads a bounded response body into an owned ArrayBuffer.
   * @param {Response} response Fetch response.
   * @param {number} maximumBytes Maximum accepted bytes.
   * @returns {Promise<ArrayBuffer>} Owned response bytes.
   */
  async function readBoundedBuffer(response, maximumBytes) {
    const declaredLength = Number(response.headers.get("Content-Length") || 0);
    if (declaredLength > maximumBytes) {
      throw new ProtectedArtifactError("ENGINE_ARTIFACT_PROTOCOL_INVALID");
    }
    if (!response.body) throw new ProtectedArtifactError("ENGINE_ARTIFACT_PROTOCOL_INVALID");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximumBytes) {
          await reader.cancel();
          throw new ProtectedArtifactError("ENGINE_ARTIFACT_PROTOCOL_INVALID");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes.buffer;
  }

  /**
   * Reads a small JSON protocol response.
   * @param {Response} response Fetch response.
   * @returns {Promise<unknown>} Parsed JSON value.
   */
  async function readProtocolJson(response) {
    const buffer = await readBoundedBuffer(response, 8192);
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
    } catch (error) {
      throw new ProtectedArtifactError("ENGINE_ARTIFACT_PROTOCOL_INVALID", error);
    }
  }

  /**
   * Returns a lowercase SHA-256 digest for artifact verification.
   * @param {ArrayBuffer} buffer Artifact bytes.
   * @param {SubtleCrypto} subtle Web Crypto implementation.
   * @returns {Promise<string>} Hex digest.
   */
  async function sha256(buffer, subtle) {
    const digest = new Uint8Array(await subtle.digest("SHA-256", buffer));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Compares fixed-length digest strings without early exit.
   * @param {string} actual Computed digest.
   * @param {string} expected Manifest digest.
   * @returns {boolean} Whether both values match.
   */
  function equalDigest(actual, expected) {
    if (actual.length !== expected.length) return false;
    let difference = 0;
    for (let index = 0; index < actual.length; index += 1) {
      difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
    }
    return difference === 0;
  }

  /**
   * Converts transport and cancellation failures to stable public errors.
   * @param {unknown} reason Failure value.
   * @param {{didTimeout:()=>boolean}} abortScope Active abort scope.
   * @param {AbortSignal | undefined} callerSignal Caller cancellation signal.
   * @param {string} fallbackCode Stable fallback code.
   * @returns {ProtectedArtifactError} Stable error.
   */
  function normalizeError(reason, abortScope, callerSignal, fallbackCode) {
    if (reason instanceof ProtectedArtifactError) return reason;
    if (abortScope.didTimeout()) return new ProtectedArtifactError("ENGINE_ARTIFACT_TIMEOUT", reason);
    if (callerSignal?.aborted || reason?.name === "AbortError") {
      return new ProtectedArtifactError("ENGINE_CANCELLED", reason);
    }
    return new ProtectedArtifactError(fallbackCode, reason);
  }

  /**
   * Creates a data-driven static/controlled WASM artifact loader.
   * @param {object} configuration Deployment mode configuration.
   * @param {object} [injected] Browser dependencies for testing and challenge integration.
   * @returns {{load(options?:{mode?:string,version:string,signal?:AbortSignal}):Promise<ArrayBuffer>}} Loader.
   */
  function createLoader(configuration, injected = {}) {
    const dependencies = {
      AbortController: injected.AbortController || root.AbortController,
      challengeProvider: injected.challengeProvider,
      clearTimeout: injected.clearTimeout || root.clearTimeout.bind(root),
      fetch: injected.fetch || root.fetch.bind(root),
      now: injected.now || Date.now,
      origin: injected.origin || root.location?.origin,
      setTimeout: injected.setTimeout || root.setTimeout.bind(root),
      subtle: injected.subtle || root.crypto?.subtle,
    };
    requireConfig(configuration?.modes && typeof configuration.modes === "object");
    requireConfig(typeof dependencies.fetch === "function" && dependencies.subtle);
    requireConfig(typeof dependencies.AbortController === "function");
    const configuredOrigin = normalizeHttpUrl(
      configuration.origin || dependencies.origin,
      dependencies.origin || "https://invalid.local",
    ).origin;
    requireConfig(configuredOrigin === dependencies.origin);

    /**
     * Loads and verifies one protected WASM artifact without any JavaScript fallback.
     * @param {{mode?:string,version:string,signal?:AbortSignal}} options Load options.
     * @returns {Promise<ArrayBuffer>} Verified WASM bytes.
     */
    async function load(options) {
      const modeName = options?.mode || configuration.defaultMode;
      const version = options?.version;
      requireConfig(typeof modeName === "string" && VERSION_PATTERN.test(version));
      const mode = configuration.modes[modeName];
      const artifact = mode?.artifacts?.[version];
      requireConfig(mode && artifact && SHA256_PATTERN.test(artifact.sha256));
      const timeoutMs = Number(mode.timeoutMs || configuration.timeoutMs || DEFAULT_TIMEOUT_MS);
      const maximumBytes = Number(artifact.maxBytes || mode.maxArtifactBytes || DEFAULT_MAX_ARTIFACT_BYTES);
      requireConfig(Number.isFinite(timeoutMs) && timeoutMs > 0);
      requireConfig(Number.isSafeInteger(maximumBytes) && maximumBytes > 0);
      const abortScope = createAbortScope(options.signal, timeoutMs, dependencies);

      try {
        abortScope.assertActive();
        let artifactUrl;
        let authorization;
        if (mode.controlledDistribution === true) {
          try {
            requireConfig(typeof dependencies.challengeProvider === "function");
            const authorizationUrl = normalizeHttpUrl(mode.authorizationUrl, configuredOrigin);
            const challengeToken = await dependencies.challengeProvider({
              action: mode.challengeAction,
              signal: abortScope.signal,
              version,
            });
            abortScope.assertActive();
            requireConfig(typeof challengeToken === "string" && challengeToken.length > 0);
            const sessionResponse = await dependencies.fetch(authorizationUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ challengeToken, version }),
              cache: "no-store",
              credentials: "omit",
              referrerPolicy: "no-referrer",
              signal: abortScope.signal,
            });
            abortScope.assertActive();
            if (!sessionResponse.ok) {
              throw new ProtectedArtifactError("ENGINE_ARTIFACT_AUTHORIZATION_FAILED");
            }
            const session = await readProtocolJson(sessionResponse);
            abortScope.assertActive();
            if (
              !session ||
              typeof session !== "object" ||
              typeof session.token !== "string" ||
              !Number.isSafeInteger(session.expiresAt) ||
              session.expiresAt <= Math.floor(dependencies.now() / 1000)
            ) {
              throw new ProtectedArtifactError("ENGINE_ARTIFACT_PROTOCOL_INVALID");
            }
            artifactUrl = normalizeHttpUrl(session.artifactUrl, configuredOrigin);
            const artifactOrigin = normalizeHttpUrl(mode.artifactOrigin, configuredOrigin).origin;
            if (artifactUrl.origin !== artifactOrigin || !artifactUrl.pathname.includes(`/${version}/`)) {
              throw new ProtectedArtifactError("ENGINE_ARTIFACT_PROTOCOL_INVALID");
            }
            authorization = `Bearer ${session.token}`;
          } catch (error) {
            throw normalizeError(error, abortScope, options.signal, "ENGINE_ARTIFACT_AUTHORIZATION_FAILED");
          }
        } else {
          requireConfig(mode.controlledDistribution === false);
          artifactUrl = normalizeHttpUrl(artifact.url, configuredOrigin);
        }

        const response = await dependencies.fetch(artifactUrl, {
          method: "GET",
          headers: authorization ? { Authorization: authorization } : {},
          cache: mode.controlledDistribution ? "no-store" : "default",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal: abortScope.signal,
        });
        abortScope.assertActive();
        if (!response.ok || response.headers.get("Content-Type")?.split(";", 1)[0] !== "application/wasm") {
          throw new ProtectedArtifactError("ENGINE_ARTIFACT_FETCH_FAILED");
        }
        const buffer = await readBoundedBuffer(response, maximumBytes);
        abortScope.assertActive();
        const actualSha256 = await sha256(buffer, dependencies.subtle);
        abortScope.assertActive();
        if (!equalDigest(actualSha256, artifact.sha256)) {
          throw new ProtectedArtifactError("ENGINE_INTEGRITY_FAILED");
        }
        return buffer;
      } catch (error) {
        throw normalizeError(error, abortScope, options.signal, "ENGINE_ARTIFACT_FETCH_FAILED");
      } finally {
        abortScope.dispose();
      }
    }

    return Object.freeze({ load });
  }

  return Object.freeze({ ProtectedArtifactError, createLoader });
});
