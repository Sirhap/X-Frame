"use strict";

const LOCAL_ONLY_START = "<!-- cloudflare-local-only:start -->";
const LOCAL_ONLY_END = "<!-- cloudflare-local-only:end -->";

/**
 * Removes tool cards that require the local Node/FFmpeg server from the Cloudflare landing page.
 * @param {string} source Landing-page HTML source.
 * @returns {string} Cloudflare-safe landing-page HTML.
 */
function prepareCloudflareLanding(source) {
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

module.exports = Object.freeze({ prepareCloudflareLanding });
