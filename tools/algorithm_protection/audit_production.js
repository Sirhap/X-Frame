"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DIST_ROOT, FORBIDDEN_CONTENT_PATTERNS, FORBIDDEN_PATH_PATTERNS } = require("./config");
const { listFiles, resolveOutputAsset, sha256 } = require("./artifact_utils");

const PRODUCTION_APP_ROUTES = new Set([
  "/projects",
  "/tools",
  "/workspace",
  "/workspace/tools/organizer",
  "/workspace/tools/cutout",
  "/tools/import",
  "/tools/organizer",
  "/tools/cutout",
  "/tools/scatter-slice",
  "/scatter-slice.html",
]);
const HASHED_ASSET_REFERENCE = /^\/assets\/[a-z-]+\.[a-f0-9]{16}\.(?:js|css|wasm|ico)$/;

/**
 * Distinguishes approved application deep links from content-addressed assets.
 * @param {string} reference Root-relative HTML reference.
 * @returns {boolean} Whether production HTML may retain the reference.
 */
function isAllowedProductionHtmlReference(reference) {
  const [pathname] = String(reference || "").split("?");
  return HASHED_ASSET_REFERENCE.test(pathname) || PRODUCTION_APP_ROUTES.has(pathname);
}

/**
 * Adds one audit failure when a condition is not met.
 * @param {string[]} failures Failure accumulator.
 * @param {boolean} condition Expected condition.
 * @param {string} message Failure message.
 * @returns {void}
 */
function assertAudit(failures, condition, message) {
  if (!condition) failures.push(message);
}

/**
 * Reads one unsigned LEB128 value without accepting truncated or oversized input.
 * @param {Buffer} bytes WASM bytes.
 * @param {{offset:number}} cursor Mutable byte cursor.
 * @returns {number} Decoded unsigned integer.
 */
function readUnsignedLeb128(bytes, cursor) {
  let value = 0;
  let shift = 0;
  for (let count = 0; count < 5; count += 1) {
    if (cursor.offset >= bytes.length) throw new Error("truncated WASM LEB128 value");
    const byte = bytes[cursor.offset];
    cursor.offset += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return value >>> 0;
    shift += 7;
  }
  throw new Error("oversized WASM LEB128 value");
}

/**
 * Lists custom section names while validating section bounds.
 * @param {Buffer} bytes WASM binary.
 * @returns {string[]} Custom section names.
 */
function readWasmCustomSections(bytes) {
  if (bytes.length < 8 || bytes.subarray(0, 8).toString("hex") !== "0061736d01000000") {
    throw new Error("invalid WASM header");
  }
  const cursor = { offset: 8 };
  const customSections = [];
  while (cursor.offset < bytes.length) {
    const sectionId = bytes[cursor.offset];
    cursor.offset += 1;
    const sectionLength = readUnsignedLeb128(bytes, cursor);
    const sectionEnd = cursor.offset + sectionLength;
    if (!Number.isSafeInteger(sectionEnd) || sectionEnd > bytes.length) {
      throw new Error("WASM section exceeds the artifact boundary");
    }
    if (sectionId === 0) {
      const nameLength = readUnsignedLeb128(bytes, cursor);
      const nameEnd = cursor.offset + nameLength;
      if (nameEnd > sectionEnd) throw new Error("WASM custom section name exceeds its section");
      customSections.push(bytes.subarray(cursor.offset, nameEnd).toString("utf8"));
    }
    cursor.offset = sectionEnd;
  }
  return customSections;
}

/**
 * Rejects debug, symbol, source-map, and source-path metadata in one WASM asset.
 * @param {string} assetPath Absolute WASM path.
 * @param {string[]} failures Failure accumulator.
 * @returns {void}
 */
function auditWasmAsset(assetPath, failures) {
  const relative = path.relative(DIST_ROOT, assetPath).split(path.sep).join("/");
  try {
    const bytes = fs.readFileSync(assetPath);
    const sections = readWasmCustomSections(bytes);
    const forbiddenSections = sections.filter((name) =>
      /^(?:name|sourceMappingURL|external_debug_info|\.debug(?:_|$)|reloc\.)/i.test(name),
    );
    assertAudit(
      failures,
      forbiddenSections.length === 0,
      `WASM debug sections leaked in ${relative}: ${forbiddenSections.join(", ")}`,
    );
    const printable = bytes.toString("latin1");
    assertAudit(
      failures,
      !/(?:[A-Za-z]:\\|\/(?:Users|home|workspace|build)\/|\.rs\b|\.cargo\/registry)/i.test(printable),
      `WASM source path leaked in ${relative}`,
    );
  } catch (error) {
    failures.push(`invalid WASM asset ${relative}: ${error.message}`);
  }
}

/**
 * Reads and validates the machine-readable artifact manifest shape.
 * @param {string[]} failures Failure accumulator.
 * @returns {object|null} Parsed manifest.
 */
function readManifest(failures) {
  const manifestPath = path.join(DIST_ROOT, "asset-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    failures.push("asset-manifest.json is missing");
    return null;
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assertAudit(failures, manifest.schemaVersion === 1, "unsupported manifest schema");
    assertAudit(failures, Array.isArray(manifest.assets), "manifest assets must be an array");
    assertAudit(failures, /^[a-f0-9]{20}$/.test(manifest.buildId || ""), "invalid build id");
    assertAudit(
      failures,
      /^[a-f0-9]{64}$/.test(manifest.sourceFingerprint || ""),
      "invalid source fingerprint",
    );
    return manifest;
  } catch (error) {
    failures.push(`invalid asset manifest: ${error.message}`);
    return null;
  }
}

/**
 * Audits file names, content leakage, manifest hashes, and the deployment whitelist.
 * @param {object|null} manifest Artifact manifest.
 * @param {string[]} failures Failure accumulator.
 * @returns {void}
 */
function auditArtifacts(manifest, failures) {
  const files = listFiles(DIST_ROOT);
  const relativeFiles = files.map((file) => path.relative(DIST_ROOT, file).split(path.sep).join("/"));
  const expectedFiles = new Set([
    "index.html",
    "scatter-slice.html",
    "asset-manifest.json",
    "sbom.spdx.json",
  ]);
  const roles = new Set();
  const assetPaths = new Set();
  for (const asset of manifest?.assets || []) {
    const assetPath = String(asset.path || "");
    assertAudit(failures, !roles.has(asset.role), `duplicate manifest role: ${asset.role}`);
    assertAudit(failures, !assetPaths.has(assetPath), `duplicate manifest path: ${assetPath}`);
    roles.add(asset.role);
    assetPaths.add(assetPath);
    assertAudit(
      failures,
      /^assets\/[a-z-]+\.[a-f0-9]{16}\.(?:js|css|wasm|ico)$/.test(assetPath),
      `invalid manifest asset path: ${assetPath}`,
    );
    assertAudit(failures, /^[a-f0-9]{64}$/.test(asset.sha256 || ""), `invalid SHA-256: ${assetPath}`);
    assertAudit(
      failures,
      assetPath.includes(String(asset.sha256 || "").slice(0, 16)),
      `filename hash mismatch: ${assetPath}`,
    );
    assertAudit(
      failures,
      Number.isSafeInteger(asset.bytes) && asset.bytes >= 0,
      `invalid byte count: ${assetPath}`,
    );
    expectedFiles.add(assetPath);
  }

  for (const relative of relativeFiles) {
    for (const pattern of FORBIDDEN_PATH_PATTERNS) {
      assertAudit(failures, !pattern.test(relative), `forbidden production path: ${relative}`);
    }
    assertAudit(failures, expectedFiles.has(relative), `non-whitelisted production file: ${relative}`);
    if (/\.(?:html|js|json|wasm)$/i.test(relative) && relative !== "asset-manifest.json") {
      const content = fs.readFileSync(path.join(DIST_ROOT, relative)).toString("latin1");
      for (const rule of FORBIDDEN_CONTENT_PATTERNS) {
        assertAudit(failures, !rule.pattern.test(content), `${rule.label} leaked in ${relative}`);
      }
    }
    if (relative.endsWith(".wasm")) auditWasmAsset(path.join(DIST_ROOT, relative), failures);
  }
  for (const expected of expectedFiles) {
    assertAudit(failures, relativeFiles.includes(expected), `whitelisted artifact is missing: ${expected}`);
  }

  for (const asset of manifest?.assets || []) {
    let assetPath;
    try {
      assetPath = resolveOutputAsset(DIST_ROOT, String(asset.path));
    } catch (error) {
      failures.push(error.message);
      continue;
    }
    if (!fs.existsSync(assetPath)) continue;
    const content = fs.readFileSync(assetPath);
    assertAudit(failures, content.length === asset.bytes, `byte count mismatch: ${asset.path}`);
    assertAudit(failures, sha256(content) === asset.sha256, `hash mismatch: ${asset.path}`);
  }
}

/**
 * Audits production HTML for source-directory or unhashed asset references.
 * @param {string[]} failures Failure accumulator.
 * @returns {void}
 */
function auditHtml(manifest, failures) {
  const htmlPath = path.join(DIST_ROOT, "index.html");
  if (!fs.existsSync(htmlPath)) return;
  const html = fs.readFileSync(htmlPath, "utf8");
  const externalReferences = Array.from(html.matchAll(/(?:src|href)="(\/[^"#]+)"/g), (match) => match[1]);
  for (const reference of externalReferences) {
    assertAudit(
      failures,
      isAllowedProductionHtmlReference(reference),
      `unhashed or non-asset HTML reference: ${reference}`,
    );
  }
  const htmlAssetPaths = externalReferences
    .filter((reference) => HASHED_ASSET_REFERENCE.test(reference))
    .map((asset) => asset.slice(1));
  const expectedHtmlAssets = (manifest?.assets || [])
    .filter((asset) => ["ui", "styles", "favicon"].includes(asset.role))
    .map((asset) => asset.path)
    .sort();
  assertAudit(
    failures,
    JSON.stringify(htmlAssetPaths.sort()) === JSON.stringify(expectedHtmlAssets),
    "production HTML entrypoints do not match the manifest",
  );
  assertAudit(failures, !html.includes("sourceMappingURL"), "HTML contains a source map reference");
}

/**
 * Requires the final WASM-only production posture when explicitly selected.
 * @param {object|null} manifest Artifact manifest.
 * @param {string[]} failures Failure accumulator.
 * @returns {void}
 */
function auditFinalPosture(manifest, failures) {
  if (!process.argv.includes("--require-wasm")) return;
  assertAudit(failures, manifest?.protectionLevel === "worker-wasm", "final build is not worker-wasm");
  assertAudit(
    failures,
    manifest?.algorithmFormat === "wasm",
    "final build has a sensitive JS algorithm path",
  );
  const assets = Array.isArray(manifest?.assets) ? manifest.assets : [];
  const expectedAssets = new Map([
    ["ui", { extension: ".js", mediaType: "application/javascript" }],
    ["product-algorithm", { extension: ".js", mediaType: "application/javascript" }],
    ["frame-analysis", { extension: ".js", mediaType: "application/javascript" }],
    ["protected-core", { extension: ".wasm", mediaType: "application/wasm" }],
    ["styles", { extension: ".css", mediaType: "text/css" }],
    ["favicon", { extension: ".ico", mediaType: "image/x-icon" }],
  ]);

  assertAudit(
    failures,
    assets.length === expectedAssets.size,
    "final build must contain only the approved UI, worker glue, WASM core, styles, and favicon assets",
  );
  for (const [role, policy] of expectedAssets) {
    const matches = assets.filter((asset) => asset.role === role);
    assertAudit(failures, matches.length === 1, `final build must declare exactly one ${role} asset`);
    if (matches.length !== 1) continue;
    const [asset] = matches;
    assertAudit(
      failures,
      String(asset.path || "").endsWith(policy.extension),
      `invalid final asset format for ${role}: ${asset.path}`,
    );
    assertAudit(
      failures,
      asset.mediaType === policy.mediaType,
      `invalid final asset media type for ${role}: ${asset.mediaType}`,
    );
  }

  for (const asset of assets) {
    const role = String(asset.role || "");
    const assetPath = String(asset.path || "");
    assertAudit(failures, expectedAssets.has(role), `unapproved final asset role: ${role}`);
    assertAudit(
      failures,
      !assetPath.endsWith(".js") || !/(?:core|fallback)/i.test(`${role}:${assetPath}`),
      `sensitive JavaScript core or fallback asset is forbidden: ${assetPath}`,
    );
  }
}

/**
 * Runs the independent production artifact audit.
 * @returns {void}
 */
function main() {
  const failures = [];
  assertAudit(failures, fs.existsSync(DIST_ROOT), "dist directory is missing");
  const manifest = readManifest(failures);
  auditArtifacts(manifest, failures);
  auditHtml(manifest, failures);
  auditFinalPosture(manifest, failures);
  if (failures.length > 0) {
    process.stderr.write(`Production audit failed (${failures.length}):\n- ${failures.join("\n- ")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Production audit passed for ${manifest.buildId}.\n`);
}

if (require.main === module) main();

module.exports = Object.freeze({
  auditFinalPosture,
  auditWasmAsset,
  isAllowedProductionHtmlReference,
  readUnsignedLeb128,
  readWasmCustomSections,
});
