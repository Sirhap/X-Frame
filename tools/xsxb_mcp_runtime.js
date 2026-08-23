"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { tunerRootHash } = require("./xsxb_mcp_processes");

function gitCommit(root) {
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "installed";
  }
}

const contentHashCache = new Map();

function runtimeFiles(root) {
  const files = [];
  const visit = (candidate, relative) => {
    if (!fs.existsSync(candidate)) return;
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink() || stat.isFile()) {
      files.push({ path: candidate, relative, symbolicLink: stat.isSymbolicLink() });
      return;
    }
    if (!stat.isDirectory()) return;
    for (const name of fs.readdirSync(candidate).sort()) {
      if (relative === "tools" && name === "tests") continue;
      visit(path.join(candidate, name), path.posix.join(relative, name));
    }
  };
  for (const relative of [
    "package.json",
    "package-lock.json",
    "tools",
    "node_modules/playwright",
    "node_modules/playwright-core",
  ]) {
    visit(path.join(root, relative), relative);
  }
  return files.sort((left, right) => left.relative.localeCompare(right.relative));
}

/**
 * Hashes every byte copied into an immutable MCP runtime build.
 * @param {string} root Source root.
 * @returns {string} SHA-256 runtime content identity.
 */
function runtimeContentHash(root) {
  const digest = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  for (const file of runtimeFiles(path.resolve(root))) {
    digest.update(file.relative);
    digest.update("\0");
    if (file.symbolicLink) {
      digest.update(`symlink:${fs.readlinkSync(file.path)}`);
      continue;
    }
    const descriptor = fs.openSync(file.path, "r");
    try {
      let bytesRead;
      do {
        bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
        if (bytesRead > 0) digest.update(buffer.subarray(0, bytesRead));
      } while (bytesRead > 0);
    } finally {
      fs.closeSync(descriptor);
    }
  }
  return digest.digest("hex");
}

function createRuntimeInfo(root, tools, options = {}) {
  const installedManifest = path.join(root, "xsxb-mcp-build.json");
  if (fs.existsSync(installedManifest)) {
    try {
      return JSON.parse(fs.readFileSync(installedManifest, "utf8"));
    } catch {
      // Fall through to a live source-tree identity when the manifest is incomplete.
    }
  }
  const packagePath = path.join(root, "package.json");
  const packageJson = fs.existsSync(packagePath) ? JSON.parse(fs.readFileSync(packagePath, "utf8")) : {};
  const version = String(packageJson.version || "0.0.0");
  const commit = gitCommit(root);
  const schemaRevision = crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        (tools || []).map((tool) => ({
          name: tool.name,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
        })),
      ),
    )
    .digest("hex")
    .slice(0, 16);
  const resolvedRoot = path.resolve(root);
  let contentHash = options.contentHash;
  if (!contentHash && options.refreshContent !== true) contentHash = contentHashCache.get(resolvedRoot);
  if (!contentHash) {
    contentHash = runtimeContentHash(resolvedRoot);
    contentHashCache.set(resolvedRoot, contentHash);
  }
  return {
    name: "xsxb-frame-tuner",
    title: "XSXB Frame Tuner",
    version,
    description: "Local multimodal animation-production MCP for XSXB Frame Tuner.",
    _meta: {
      "xsxb/buildId": `${version}+${commit}.${schemaRevision}.${contentHash.slice(0, 16)}`,
      "xsxb/commit": commit,
      "xsxb/toolSchemaRevision": schemaRevision,
      "xsxb/runtimeContentHash": contentHash,
      "xsxb/projectDataVersion": 1,
      "xsxb/rootIdentity": tunerRootHash(root),
    },
  };
}

module.exports = { createRuntimeInfo, gitCommit, runtimeContentHash };
