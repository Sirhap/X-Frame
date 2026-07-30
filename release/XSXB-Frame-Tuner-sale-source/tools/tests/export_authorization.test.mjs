import assert from "node:assert/strict";
import test from "node:test";

import { handleExportAuthorizationRequest } from "../../cloudflare/site/src/export_authorization.mjs";

const fixedNow = Date.parse("2026-07-22T08:00:00.000Z");
const activationSecret = "test-secret-with-at-least-thirty-two-characters";

/** @param {string} pathname API path. @param {object} body JSON body. @param {string} [origin] Origin. */
function exportRequest(pathname, body, origin = "https://example.com") {
  return new Request(`https://example.com${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

test("device-bound export authorization issues and verifies a short-lived permit", async () => {
  const options = {
    now: () => fixedNow,
    activationService: {
      async status() {
        return { activated: true, configured: true, deviceId: "device-1" };
      },
    },
  };
  const env = { XSXB_ACTIVATION_SECRET: activationSecret };
  const authorized = await handleExportAuthorizationRequest(
    exportRequest("/api/export/authorize", { features: ["organizer.output", "tuner.collision-boxes"] }),
    env,
    options,
  );
  const authorization = await authorized.json();

  assert.equal(authorized.status, 200);
  assert.equal(authorization.authorized, true);
  assert.match(authorization.permit, /^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/u);

  const verified = await handleExportAuthorizationRequest(
    exportRequest("/api/export/verify", {
      features: ["organizer.output", "tuner.collision-boxes"],
      permit: authorization.permit,
    }),
    env,
    options,
  );
  assert.equal(verified.status, 200);
  assert.equal((await verified.json()).authorized, true);
});

test("export authorization rejects inactive sessions and cross-origin requests", async () => {
  const env = { XSXB_ACTIVATION_SECRET: activationSecret };
  const inactive = await handleExportAuthorizationRequest(
    exportRequest("/api/export/authorize", { features: ["tuner.frame-playback"] }),
    env,
    {
      now: () => fixedNow,
      activationService: { status: async () => ({ activated: false, configured: true }) },
    },
  );
  assert.equal(inactive.status, 401);

  const crossOrigin = await handleExportAuthorizationRequest(
    exportRequest(
      "/api/export/authorize",
      { features: ["tuner.frame-playback"] },
      "https://attacker.example",
    ),
    env,
    {
      now: () => fixedNow,
      activationService: { status: async () => ({ activated: true, deviceId: "device-1" }) },
    },
  );
  assert.equal(crossOrigin.status, 403);
});
