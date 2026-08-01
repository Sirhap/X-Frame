"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("scatter-slice routes recoverable failures through one error boundary", () => {
  const script = fs.readFileSync(
    path.resolve(__dirname, "../animation_tuner/public/scatter_slice.js"),
    "utf8",
  );

  assert.match(script, /function reportFailure\(error, fallback\)/);
  assert.doesNotMatch(script, /console\.error\(error\)/);
});
