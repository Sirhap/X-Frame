"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { projectDataRevision } = require("./attachment_alignment_core");

const MAX_REVISIONS = 20;
const MAX_REVISION_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ARGUMENT_METADATA_BYTES = 48 * 1024;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function redact(value, key = "", depth = 0) {
  if (/secret|token|password|authorization|api[_-]?key/iu.test(key)) return "[REDACTED]";
  if (depth > 6) return "[MAX_DEPTH]";
  if (typeof value === "string") {
    const bytes = Buffer.byteLength(value);
    if (/path|directory|root|source/iu.test(key)) {
      return `[PATH basename=${path.basename(value)} sha256=${sha256(value).slice(0, 16)}]`;
    }
    if (/data|blob|image|content|base64/iu.test(key) || value.startsWith("data:") || bytes > 2048) {
      return `[DATA bytes=${bytes} sha256=${sha256(value)}]`;
    }
    return value.length > 512 ? `${value.slice(0, 256)}…[sha256=${sha256(value)}]` : value;
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, 32).map((entry) => redact(entry, key, depth + 1));
    return value.length > items.length ? { count: value.length, items, truncated: true } : items;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 64)
        .map(([name, entry]) => [name, redact(entry, name, depth + 1)]),
    );
  }
  return value;
}

function boundedArguments(value) {
  const summarized = redact(value || {});
  const encoded = JSON.stringify(summarized);
  if (Buffer.byteLength(encoded) <= MAX_ARGUMENT_METADATA_BYTES) return summarized;
  const source = JSON.stringify(value || {});
  return {
    summary: "Arguments exceeded the journal metadata budget and were replaced by a digest.",
    bytes: Buffer.byteLength(source),
    sha256: sha256(source),
    keys: value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).slice(0, 64) : [],
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, filePath);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function isInside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function pathEntryExists(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function fileHash(filePath) {
  if (!fs.existsSync(filePath)) return "missing";
  const digest = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = fs.openSync(filePath, "r");
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) digest.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return digest.digest("hex");
}

/**
 * Hashes the current contents and topology of restore targets without following symlinks.
 * @param {Array<{path:string}>} snapshots Revision snapshot descriptors.
 * @returns {string} Stable state digest.
 */
function currentSnapshotStateHash(snapshots) {
  const digest = crypto.createHash("sha256");

  /** @param {string} absolutePath @param {string} relativePath */
  function visit(absolutePath, relativePath) {
    if (!pathEntryExists(absolutePath)) {
      digest.update(`missing:${relativePath}\0`);
      return;
    }
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) {
      digest.update(`symlink:${relativePath}:${fs.readlinkSync(absolutePath)}\0`);
      return;
    }
    if (stat.isDirectory()) {
      digest.update(`directory:${relativePath}\0`);
      for (const entry of fs.readdirSync(absolutePath).sort()) {
        visit(path.join(absolutePath, entry), path.posix.join(relativePath, entry));
      }
      return;
    }
    if (stat.isFile()) {
      digest.update(`file:${relativePath}:${stat.size}:${fileHash(absolutePath)}\0`);
      return;
    }
    digest.update(`other:${relativePath}:${stat.mode}\0`);
  }

  for (const snapshot of [...snapshots].sort((left, right) => left.path.localeCompare(right.path))) {
    visit(path.resolve(snapshot.path), path.basename(snapshot.path));
  }
  return digest.digest("hex");
}

function pathBytes(filePath) {
  if (!pathEntryExists(filePath)) return 0;
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) throw new Error(`Mutation journal refuses symbolic links: ${filePath}`);
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  return fs.readdirSync(filePath).reduce((sum, entry) => sum + pathBytes(path.join(filePath, entry)), 0);
}

function assertNoSymlinks(filePath) {
  if (!pathEntryExists(filePath)) return;
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) throw new Error(`Mutation journal refuses symbolic link targets: ${filePath}`);
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(filePath)) assertNoSymlinks(path.join(filePath, entry));
}

function pathContentHash(filePath) {
  const digest = crypto.createHash("sha256");
  const rootPath = path.resolve(filePath);
  function visit(candidate, relative) {
    if (!pathEntryExists(candidate)) {
      digest.update(`missing:${relative}\0`);
      return;
    }
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink()) throw new Error(`Snapshot integrity refuses symbolic links: ${candidate}`);
    if (stat.isDirectory()) {
      digest.update(`directory:${relative}\0`);
      for (const entry of fs.readdirSync(candidate).sort()) {
        visit(path.join(candidate, entry), path.posix.join(relative, entry));
      }
      return;
    }
    if (stat.isFile()) {
      digest.update(`file:${relative}:${stat.size}:${fileHash(candidate)}\0`);
      return;
    }
    digest.update(`other:${relative}:${stat.mode}\0`);
  }
  visit(rootPath, path.basename(rootPath));
  return digest.digest("hex");
}

/**
 * Checks whether a journal owner process is still running on the local host.
 * @param {unknown} ownerPid Persisted process id.
 * @returns {boolean} True when the process may still own the mutation.
 */
function isProcessAlive(ownerPid) {
  const pid = Number(ownerPid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/**
 * Creates the per-project mutation journal and restore interface.
 * @param {{root:string,projectStore:object,now?:()=>number,maxRevisions?:number,maxBytes?:number}} options Journal options.
 * @returns {{run:Function,list:Function,previewRestore:Function,restore:Function}} Journal.
 */
function createProjectMutationJournal(options) {
  const root = path.resolve(options.root);
  const projectStore = options.projectStore;
  const now = options.now || Date.now;
  const maxRevisions = Number(options.maxRevisions || MAX_REVISIONS);
  const maxBytes = Number(options.maxBytes || MAX_REVISION_BYTES);
  const onListChanged = typeof options.onListChanged === "function" ? options.onListChanged : () => {};
  const baseFor = (project) => path.join(projectStore.projectWorkspaceDir(project), ".xsxb", "revisions");

  function assertTrustedPath(project, targetPath) {
    const absolute = path.resolve(targetPath);
    let trustedBase = "";
    if (isInside(absolute, root)) trustedBase = root;
    else if (project.projectRoot && isInside(absolute, project.projectRoot)) {
      trustedBase = path.resolve(project.projectRoot);
    }
    if (!trustedBase)
      throw new Error(`Mutation journal refused path outside trusted project roots: ${absolute}`);
    let ancestor = absolute;
    while (!fs.existsSync(ancestor)) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
    const realBase = fs.realpathSync(trustedBase);
    const realAncestor = fs.realpathSync(ancestor);
    if (!isInside(realAncestor, realBase)) {
      throw new Error(`Mutation journal path resolves outside its trusted project root: ${absolute}`);
    }
    return absolute;
  }

  function metadataPath(project, revisionId) {
    return path.join(baseFor(project), revisionId, "revision.json");
  }

  function readEntry(project, revisionId) {
    if (!/^revision_[a-f0-9]{24}$/u.test(String(revisionId || ""))) {
      throw new Error("Invalid project revision id.");
    }
    const filePath = metadataPath(project, revisionId);
    if (!fs.existsSync(filePath)) throw new Error(`Project revision not found: ${revisionId}`);
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  function snapshot(project, revisionId, paths) {
    const directory = path.join(baseFor(project), revisionId, "before");
    fs.mkdirSync(directory, { recursive: true });
    return paths.map((filePath, index) => {
      const absolute = assertTrustedPath(project, filePath);
      const exists = pathEntryExists(absolute);
      if (exists) assertNoSymlinks(absolute);
      const type = exists && fs.statSync(absolute).isDirectory() ? "directory" : "file";
      const snapshotName = `${String(index).padStart(4, "0")}-${sha256(absolute).slice(0, 12)}.snapshot`;
      const snapshotPath = path.join(directory, snapshotName);
      if (exists && type === "directory") fs.cpSync(absolute, snapshotPath, { recursive: true });
      else if (exists) fs.copyFileSync(absolute, snapshotPath);
      return {
        path: absolute,
        exists,
        type,
        hash: exists ? pathContentHash(absolute) : "missing",
        snapshotHash: exists ? pathContentHash(snapshotPath) : "missing",
        snapshot: exists ? path.relative(path.join(baseFor(project), revisionId), snapshotPath) : "",
        bytes: exists ? pathBytes(absolute) : 0,
      };
    });
  }

  function restoreSnapshots(project, revisionId, snapshots) {
    const directory = path.join(baseFor(project), revisionId);
    const prepared = [];
    for (const entry of snapshots) {
      assertTrustedPath(project, entry.path);
      let source = "";
      if (entry.exists) {
        source = path.resolve(directory, entry.snapshot);
        if (!isInside(source, directory) || !fs.existsSync(source)) {
          throw new Error(`Revision snapshot is missing: ${entry.path}`);
        }
        if (entry.snapshotHash && pathContentHash(source) !== String(entry.snapshotHash)) {
          throw new Error(`Revision snapshot integrity hash mismatch: ${entry.path}`);
        }
      }
      const token = crypto.randomBytes(8).toString("hex");
      const stage = `${entry.path}.xsxb-restore-stage-${token}`;
      const backup = `${entry.path}.xsxb-restore-backup-${token}`;
      if (entry.exists) {
        fs.mkdirSync(path.dirname(stage), { recursive: true });
        if (entry.type === "directory") fs.cpSync(source, stage, { recursive: true });
        else fs.copyFileSync(source, stage);
      }
      prepared.push({ entry, stage, backup, hadCurrent: pathEntryExists(entry.path), applied: false });
    }
    try {
      for (const item of prepared) {
        fs.mkdirSync(path.dirname(item.entry.path), { recursive: true });
        if (item.hadCurrent) fs.renameSync(item.entry.path, item.backup);
        if (item.entry.exists) fs.renameSync(item.stage, item.entry.path);
        item.applied = true;
      }
    } catch (error) {
      for (const item of [...prepared].reverse()) {
        if (item.applied || fs.existsSync(item.backup)) {
          fs.rmSync(item.entry.path, { recursive: true, force: true });
          if (fs.existsSync(item.backup)) fs.renameSync(item.backup, item.entry.path);
        }
        fs.rmSync(item.stage, { recursive: true, force: true });
      }
      throw error;
    }
    for (const item of prepared) {
      fs.rmSync(item.stage, { recursive: true, force: true });
      fs.rmSync(item.backup, { recursive: true, force: true });
    }
  }

  function entries(project) {
    const base = baseFor(project);
    if (!fs.existsSync(base)) return [];
    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^revision_[a-f0-9]{24}$/u.test(entry.name))
      .flatMap((entry) => {
        try {
          return [readEntry(project, entry.name)];
        } catch {
          return [];
        }
      })
      .sort((left, right) => Number(right.createdAtMs || 0) - Number(left.createdAtMs || 0));
  }

  function recoverPending(project) {
    let recovered = 0;
    for (const entry of entries(project)) {
      if (!new Set(["pending", "rollback_failed", "recovery_failed"]).has(String(entry.status || ""))) {
        continue;
      }
      if (isProcessAlive(entry.ownerPid)) continue;
      try {
        restoreSnapshots(project, entry.revisionId, entry.snapshots || []);
        writeJson(metadataPath(project, entry.revisionId), {
          ...entry,
          status: "recovered_rollback",
          recoveredAt: new Date(now()).toISOString(),
          recoveredAtMs: now(),
          afterRevision: projectDataRevision(projectStore, project),
        });
        recovered += 1;
      } catch (error) {
        writeJson(metadataPath(project, entry.revisionId), {
          ...entry,
          status: "recovery_failed",
          recoveryError: String(error?.message || error),
        });
        throw new Error(
          `Pending mutation recovery failed for ${project.id}/${entry.revisionId}: ${error.message}`,
        );
      }
    }
    if (recovered > 0) onListChanged();
    return recovered;
  }

  function prune(project) {
    const current = entries(project);
    let retainedBytes = 0;
    current.forEach((entry, index) => {
      const entryBytes = Number(entry.snapshotBytes || 0);
      retainedBytes += entryBytes;
      if (entry.pinned === true) return;
      if (index < maxRevisions && retainedBytes <= maxBytes) return;
      fs.rmSync(path.join(baseFor(project), entry.revisionId), { recursive: true, force: true });
    });
  }

  async function run(args) {
    const project = args.project;
    const beforeRevision = projectDataRevision(projectStore, project);
    const createdAtMs = now();
    const revisionId = `revision_${sha256(
      `${project.id}:${args.tool}:${beforeRevision}:${createdAtMs}:${crypto.randomBytes(8).toString("hex")}`,
    ).slice(0, 24)}`;
    const paths = [...new Set((args.paths || []).map((filePath) => path.resolve(filePath)))];
    for (const filePath of paths) {
      assertTrustedPath(project, filePath);
      assertNoSymlinks(filePath);
    }
    const estimatedSnapshotBytes = paths.reduce((sum, filePath) => sum + pathBytes(filePath), 0);
    const pinnedBytes = entries(project)
      .filter((entry) => entry.pinned === true)
      .reduce((sum, entry) => sum + Number(entry.snapshotBytes || 0), 0);
    if (estimatedSnapshotBytes > maxBytes || pinnedBytes + estimatedSnapshotBytes > maxBytes) {
      const error = new Error(
        `Mutation snapshot cannot be retained within the ${maxBytes}-byte revision budget.`,
      );
      error.code = "xsxb_revision_budget_exceeded";
      throw error;
    }
    if (typeof fs.statfsSync === "function") {
      const filesystem = fs.statfsSync(root);
      const availableBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
      if (estimatedSnapshotBytes > availableBytes * 0.9) {
        const error = new Error("Mutation snapshot cannot be retained with the available disk space.");
        error.code = "xsxb_revision_disk_full";
        throw error;
      }
    }
    const snapshots = snapshot(project, revisionId, paths);
    const snapshotBytes = snapshots.reduce((sum, entry) => sum + Number(entry.bytes || 0), 0);
    if (snapshotBytes > maxBytes || pinnedBytes + snapshotBytes > maxBytes) {
      fs.rmSync(path.join(baseFor(project), revisionId), { recursive: true, force: true });
      const error = new Error("Mutation snapshot grew beyond the retainable revision budget.");
      error.code = "xsxb_revision_budget_exceeded";
      throw error;
    }
    const baseMetadata = {
      schemaVersion: 1,
      revisionId,
      projectId: project.id,
      tool: String(args.tool || "mutation"),
      arguments: boundedArguments(args.arguments || {}),
      createdAt: new Date(createdAtMs).toISOString(),
      createdAtMs,
      beforeRevision,
      snapshots,
      snapshotBytes,
      pinned: false,
      ownerPid: process.pid,
    };
    writeJson(metadataPath(project, revisionId), {
      ...baseMetadata,
      status: "pending",
      afterRevision: beforeRevision,
    });
    onListChanged();
    try {
      const result = await args.mutate();
      if (result?.sync?.requested === true && result.sync.ok === false && result.syncPending === undefined) {
        result.syncPending = true;
      }
      const afterRevision = projectDataRevision(projectStore, project);
      const metadata = { ...baseMetadata, status: "committed", afterRevision };
      writeJson(metadataPath(project, revisionId), metadata);
      onListChanged();
      prune(project);
      return {
        ...(result || {}),
        ...((result || {}).status === undefined ? { status: "committed" } : {}),
        mutationJournalStatus: "committed",
        mutationRevisionId: revisionId,
        mutationBeforeRevision: beforeRevision,
        mutationAfterRevision: afterRevision,
      };
    } catch (error) {
      let rollbackError = null;
      try {
        restoreSnapshots(project, revisionId, snapshots);
      } catch (reason) {
        rollbackError = reason;
      }
      writeJson(metadataPath(project, revisionId), {
        ...baseMetadata,
        status: rollbackError ? "rollback_failed" : "rolled_back",
        error: String(error?.message || error),
        ...(rollbackError ? { rollbackError: String(rollbackError.message || rollbackError) } : {}),
        afterRevision: projectDataRevision(projectStore, project),
      });
      onListChanged();
      prune(project);
      if (rollbackError) {
        const rollbackFailure = new Error(
          `${error.message}; automatic rollback also failed: ${rollbackError.message}`,
        );
        rollbackFailure.code = "xsxb_rollback_failed";
        throw rollbackFailure;
      }
      throw error;
    }
  }

  function list(project) {
    return entries(project);
  }

  function resourceUri(projectId, revisionId) {
    return `xsxb://projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}`;
  }

  function parseResourceUri(uri) {
    let parsed;
    try {
      parsed = new URL(String(uri));
    } catch {
      throw new Error("Invalid project revision resource URI.");
    }
    const parts = parsed.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
    if (
      parsed.protocol !== "xsxb:" ||
      parsed.hostname !== "projects" ||
      parts.length !== 3 ||
      parts[1] !== "revisions" ||
      !/^[a-zA-Z0-9_.-]+$/u.test(parts[0]) ||
      !/^revision_[a-f0-9]{24}$/u.test(parts[2])
    ) {
      throw new Error("Invalid project revision resource URI.");
    }
    return { projectId: parts[0], revisionId: parts[2] };
  }

  function projectById(projectId) {
    const project = projectStore.readRegistry().projects.find((entry) => entry.id === projectId);
    if (!project) throw new Error(`Project revision resource project not found: ${projectId}`);
    return project;
  }

  function readResource(uri) {
    const identity = parseResourceUri(uri);
    const entry = readEntry(projectById(identity.projectId), identity.revisionId);
    return {
      uri: String(uri),
      mimeType: "application/json",
      text: `${JSON.stringify(entry, null, 2)}\n`,
    };
  }

  function listResources() {
    const resources = [];
    for (const project of projectStore.readRegistry().projects) {
      for (const entry of entries(project)) {
        resources.push({
          uri: resourceUri(project.id, entry.revisionId),
          name: entry.revisionId,
          title: `${entry.tool} project revision`,
          description: `Restorable XSXB mutation revision for ${project.id}`,
          mimeType: "application/json",
          annotations: {
            audience: ["user", "assistant"],
            priority: 0.7,
            lastModified: entry.createdAt,
          },
        });
      }
    }
    return resources;
  }

  function restoreToken(project, entry) {
    const currentRevision = projectDataRevision(projectStore, project);
    const currentState = currentSnapshotStateHash(entry.snapshots);
    const restoreScope = sha256(
      JSON.stringify(
        [...entry.snapshots]
          .map((snapshot) => ({
            path: String(snapshot.path),
            type: String(snapshot.type),
            exists: snapshot.exists === true,
            snapshot: String(snapshot.snapshot || ""),
            snapshotHash: String(snapshot.snapshotHash || ""),
          }))
          .sort((left, right) => left.path.localeCompare(right.path)),
      ),
    );
    return sha256(
      `${project.id}:${entry.revisionId}:${entry.beforeRevision}:${currentRevision}:${currentState}:${restoreScope}`,
    ).slice(0, 32);
  }

  function previewRestore(project, revisionId) {
    const entry = readEntry(project, revisionId);
    return {
      projectId: project.id,
      revisionId,
      dryRun: true,
      status: "preview",
      restoreToken: restoreToken(project, entry),
      files: entry.snapshots.map((snapshot) => ({ path: snapshot.path, existed: snapshot.exists })),
      beforeRevision: entry.beforeRevision,
      currentRevision: projectDataRevision(projectStore, project),
    };
  }

  async function restore(args) {
    if (args.confirm !== true) throw new Error("Restoring a project revision requires confirm=true.");
    const entry = readEntry(args.project, args.revisionId);
    const expected = restoreToken(args.project, entry);
    if (!args.restoreToken || String(args.restoreToken) !== expected) {
      throw new Error("restore_token is missing or stale; run dry_run again.");
    }
    return run({
      project: args.project,
      tool: "xsxb_restore_project_revision",
      arguments: { revision_id: args.revisionId },
      paths: entry.snapshots.map((snapshotEntry) => snapshotEntry.path),
      mutate() {
        restoreSnapshots(args.project, args.revisionId, entry.snapshots);
        return {
          projectId: args.project.id,
          revisionId: args.revisionId,
          status: "restored",
          restoredFiles: entry.snapshots.length,
          revision: projectDataRevision(projectStore, args.project),
        };
      },
    });
  }

  for (const project of projectStore.readRegistry().projects) recoverPending(project);

  return { list, listResources, previewRestore, readResource, recoverPending, resourceUri, restore, run };
}

module.exports = {
  MAX_REVISIONS,
  MAX_REVISION_BYTES,
  createProjectMutationJournal,
  redact,
};
