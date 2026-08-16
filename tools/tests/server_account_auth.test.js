"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createLocalAccountAuthService } = require("../animation_tuner/server_account_auth");

test("local account service verifies email and issues a seven-day session", async () => {
  let currentTime = Date.parse("2026-08-10T00:00:00.000Z");
  const service = createLocalAccountAuthService({
    secret: "x".repeat(32),
    now: () => currentTime,
    development: true,
  });
  const requested = await service.requestCode("Person@Example.COM");
  assert.match(requested.developmentCode, /^\d{6}$/u);
  const login = service.verifyCode("person@example.com", requested.developmentCode);
  assert.equal(login.authenticated, true);
  const cookie = service.cookieHeader(login.token, { headers: {}, socket: {} });
  assert.match(cookie, /Max-Age=604800/u);
  const status = service.status({ headers: { cookie } });
  assert.equal(status.email, "person@example.com");
  currentTime += 7 * 24 * 60 * 60 * 1000 + 1;
  assert.equal(service.status({ headers: { cookie } }).authenticated, false);
});

test("local account export permits are account-bound and short-lived", async () => {
  const crypto = require("node:crypto");
  let timingSafeCalls = 0;
  const cryptoApi = {
    ...crypto,
    timingSafeEqual(left, right) {
      timingSafeCalls += 1;
      return crypto.timingSafeEqual(left, right);
    },
  };
  const service = createLocalAccountAuthService({
    secret: "y".repeat(32),
    development: true,
    cryptoApi,
  });
  const requested = await service.requestCode("person@example.com");
  const login = service.verifyCode("person@example.com", requested.developmentCode);
  const request = { headers: { cookie: service.cookieHeader(login.token).split(";")[0] } };
  const authorization = service.authorizeExport(["organizer.output"], request);
  assert.equal(authorization.authorized, true);
  const callsBeforePermitVerification = timingSafeCalls;
  assert.equal(service.verifyExport(authorization.permit, ["organizer.output"], request).authorized, true);
  assert.equal(timingSafeCalls, callsBeforePermitVerification + 2);
  assert.throws(
    () => service.verifyExport(authorization.permit, ["tuner.frame-audio"], request),
    /无效或已过期/u,
  );
});
