"use strict";

const { runCutoutProductSelfTests } = require("./self_test_cutout_product");
const { runCutoutProtectionSelfTests } = require("./self_test_cutout_protection");
const { runCutoutTrackingSelfTests } = require("./self_test_cutout_tracking");

/**
 * Runs deterministic cutout, protection, tracking, and quality regression assertions.
 * The runners are invoked in the original order so failures retain their historical sequence.
 * @returns {void}
 */
function runCutoutCoreSelfTests() {
  const context = runCutoutProductSelfTests();
  runCutoutProtectionSelfTests(context);
  runCutoutTrackingSelfTests();
}

module.exports = { runCutoutCoreSelfTests };
