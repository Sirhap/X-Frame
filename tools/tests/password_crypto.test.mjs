import assert from "node:assert/strict";
import test from "node:test";

import { hashPassword, verifyPassword } from "../../cloudflare/site/src/password_crypto.mjs";

test("password hashes use random salts and verify the original password", async () => {
  const first = await hashPassword("correct horse battery staple");
  const second = await hashPassword("correct horse battery staple");
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
  assert.equal(
    await verifyPassword("correct horse battery staple", {
      password_hash: first.hash,
      password_salt: first.salt,
    }),
    true,
  );
  assert.equal(
    await verifyPassword("wrong password", {
      password_hash: first.hash,
      password_salt: first.salt,
    }),
    false,
  );
});

test("password hashing rejects weak-length inputs", async () => {
  await assert.rejects(hashPassword("short"), /8 到 256/u);
});
