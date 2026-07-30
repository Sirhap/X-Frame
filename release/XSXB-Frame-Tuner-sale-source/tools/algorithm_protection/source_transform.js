"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { SENSITIVE_GLOBALS } = require("./config");
const { resolvePublicAsset, sha256 } = require("./artifact_utils");

/**
 * Extracts unique root-relative asset URLs while retaining document order.
 * @param {string} html Source HTML.
 * @param {RegExp} expression Global expression with one URL capture.
 * @returns {string[]} Ordered URLs.
 */
function extractAssetUrls(html, expression) {
  return Array.from(html.matchAll(expression), (match) => match[1]).filter(
    (value, index, values) => values.indexOf(value) === index,
  );
}

/**
 * Creates build-specific opaque aliases for sensitive global seam names.
 * @param {string} seed Reproducible private build seed.
 * @returns {Map<string,string>} Source name to opaque name.
 */
function createSymbolAliases(seed) {
  return new Map(
    SENSITIVE_GLOBALS.map((name, index) => [name, `_${sha256(`${seed}:${index}:${name}`).slice(0, 12)}`]),
  );
}

/**
 * Replaces sensitive global tokens consistently across UI and Worker artifacts.
 * @param {string} source JavaScript source.
 * @param {Map<string,string>} aliases Source name aliases.
 * @returns {string} Aliased source.
 */
function aliasSensitiveSymbols(source, aliases) {
  let output = source;
  for (const [name, alias] of aliases) {
    output = output.replace(new RegExp(`\\b${name}\\b`, "g"), alias);
  }
  return output;
}

/**
 * Reads and concatenates public scripts in browser execution order.
 * @param {string} publicRoot Public source root.
 * @param {string[]} urls Root-relative script URLs.
 * @param {Map<string,string>} aliases Sensitive aliases.
 * @returns {string} Combined JavaScript.
 */
function combineScripts(publicRoot, urls, aliases) {
  const source = urls
    .map((url) => fs.readFileSync(resolvePublicAsset(publicRoot, url), "utf8"))
    .join("\n;\n");
  return aliasSensitiveSymbols(source, aliases);
}

/**
 * Inlines classic Worker importScripts dependencies into one deployable source.
 * @param {string} publicRoot Public source root.
 * @param {string} workerName Worker filename.
 * @param {Map<string,string>} aliases Sensitive aliases.
 * @returns {string} Combined Worker source.
 */
function combineWorker(publicRoot, workerName, aliases) {
  const workerPath = path.join(publicRoot, workerName);
  const workerSource = fs.readFileSync(workerPath, "utf8");
  const importMatch = workerSource.match(/importScripts\(([\s\S]*?)\);/);
  if (!importMatch) throw new Error(`Worker entry must declare importScripts dependencies: ${workerName}`);
  const importedUrls = Array.from(importMatch[1].matchAll(/["']([^"']+)["']/g), (match) => `/${match[1]}`);
  if (importedUrls.length === 0) {
    throw new Error(`Worker importScripts dependency list is empty: ${workerName}`);
  }
  const dependencies = combineScripts(publicRoot, importedUrls, aliases);
  const entry = workerSource.replace(importMatch[0], "");
  return `${dependencies}\n;\n${aliasSensitiveSymbols(entry, aliases)}`;
}

module.exports = Object.freeze({
  aliasSensitiveSymbols,
  combineScripts,
  combineWorker,
  createSymbolAliases,
  extractAssetUrls,
});
