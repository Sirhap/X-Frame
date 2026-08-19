"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  auditFinalPosture,
  isAllowedProductionHtmlReference,
} = require("../algorithm_protection/audit_production");

/**
 * Creates a valid final manifest with JS Worker glue and one protected WASM core.
 * @param {object[]} [overrides] Replacement asset records.
 * @returns {object} Final artifact manifest fixture.
 */
function createFinalManifest(overrides) {
  return {
    protectionLevel: "worker-wasm",
    algorithmFormat: "wasm",
    assets: overrides || [
      { role: "ui", path: "assets/ui.1111111111111111.js", mediaType: "application/javascript" },
      {
        role: "product-algorithm",
        path: "assets/algorithm-worker.2222222222222222.js",
        mediaType: "application/javascript",
      },
      {
        role: "frame-analysis",
        path: "assets/analysis-worker.3333333333333333.js",
        mediaType: "application/javascript",
      },
      {
        role: "protected-core",
        path: "assets/algorithm-core.4444444444444444.wasm",
        mediaType: "application/wasm",
      },
      { role: "styles", path: "assets/styles.5555555555555555.css", mediaType: "text/css" },
      { role: "favicon", path: "assets/favicon.6666666666666666.ico", mediaType: "image/x-icon" },
      {
        role: "attack-trail-texture",
        path: "assets/attack-trail-texture.7777777777777777.png",
        mediaType: "image/png",
      },
    ],
  };
}

/**
 * Runs the final-posture branch without leaking argument mutations between tests.
 * @param {object} manifest Artifact manifest fixture.
 * @returns {string[]} Audit failures.
 */
function runFinalAudit(manifest) {
  const previousArguments = process.argv;
  const failures = [];
  process.argv = [...previousArguments, "--require-wasm"];
  try {
    auditFinalPosture(manifest, failures);
  } finally {
    process.argv = previousArguments;
  }
  return failures;
}

test("final audit accepts JavaScript Worker glue backed by a protected WASM core", () => {
  assert.deepEqual(runFinalAudit(createFinalManifest()), []);
});

test("final audit rejects a JavaScript protected core", () => {
  const manifest = createFinalManifest();
  const core = manifest.assets.find((asset) => asset.role === "protected-core");
  core.path = "assets/algorithm-core.4444444444444444.js";
  core.mediaType = "application/javascript";

  const failures = runFinalAudit(manifest);
  assert.ok(failures.some((failure) => failure.includes("invalid final asset format for protected-core")));
  assert.ok(failures.some((failure) => failure.includes("core or fallback asset is forbidden")));
});

test("final audit rejects an additional JavaScript fallback", () => {
  const manifest = createFinalManifest();
  manifest.assets.push({
    role: "algorithm-fallback",
    path: "assets/algorithm-fallback.7777777777777777.js",
    mediaType: "application/javascript",
  });

  const failures = runFinalAudit(manifest);
  assert.ok(failures.some((failure) => failure.includes("contain only approved")));
  assert.ok(failures.some((failure) => failure.includes("unapproved final asset role")));
  assert.ok(failures.some((failure) => failure.includes("core or fallback asset is forbidden")));
});

test("final audit rejects migration metadata even when asset extensions look valid", () => {
  const manifest = createFinalManifest();
  manifest.protectionLevel = "worker-wasm-poc";
  manifest.algorithmFormat = "javascript-wasm-migration";

  const failures = runFinalAudit(manifest);
  assert.ok(failures.includes("final build is not worker-wasm"));
  assert.ok(failures.includes("final build has a sensitive JS algorithm path"));
});

test("production HTML permits canonical app routes but rejects arbitrary unhashed references", () => {
  for (const route of [
    "/projects",
    "/tools",
    "/workspace",
    "/workspace/tools/organizer",
    "/workspace/tools/cutout",
    "/workspace/resources/import",
    "/workspace/resources/cutout",
    "/workspace/resources/scatter",
    "/workspace/animation/overview",
    "/workspace/animation/transform",
    "/workspace/animation/boxes",
    "/workspace/animation/trails",
    "/workspace/animation/audio",
    "/workspace/animation/attachments",
    "/workspace/delivery/export",
    "/workspace/delivery/godot",
    "/workspace/delivery/codex-pet",
    "/tools/import",
    "/tools/organizer",
    "/tools/cutout",
    "/tools/scatter-slice",
    "/tools/watermark",
    "/tools/export",
  ]) {
    assert.equal(isAllowedProductionHtmlReference(route), true);
  }
  assert.equal(isAllowedProductionHtmlReference("/workspace?guide=character"), true);
  assert.equal(isAllowedProductionHtmlReference("/scatter-slice.html?embedded=1"), true);
  assert.equal(isAllowedProductionHtmlReference("/assets/ui.1111111111111111.js"), true);
  assert.equal(isAllowedProductionHtmlReference("/tools/unknown"), false);
  assert.equal(isAllowedProductionHtmlReference("/unhashed.js"), false);
});
