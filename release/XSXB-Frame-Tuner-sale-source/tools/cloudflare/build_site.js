"use strict";

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "../..");
const protectedDist = path.join(projectRoot, "dist");
const publicRoot = path.join(projectRoot, "tools/animation_tuner/public");
const landingAssetsSource = path.join(publicRoot, "assets/landing");
const staticHeadersSource = path.join(projectRoot, "cloudflare/site/_headers");
const siteDist = path.join(projectRoot, "cloudflare/site/dist");

/**
 * Asserts that a generated path is confined to the Cloudflare site directory.
 * @param {string} targetPath Candidate generated path.
 * @returns {void}
 */
function assertGeneratedPath(targetPath) {
  const expectedParent = path.join(projectRoot, "cloudflare/site");
  if (path.dirname(targetPath) !== expectedParent || path.basename(targetPath) !== "dist") {
    throw new Error(`Refusing to manage unexpected Cloudflare output: ${targetPath}`);
  }
}

/**
 * Composes the audited workbench and public landing page into one deployment directory.
 * @returns {void}
 */
function buildSite() {
  const workbenchEntry = path.join(protectedDist, "index.html");
  if (!fs.existsSync(workbenchEntry)) {
    throw new Error("Protected production output is missing. Run npm run build:production first.");
  }
  assertGeneratedPath(siteDist);
  fs.rmSync(siteDist, { force: true, recursive: true });
  fs.mkdirSync(siteDist, { recursive: true });
  fs.cpSync(protectedDist, siteDist, { recursive: true });
  fs.renameSync(path.join(siteDist, "index.html"), path.join(siteDist, "workbench.html"));
  fs.copyFileSync(path.join(publicRoot, "landing.html"), path.join(siteDist, "index.html"));
  fs.copyFileSync(path.join(publicRoot, "admin.html"), path.join(siteDist, "admin.html"));
  fs.copyFileSync(path.join(publicRoot, "landing.css"), path.join(siteDist, "landing.css"));
  fs.copyFileSync(path.join(publicRoot, "landing-admin.css"), path.join(siteDist, "landing-admin.css"));
  fs.copyFileSync(path.join(publicRoot, "landing-admin.js"), path.join(siteDist, "landing-admin.js"));
  fs.cpSync(landingAssetsSource, path.join(siteDist, "assets/landing"), { recursive: true });
  fs.copyFileSync(staticHeadersSource, path.join(siteDist, "_headers"));
  process.stdout.write(`Built Cloudflare site at ${path.relative(projectRoot, siteDist)}.\n`);
}

try {
  buildSite();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
