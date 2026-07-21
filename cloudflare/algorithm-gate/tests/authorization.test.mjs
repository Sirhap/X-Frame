import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import authorizationWorker from "../authorization/src/index.mjs";
import { hashCredential } from "../shared/policy.mjs";
import { verifySession } from "../shared/session.mjs";
import {
  TEST_ORIGIN,
  TEST_SIGNING_KEY,
  TEST_VERSION,
  createAuthorizationEnv,
  createAuthorizationRequest,
  createRateLimiter,
  createStateStore,
} from "./helpers.mjs";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * Installs a deterministic Siteverify response and captures its server-only payload.
 * @param {Record<string, unknown>} responseBody Siteverify response.
 * @returns {Record<string, unknown>[]} Captured request bodies.
 */
function installSiteverify(responseBody) {
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return Response.json(responseBody);
  };
  return requests;
}

test("authorization validates Turnstile server-side and issues a scoped short session", async () => {
  const siteverifyRequests = installSiteverify({
    action: "algorithm-artifact-session",
    hostname: "app.example.test",
    success: true,
  });
  const env = createAuthorizationEnv();
  const response = await authorizationWorker.fetch(
    createAuthorizationRequest({ challengeToken: "challenge", version: TEST_VERSION }),
    env,
  );

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("access-control-allow-origin"), TEST_ORIGIN);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const result = await response.json();
  assert.equal(
    result.artifactUrl,
    `https://artifact.example.test/v1/artifacts/${TEST_VERSION}/algorithm.wasm`,
  );
  const claims = await verifySession(result.token, TEST_SIGNING_KEY, {
    audience: "algorithm-artifact",
  });
  assert.equal(claims.origin, TEST_ORIGIN);
  assert.equal(claims.version, TEST_VERSION);
  assert.ok(claims.exp - claims.iat <= 300);
  assert.equal(siteverifyRequests.length, 1);
  assert.equal(siteverifyRequests[0].secret, "bound-test-secret");
  assert.equal(siteverifyRequests[0].response, "challenge");
});

test("authorization rejects an unlisted Origin before external verification", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ success: true });
  };
  const response = await authorizationWorker.fetch(
    createAuthorizationRequest(
      { challengeToken: "challenge", version: TEST_VERSION },
      "https://copied.example.test",
    ),
    createAuthorizationEnv(),
  );

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(calls, 0);
});

test("authorization rejects inactive and revoked versions before Turnstile", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ success: true });
  };
  const inactiveResponse = await authorizationWorker.fetch(
    createAuthorizationRequest({ challengeToken: "challenge", version: "old-release" }),
    createAuthorizationEnv(),
  );
  assert.equal(inactiveResponse.status, 404);

  const revokedEnv = createAuthorizationEnv();
  revokedEnv.GATE_STATE = createStateStore({ [`revoked:version:${TEST_VERSION}`]: "1" });
  const revokedResponse = await authorizationWorker.fetch(
    createAuthorizationRequest({ challengeToken: "challenge", version: TEST_VERSION }),
    revokedEnv,
  );
  assert.equal(revokedResponse.status, 403);
  assert.equal(calls, 0);
});

test("authorization enforces entitlement records by hashed credential", async () => {
  installSiteverify({ action: "algorithm-artifact-session", hostname: "app.example.test", success: true });
  const env = createAuthorizationEnv();
  env.REQUIRE_ENTITLEMENT = "true";

  const response = await authorizationWorker.fetch(
    createAuthorizationRequest({
      challengeToken: "challenge",
      entitlementCredential: "credential-without-a-record",
      version: TEST_VERSION,
    }),
    env,
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "NOT_AUTHORIZED" });
});

test("authorization accepts an active version-scoped entitlement without storing the credential", async () => {
  installSiteverify({
    action: "algorithm-artifact-session",
    hostname: "app.example.test",
    success: true,
  });
  const credential = "random-entitlement-credential-with-32-plus-characters";
  const credentialHash = await hashCredential(credential);
  const env = createAuthorizationEnv();
  env.REQUIRE_ENTITLEMENT = "true";
  env.GATE_STATE = createStateStore({
    [`entitlement:${credentialHash}`]: JSON.stringify({
      active: true,
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      versions: [TEST_VERSION],
    }),
  });

  const response = await authorizationWorker.fetch(
    createAuthorizationRequest({
      challengeToken: "challenge",
      entitlementCredential: credential,
      version: TEST_VERSION,
    }),
    env,
  );
  assert.equal(response.status, 201);
});

test("authorization validates Turnstile hostname and action", async () => {
  installSiteverify({ action: "other-action", hostname: "app.example.test", success: true });
  const wrongAction = await authorizationWorker.fetch(
    createAuthorizationRequest({ challengeToken: "challenge", version: TEST_VERSION }),
    createAuthorizationEnv(),
  );
  assert.equal(wrongAction.status, 403);

  installSiteverify({
    action: "algorithm-artifact-session",
    hostname: "copied.example.test",
    success: true,
  });
  const wrongHostname = await authorizationWorker.fetch(
    createAuthorizationRequest({ challengeToken: "challenge", version: TEST_VERSION }),
    createAuthorizationEnv(),
  );
  assert.equal(wrongHostname.status, 403);
});

test("authorization distinguishes exceeded rate limits from unavailable bindings", async () => {
  const exceededEnv = createAuthorizationEnv();
  exceededEnv.AUTH_RATE_LIMITER = createRateLimiter(false);
  const exceeded = await authorizationWorker.fetch(
    createAuthorizationRequest({ challengeToken: "challenge", version: TEST_VERSION }),
    exceededEnv,
  );
  assert.equal(exceeded.status, 429);

  const unavailableEnv = createAuthorizationEnv();
  delete unavailableEnv.AUTH_RATE_LIMITER;
  const unavailable = await authorizationWorker.fetch(
    createAuthorizationRequest({ challengeToken: "challenge", version: TEST_VERSION }),
    unavailableEnv,
  );
  assert.equal(unavailable.status, 503);
});

test("authorization reports Siteverify outages without treating them as a user challenge failure", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("network unavailable");
  };
  const response = await authorizationWorker.fetch(
    createAuthorizationRequest({ challengeToken: "challenge", version: TEST_VERSION }),
    createAuthorizationEnv(),
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "AUTHORIZATION_UNAVAILABLE" });
});

test("authorization fails closed when revocation state is unavailable", async () => {
  const env = createAuthorizationEnv();
  delete env.GATE_STATE;
  const response = await authorizationWorker.fetch(
    createAuthorizationRequest({ challengeToken: "challenge", version: TEST_VERSION }),
    env,
  );
  assert.equal(response.status, 503);
});

test("authorization rejects oversized bodies and strict CORS headers", async () => {
  const oversized = new Request("https://authorization.example.test/v1/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
    body: JSON.stringify({ challengeToken: "x".repeat(5000), version: TEST_VERSION }),
  });
  const oversizedResponse = await authorizationWorker.fetch(oversized, createAuthorizationEnv());
  assert.equal(oversizedResponse.status, 400);

  const preflight = new Request("https://authorization.example.test/v1/session", {
    method: "OPTIONS",
    headers: {
      "Access-Control-Request-Headers": "X-Leaky-Header",
      Origin: TEST_ORIGIN,
    },
  });
  const preflightResponse = await authorizationWorker.fetch(preflight, createAuthorizationEnv());
  assert.equal(preflightResponse.status, 403);
});
