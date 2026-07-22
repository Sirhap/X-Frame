import { hmacHex } from "./activation_crypto.mjs";

const MAX_SIGNAL_LENGTH = 240;
const MAX_LANGUAGES = 8;

/** @param {unknown} value Raw string signal. @param {number} [limit] Maximum characters. @returns {string} Bounded signal. */
function normalizeString(value, limit = MAX_SIGNAL_LENGTH) {
  return String(value || "")
    .trim()
    .slice(0, limit);
}

/** @param {unknown} value Raw number signal. @param {number} maximum Maximum accepted value. @returns {number} Bounded integer. */
function normalizeInteger(value, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(0, Math.round(number))) : 0;
}

/** @param {unknown} value Raw boolean signal. @returns {boolean} Normalized boolean. */
function normalizeBoolean(value) {
  return value === true;
}

/**
 * Normalizes privacy-sensitive browser signals before hashing.
 * @param {unknown} value Raw fingerprint payload.
 * @returns {object} Stable bounded fingerprint components.
 */
export function normalizeDeviceFingerprint(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const screen = source.screen && typeof source.screen === "object" ? source.screen : {};
  const userAgentData =
    source.userAgentData && typeof source.userAgentData === "object" ? source.userAgentData : {};
  const webgl = source.webgl && typeof source.webgl === "object" ? source.webgl : {};
  const languages = Array.isArray(source.languages)
    ? source.languages.slice(0, MAX_LANGUAGES).map((language) => normalizeString(language, 32))
    : [];
  const brands = Array.isArray(userAgentData.brands)
    ? userAgentData.brands.slice(0, 12).map((brand) => ({
        brand: normalizeString(brand?.brand, 80),
        version: normalizeString(brand?.version, 32),
      }))
    : [];
  return {
    version: 1,
    platform: normalizeString(source.platform, 80),
    userAgent: normalizeString(source.userAgent),
    language: normalizeString(source.language, 32),
    languages,
    timeZone: normalizeString(source.timeZone, 80),
    hardwareConcurrency: normalizeInteger(source.hardwareConcurrency, 256),
    deviceMemory: normalizeInteger(source.deviceMemory, 1024),
    maxTouchPoints: normalizeInteger(source.maxTouchPoints, 64),
    screen: {
      width: normalizeInteger(screen.width, 16384),
      height: normalizeInteger(screen.height, 16384),
      colorDepth: normalizeInteger(screen.colorDepth, 128),
      pixelRatio: normalizeInteger(Number(screen.pixelRatio || 0) * 100, 1600),
    },
    userAgentData: {
      architecture: normalizeString(userAgentData.architecture, 32),
      bitness: normalizeString(userAgentData.bitness, 16),
      model: normalizeString(userAgentData.model, 80),
      platformVersion: normalizeString(userAgentData.platformVersion, 80),
      wow64: normalizeBoolean(userAgentData.wow64),
      brands,
    },
    webgl: {
      vendor: normalizeString(webgl.vendor, 120),
      renderer: normalizeString(webgl.renderer, 160),
    },
  };
}

/**
 * Produces domain-separated hashes without persisting raw browser signals.
 * @param {unknown} value Raw fingerprint payload.
 * @param {string} secret Worker root secret.
 * @param {SubtleCrypto} subtle Web Crypto API.
 * @returns {Promise<{fingerprintHash:string,hardwareHash:string,displayHash:string}>} Fingerprint hashes.
 */
export async function hashDeviceFingerprint(value, secret, subtle) {
  const fingerprint = normalizeDeviceFingerprint(value);
  const hardware = {
    platform: fingerprint.platform,
    userAgent: fingerprint.userAgent,
    hardwareConcurrency: fingerprint.hardwareConcurrency,
    deviceMemory: fingerprint.deviceMemory,
    maxTouchPoints: fingerprint.maxTouchPoints,
    userAgentData: fingerprint.userAgentData,
    webgl: fingerprint.webgl,
  };
  const display = {
    language: fingerprint.language,
    languages: fingerprint.languages,
    timeZone: fingerprint.timeZone,
    screen: fingerprint.screen,
  };
  const [fingerprintHash, hardwareHash, displayHash] = await Promise.all([
    hmacHex(`trial-fingerprint:${JSON.stringify(fingerprint)}`, secret, subtle),
    hmacHex(`trial-hardware:${JSON.stringify(hardware)}`, secret, subtle),
    hmacHex(`trial-display:${JSON.stringify(display)}`, secret, subtle),
  ]);
  return { fingerprintHash, hardwareHash, displayHash };
}
