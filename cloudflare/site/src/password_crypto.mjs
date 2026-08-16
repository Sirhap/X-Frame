import { bytesToBase64Url, safeEqual } from "./activation_crypto.mjs";

export const PASSWORD_ITERATIONS = 210_000;

/** Derives a password hash suitable for persistent account storage. */
export async function hashPassword(
  password,
  cryptoApi = globalThis.crypto,
  saltValue = "",
  iterations = PASSWORD_ITERATIONS,
) {
  const value = String(password || "");
  if (value.length < 8 || value.length > 256) {
    throw Object.assign(new Error("密码长度必须为 8 到 256 个字符。"), { status: 400 });
  }
  const encodedSalt = saltValue.replace(/-/gu, "+").replace(/_/gu, "/");
  const paddedSalt = encodedSalt.padEnd(Math.ceil(encodedSalt.length / 4) * 4, "=");
  const salt = saltValue
    ? Uint8Array.from(atob(paddedSalt), (character) => character.charCodeAt(0))
    : cryptoApi.getRandomValues(new Uint8Array(16));
  const key = await cryptoApi.subtle.importKey("raw", new TextEncoder().encode(value), "PBKDF2", false, [
    "deriveBits",
  ]);
  const safeIterations = Number.isSafeInteger(Number(iterations)) ? Number(iterations) : PASSWORD_ITERATIONS;
  const bits = await cryptoApi.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: safeIterations },
    key,
    256,
  );
  return {
    hash: bytesToBase64Url(new Uint8Array(bits)),
    salt: bytesToBase64Url(salt),
    iterations: safeIterations,
  };
}

/** Verifies an entered password without an early-exit string comparison. */
export async function verifyPassword(password, account, cryptoApi = globalThis.crypto) {
  if (!account?.password_hash || !account?.password_salt) return false;
  const derived = await hashPassword(password, cryptoApi, account.password_salt, account.password_iterations);
  return safeEqual(
    new TextEncoder().encode(derived.hash),
    new TextEncoder().encode(account.password_hash),
    cryptoApi.subtle,
  );
}
