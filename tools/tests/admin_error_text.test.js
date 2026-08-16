"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { localize } = require("../animation_tuner/public/admin_error_text");

test("administrator API errors use the Chinese console language", () => {
  assert.equal(localize("The username or verification code is invalid.", 401), "用户名或动态验证码无效。");
  assert.equal(
    localize("This verification code has already been used.", 409),
    "该动态验证码已使用，请等待下一组验证码。",
  );
  assert.equal(localize("Too many attempts. Try again later.", 429), "尝试次数过多，请稍后再试。");
});

test("administrator errors retain useful unknown messages and status fallbacks", () => {
  assert.equal(localize("Database unavailable.", 500), "Database unavailable.");
  assert.equal(localize("", 401), "管理员身份验证失败，请重新验证。");
  assert.equal(localize(null, 429), "请求过于频繁，请稍后再试。");
});
