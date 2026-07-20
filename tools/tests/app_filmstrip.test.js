"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/app_filmstrip");

test("filmstrip controller rejects missing DOM dependencies", () => {
  assert.throws(() => createController(), /dependencies are required/);
  assert.throws(() => createController({}), /dependencies are required/);
});
