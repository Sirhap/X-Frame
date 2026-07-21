import assert from "node:assert/strict";
import { test } from "node:test";

import artifactWorker, { createObjectKey } from "../artifact/src/index.mjs";
import { signSession } from "../shared/session.mjs";
import {
  TEST_ORIGIN,
  TEST_SIGNING_KEY,
  TEST_VERSION,
  createRateLimiter,
  createStateStore,
} from "./helpers.mjs";

/**
 * Creates a signed session with optional claim overrides.
 * @param {Record<string, unknown>} overrides Claim overrides.
 * @returns {Promise<string>} Signed fixture token.
 */
async function createSession(overrides = {}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return signSession(
    {
      aud: "algorithm-artifact",
      exp: nowSeconds + 300,
      iat: nowSeconds,
      jti: "session-fixture",
      origin: TEST_ORIGIN,
      version: TEST_VERSION,
      ...overrides,
    },
    TEST_SIGNING_KEY,
  );
}

/**
 * Creates an Artifact Worker environment and captures private R2 keys.
 * @returns {{ env: Record<string, unknown>, requestedKeys: string[] }} Fixture.
 */
function createArtifactEnv() {
  const requestedKeys = [];
  return {
    requestedKeys,
    env: {
      ACTIVE_VERSIONS: TEST_VERSION,
      ALGORITHM_ARTIFACTS: {
        async get(key) {
          requestedKeys.push(key);
          const bytes = new Uint8Array([0, 97, 115, 109]);
          return {
            body: new Blob([bytes]).stream(),
            httpEtag: '"fixture-etag"',
            size: bytes.byteLength,
          };
        },
      },
      ALLOWED_ORIGINS: JSON.stringify([TEST_ORIGIN]),
      ARTIFACT_RATE_LIMITER: createRateLimiter(),
      GATE_STATE: createStateStore(),
      R2_OBJECT_PREFIX: "protected-releases",
      REVOKED_VERSIONS: "",
      SESSION_SIGNING_KEY: TEST_SIGNING_KEY,
    },
  };
}

/**
 * Creates an authorized artifact request.
 * @param {string} token Signed session token.
 * @param {string} origin Browser Origin.
 * @param {string} version URL artifact version.
 * @returns {Request} Request fixture.
 */
function createArtifactRequest(token, origin = TEST_ORIGIN, version = TEST_VERSION) {
  return new Request(`https://artifact.example.test/v1/artifacts/${version}/algorithm.wasm`, {
    headers: { Authorization: `Bearer ${token}`, Origin: origin },
  });
}

test("artifact worker validates session then streams a private R2 body", async () => {
  const token = await createSession();
  const { env, requestedKeys } = createArtifactEnv();
  const response = await artifactWorker.fetch(createArtifactRequest(token), env);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/wasm");
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("access-control-allow-origin"), TEST_ORIGIN);
  assert.equal(response.headers.get("vary"), "Origin, Authorization");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([0, 97, 115, 109]));
  assert.deepEqual(requestedKeys, [`protected-releases/${TEST_VERSION}/algorithm-core.wasm`]);
});

test("artifact worker binds a session to its exact Origin and version", async () => {
  const token = await createSession();
  const { env, requestedKeys } = createArtifactEnv();
  const copiedOrigin = await artifactWorker.fetch(
    createArtifactRequest(token, "https://copied.example.test"),
    env,
  );
  assert.equal(copiedOrigin.status, 403);

  env.ACTIVE_VERSIONS = `${TEST_VERSION},other-version`;
  const wrongVersion = await artifactWorker.fetch(
    createArtifactRequest(token, TEST_ORIGIN, "other-version"),
    env,
  );
  assert.equal(wrongVersion.status, 401);
  assert.equal(requestedKeys.length, 0);
});

test("artifact worker rejects expired, tampered, and revoked sessions", async () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expired = await createSession({ exp: nowSeconds - 1, iat: nowSeconds - 301 });
  const expiredFixture = createArtifactEnv();
  assert.equal((await artifactWorker.fetch(createArtifactRequest(expired), expiredFixture.env)).status, 401);

  const overlong = await createSession({ exp: nowSeconds + 901 });
  const overlongFixture = createArtifactEnv();
  assert.equal(
    (await artifactWorker.fetch(createArtifactRequest(overlong), overlongFixture.env)).status,
    401,
  );

  const valid = await createSession();
  const tampered = `${valid.slice(0, -1)}${valid.endsWith("A") ? "B" : "A"}`;
  const tamperedFixture = createArtifactEnv();
  assert.equal(
    (await artifactWorker.fetch(createArtifactRequest(tampered), tamperedFixture.env)).status,
    401,
  );

  const revokedFixture = createArtifactEnv();
  revokedFixture.env.GATE_STATE = createStateStore({ "revoked:session:session-fixture": "1" });
  assert.equal((await artifactWorker.fetch(createArtifactRequest(valid), revokedFixture.env)).status, 403);
});

test("artifact worker enforces active/revoked versions and rate limits before R2", async () => {
  const token = await createSession();
  const revokedFixture = createArtifactEnv();
  revokedFixture.env.REVOKED_VERSIONS = TEST_VERSION;
  assert.equal((await artifactWorker.fetch(createArtifactRequest(token), revokedFixture.env)).status, 403);
  assert.equal(revokedFixture.requestedKeys.length, 0);

  const limitedFixture = createArtifactEnv();
  limitedFixture.env.ARTIFACT_RATE_LIMITER = createRateLimiter(false);
  assert.equal((await artifactWorker.fetch(createArtifactRequest(token), limitedFixture.env)).status, 429);
  assert.equal(limitedFixture.requestedKeys.length, 0);
});

test("artifact worker fails closed when revocation state is unavailable", async () => {
  const token = await createSession();
  const fixture = createArtifactEnv();
  delete fixture.env.GATE_STATE;
  const response = await artifactWorker.fetch(createArtifactRequest(token), fixture.env);
  assert.equal(response.status, 503);
  assert.equal(fixture.requestedKeys.length, 0);
});

test("private object keys reject traversal prefixes", () => {
  assert.equal(
    createObjectKey(TEST_VERSION, "protected-releases"),
    `protected-releases/${TEST_VERSION}/algorithm-core.wasm`,
  );
  assert.throws(() => createObjectKey(TEST_VERSION, "../public"), /Invalid private artifact prefix/u);
});
