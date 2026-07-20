"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/app_attachments");

test("attachment controller validates browser integration dependencies", () => {
  assert.throws(() => createController(), /dependencies are required/);
  assert.throws(
    () => createController({ fetchImpl: fetch, fileReaderConstructor: class {} }),
    /dependencies are required/,
  );
});
