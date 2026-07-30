"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const TRASH_DIRECTORY_NAME = ".xsxb-trash";
const TRASH_METADATA_NAME = "removal.json";
const TRASH_PET_DIRECTORY_NAME = "pet";
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Error with an HTTP status and stable code for Codex pet lifecycle failures. */
class CodexPetLifecycleError extends Error {
  /**
   * @param {number} status HTTP response status.
   * @param {string} code Stable machine-readable code.
   * @param {string} message User-facing error message.
   * @param {{cause?:unknown}} [options] Optional underlying error.
   */
  constructor(status, code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CodexPetLifecycleError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Creates safe custom-pet removal, recovery, and atlas-backup operations.
 * @param {{codexPetRoot:()=>string,parseWebpSize:(buffer:Buffer)=>{width:number,height:number},atlasWidth:number,atlasHeights:number[],createToken?:()=>string,now?:()=>number|Date}} options Lifecycle dependencies.
 * @returns {{removeCustomCodexPet:(projectStore:object,project:object,payload:object)=>Promise<object>,restoreRemovedCodexPet:(projectStore:object,project:object,payload:object)=>Promise<object>,restoreCodexPetBackup:(projectStore:object,project:object,payload:object)=>Promise<object>}} Lifecycle operations.
 */
function createCodexPetLifecycle(options = {}) {
  const {
    codexPetRoot,
    parseWebpSize,
    atlasWidth,
    atlasHeights,
    createToken = () => crypto.randomUUID(),
    now = () => Date.now(),
  } = options;
  if (
    typeof codexPetRoot !== "function" ||
    typeof parseWebpSize !== "function" ||
    !Number.isSafeInteger(atlasWidth) ||
    !Array.isArray(atlasHeights)
  ) {
    throw new TypeError("Codex pet lifecycle dependencies are required.");
  }
  const validAtlasHeights = new Set(atlasHeights.map(Number));

  /** @param {unknown} error Failure to inspect. @returns {boolean} Whether it is already lifecycle-safe. */
  function isLifecycleError(error) {
    return error instanceof CodexPetLifecycleError;
  }

  /** @param {unknown} error Underlying failure. @param {string} message Safe message. @param {string} code Error code. @returns {CodexPetLifecycleError} Wrapped error. */
  function wrapFilesystemError(error, message, code) {
    if (isLifecycleError(error)) return error;
    return new CodexPetLifecycleError(500, code, message, { cause: error });
  }

  /** @param {object} project Project record. @returns {void} */
  function assertCodexPetsProject(project) {
    if (!project || project.kind !== "codex_pets") {
      throw new CodexPetLifecycleError(
        400,
        "codex_pets_project_required",
        "The active project is not the Codex Pets system project.",
      );
    }
  }

  /** @param {unknown} value Raw profile ID. @returns {string} Validated profile ID. */
  function normalizeProfileId(value) {
    const profileId = String(value || "").trim();
    if (!profileId || profileId.length > 160 || profileId.includes("\0")) {
      throw new CodexPetLifecycleError(
        400,
        "invalid_codex_pet_profile",
        "A valid Codex pet profile is required.",
      );
    }
    return profileId;
  }

  /** @param {unknown} value Raw recovery token. @returns {string} Valid UUID token. */
  function normalizeRecoveryToken(value) {
    const token = String(value || "")
      .trim()
      .toLowerCase();
    if (!TOKEN_PATTERN.test(token)) {
      throw new CodexPetLifecycleError(
        400,
        "invalid_codex_pet_token",
        "The Codex pet recovery token is invalid.",
      );
    }
    return token;
  }

  /** @param {string} parent Parent directory. @param {string} candidate Candidate path. @returns {boolean} Whether candidate is one direct child. */
  function isDirectChild(parent, candidate) {
    const relative = path.relative(path.resolve(parent), path.resolve(candidate));
    return (
      Boolean(relative) && !path.isAbsolute(relative) && path.dirname(relative) === "." && relative !== ".."
    );
  }

  /** @param {string} parent Parent directory. @param {string} candidate Candidate path. @returns {boolean} Whether candidate stays inside parent. */
  function isInside(parent, candidate) {
    const relative = path.relative(path.resolve(parent), path.resolve(candidate));
    return (
      relative === "" ||
      (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
    );
  }

  /** @param {unknown} value Directory basename. @returns {boolean} Whether it can be restored below petRoot. */
  function isSafeDirectoryName(value) {
    const name = String(value || "");
    return (
      Boolean(name) &&
      name !== "." &&
      name !== ".." &&
      name !== TRASH_DIRECTORY_NAME &&
      !name.includes("\0") &&
      path.basename(name) === name
    );
  }

  /** @param {string} target Path to inspect. @returns {Promise<import("node:fs").Stats|null>} lstat result or null. */
  async function lstatOptional(target) {
    try {
      return await fs.promises.lstat(target);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  /** @param {string} target Directory path. @param {string} message Missing/unsafe message. @param {string} code Error code. @returns {Promise<void>} */
  async function requireRealDirectory(target, message, code) {
    const stat = await lstatOptional(target);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw new CodexPetLifecycleError(stat ? 409 : 404, code, message);
    }
  }

  /** @param {string} target File path. @param {string} message Missing/unsafe message. @param {string} code Error code. @returns {Promise<void>} */
  async function requireRealFile(target, message, code) {
    const stat = await lstatOptional(target);
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      throw new CodexPetLifecycleError(stat ? 409 : 404, code, message);
    }
  }

  /** @param {object} project Project record. @returns {Promise<string>} Safe pet root. */
  async function resolvePetRoot(project) {
    const petRoot = path.resolve(String(project.petRoot || codexPetRoot()));
    await requireRealDirectory(
      petRoot,
      "The Codex pet directory is missing or unsafe.",
      "unsafe_codex_pet_root",
    );
    return petRoot;
  }

  /** @param {object} projectStore Project persistence. @param {object} project Project record. @returns {Promise<object>} Parsed catalog. */
  async function readCatalog(projectStore, project) {
    const dataDir = projectStore?.projectPaths?.(project)?.dataDir;
    if (!dataDir) {
      throw new CodexPetLifecycleError(
        500,
        "codex_pet_catalog_unavailable",
        "The Codex pet catalog is unavailable.",
      );
    }
    const catalogPath = path.join(dataDir, "codex_pets_catalog.json");
    try {
      const catalog = JSON.parse(await fs.promises.readFile(catalogPath, "utf8"));
      if (!catalog || !Array.isArray(catalog.pets)) throw new Error("invalid catalog");
      return catalog;
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new CodexPetLifecycleError(
          404,
          "codex_pet_catalog_missing",
          "The Codex pet catalog is missing. Refresh the project and try again.",
        );
      }
      throw wrapFilesystemError(
        error,
        "Unable to read the Codex pet catalog.",
        "codex_pet_catalog_unavailable",
      );
    }
  }

  /** @param {object} catalog Pet catalog. @param {string} profileId Target profile. @returns {object} Writable custom pet. */
  function requireWritableCustomPet(catalog, profileId) {
    const pet = catalog.pets.find((entry) => String(entry?.profileId || "") === profileId);
    if (!pet) {
      throw new CodexPetLifecycleError(404, "codex_pet_not_found", `Codex pet not found: ${profileId}`);
    }
    if (pet.kind !== "custom" || pet.writable !== true) {
      throw new CodexPetLifecycleError(
        403,
        "codex_pet_read_only",
        "Built-in or read-only Codex pets cannot be removed or restored.",
      );
    }
    return pet;
  }

  /** @param {string} petRoot Safe pet root. @param {object} pet Catalog pet. @returns {Promise<string>} Safe source directory. */
  async function resolveSourceDirectory(petRoot, pet) {
    const sourceDirectory = path.resolve(String(pet.sourceDirectory || ""));
    if (!isDirectChild(petRoot, sourceDirectory) || path.basename(sourceDirectory) === TRASH_DIRECTORY_NAME) {
      throw new CodexPetLifecycleError(
        409,
        "unsafe_codex_pet_path",
        "The custom Codex pet directory is outside the managed pet root.",
      );
    }
    await requireRealDirectory(
      sourceDirectory,
      "The custom Codex pet directory is missing or unsafe.",
      "unsafe_codex_pet_path",
    );
    return sourceDirectory;
  }

  /** @param {string} petRoot Safe pet root. @param {boolean} create Whether to create the trash directory. @returns {Promise<string>} Safe trash root. */
  async function resolveTrashRoot(petRoot, create) {
    const trashRoot = path.join(petRoot, TRASH_DIRECTORY_NAME);
    const existing = await lstatOptional(trashRoot);
    if (!existing && create) await fs.promises.mkdir(trashRoot, { recursive: false });
    await requireRealDirectory(
      trashRoot,
      "The Codex pet recovery area is missing or unsafe.",
      "unsafe_codex_pet_trash",
    );
    return trashRoot;
  }

  /** @param {string} trashRoot Safe trash root. @returns {Promise<{token:string,entryPath:string}>} Reserved unique recovery entry. */
  async function reserveTrashEntry(trashRoot) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = normalizeRecoveryToken(createToken());
      const entryPath = path.join(trashRoot, token);
      try {
        await fs.promises.mkdir(entryPath, { recursive: false });
        return { token, entryPath };
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
    }
    throw new CodexPetLifecycleError(
      409,
      "codex_pet_token_conflict",
      "Unable to reserve a unique Codex pet recovery token.",
    );
  }

  /** @returns {string} Current timestamp as ISO text. */
  function timestamp() {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw new CodexPetLifecycleError(500, "codex_pet_clock_invalid", "The system clock is invalid.");
    }
    return date.toISOString();
  }

  /**
   * Moves one writable custom pet into the managed recovery area.
   * @param {object} projectStore Project persistence.
   * @param {object} project Active Codex Pets project.
   * @param {{profileId?:string}} payload Removal payload.
   * @returns {Promise<{token:string,id:string,profileId:string,displayName:string,removedAt:string,originalDirectoryName:string}>} Recovery metadata.
   */
  async function removeCustomCodexPet(projectStore, project, payload = {}) {
    let reservedEntry = "";
    try {
      assertCodexPetsProject(project);
      const profileId = normalizeProfileId(payload.profileId);
      const catalog = await readCatalog(projectStore, project);
      const pet = requireWritableCustomPet(catalog, profileId);
      const petRoot = await resolvePetRoot(project);
      const sourceDirectory = await resolveSourceDirectory(petRoot, pet);
      const originalDirectoryName = path.basename(sourceDirectory);
      if (!isSafeDirectoryName(originalDirectoryName)) {
        throw new CodexPetLifecycleError(
          409,
          "unsafe_codex_pet_path",
          "The custom Codex pet directory name is unsafe.",
        );
      }
      const trashRoot = await resolveTrashRoot(petRoot, true);
      const { token, entryPath } = await reserveTrashEntry(trashRoot);
      reservedEntry = entryPath;
      const metadata = {
        schemaVersion: 1,
        token,
        id: String(pet.id || profileId.replace(/^custom:/u, "")),
        profileId,
        displayName: String(pet.displayName || pet.id || profileId).slice(0, 160),
        kind: "custom",
        writable: true,
        removedAt: timestamp(),
        originalDirectoryName,
      };
      await fs.promises.writeFile(
        path.join(entryPath, TRASH_METADATA_NAME),
        `${JSON.stringify(metadata, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
      await fs.promises.rename(sourceDirectory, path.join(entryPath, TRASH_PET_DIRECTORY_NAME));
      return {
        token: metadata.token,
        id: metadata.id,
        profileId: metadata.profileId,
        displayName: metadata.displayName,
        removedAt: metadata.removedAt,
        originalDirectoryName: metadata.originalDirectoryName,
      };
    } catch (error) {
      if (reservedEntry) {
        try {
          const trashedPet = path.join(reservedEntry, TRASH_PET_DIRECTORY_NAME);
          if (await lstatOptional(trashedPet)) {
            // A completed rename means the removal itself succeeded; retain the recoverable entry.
            throw error;
          }
          await fs.promises.rm(reservedEntry, { recursive: true, force: true });
        } catch (cleanupError) {
          if (cleanupError === error) throw error;
          throw new CodexPetLifecycleError(
            500,
            "codex_pet_remove_cleanup_failed",
            "Custom pet removal failed and its temporary recovery entry could not be cleaned up.",
            { cause: new AggregateError([error, cleanupError]) },
          );
        }
      }
      throw wrapFilesystemError(
        error,
        "Unable to move the custom Codex pet to recovery.",
        "codex_pet_remove_failed",
      );
    }
  }

  /** @param {string} entryPath Recovery entry. @param {string} token Expected token. @returns {Promise<object>} Validated recovery metadata. */
  async function readRecoveryMetadata(entryPath, token) {
    const metadataPath = path.join(entryPath, TRASH_METADATA_NAME);
    await requireRealFile(
      metadataPath,
      "The Codex pet recovery metadata is missing or unsafe.",
      "codex_pet_recovery_corrupt",
    );
    let metadata;
    try {
      metadata = JSON.parse(await fs.promises.readFile(metadataPath, "utf8"));
    } catch (error) {
      throw new CodexPetLifecycleError(
        422,
        "codex_pet_recovery_corrupt",
        "The Codex pet recovery metadata is invalid.",
        { cause: error },
      );
    }
    if (
      metadata?.schemaVersion !== 1 ||
      metadata?.token !== token ||
      metadata?.kind !== "custom" ||
      metadata?.writable !== true ||
      !String(metadata?.id || "") ||
      String(metadata?.id || "").length > 160 ||
      String(metadata?.profileId || "").length > 167 ||
      String(metadata?.displayName || "").length > 160 ||
      !Number.isFinite(Date.parse(String(metadata?.removedAt || ""))) ||
      String(metadata?.originalDirectoryName || "").length > 255 ||
      !isSafeDirectoryName(metadata?.originalDirectoryName) ||
      String(metadata?.profileId || "") !== `custom:${String(metadata?.id || "")}`
    ) {
      throw new CodexPetLifecycleError(
        422,
        "codex_pet_recovery_corrupt",
        "The Codex pet recovery metadata failed validation.",
      );
    }
    return metadata;
  }

  /** @param {string} petDirectory Trashed pet directory. @param {object} metadata Recovery metadata. @returns {Promise<void>} */
  async function validateTrashedPet(petDirectory, metadata) {
    await requireRealDirectory(
      petDirectory,
      "The recovered Codex pet directory is missing or unsafe.",
      "codex_pet_recovery_corrupt",
    );
    const manifestPath = path.join(petDirectory, "pet.json");
    await requireRealFile(
      manifestPath,
      "The recovered Codex pet manifest is missing or unsafe.",
      "codex_pet_recovery_corrupt",
    );
    let manifest;
    try {
      manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
    } catch (error) {
      throw new CodexPetLifecycleError(
        422,
        "codex_pet_recovery_corrupt",
        "The recovered Codex pet manifest is invalid.",
        { cause: error },
      );
    }
    if (String(manifest?.id || "") !== String(metadata.id || "")) {
      throw new CodexPetLifecycleError(
        422,
        "codex_pet_recovery_corrupt",
        "The recovered Codex pet does not match its recovery metadata.",
      );
    }
    const spritePath = path.resolve(petDirectory, String(manifest.spritesheetPath || "spritesheet.webp"));
    if (!isInside(petDirectory, spritePath)) {
      throw new CodexPetLifecycleError(
        422,
        "codex_pet_recovery_corrupt",
        "The recovered Codex pet spritesheet path is unsafe.",
      );
    }
    await requireRealFile(
      spritePath,
      "The recovered Codex pet spritesheet is missing or unsafe.",
      "codex_pet_recovery_corrupt",
    );
    const [realPetDirectory, realSpritePath] = await Promise.all([
      fs.promises.realpath(petDirectory),
      fs.promises.realpath(spritePath),
    ]);
    if (!isInside(realPetDirectory, realSpritePath)) {
      throw new CodexPetLifecycleError(
        422,
        "codex_pet_recovery_corrupt",
        "The recovered Codex pet spritesheet escapes its recovery directory.",
      );
    }
  }

  /**
   * Restores one previously removed custom pet from its recovery token.
   * @param {object} projectStore Project persistence.
   * @param {object} project Active Codex Pets project.
   * @param {{token?:string}} payload Restore payload.
   * @returns {Promise<{token:string,id:string,profileId:string,displayName:string,removedAt:string,restoredAt:string,cleanupPending:boolean}>} Restored pet metadata.
   */
  async function restoreRemovedCodexPet(projectStore, project, payload = {}) {
    try {
      assertCodexPetsProject(project);
      const token = normalizeRecoveryToken(payload.token);
      const petRoot = await resolvePetRoot(project);
      const trashRoot = await resolveTrashRoot(petRoot, false);
      const entryPath = path.join(trashRoot, token);
      if (!isDirectChild(trashRoot, entryPath)) {
        throw new CodexPetLifecycleError(
          400,
          "invalid_codex_pet_token",
          "The recovery token path is unsafe.",
        );
      }
      await requireRealDirectory(
        entryPath,
        "The Codex pet recovery token was not found.",
        "codex_pet_recovery_not_found",
      );
      const metadata = await readRecoveryMetadata(entryPath, token);
      const trashedPet = path.join(entryPath, TRASH_PET_DIRECTORY_NAME);
      await validateTrashedPet(trashedPet, metadata);
      const catalog = await readCatalog(projectStore, project);
      if (catalog.pets.some((pet) => String(pet?.profileId || "") === metadata.profileId)) {
        throw new CodexPetLifecycleError(
          409,
          "codex_pet_restore_conflict",
          `Cannot restore ${metadata.displayName}: profile ${metadata.profileId} already exists.`,
        );
      }
      const destination = path.join(petRoot, metadata.originalDirectoryName);
      if (!isDirectChild(petRoot, destination) || (await lstatOptional(destination))) {
        throw new CodexPetLifecycleError(
          409,
          "codex_pet_restore_conflict",
          `Cannot restore ${metadata.displayName}: destination ${metadata.originalDirectoryName} already exists.`,
        );
      }
      const restoredAt = timestamp();
      await fs.promises.rename(trashedPet, destination);
      let cleanupPending = false;
      try {
        await fs.promises.rm(entryPath, { recursive: true, force: true });
      } catch (_error) {
        cleanupPending = true;
      }
      return {
        token,
        id: metadata.id,
        profileId: metadata.profileId,
        displayName: metadata.displayName,
        removedAt: metadata.removedAt,
        restoredAt,
        cleanupPending,
      };
    } catch (error) {
      throw wrapFilesystemError(error, "Unable to restore the custom Codex pet.", "codex_pet_restore_failed");
    }
  }

  /** @param {string} petRoot Safe pet root. @param {object} pet Catalog pet. @returns {Promise<{sourceDirectory:string,destination:string,backup:string}>} Validated atlas paths. */
  async function resolveAtlasPaths(petRoot, pet) {
    const sourceDirectory = await resolveSourceDirectory(petRoot, pet);
    const destination = path.resolve(String(pet.installedSpritesheetPath || ""));
    if (!isInside(sourceDirectory, destination)) {
      throw new CodexPetLifecycleError(
        409,
        "unsafe_codex_pet_atlas_path",
        "The custom Codex pet atlas is outside its managed directory.",
      );
    }
    const backup = path.join(path.dirname(destination), "spritesheet.xsxb-backup.webp");
    if (!isInside(sourceDirectory, backup)) {
      throw new CodexPetLifecycleError(
        409,
        "unsafe_codex_pet_backup_path",
        "The custom Codex pet backup path is outside its managed directory.",
      );
    }
    await requireRealFile(
      destination,
      "The current custom Codex pet atlas is missing or unsafe.",
      "codex_pet_atlas_missing",
    );
    await requireRealFile(
      backup,
      "No recoverable Codex pet atlas backup exists.",
      "codex_pet_backup_missing",
    );
    const [realSource, realDestination, realBackup] = await Promise.all([
      fs.promises.realpath(sourceDirectory),
      fs.promises.realpath(destination),
      fs.promises.realpath(backup),
    ]);
    if (!isInside(realSource, realDestination) || !isInside(realSource, realBackup)) {
      throw new CodexPetLifecycleError(
        409,
        "unsafe_codex_pet_backup_path",
        "The Codex pet atlas or backup escapes its managed directory.",
      );
    }
    return { sourceDirectory, destination, backup };
  }

  /**
   * Restores the original atlas backup for one writable custom pet.
   * @param {object} projectStore Project persistence.
   * @param {object} project Active Codex Pets project.
   * @param {{profileId?:string}} payload Backup restore payload.
   * @returns {Promise<{id:string,profileId:string,displayName:string,restoredAt:string,backupName:string}>} Restore metadata.
   */
  async function restoreCodexPetBackup(projectStore, project, payload = {}) {
    let stagedPath = "";
    try {
      assertCodexPetsProject(project);
      const profileId = normalizeProfileId(payload.profileId);
      const catalog = await readCatalog(projectStore, project);
      const pet = requireWritableCustomPet(catalog, profileId);
      const petRoot = await resolvePetRoot(project);
      const { destination, backup } = await resolveAtlasPaths(petRoot, pet);
      const backupBuffer = await fs.promises.readFile(backup);
      const size = parseWebpSize(backupBuffer);
      if (size.width !== atlasWidth || !validAtlasHeights.has(size.height)) {
        throw new CodexPetLifecycleError(
          422,
          "codex_pet_backup_invalid",
          `The Codex pet backup atlas has invalid dimensions: ${size.width}x${size.height}.`,
        );
      }
      const restoredAt = timestamp();
      stagedPath = path.join(path.dirname(destination), `.xsxb-restore-${crypto.randomUUID()}.tmp`);
      await fs.promises.writeFile(stagedPath, backupBuffer, { flag: "wx" });
      await fs.promises.rename(stagedPath, destination);
      stagedPath = "";
      return {
        id: String(pet.id || profileId.replace(/^custom:/u, "")),
        profileId,
        displayName: String(pet.displayName || pet.id || profileId).slice(0, 160),
        restoredAt,
        backupName: path.basename(backup),
      };
    } catch (error) {
      if (stagedPath) {
        try {
          await fs.promises.rm(stagedPath, { force: true });
        } catch (cleanupError) {
          throw new CodexPetLifecycleError(
            500,
            "codex_pet_backup_cleanup_failed",
            "Atlas recovery failed and its temporary file could not be cleaned up.",
            { cause: new AggregateError([error, cleanupError]) },
          );
        }
      }
      throw wrapFilesystemError(
        error,
        "Unable to restore the Codex pet atlas backup.",
        "codex_pet_backup_restore_failed",
      );
    }
  }

  return Object.freeze({ removeCustomCodexPet, restoreCodexPetBackup, restoreRemovedCodexPet });
}

module.exports = { CodexPetLifecycleError, createCodexPetLifecycle };
