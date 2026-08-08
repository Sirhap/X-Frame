"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const packageScripts = require("../../package.json").scripts;
const { QUALITY_GATE_PROFILES, runQualityGate, validateQualityGateProfiles } = require("../quality_gate");

const LEGACY_FULL_CHECKS = Object.freeze([
  "check:syntax",
  "check:clipboard-media",
  "check:watermark",
  "check:scatter-slice",
  "check:app-shell",
  "check:mutations",
  "check:server-persistence",
  "check:server-media",
  "check:asset-pipeline",
  "check:server-io",
  "check:tracking-geometry",
  "check:batch-color",
  "check:batch-connectivity",
  "check:batch-image",
  "check:batch-text",
  "check:batch-preview-renderer",
  "check:batch-events-preview",
  "check:batch-navigation",
  "check:batch-processing-helpers",
  "check:batch-settings",
  "check:batch-reference-input",
  "check:godot-templates",
  "check:app-lifecycle",
  "check:app-save",
  "check:app-transform-runtime",
  "check:app-box-adjustment",
  "check:app-adjustment-inputs",
  "check:app-frame-edit-state",
  "check:app-attachment-manipulation",
  "check:app-playback-inputs",
  "check:app-tool-actions",
  "check:app-project-state",
  "check:app-events",
  "check:frame-organizer-text",
  "check:frame-organizer-ui",
  "check:frame-organizer-actions",
  "check:production-build",
  "check:algorithm-gate",
  "lint",
  "format:check",
  "format:mutations",
  "typecheck",
]);

test("full quality gate preserves the existing check order", () => {
  assert.equal(QUALITY_GATE_PROFILES.full[0], "check:quality-gate");
  assert.equal(QUALITY_GATE_PROFILES.full[1], "check:server-save");
  assert.deepEqual(QUALITY_GATE_PROFILES.full.slice(2), LEGACY_FULL_CHECKS);
});

test("quick quality gate is a safe ordered subset of the full profile", () => {
  assert.deepEqual(QUALITY_GATE_PROFILES.quick, [
    "check:quality-gate",
    "check:server-save",
    "check:syntax",
    "lint",
    "format:check",
    "format:mutations",
    "typecheck",
  ]);
  assert.ok(
    QUALITY_GATE_PROFILES.quick.every((scriptName) => QUALITY_GATE_PROFILES.full.includes(scriptName)),
  );
});

test("quality gate profiles reference unique existing package scripts", () => {
  assert.doesNotThrow(() => validateQualityGateProfiles(QUALITY_GATE_PROFILES, packageScripts));
});

test("quality gate profile validation rejects duplicates, missing scripts, and recursion", () => {
  assert.throws(
    () => validateQualityGateProfiles({ invalid: ["lint", "lint"] }, packageScripts),
    /duplicate.*lint/iu,
  );
  assert.throws(
    () => validateQualityGateProfiles({ invalid: ["missing:script"] }, packageScripts),
    /unknown.*missing:script/iu,
  );
  assert.throws(
    () => validateQualityGateProfiles({ invalid: ["check"] }, packageScripts),
    /recursive.*check/iu,
  );
});

test("quality gate runs in order and stops after the first failure", () => {
  const calls = [];
  assert.throws(
    () =>
      runQualityGate("sample", {
        profiles: { sample: ["first", "second", "third"] },
        runScript(scriptName) {
          calls.push(scriptName);
          if (scriptName === "second") throw new Error("expected failure");
        },
        logger: { log() {} },
      }),
    /expected failure/u,
  );
  assert.deepEqual(calls, ["first", "second"]);
});

test("quality gate rejects an unknown profile before running scripts", () => {
  assert.throws(
    () => runQualityGate("missing", { profiles: QUALITY_GATE_PROFILES, runScript() {} }),
    /unknown quality gate profile.*missing/iu,
  );
});
