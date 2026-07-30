"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");
const {
  ProtectedArtifactError,
  createLoader,
} = require("../animation_tuner/public/protected_artifact_loader");

const ORIGIN = "https://app.example.test";
const VERSION = "release-2026.07.21";
const WASM_BYTES = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const WASM_SHA256 = createHash("sha256").update(WASM_BYTES).digest("hex");

/**
 * Creates a WASM response with an optional header override.
 * @param {Uint8Array} bytes Response bytes.
 * @param {HeadersInit} [headers] Response header overrides.
 * @returns {Response} Artifact response.
 */
function wasmResponse(bytes = WASM_BYTES, headers = {}) {
  return new Response(bytes, {
    headers: { "Content-Type": "application/wasm", ...headers },
  });
}

/**
 * Creates the data-driven static and controlled deployment fixture.
 * @returns {object} Loader configuration.
 */
function createConfiguration() {
  return {
    defaultMode: "static",
    origin: ORIGIN,
    modes: {
      static: {
        controlledDistribution: false,
        artifacts: {
          [VERSION]: {
            sha256: WASM_SHA256,
            url: `/assets/core.${WASM_SHA256.slice(0, 16)}.wasm`,
          },
        },
      },
      controlled: {
        controlledDistribution: true,
        authorizationUrl: "https://authorization.example.test/v1/session",
        artifactOrigin: "https://artifact.example.test",
        challengeAction: "algorithm-artifact-session",
        artifacts: { [VERSION]: { sha256: WASM_SHA256 } },
      },
    },
  };
}

/**
 * Creates standard browser dependencies with a supplied fetch double.
 * @param {(input:URL, init:RequestInit)=>Promise<Response>} fetch Fetch double.
 * @param {object} [overrides] Dependency overrides.
 * @returns {object} Loader dependencies.
 */
function createDependencies(fetch, overrides = {}) {
  return {
    AbortController,
    clearTimeout,
    fetch,
    now: () => 1_800_000_000_000,
    origin: ORIGIN,
    setTimeout,
    subtle: globalThis.crypto.subtle,
    ...overrides,
  };
}

/**
 * Asserts a stable protected artifact error code.
 * @param {Promise<unknown>} promise Rejected operation.
 * @param {string} code Expected stable code.
 * @returns {Promise<void>}
 */
async function rejectsWithCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ProtectedArtifactError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    return true;
  });
}

test("static mode fetches and verifies a manifest-selected WASM artifact", async () => {
  const requests = [];
  const loader = createLoader(
    createConfiguration(),
    createDependencies(async (input, init) => {
      requests.push({ init, url: input.toString() });
      return wasmResponse();
    }),
  );

  const result = await loader.load({ version: VERSION });
  assert.ok(result instanceof ArrayBuffer);
  assert.deepEqual(new Uint8Array(result), WASM_BYTES);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `https://app.example.test/assets/core.${WASM_SHA256.slice(0, 16)}.wasm`);
  assert.equal(requests[0].init.method, "GET");
  assert.deepEqual(requests[0].init.headers, {});
});

test("controlled mode exchanges only challenge/version then uses Bearer artifact authorization", async () => {
  const requests = [];
  const challengeCalls = [];
  const loader = createLoader(
    createConfiguration(),
    createDependencies(
      async (input, init) => {
        requests.push({ init, url: input.toString() });
        if (requests.length === 1) {
          return Response.json({
            artifactUrl: `https://artifact.example.test/v1/artifacts/${VERSION}/algorithm.wasm`,
            expiresAt: 1_800_000_300,
            token: "signed-session-token",
          });
        }
        return wasmResponse();
      },
      {
        challengeProvider: async (options) => {
          challengeCalls.push(options);
          return "single-use-challenge";
        },
      },
    ),
  );

  const result = await loader.load({ mode: "controlled", version: VERSION });
  assert.deepEqual(new Uint8Array(result), WASM_BYTES);
  assert.equal(challengeCalls[0].action, "algorithm-artifact-session");
  assert.equal(challengeCalls[0].version, VERSION);
  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    challengeToken: "single-use-challenge",
    version: VERSION,
  });
  assert.equal(Object.keys(JSON.parse(requests[0].init.body)).length, 2);
  assert.equal(requests[1].init.headers.Authorization, "Bearer signed-session-token");
  assert.equal(requests[1].init.cache, "no-store");
});

test("integrity mismatch fails explicitly and never supplies a fallback", async () => {
  const loader = createLoader(
    createConfiguration(),
    createDependencies(async () => wasmResponse(Uint8Array.from([0, 1, 2, 3]))),
  );
  await rejectsWithCode(loader.load({ version: VERSION }), "ENGINE_INTEGRITY_FAILED");
  assert.equal(Object.hasOwn(loader, "fallback"), false);
});

test("configuration locks the current Origin and validates requested versions", async () => {
  assert.throws(
    () =>
      createLoader(
        createConfiguration(),
        createDependencies(async () => wasmResponse(), { origin: "https://copied.example.test" }),
      ),
    (error) => error.code === "ENGINE_ARTIFACT_CONFIG_INVALID",
  );

  const loader = createLoader(
    createConfiguration(),
    createDependencies(async () => wasmResponse()),
  );
  await rejectsWithCode(loader.load({ version: "../other" }), "ENGINE_ARTIFACT_CONFIG_INVALID");
  await rejectsWithCode(loader.load({ version: "missing-release" }), "ENGINE_ARTIFACT_CONFIG_INVALID");
});

test("controlled mode rejects authorization, cross-origin, and cross-version session responses", async () => {
  const baseDependencies = {
    challengeProvider: async () => "challenge",
  };
  const authorizationFailure = createLoader(
    createConfiguration(),
    createDependencies(async () => new Response(null, { status: 403 }), baseDependencies),
  );
  await rejectsWithCode(
    authorizationFailure.load({ mode: "controlled", version: VERSION }),
    "ENGINE_ARTIFACT_AUTHORIZATION_FAILED",
  );

  for (const artifactUrl of [
    `https://copied.example.test/v1/artifacts/${VERSION}/algorithm.wasm`,
    "https://artifact.example.test/v1/artifacts/other-release/algorithm.wasm",
  ]) {
    const loader = createLoader(
      createConfiguration(),
      createDependencies(
        async () =>
          Response.json({
            artifactUrl,
            expiresAt: 1_800_000_300,
            token: "session",
          }),
        baseDependencies,
      ),
    );
    await rejectsWithCode(
      loader.load({ mode: "controlled", version: VERSION }),
      "ENGINE_ARTIFACT_PROTOCOL_INVALID",
    );
  }
});

test("timeout and caller Abort produce distinct stable codes", async () => {
  const configuration = createConfiguration();
  configuration.modes.static.timeoutMs = 5;
  const abortAwareFetch = async (_input, init) => {
    await new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
        once: true,
      });
    });
    return wasmResponse();
  };
  const timeoutLoader = createLoader(configuration, createDependencies(abortAwareFetch));
  await rejectsWithCode(timeoutLoader.load({ version: VERSION }), "ENGINE_ARTIFACT_TIMEOUT");

  const callerController = new AbortController();
  callerController.abort();
  const cancelledLoader = createLoader(
    createConfiguration(),
    createDependencies(async (_input, init) => {
      if (init.signal.aborted) throw new DOMException("aborted", "AbortError");
      return wasmResponse();
    }),
  );
  await rejectsWithCode(
    cancelledLoader.load({ signal: callerController.signal, version: VERSION }),
    "ENGINE_CANCELLED",
  );
});

test("artifact responses enforce WASM media type and configured byte bounds", async () => {
  const wrongType = createLoader(
    createConfiguration(),
    createDependencies(async () => new Response(WASM_BYTES, { headers: { "Content-Type": "text/plain" } })),
  );
  await rejectsWithCode(wrongType.load({ version: VERSION }), "ENGINE_ARTIFACT_FETCH_FAILED");

  const configuration = createConfiguration();
  configuration.modes.static.artifacts[VERSION].maxBytes = 4;
  const oversized = createLoader(
    configuration,
    createDependencies(async () => wasmResponse()),
  );
  await rejectsWithCode(oversized.load({ version: VERSION }), "ENGINE_ARTIFACT_PROTOCOL_INVALID");
});
