"use strict";

/**
 * Creates the project-persistence operations used by the animation tuner HTTP
 * server.  The factory keeps filesystem and project-store dependencies at the
 * boundary so the mutation logic can be tested without starting a server.
 *
 * @param {object} dependencies Persistence dependencies.
 * @param {import("node:fs")} dependencies.fs Node filesystem module.
 * @param {import("node:path")} dependencies.path Node path module.
 * @param {import("node:crypto")} dependencies.crypto Node crypto module.
 * @param {string} dependencies.root Workspace root used for relative paths.
 * @param {object} dependencies.projectStore Project-store adapter.
 * @param {(value:unknown)=>object|null} dependencies.decodeDataUrl Data URL decoder.
 * @param {(mime:string,name?:string)=>string} dependencies.imageExtensionFromMime Image extension resolver.
 * @param {(candidate:string,root:string)=>boolean} dependencies.isInside Path containment guard.
 * @param {(root:string,requested:string)=>string|null} dependencies.safeResolve Workspace path resolver.
 * @param {(value:string)=>string} dependencies.reslash Slash-normalization helper.
 * @param {(filePath:string)=>{width:number,height:number}} dependencies.getPngSize PNG dimension reader.
 * @param {(values:object)=>object} dependencies.normalizeTuningScaleValues Tuning-value normalizer.
 * @param {(project:object,attachment:object)=>object} dependencies.withFrameAttachmentHash Attachment hash enricher.
 * @param {class} dependencies.HttpError HTTP error constructor.
 * @returns {object} Project persistence operations.
 */
function createProjectPersistence({
  fs,
  path,
  crypto,
  root,
  projectStore,
  decodeDataUrl,
  imageExtensionFromMime,
  isInside,
  safeResolve,
  reslash,
  getPngSize,
  normalizeTuningScaleValues,
  withFrameAttachmentHash,
  HttpError,
}) {
  if (!fs || !path || !crypto || !root || !projectStore) {
    throw new TypeError(
      "Project persistence requires filesystem, path, crypto, root, and project-store dependencies.",
    );
  }

  /**
   * Computes a stable content hash for persisted binary data.
   * @param {Buffer} buffer Binary content.
   * @returns {string} SHA-256 digest.
   */
  function contentHash(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }

  /**
   * Persists tuning and frame override values.
   * @param {object} payload Client tuning payload.
   * @param {object} project Project descriptor.
   * @returns {void}
   */
  function saveTuningPayload(payload, project) {
    const next = {
      schemaVersion: 1,
      values: normalizeTuningScaleValues(payload.values),
      scene_settings:
        payload.scene_settings && typeof payload.scene_settings === "object" ? payload.scene_settings : {},
      frame_visual_overrides:
        payload.frame_visual_overrides && typeof payload.frame_visual_overrides === "object"
          ? payload.frame_visual_overrides
          : {},
      frame_playback_overrides:
        payload.frame_playback_overrides && typeof payload.frame_playback_overrides === "object"
          ? payload.frame_playback_overrides
          : {},
      frame_box_overrides:
        payload.frame_box_overrides && typeof payload.frame_box_overrides === "object"
          ? payload.frame_box_overrides
          : {},
    };
    projectStore.writeJson(projectStore.projectPaths(project).tuning, next);
  }

  /**
   * Persists frame image attachment records and adds missing content hashes.
   * @param {unknown} payload Attachment records.
   * @param {object} project Project descriptor.
   * @returns {object[]} Saved attachment records.
   */
  function saveFrameImageAttachments(payload, project) {
    const attachments = Array.isArray(payload)
      ? payload
          .filter((entry) => entry && typeof entry === "object")
          .map((entry) => withFrameAttachmentHash(project, entry))
      : [];
    projectStore.writeJson(projectStore.projectPaths(project).frameImageAttachments, attachments);
    return attachments;
  }

  /**
   * Persists reusable attachment assets independently from frame instances.
   * @param {unknown} payload Asset records.
   * @param {object} project Project descriptor.
   * @returns {object[]} Saved assets.
   */
  function saveAttachmentAssets(payload, project) {
    const assets = Array.isArray(payload)
      ? payload
          .filter((entry) => entry && typeof entry === "object" && entry.path)
          .map((entry) => ({
            id: String(entry.id || entry.assetHash || crypto.randomUUID()),
            name: String(entry.name || "image"),
            path: String(entry.path),
            assetHash: String(entry.assetHash || ""),
            type: String(entry.type || "image/png"),
            width: Number(entry.width || 0),
            height: Number(entry.height || 0),
            groupKey: String(entry.groupKey || ""),
          }))
      : [];
    projectStore.writeJson(projectStore.projectPaths(project).attachmentAssets, assets);
    return assets;
  }

  /**
   * Persists frame audio bindings in their canonical array representation.
   * @param {unknown} payload Binding array or keyed object.
   * @param {object} project Project descriptor.
   * @returns {object[]} Saved audio bindings.
   */
  function saveFrameAudioBindings(payload, project) {
    const bindings = Array.isArray(payload)
      ? payload.filter((entry) => entry && typeof entry === "object")
      : Object.entries(payload || {})
          .map(([key, value]) => ({
            key,
            ...(value && typeof value === "object" ? value : {}),
          }))
          .filter((entry) => entry && typeof entry === "object");
    const usableBindings = bindings.filter((entry) => entry.data || entry.path || entry.file);
    projectStore.writeJson(projectStore.projectPaths(project).frameAudio, usableBindings);
    return usableBindings;
  }

  /**
   * Stores a frame attachment image under the active project workspace.
   * @param {object} payload Image data URL payload.
   * @param {object} project Project descriptor.
   * @returns {object} Persisted image descriptor.
   */
  function saveFrameAttachmentImage(payload, project) {
    const decoded = decodeDataUrl(payload.data);
    if (!decoded?.buffer?.length || !decoded.mime.startsWith("image/")) {
      throw new Error("Expected an image data URL.");
    }
    const ext = imageExtensionFromMime(decoded.mime, payload.name);
    if (!ext) throw new Error("Unsupported image type.");
    const hash = contentHash(decoded.buffer);
    const fileName = `${hash}${ext}`;
    const workspaceDir = projectStore.projectWorkspaceDir(project);
    const fullPath = path.join(workspaceDir, "attachments", fileName);
    if (!isInside(fullPath, workspaceDir))
      throw new Error("Attachment image must stay under the active project workspace.");
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    if (!fs.existsSync(fullPath)) fs.writeFileSync(fullPath, decoded.buffer);
    const relPath = reslash(path.relative(root, fullPath));
    const pngSize = ext === ".png" ? getPngSize(fullPath) : {};
    return {
      path: relPath,
      assetHash: hash,
      name: String(payload.name || fileName),
      type: decoded.mime,
      width: Number(payload.width || pngSize.width || 0),
      height: Number(payload.height || pngSize.height || 0),
    };
  }

  /**
   * Replaces one PNG frame in the active project workspace.
   * @param {object} payload Replacement payload.
   * @param {object} project Project descriptor.
   * @returns {object} Updated frame dimensions.
   */
  function replaceFrameImage(payload, project) {
    const relPath = reslash(payload.path || "");
    const fullPath = safeResolve(root, relPath);
    const workspaceDir = projectStore.projectWorkspaceDir(project);
    if (!fullPath || !isInside(fullPath, workspaceDir) || path.extname(fullPath).toLowerCase() !== ".png") {
      throw new Error("Frame replacement path must be a PNG under the active project workspace.");
    }
    const match = /^data:image\/png;base64,(.+)$/i.exec(String(payload.data || ""));
    if (!match) throw new Error("Expected a PNG data URL.");
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, Buffer.from(match[1], "base64"));
    return { path: relPath, ...getPngSize(fullPath) };
  }

  /**
   * Atomically replaces an ordered animation frame batch.
   * Every target and PNG payload is validated before temporary files are staged.
   * If a commit fails, already replaced files are restored from their original bytes.
   * @param {Array<{path:string}>} frames Ordered target frame descriptors.
   * @param {Array<{data:string}>} files Ordered PNG payloads.
   * @param {object} project Active project descriptor.
   * @returns {{frames:Array<{path:string,width:number,height:number}>,rollback:()=>void}} Replacement result.
   */
  function replaceAnimationImages(frames, files, project) {
    if (!frames.length || frames.length !== files.length) {
      throw new HttpError(400, `Expected exactly ${frames.length} PNG files`);
    }
    const workspaceDir = projectStore.projectWorkspaceDir(project);
    const seenTargets = new Set();
    const replacements = frames.map((frame, index) => {
      const relPath = reslash(frame?.path || "");
      const fullPath = safeResolve(root, relPath);
      if (!fullPath || !isInside(fullPath, workspaceDir) || path.extname(fullPath).toLowerCase() !== ".png") {
        throw new Error("Frame replacement path must be a PNG under the active project workspace.");
      }
      const targetKey =
        process.platform === "darwin" || process.platform === "win32" ? fullPath.toLowerCase() : fullPath;
      if (seenTargets.has(targetKey)) throw new Error(`Duplicate frame replacement path: ${relPath}`);
      seenTargets.add(targetKey);
      const match = /^data:image\/png;base64,(.+)$/i.exec(String(files[index]?.data || ""));
      if (!match) throw new Error(`Expected a PNG data URL for frame ${index + 1}.`);
      const bytes = Buffer.from(match[1], "base64");
      if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG") {
        throw new Error(`Invalid PNG data for frame ${index + 1}.`);
      }
      return {
        relPath,
        fullPath,
        bytes,
        original: fs.existsSync(fullPath) ? fs.readFileSync(fullPath) : null,
        tempPath: `${fullPath}.cutout-${process.pid}-${Date.now()}-${index}`,
      };
    });
    try {
      for (const replacement of replacements) {
        fs.mkdirSync(path.dirname(replacement.fullPath), { recursive: true });
        fs.writeFileSync(replacement.tempPath, replacement.bytes);
      }
      const committed = [];
      try {
        for (const replacement of replacements) {
          fs.renameSync(replacement.tempPath, replacement.fullPath);
          committed.push(replacement);
        }
      } catch (error) {
        for (const replacement of committed.reverse()) {
          if (replacement.original !== null) fs.writeFileSync(replacement.fullPath, replacement.original);
          else fs.rmSync(replacement.fullPath, { force: true });
        }
        throw error;
      }
    } finally {
      for (const replacement of replacements) fs.rmSync(replacement.tempPath, { force: true });
    }
    let rolledBack = false;
    return {
      frames: replacements.map((replacement) => ({
        path: replacement.relPath,
        ...getPngSize(replacement.fullPath),
      })),
      rollback() {
        if (rolledBack) return;
        for (const replacement of [...replacements].reverse()) {
          if (replacement.original !== null) fs.writeFileSync(replacement.fullPath, replacement.original);
          else fs.rmSync(replacement.fullPath, { force: true });
        }
        rolledBack = true;
      },
    };
  }

  return {
    saveTuningPayload,
    saveFrameImageAttachments,
    saveAttachmentAssets,
    saveFrameAudioBindings,
    saveFrameAttachmentImage,
    replaceFrameImage,
    replaceAnimationImages,
  };
}

module.exports = { createProjectPersistence };
