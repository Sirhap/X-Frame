"use strict";

const LOCAL_ONLY_START = "<!-- cloudflare-local-only:start -->";
const LOCAL_ONLY_END = "<!-- cloudflare-local-only:end -->";
const WORKSTATION_COUNT_EXPRESSION = /(<span data-workstation-count>)[^<]*(<\/span>)/u;

/** @param {number} count Workstation count. @returns {string} English count label. */
function workstationCountLabel(count) {
  const labels = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE"];
  return labels[count] || String(count);
}

/**
 * Removes local-server-only HTML blocks marked for Cloudflare exclusion.
 * @param {string} source HTML source.
 * @returns {string} Source without local-only blocks.
 */
function stripCloudflareLocalOnly(source) {
  let output = String(source || "");
  while (output.includes(LOCAL_ONLY_START) || output.includes(LOCAL_ONLY_END)) {
    const startIndex = output.indexOf(LOCAL_ONLY_START);
    const endIndex = output.indexOf(LOCAL_ONLY_END);
    if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
      throw new Error("Cloudflare local-only marker pair is malformed.");
    }
    output = `${output.slice(0, startIndex)}${output.slice(endIndex + LOCAL_ONLY_END.length)}`;
  }
  return output;
}

/**
 * Removes tool cards that require the local Node/FFmpeg server from the Cloudflare landing page.
 * @param {string} source Landing-page HTML source.
 * @returns {string} Cloudflare-safe landing-page HTML.
 */
function prepareCloudflareLanding(source) {
  let output = stripCloudflareLocalOnly(source);
  const workstationCount = Array.from(output.matchAll(/<a\s+class="[^"]*\btool-card\b[^"]*"/gu)).length;
  if (!WORKSTATION_COUNT_EXPRESSION.test(output)) {
    throw new Error("Cloudflare landing is missing its workstation-count marker.");
  }
  output = output.replace(WORKSTATION_COUNT_EXPRESSION, `$1${workstationCountLabel(workstationCount)}$2`);
  return output;
}

module.exports = Object.freeze({
  prepareCloudflareLanding,
  stripCloudflareLocalOnly,
  workstationCountLabel,
});
