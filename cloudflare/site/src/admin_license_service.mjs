import { sha256Hex } from "./activation_crypto.mjs";
import { decryptActivationCode, encryptActivationCode } from "./admin_license_crypto.mjs";
import {
  isPermanentLicenseExpiry,
  PERMANENT_LICENSE_EXPIRES_AT,
  resolveLicenseExpiry,
} from "./license_duration.mjs";

export const MAX_LICENSE_BATCH_SIZE = 100;
export const MAX_LICENSE_SELECTION_SIZE = 200;
export const MAX_ACTIVATION_CODE_LENGTH = 512;
export const PERMANENT_REDEEM_BY = "9999-12-31T23:59:59.999Z";

/** @param {unknown} value Raw activation code. @returns {string} Normalized activation code. */
function normalizeCode(value) {
  const code = String(value || "")
    .trim()
    .toUpperCase();
  if (!code || code.length > MAX_ACTIVATION_CODE_LENGTH) {
    throw Object.assign(
      new Error(`Activation code must contain 1 to ${MAX_ACTIVATION_CODE_LENGTH} characters.`),
      { status: 400 },
    );
  }
  return code;
}

/** @param {unknown} value Raw duration. @param {number} referenceTime Reference epoch. @returns {number} Valid duration in days. */
function normalizeDurationDays(value, referenceTime) {
  const durationDays = Number(value);
  if (!Number.isSafeInteger(durationDays) || durationDays < 1) {
    throw Object.assign(new Error("Duration must be a positive whole number of days."), { status: 400 });
  }
  try {
    resolveLicenseExpiry(referenceTime, durationDays, false);
  } catch (_error) {
    throw Object.assign(new Error("Duration is too large; use permanent validity instead."), {
      status: 400,
    });
  }
  return durationDays;
}

/** @param {unknown} value Raw device limit. @returns {number|null} Valid maximum devices or unlimited. */
function normalizeMaxDevices(value) {
  if (value === null) return null;
  const maxDevices = Number(value);
  if (!Number.isSafeInteger(maxDevices) || maxDevices < 1) {
    throw Object.assign(new Error("Device limit must be a positive whole number or unlimited."), {
      status: 400,
    });
  }
  return maxDevices;
}

/** @param {unknown} value Raw permanent flag. @returns {boolean} Valid permanent state. */
function normalizePermanent(value) {
  if (typeof value !== "boolean") {
    throw Object.assign(new Error("Permanent state must be true or false."), { status: 400 });
  }
  return value;
}

/** @param {unknown} value Date input. @param {number} now Current epoch. @returns {string} ISO date. */
function normalizeRedeemBy(value, now) {
  const candidate =
    value === null || value === undefined || String(value).trim() === ""
      ? PERMANENT_REDEEM_BY
      : String(value);
  const timestamp = Date.parse(candidate);
  if (!Number.isFinite(timestamp)) {
    throw Object.assign(new Error("Redeem deadline is invalid."), { status: 400 });
  }
  if (timestamp <= now) {
    throw Object.assign(new Error("Redeem deadline must be in the future."), { status: 400 });
  }
  return new Date(timestamp).toISOString();
}

/** @param {unknown} value Raw IDs. @returns {string[]} Unique license IDs. */
function normalizeIds(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_LICENSE_SELECTION_SIZE) {
    throw Object.assign(new Error(`Select between 1 and ${MAX_LICENSE_SELECTION_SIZE} activation codes.`), {
      status: 400,
    });
  }
  const ids = [...new Set(value.map((id) => String(id || "").trim()))];
  if (ids.length !== value.length || ids.some((id) => !/^[a-zA-Z0-9-]{8,80}$/u.test(id))) {
    throw Object.assign(new Error("Activation code selection is invalid."), { status: 400 });
  }
  return ids;
}

/** @param {unknown} value Raw device IDs. @returns {string[]} Unique device IDs. */
function normalizeDeviceIds(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_LICENSE_SELECTION_SIZE) {
    throw Object.assign(new Error(`Select between 1 and ${MAX_LICENSE_SELECTION_SIZE} devices.`), {
      status: 400,
    });
  }
  const ids = [...new Set(value.map((id) => String(id || "").trim()))];
  if (ids.length !== value.length || ids.some((id) => !/^[a-zA-Z0-9-]{8,80}$/u.test(id))) {
    throw Object.assign(new Error("Device selection is invalid."), { status: 400 });
  }
  return ids;
}

/** @param {unknown} error Persistence error. @returns {never} */
function rethrowPersistenceError(error) {
  if (String(error?.message || error).includes("UNIQUE constraint failed")) {
    throw Object.assign(new Error("One or more activation codes already exist."), { status: 409 });
  }
  throw error;
}

/**
 * Creates batch CRUD operations for administrator-managed activation codes.
 * @param {object} repository Administrator repository.
 * @param {Crypto} cryptoApi Web Crypto API.
 * @param {()=>number} now Current time provider.
 * @param {(row:object,now:number,code?:string)=>object} serializeLicense Browser-safe serializer.
 * @param {string} rootSecret Worker root secret used for domain-separated encryption.
 * @returns {object} License management operations.
 */
export function createAdminLicenseService(repository, cryptoApi, now, serializeLicense, rootSecret) {
  const subtle = cryptoApi.subtle;

  /** @param {object} row Stored license row. @returns {Promise<object>} Browser-safe row. */
  async function serializeStoredLicense(row) {
    const code =
      row.source === "automatic_trial"
        ? ""
        : await decryptActivationCode(row.code_ciphertext, row.code_hash, rootSecret, subtle);
    return serializeLicense(row, now(), code);
  }

  /** @param {object[]} rows Stored license rows. @returns {Promise<object[]>} Browser-safe rows. */
  function serializeStoredLicenses(rows) {
    return Promise.all(rows.map(serializeStoredLicense));
  }

  /** @param {string[]} ids IDs that must exist. @returns {Promise<object[]>} Stored rows in request order. */
  async function requireLicenses(ids) {
    const rows = await repository.findLicensesByIds(ids);
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    if (rowsById.size !== ids.length) {
      throw Object.assign(new Error("One or more selected activation codes no longer exist."), {
        status: 404,
      });
    }
    return ids.map((id) => rowsById.get(id));
  }

  /** @param {string[]} ids Device IDs that must exist. @returns {Promise<object[]>} Stored devices. */
  async function requireDevices(ids) {
    const rows = await repository.findDevicesByIds(ids);
    if (rows.length !== ids.length) {
      throw Object.assign(new Error("One or more selected devices no longer exist."), { status: 404 });
    }
    return rows;
  }

  return {
    /** @param {object} payload Create payload. @returns {Promise<object>} Created plaintext codes and rows. */
    async create(payload) {
      const rawCodes = Array.isArray(payload.codes) ? payload.codes : [payload.code];
      if (rawCodes.length < 1 || rawCodes.length > MAX_LICENSE_BATCH_SIZE) {
        throw Object.assign(
          new Error(`Create between 1 and ${MAX_LICENSE_BATCH_SIZE} activation codes at a time.`),
          { status: 400 },
        );
      }
      const codes = rawCodes.map(normalizeCode);
      if (new Set(codes).size !== codes.length) {
        throw Object.assign(new Error("The batch contains duplicate activation codes."), { status: 400 });
      }
      const currentTime = now();
      const durationDays = normalizeDurationDays(payload.durationDays ?? 3, currentTime);
      const maxDevices = Object.hasOwn(payload, "maxDevices") ? normalizeMaxDevices(payload.maxDevices) : 1;
      const permanent = Object.hasOwn(payload, "permanent") ? normalizePermanent(payload.permanent) : false;
      const redeemBy = normalizeRedeemBy(payload.redeemBy, currentTime);
      const licenses = await Promise.all(
        codes.map(async (code) => {
          const codeHash = await sha256Hex(code, subtle);
          return {
            id: cryptoApi.randomUUID(),
            code,
            codeHash,
            codeCiphertext: await encryptActivationCode(code, codeHash, rootSecret, cryptoApi),
            durationDays,
            maxDevices,
            redeemBy,
            expiresAt: permanent ? PERMANENT_LICENSE_EXPIRES_AT : null,
          };
        }),
      );
      try {
        await repository.createLicenses(licenses);
      } catch (error) {
        rethrowPersistenceError(error);
      }
      const serialized = licenses.map((license) =>
        serializeLicense(
          {
            id: license.id,
            code_hash: license.codeHash,
            code_ciphertext: license.codeCiphertext,
            plan: "standard",
            duration_days: license.durationDays,
            max_devices: license.maxDevices,
            redeem_by: license.redeemBy,
            first_activated_at: null,
            expires_at: license.expiresAt,
            revoked_at: null,
            device_name: null,
            last_seen_at: null,
            devices: [],
          },
          now(),
          license.code,
        ),
      );
      return { code: codes[0], codes, license: serialized[0], licenses: serialized };
    },

    /** @param {object[]} rows Stored rows. @returns {Promise<object[]>} Decrypted administrator rows. */
    list(rows) {
      return serializeStoredLicenses(rows);
    },

    /** @param {object} payload Batch edit payload. @returns {Promise<object>} Updated rows. */
    async update(payload) {
      const ids = normalizeIds(payload.ids);
      const hasDuration = Object.hasOwn(payload, "durationDays");
      const hasPermanent = Object.hasOwn(payload, "permanent");
      const hasRedeemBy = Object.hasOwn(payload, "redeemBy");
      const hasMaxDevices = Object.hasOwn(payload, "maxDevices");
      if (!hasDuration && !hasPermanent && !hasRedeemBy && !hasMaxDevices) {
        throw Object.assign(new Error("Provide a duration, device limit, or redeem deadline to update."), {
          status: 400,
        });
      }
      const durationDays = hasDuration ? normalizeDurationDays(payload.durationDays, now()) : null;
      const permanent = hasPermanent ? normalizePermanent(payload.permanent) : null;
      const redeemBy = hasRedeemBy ? normalizeRedeemBy(payload.redeemBy, now()) : null;
      const maxDevices = hasMaxDevices ? normalizeMaxDevices(payload.maxDevices) : null;
      const rows = await requireLicenses(ids);
      const updates = rows.map((row) => {
        const nextDurationDays = durationDays ?? Number(row.duration_days);
        const activatedAt = Date.parse(row.first_activated_at || "");
        const currentPermanent = isPermanentLicenseExpiry(row.expires_at);
        const nextPermanent = permanent ?? (hasDuration ? false : currentPermanent);
        const expiryChanged = hasDuration || hasPermanent;
        return {
          id: row.id,
          durationDays: nextDurationDays,
          maxDevices: hasMaxDevices
            ? maxDevices
            : row.max_devices === null
              ? null
              : Number(row.max_devices || 1),
          redeemBy: redeemBy ?? row.redeem_by ?? PERMANENT_REDEEM_BY,
          expiresAt: expiryChanged
            ? resolveLicenseExpiry(activatedAt, nextDurationDays, nextPermanent)
            : row.expires_at || null,
        };
      });
      await repository.updateLicenses(updates);
      const updatedRows = rows.map((row, index) => ({
        ...row,
        duration_days: updates[index].durationDays,
        max_devices: updates[index].maxDevices,
        redeem_by: updates[index].redeemBy,
        expires_at: updates[index].expiresAt,
      }));
      return { count: updatedRows.length, licenses: await serializeStoredLicenses(updatedRows) };
    },

    /** @param {object} payload Revocation payload. @returns {Promise<object>} Mutation summary. */
    async setRevoked(payload) {
      const ids = normalizeIds(payload.ids);
      if (typeof payload.revoked !== "boolean") {
        throw Object.assign(new Error("Revocation state must be true or false."), { status: 400 });
      }
      await requireLicenses(ids);
      await repository.setLicensesRevoked(ids, payload.revoked ? new Date(now()).toISOString() : null);
      return { count: ids.length, revoked: payload.revoked };
    },

    /** @param {object} payload Delete payload. @returns {Promise<object>} Mutation summary. */
    async delete(payload) {
      const ids = normalizeIds(payload.ids);
      await requireLicenses(ids);
      await repository.deleteLicenses(ids);
      return { count: ids.length };
    },

    /** @param {object} payload Device revocation payload. @returns {Promise<object>} Mutation summary. */
    async setDevicesRevoked(payload) {
      const ids = normalizeDeviceIds(payload.ids);
      if (typeof payload.revoked !== "boolean") {
        throw Object.assign(new Error("Device revocation state must be true or false."), { status: 400 });
      }
      await requireDevices(ids);
      await repository.setDevicesRevoked(ids, payload.revoked ? new Date(now()).toISOString() : null);
      return { count: ids.length, revoked: payload.revoked };
    },

    /** @param {object} payload Device reset payload. @returns {Promise<object>} Mutation summary. */
    async deleteDevices(payload) {
      const ids = normalizeDeviceIds(payload.ids);
      await requireDevices(ids);
      await repository.deleteDevices(ids);
      return { count: ids.length };
    },
  };
}
