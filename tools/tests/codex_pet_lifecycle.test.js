"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  ATLAS_HEIGHT,
  ATLAS_WIDTH,
  removeCustomCodexPet,
  restoreCodexPetBackup,
  restoreRemovedCodexPet,
} = require("../codex_pets");

/** @param {number} marker Distinguishing VP8X flag byte. @returns {Buffer} Minimal atlas header accepted by the production parser. */
function createAtlas(marker) {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUInt32LE(10, 16);
  buffer[20] = marker;
  buffer.writeUIntLE(ATLAS_WIDTH - 1, 24, 3);
  buffer.writeUIntLE(ATLAS_HEIGHT - 1, 27, 3);
  return buffer;
}

/**
 * Creates one isolated Codex Pets project with custom and built-in catalog entries.
 * @returns {{root:string,petRoot:string,petDirectory:string,dataDir:string,project:object,projectStore:object,customPet:object,builtinPet:object,writeCatalog:(pets:object[])=>void,dispose:()=>void}}
 */
function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-codex-pet-lifecycle-"));
  const petRoot = path.join(root, "pets");
  const petDirectory = path.join(petRoot, "custom-pet");
  const dataDir = path.join(root, "data");
  fs.mkdirSync(petDirectory, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(petDirectory, "pet.json"),
    `${JSON.stringify({ id: "custom-pet", displayName: "Custom Pet", spritesheetPath: "spritesheet.webp" })}\n`,
  );
  fs.writeFileSync(path.join(petDirectory, "spritesheet.webp"), createAtlas(1));

  const customPet = {
    id: "custom-pet",
    profileId: "custom:custom-pet",
    displayName: "Custom Pet",
    kind: "custom",
    writable: true,
    sourceDirectory: petDirectory,
    installedSpritesheetPath: path.join(petDirectory, "spritesheet.webp"),
  };
  const builtinPet = {
    id: "codex",
    profileId: "codex",
    displayName: "Codex",
    kind: "builtin",
    writable: false,
    sourceDirectory: "",
    installedSpritesheetPath: "",
  };
  const catalogPath = path.join(dataDir, "codex_pets_catalog.json");
  const writeCatalog = (pets) => {
    fs.writeFileSync(catalogPath, `${JSON.stringify({ schemaVersion: 1, petRoot, pets }, null, 2)}\n`);
  };
  writeCatalog([customPet, builtinPet]);
  return {
    root,
    petRoot,
    petDirectory,
    dataDir,
    project: { id: "codex_pets", kind: "codex_pets", petRoot },
    projectStore: { projectPaths: () => ({ dataDir }) },
    customPet,
    builtinPet,
    writeCatalog,
    dispose: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test("custom Codex pets move to recovery and restore only when the destination is free", async () => {
  const fixture = createFixture();
  try {
    const removed = await removeCustomCodexPet(fixture.projectStore, fixture.project, {
      profileId: fixture.customPet.profileId,
    });
    assert.match(removed.token, /^[0-9a-f-]{36}$/u);
    assert.equal(removed.profileId, fixture.customPet.profileId);
    assert.equal(fs.existsSync(fixture.petDirectory), false);
    const recoveryEntry = path.join(fixture.petRoot, ".xsxb-trash", removed.token);
    assert.equal(fs.existsSync(path.join(recoveryEntry, "removal.json")), true);
    assert.equal(fs.existsSync(path.join(recoveryEntry, "pet", "spritesheet.webp")), true);

    await assert.rejects(
      () => restoreRemovedCodexPet(fixture.projectStore, fixture.project, { token: removed.token }),
      (error) => error.status === 409 && error.code === "codex_pet_restore_conflict",
    );
    assert.equal(fs.existsSync(path.join(recoveryEntry, "pet")), true);

    fixture.writeCatalog([fixture.builtinPet]);
    fs.mkdirSync(fixture.petDirectory);
    await assert.rejects(
      () => restoreRemovedCodexPet(fixture.projectStore, fixture.project, { token: removed.token }),
      (error) => error.status === 409 && error.code === "codex_pet_restore_conflict",
    );
    assert.equal(fs.existsSync(path.join(recoveryEntry, "pet")), true);

    fs.rmdirSync(fixture.petDirectory);
    const restored = await restoreRemovedCodexPet(fixture.projectStore, fixture.project, {
      token: removed.token,
    });
    assert.equal(restored.profileId, fixture.customPet.profileId);
    assert.equal(restored.cleanupPending, false);
    assert.equal(fs.existsSync(path.join(fixture.petDirectory, "spritesheet.webp")), true);
    assert.equal(fs.existsSync(recoveryEntry), false);
  } finally {
    fixture.dispose();
  }
});

test("built-in and unsafe Codex pet paths cannot be removed", async () => {
  const fixture = createFixture();
  try {
    await assert.rejects(
      () =>
        removeCustomCodexPet(fixture.projectStore, fixture.project, {
          profileId: fixture.builtinPet.profileId,
        }),
      (error) => error.status === 403 && error.code === "codex_pet_read_only",
    );

    const outsideDirectory = path.join(fixture.root, "outside-pet");
    fs.mkdirSync(outsideDirectory);
    fixture.writeCatalog([{ ...fixture.customPet, sourceDirectory: outsideDirectory }]);
    await assert.rejects(
      () =>
        removeCustomCodexPet(fixture.projectStore, fixture.project, {
          profileId: fixture.customPet.profileId,
        }),
      (error) => error.status === 409 && error.code === "unsafe_codex_pet_path",
    );
    assert.equal(fs.existsSync(outsideDirectory), true);

    await assert.rejects(
      () => restoreRemovedCodexPet(fixture.projectStore, fixture.project, { token: "../../outside" }),
      (error) => error.status === 400 && error.code === "invalid_codex_pet_token",
    );
  } finally {
    fixture.dispose();
  }
});

test("custom Codex pet atlas backup restores atomically while built-ins remain protected", async () => {
  const fixture = createFixture();
  try {
    const currentAtlas = createAtlas(7);
    const backupAtlas = createAtlas(9);
    const atlasPath = path.join(fixture.petDirectory, "spritesheet.webp");
    const backupPath = path.join(fixture.petDirectory, "spritesheet.xsxb-backup.webp");
    fs.writeFileSync(atlasPath, currentAtlas);
    fs.writeFileSync(backupPath, backupAtlas);

    const restored = await restoreCodexPetBackup(fixture.projectStore, fixture.project, {
      profileId: fixture.customPet.profileId,
    });
    assert.equal(restored.profileId, fixture.customPet.profileId);
    assert.deepEqual(fs.readFileSync(atlasPath), backupAtlas);
    assert.deepEqual(fs.readFileSync(backupPath), backupAtlas);

    await assert.rejects(
      () =>
        restoreCodexPetBackup(fixture.projectStore, fixture.project, {
          profileId: fixture.builtinPet.profileId,
        }),
      (error) => error.status === 403 && error.code === "codex_pet_read_only",
    );
  } finally {
    fixture.dispose();
  }
});
