"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");

test("email-only authorization removes the device route and drops device tables", () => {
  const worker = fs.readFileSync(path.join(root, "cloudflare/site/src/index.mjs"), "utf8");
  const migration = fs.readFileSync(
    path.join(root, "cloudflare/site/migrations/0010_email_only_authorization.sql"),
    "utf8",
  );
  const accountAuth = fs.readFileSync(path.join(root, "cloudflare/site/src/account_auth.mjs"), "utf8");

  assert.doesNotMatch(worker, /handleActivationRequest/u);
  assert.match(migration, /DROP TABLE license_devices/u);
  assert.match(migration, /DROP TABLE automatic_trial_claims/u);
  assert.match(accountAuth, /\/api\/entitlements\/trial/u);
  assert.match(accountAuth, /claimTrial/u);
});
