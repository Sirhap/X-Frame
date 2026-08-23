"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { decodePngRgba, encodePngRgba } = require("./xsxb_mcp_cutout");

const DEFAULT_MAX_EDGE = 1024;
const DEFAULT_MAX_INLINE_BYTES = 1_500_000;
const REVIEW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ARTIFACTS_PER_PROJECT = 100;
const DEFAULT_MAX_PINNED_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const DEFAULT_MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fileSha256(filePath) {
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

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, filePath);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function resizeNearest(image, width, height) {
  if (image.width === width && image.height === height) return image;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor((y * image.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor((x * image.width) / width));
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      data.set(image.data.subarray(sourceOffset, sourceOffset + 4), (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

function boundedPng(sourcePath, options = {}) {
  const image = decodePngRgba(sourcePath);
  const maxEdge = Math.max(64, Number(options.maxEdge || DEFAULT_MAX_EDGE));
  const maxBytes = Math.max(64 * 1024, Number(options.maxBytes || DEFAULT_MAX_INLINE_BYTES));
  let scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  let output = image;
  let buffer;
  do {
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    output = resizeNearest(image, width, height);
    buffer = encodePngRgba(output.data, output.width, output.height);
    scale *= 0.8;
  } while (buffer.length > maxBytes && output.width > 64 && output.height > 64);
  return { ...output, buffer, bytes: buffer.length };
}

function mimeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".gif") return "image/gif";
  if (extension === ".json") return "application/json";
  return "application/octet-stream";
}

function safeSegment(value, label) {
  const text = String(value || "");
  if (!/^[a-zA-Z0-9_.-]+$/u.test(text)) throw new Error(`Invalid review resource ${label}.`);
  return text;
}

/**
 * Persists bounded visual review evidence and exposes it through MCP resources.
 * @param {{root:string,projectStore:object,now?:()=>number,maxEdge?:number,maxInlineBytes?:number}} options Store options.
 * @returns {{create:Function,read:Function,list:Function,templates:Function,get:Function}} Artifact store.
 */
function createReviewArtifactStore(options) {
  const projectStore = options.projectStore;
  const now = options.now || Date.now;
  const maxEdge = Number(options.maxEdge || DEFAULT_MAX_EDGE);
  const maxInlineBytes = Number(options.maxInlineBytes || DEFAULT_MAX_INLINE_BYTES);
  const maxPinnedBytes = Number(options.maxPinnedBytes || DEFAULT_MAX_PINNED_BYTES);
  const maxTotalBytes = Number(options.maxTotalBytes || DEFAULT_MAX_TOTAL_BYTES);
  const maxArtifactBytes = Number(options.maxArtifactBytes || DEFAULT_MAX_ARTIFACT_BYTES);
  const onListChanged = typeof options.onListChanged === "function" ? options.onListChanged : () => {};
  const stats = { created: 0, reused: 0, peakThumbnailPixels: 0 };

  const baseFor = (project) => path.join(projectStore.projectWorkspaceDir(project), ".xsxb", "reviews");
  const metadataPath = (project, artifactId) => path.join(baseFor(project), artifactId, "artifact.json");

  function projectById(projectId) {
    const registry = projectStore.readRegistry();
    const project = registry.projects.find((entry) => entry.id === projectId);
    if (!project) throw new Error(`Review resource project not found: ${projectId}`);
    return project;
  }

  function readMetadata(project, artifactId) {
    const filePath = metadataPath(project, artifactId);
    if (!fs.existsSync(filePath)) throw new Error(`Review artifact not found: ${artifactId}`);
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  function get(project, artifactId, getOptions = {}) {
    const metadata = readMetadata(project, artifactId);
    if (metadata.pinned !== true && Number(metadata.expiresAtMs || 0) <= now()) {
      fs.rmSync(path.join(baseFor(project), artifactId), { recursive: true, force: true });
      onListChanged();
      throw new Error(`Review artifact expired: ${artifactId}`);
    }
    const directory = path.join(baseFor(project), artifactId);
    const fullPath = path.join(directory, metadata.full?.name || "");
    const thumbnailPath = path.join(directory, metadata.thumbnail?.name || "");
    if (
      !metadata.full?.name ||
      !metadata.thumbnail?.name ||
      !fs.existsSync(fullPath) ||
      !fs.existsSync(thumbnailPath)
    ) {
      throw new Error(`Review artifact integrity files are missing: ${artifactId}`);
    }
    if (
      fs.statSync(fullPath).size !== Number(metadata.full.bytes) ||
      fs.statSync(thumbnailPath).size !== Number(metadata.thumbnail.bytes)
    ) {
      throw new Error(`Review artifact integrity size mismatch: ${artifactId}`);
    }
    if (!metadata.thumbnail.hash && Number(metadata.schemaVersion || 0) < 2) {
      metadata.thumbnail.hash = sha256(fs.readFileSync(thumbnailPath));
      metadata.schemaVersion = 2;
      atomicJson(metadataPath(project, artifactId), metadata);
    }
    if (getOptions.verifyContent !== false) {
      if (fileSha256(fullPath) !== String(metadata.artifactHash || "")) {
        throw new Error(`Review artifact full-content hash mismatch: ${artifactId}`);
      }
      if (sha256(fs.readFileSync(thumbnailPath)) !== String(metadata.thumbnail.hash || "")) {
        throw new Error(`Review artifact thumbnail hash mismatch: ${artifactId}`);
      }
    }
    return metadata;
  }

  function assertPinnedBudget(project, additionalBytes, excludedArtifactId = "") {
    let pinnedBytes = 0;
    const base = baseFor(project);
    if (fs.existsSync(base)) {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === excludedArtifactId) continue;
        try {
          const metadata = readMetadata(project, entry.name);
          if (metadata.pinned === true) {
            pinnedBytes += Number(metadata.full?.bytes || 0) + Number(metadata.thumbnail?.bytes || 0);
          }
        } catch {
          // Corrupt artifacts are excluded from usable pinned evidence.
        }
      }
    }
    if (pinnedBytes + Number(additionalBytes || 0) > maxPinnedBytes) {
      throw new Error(`Pinned review artifacts exceed the ${maxPinnedBytes}-byte project budget.`);
    }
  }

  function setPinned(project, artifactId, pinned) {
    const metadata = get(project, artifactId);
    if (pinned === true && metadata.pinned !== true) {
      assertPinnedBudget(
        project,
        Number(metadata.full.bytes || 0) + Number(metadata.thumbnail.bytes || 0),
        artifactId,
      );
    }
    metadata.pinned = pinned === true;
    atomicJson(metadataPath(project, artifactId), metadata);
    return metadata;
  }

  function resourceUri(projectId, artifactId, asset) {
    return `xsxb://projects/${encodeURIComponent(projectId)}/reviews/${encodeURIComponent(artifactId)}/${encodeURIComponent(asset)}`;
  }

  function prune(project) {
    const base = baseFor(project);
    if (!fs.existsSync(base)) return;
    const entries = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^review_[a-f0-9]{24}$/u.test(entry.name))
      .map((entry) => {
        try {
          return readMetadata(project, entry.name);
        } catch {
          return { artifactId: entry.name, createdAtMs: 0, expiresAtMs: 0, pinned: false };
        }
      })
      .sort((left, right) => Number(right.createdAtMs || 0) - Number(left.createdAtMs || 0));
    let retainedUnpinnedBytes = 0;
    let retainedUnpinnedCount = 0;
    entries.forEach((entry) => {
      if (entry.pinned === true) return;
      retainedUnpinnedCount += 1;
      retainedUnpinnedBytes += Number(entry.full?.bytes || 0) + Number(entry.thumbnail?.bytes || 0);
      if (
        retainedUnpinnedCount <= MAX_ARTIFACTS_PER_PROJECT &&
        retainedUnpinnedBytes <= maxTotalBytes &&
        Number(entry.expiresAtMs || 0) > now()
      ) {
        return;
      }
      fs.rmSync(path.join(base, entry.artifactId), { recursive: true, force: true });
    });
  }

  function create(args) {
    const project = args.project;
    const sourcePath = path.resolve(String(args.sourcePath || ""));
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new Error(`Review artifact source not found: ${sourcePath}`);
    }
    const sourceSize = fs.statSync(sourcePath).size;
    if (sourceSize > maxArtifactBytes) {
      throw new Error(
        `Review artifact is too large: ${sourceSize} bytes exceeds the ${maxArtifactBytes}-byte limit.`,
      );
    }
    const artifactHash = fileSha256(sourcePath);
    const seed = JSON.stringify({
      projectId: project.id,
      kind: String(args.kind || "review"),
      revision: String(args.revision || ""),
      artifactHash,
      parameters: args.parameters || {},
    });
    const artifactId = `review_${sha256(seed).slice(0, 24)}`;
    const directory = path.join(baseFor(project), artifactId);
    const existingPath = metadataPath(project, artifactId);
    let metadata;
    let reused = false;
    if (fs.existsSync(existingPath)) {
      metadata = readMetadata(project, artifactId);
      const expired = metadata.pinned !== true && Number(metadata.expiresAtMs || 0) <= now();
      if (expired) {
        fs.rmSync(directory, { recursive: true, force: true });
        metadata = undefined;
      } else {
        if (args.pinned === true && metadata.pinned !== true) {
          assertPinnedBudget(
            project,
            Number(metadata.full.bytes || 0) + Number(metadata.thumbnail.bytes || 0),
            artifactId,
          );
          metadata.pinned = true;
          atomicJson(existingPath, metadata);
        }
        metadata = get(project, artifactId);
        reused = true;
        stats.reused += 1;
      }
    }
    if (!metadata) {
      const extension = path.extname(sourcePath).toLowerCase() || ".bin";
      const fullName = `full${extension}`;
      const thumbnailSourcePath = path.resolve(String(args.thumbnailSourcePath || sourcePath));
      if (!/\.png$/iu.test(thumbnailSourcePath)) {
        throw new Error("A PNG thumbnailSourcePath is required for non-PNG review artifacts.");
      }
      const thumbnail = boundedPng(thumbnailSourcePath, {
        maxEdge,
        maxBytes: maxInlineBytes,
      });
      if (args.pinned === true) {
        assertPinnedBudget(project, sourceSize + thumbnail.bytes, artifactId);
      }
      const createdAtMs = now();
      metadata = {
        schemaVersion: 2,
        artifactId,
        artifactHash,
        projectId: project.id,
        kind: String(args.kind || "review"),
        revision: String(args.revision || ""),
        parameters: args.parameters || {},
        createdAt: new Date(createdAtMs).toISOString(),
        createdAtMs,
        expiresAtMs: createdAtMs + REVIEW_RETENTION_MS,
        pinned: args.pinned === true,
        full: { name: fullName, mimeType: mimeFor(sourcePath), bytes: sourceSize },
        thumbnail: {
          name: "thumbnail.png",
          mimeType: "image/png",
          width: thumbnail.width,
          height: thumbnail.height,
          bytes: thumbnail.bytes,
          hash: sha256(thumbnail.buffer),
        },
        reviewPolicy: {
          requiredCapabilities: ["image_input"],
          fallback: "human_review",
          canAutoApplyWithoutVision: false,
        },
      };
      const base = baseFor(project);
      fs.mkdirSync(base, { recursive: true });
      const temporaryDirectory = path.join(
        base,
        `.artifact-${artifactId}-${process.pid}-${crypto.randomBytes(6).toString("hex")}`,
      );
      fs.mkdirSync(temporaryDirectory);
      let created = false;
      try {
        fs.copyFileSync(sourcePath, path.join(temporaryDirectory, fullName));
        fs.writeFileSync(path.join(temporaryDirectory, "thumbnail.png"), thumbnail.buffer);
        atomicJson(path.join(temporaryDirectory, "artifact.json"), metadata);
        try {
          fs.renameSync(temporaryDirectory, directory);
          created = true;
        } catch (error) {
          if (!new Set(["EEXIST", "ENOTEMPTY"]).has(error.code)) throw error;
          metadata = get(project, artifactId);
          if (args.pinned === true && metadata.pinned !== true) {
            metadata = setPinned(project, artifactId, true);
          }
          reused = true;
          stats.reused += 1;
        }
      } finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
      }
      if (created) stats.created += 1;
      stats.peakThumbnailPixels = Math.max(
        stats.peakThumbnailPixels,
        metadata.thumbnail.width * metadata.thumbnail.height,
      );
      if (created) {
        prune(project);
        onListChanged();
      }
    }
    metadata = get(project, artifactId);
    const thumbnailBuffer = fs.readFileSync(path.join(directory, metadata.thumbnail.name));
    const fullUri = resourceUri(project.id, artifactId, metadata.full.name);
    return {
      ...metadata,
      reused,
      uri: fullUri,
      content: [
        {
          type: "image",
          data: thumbnailBuffer.toString("base64"),
          mimeType: "image/png",
          annotations: { audience: ["user", "assistant"], priority: 0.9 },
        },
        {
          type: "resource_link",
          uri: fullUri,
          name: metadata.full.name,
          title: `${metadata.kind} full review artifact`,
          mimeType: metadata.full.mimeType,
          size: metadata.full.bytes,
          annotations: { audience: ["user", "assistant"], priority: 0.8 },
        },
      ],
    };
  }

  function parseUri(uri) {
    let parsed;
    try {
      parsed = new URL(String(uri));
    } catch {
      throw new Error("Invalid review resource URI.");
    }
    if (parsed.protocol !== "xsxb:" || parsed.hostname !== "projects") {
      throw new Error("Invalid review resource URI.");
    }
    const parts = parsed.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
    if (parts.length !== 4 || parts[1] !== "reviews") throw new Error("Invalid review resource URI.");
    return {
      projectId: safeSegment(parts[0], "project"),
      artifactId: safeSegment(parts[2], "artifact"),
      asset: safeSegment(parts[3], "asset"),
    };
  }

  function read(uri) {
    const identity = parseUri(uri);
    const project = projectById(identity.projectId);
    const metadata = get(project, identity.artifactId);
    const allowed = new Set([metadata.full.name, metadata.thumbnail.name, "artifact.json"]);
    if (!allowed.has(identity.asset)) throw new Error(`Review resource asset not found: ${identity.asset}`);
    const filePath = path.join(baseFor(project), identity.artifactId, identity.asset);
    if (!fs.existsSync(filePath)) throw new Error(`Review resource not found: ${uri}`);
    return {
      uri: String(uri),
      mimeType: mimeFor(filePath),
      blob: fs.readFileSync(filePath).toString("base64"),
    };
  }

  function contentFor(projectId, artifactId) {
    const project = projectById(projectId);
    const metadata = get(project, artifactId);
    const directory = path.join(baseFor(project), artifactId);
    const thumbnailBuffer = fs.readFileSync(path.join(directory, metadata.thumbnail.name));
    const uri = resourceUri(project.id, artifactId, metadata.full.name);
    return [
      {
        type: "image",
        data: thumbnailBuffer.toString("base64"),
        mimeType: "image/png",
        annotations: { audience: ["user", "assistant"], priority: 0.9 },
      },
      {
        type: "resource_link",
        uri,
        name: metadata.full.name,
        title: `${metadata.kind} full review artifact`,
        mimeType: metadata.full.mimeType,
        size: metadata.full.bytes,
        annotations: { audience: ["user", "assistant"], priority: 0.8 },
      },
    ];
  }

  function list() {
    const resources = [];
    const registry = projectStore.readRegistry();
    for (const project of registry.projects) {
      const base = baseFor(project);
      if (!fs.existsSync(base)) continue;
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^review_[a-f0-9]{24}$/u.test(entry.name)) continue;
        try {
          const metadata = get(project, entry.name, { verifyContent: false });
          resources.push({
            uri: resourceUri(project.id, metadata.artifactId, metadata.full.name),
            name: `${metadata.artifactId}-${metadata.full.name}`,
            title: `${metadata.kind} review`,
            description: `XSXB review artifact for ${project.id}`,
            mimeType: metadata.full.mimeType,
            size: metadata.full.bytes,
            annotations: {
              audience: ["user", "assistant"],
              priority: 0.8,
              lastModified: metadata.createdAt,
            },
          });
        } catch {
          // Ignore incomplete artifacts; the next retention pass removes them.
        }
      }
    }
    return { resources };
  }

  function templates() {
    return {
      resourceTemplates: [
        {
          uriTemplate: "xsxb://projects/{projectId}/reviews/{artifactId}/{asset}",
          name: "xsxb_review_artifact",
          title: "XSXB review artifact",
          description: "Bounded thumbnails, full visual reviews, and review metadata.",
          mimeType: "application/octet-stream",
        },
      ],
    };
  }

  return { contentFor, create, get, list, read, resourceUri, setPinned, stats, templates };
}

module.exports = {
  DEFAULT_MAX_EDGE,
  DEFAULT_MAX_INLINE_BYTES,
  boundedPng,
  createReviewArtifactStore,
  resizeNearest,
};
