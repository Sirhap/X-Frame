"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { runCutoutCoreSelfTests } = require("../self_test_cutout_core.js");

test("cutout self-test keeps its public runner and ordered assertions", () => {
  assert.equal(typeof runCutoutCoreSelfTests, "function");
  runCutoutCoreSelfTests();
});
