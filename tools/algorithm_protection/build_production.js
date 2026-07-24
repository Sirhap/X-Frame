"use strict";

const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");
const {
  DIST_ROOT,
  PROJECT_ROOT,
  PROTECTED_CORE_WASM_PATH,
  PUBLIC_ROOT,
  SENSITIVE_PUBLIC_SCRIPTS,
} = require("./config");
const { hashedFilename, resolvePublicAsset, sha256, writeArtifact } = require("./artifact_utils");
const {
  combineScripts,
  combineWorker,
  createSymbolAliases,
  extractAssetUrls,
} = require("./source_transform");
const { recordProtectedRelease } = require("./release_store");
const {
  createProductionAlgorithmWorkerSource,
  createProductionUiSource,
} = require("./production_ui_transform");
const { redactWasmSourcePaths } = require("./wasm_transform");

const STYLESHEET_EXPRESSION = /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/g;
const SCRIPT_EXPRESSION = /<script\s+src="([^"]+)"\s*><\/script>/g;
const BUILD_FORMAT_VERSION = 2;
const TEMPORARY_ROOT = path.join(PROJECT_ROOT, `.dist-build-${process.pid}`);
const BACKUP_ROOT = path.join(PROJECT_ROOT, `.dist-backup-${process.pid}`);

/**
 * Applies deterministic production minification without generating source maps.
 * @param {string} source JavaScript or CSS source.
 * @param {"js"|"css"} loader Source language.
 * @returns {Promise<string>} Minified source.
 */
async function minify(source, loader) {
  const result = await esbuild.transform(source, {
    charset: "utf8",
    legalComments: "none",
    loader,
    minify: true,
    sourcemap: false,
    target: loader === "css" ? undefined : "es2020",
  });
  return result.code;
}

/**
 * Creates a non-secret, reproducible build identifier and private layout seed.
 * @param {string} sourceFingerprint Hash of every production source input.
 * @returns {{buildId:string,seed:string}} Build identifiers.
 */
function createBuildIdentity(sourceFingerprint) {
  const requestedSeed = String(process.env.XSXB_PROTECTION_BUILD_SEED || "").trim();
  const version = require("../../package.json").version;
  const seed = sha256(`${version}:${requestedSeed || "default"}:${sourceFingerprint}`);
  return { buildId: sha256(`xsxb-build:${sourceFingerprint}:${seed}`).slice(0, 20), seed };
}

/**
 * Prepares a process-scoped output directory while preserving the current release.
 * @returns {void}
 */
function prepareOutput() {
  for (const outputRoot of [DIST_ROOT, TEMPORARY_ROOT, BACKUP_ROOT]) {
    if (
      path.dirname(outputRoot) !== PROJECT_ROOT ||
      !/^\.?(?:dist)(?:-(?:build|backup)-\d+)?$/.test(path.basename(outputRoot))
    ) {
      throw new Error(`Refusing to manage unexpected output directory: ${outputRoot}`);
    }
  }
  fs.rmSync(TEMPORARY_ROOT, { force: true, recursive: true });
  fs.rmSync(BACKUP_ROOT, { force: true, recursive: true });
  fs.mkdirSync(path.join(TEMPORARY_ROOT, "assets"), { recursive: true });
}

/**
 * Atomically promotes the verified temporary tree and restores the prior tree on failure.
 * @returns {void}
 */
function commitOutput() {
  const hadPreviousOutput = fs.existsSync(DIST_ROOT);
  if (hadPreviousOutput) fs.renameSync(DIST_ROOT, BACKUP_ROOT);
  try {
    fs.renameSync(TEMPORARY_ROOT, DIST_ROOT);
    fs.rmSync(BACKUP_ROOT, { force: true, recursive: true });
  } catch (error) {
    if (hadPreviousOutput && fs.existsSync(BACKUP_ROOT) && !fs.existsSync(DIST_ROOT)) {
      fs.renameSync(BACKUP_ROOT, DIST_ROOT);
    }
    throw error;
  }
}

/**
 * Produces a minimal SPDX inventory from the locked direct toolchain dependencies.
 * @returns {object} SPDX 2.3 document.
 */
function createSbom() {
  const packageJson = require("../../package.json");
  const packageLock = require("../../package-lock.json");
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  return {
    SPDXID: "SPDXRef-DOCUMENT",
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    name: `${packageJson.name}-${packageJson.version}-build-toolchain`,
    documentNamespace: `https://xsxb.local/spdx/${packageJson.version}/${sha256(JSON.stringify(dependencies))}`,
    creationInfo: { creators: ["Tool: xsxb-protected-build"], created: new Date(0).toISOString() },
    packages: Object.entries(dependencies)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name], index) => {
        const locked = packageLock.packages?.[`node_modules/${name}`];
        if (!locked?.version) throw new Error(`Direct dependency is not locked: ${name}`);
        return {
          SPDXID: `SPDXRef-Package-${index + 1}`,
          name,
          versionInfo: String(locked.version),
          downloadLocation: String(locked.resolved || "NOASSERTION"),
          licenseConcluded: String(locked.license || "NOASSERTION"),
          licenseDeclared: String(locked.license || "NOASSERTION"),
          filesAnalyzed: false,
        };
      }),
  };
}

/**
 * Creates one manifest record for a generated artifact.
 * @param {string} role Stable runtime role.
 * @param {string} filename Filename below assets.
 * @param {string|Buffer} content Artifact bytes.
 * @param {string} mediaType HTTP media type.
 * @returns {object} Manifest asset record.
 */
function manifestAsset(role, filename, content, mediaType) {
  return {
    role,
    path: `assets/${filename}`,
    bytes: Buffer.byteLength(content),
    sha256: sha256(content),
    mediaType,
  };
}

/**
 * Builds the isolated production artifact set from an explicit HTML-derived whitelist.
 * @returns {Promise<void>}
 */
async function buildProduction() {
  if (!fs.existsSync(PROTECTED_CORE_WASM_PATH)) {
    throw new Error("Protected WASM core is missing. Run npm run build:protected-core first.");
  }
  const sourceHtml = fs.readFileSync(path.join(PUBLIC_ROOT, "index.html"), "utf8");
  const favicon = fs.readFileSync(path.join(PUBLIC_ROOT, "favicon.ico"));
  const scriptUrls = extractAssetUrls(sourceHtml, SCRIPT_EXPRESSION);
  const productionScriptUrls = scriptUrls.filter((url) => !SENSITIVE_PUBLIC_SCRIPTS.includes(url));
  const stylesheetUrls = extractAssetUrls(sourceHtml, STYLESHEET_EXPRESSION);
  if (scriptUrls.length === 0 || stylesheetUrls.length === 0) {
    throw new Error("Production entry must declare scripts and stylesheets.");
  }

  const rawUiSource = createProductionUiSource(combineScripts(PUBLIC_ROOT, productionScriptUrls, new Map()));
  const rawCutoutWorker = combineWorker(PUBLIC_ROOT, "batch_cutout_worker.js", new Map());
  const rawFrameWorker = combineWorker(PUBLIC_ROOT, "frame_organizer_worker.js", new Map());
  const protectedCore = redactWasmSourcePaths(fs.readFileSync(PROTECTED_CORE_WASM_PATH));
  const cssSource = stylesheetUrls
    .map((url) => fs.readFileSync(resolvePublicAsset(PUBLIC_ROOT, url), "utf8"))
    .join("\n");
  const sourceFingerprint = sha256(
    [
      `protected-build-format:${BUILD_FORMAT_VERSION}`,
      fs.readFileSync(__filename, "utf8"),
      fs.readFileSync(path.join(__dirname, "source_transform.js"), "utf8"),
      fs.readFileSync(path.join(__dirname, "production_ui_transform.js"), "utf8"),
      fs.readFileSync(path.join(__dirname, "wasm_transform.js"), "utf8"),
      sourceHtml,
      rawUiSource,
      rawCutoutWorker,
      rawFrameWorker,
      cssSource,
      sha256(favicon),
      sha256(protectedCore),
    ].join("\n\0\n"),
  );
  const { buildId, seed } = createBuildIdentity(sourceFingerprint);
  const aliases = createSymbolAliases(seed);
  prepareOutput();

  const protectedCoreName = hashedFilename("algorithm-core", "wasm", protectedCore);
  const protectedCoreSha256 = sha256(protectedCore);
  const protectedCoreConfiguration = {
    version: buildId,
    mode: "static",
    loader: {
      defaultMode: "static",
      modes: {
        static: {
          controlledDistribution: false,
          artifacts: {
            [buildId]: {
              url: `/assets/${protectedCoreName}`,
              sha256: protectedCoreSha256,
              maxBytes: protectedCore.length,
            },
          },
        },
      },
    },
  };
  const protectedWorkerSource = createProductionAlgorithmWorkerSource(
    combineWorker(PUBLIC_ROOT, "batch_cutout_worker.js", aliases),
  );
  const cutoutWorkerSource = `self.__XSXB_PROTECTED_CORE_CONFIG__={...${JSON.stringify(
    protectedCoreConfiguration,
  )},loader:{...${JSON.stringify(
    protectedCoreConfiguration.loader,
  )},origin:self.location.origin}};\n${protectedWorkerSource}`;
  const cutoutWorker = await minify(cutoutWorkerSource, "js");
  const frameWorker = await minify(combineWorker(PUBLIC_ROOT, "frame_organizer_worker.js", aliases), "js");
  const cutoutWorkerName = hashedFilename("algorithm-worker", "js", cutoutWorker);
  const frameWorkerName = hashedFilename("analysis-worker", "js", frameWorker);

  let uiSource = createProductionUiSource(combineScripts(PUBLIC_ROOT, productionScriptUrls, aliases));
  uiSource = uiSource
    .replaceAll("batch_cutout_worker.js", `/assets/${cutoutWorkerName}`)
    .replaceAll("frame_organizer_worker.js", `/assets/${frameWorkerName}`);
  uiSource = `globalThis.__XSXB_PRODUCTION__=true;globalThis.__XSXB_BUILD_ID__=${JSON.stringify(buildId)};\n${uiSource}`;
  const ui = await minify(uiSource, "js");
  const uiName = hashedFilename("ui", "js", ui);

  const styles = await minify(cssSource, "css");
  const stylesName = hashedFilename("styles", "css", styles);
  const faviconName = hashedFilename("favicon", "ico", favicon);

  writeArtifact(TEMPORARY_ROOT, `assets/${uiName}`, ui);
  writeArtifact(TEMPORARY_ROOT, `assets/${cutoutWorkerName}`, cutoutWorker);
  writeArtifact(TEMPORARY_ROOT, `assets/${frameWorkerName}`, frameWorker);
  writeArtifact(TEMPORARY_ROOT, `assets/${protectedCoreName}`, protectedCore);
  writeArtifact(TEMPORARY_ROOT, `assets/${stylesName}`, styles);
  writeArtifact(TEMPORARY_ROOT, `assets/${faviconName}`, favicon);

  const productionHtml = sourceHtml
    .replace(STYLESHEET_EXPRESSION, "")
    .replace(SCRIPT_EXPRESSION, "")
    .replace('href="/favicon.ico"', `href="/assets/${faviconName}"`)
    .replace("</head>", `    <link rel="stylesheet" href="/assets/${stylesName}" />\n  </head>`)
    .replace("</body>", `    <script src="/assets/${uiName}"></script>\n  </body>`);
  writeArtifact(TEMPORARY_ROOT, "index.html", productionHtml);

  const assets = [
    manifestAsset("ui", uiName, ui, "application/javascript"),
    manifestAsset("product-algorithm", cutoutWorkerName, cutoutWorker, "application/javascript"),
    manifestAsset("frame-analysis", frameWorkerName, frameWorker, "application/javascript"),
    manifestAsset("protected-core", protectedCoreName, protectedCore, "application/wasm"),
    manifestAsset("styles", stylesName, styles, "text/css"),
    manifestAsset("favicon", faviconName, favicon, "image/x-icon"),
  ];
  const manifest = {
    schemaVersion: 1,
    runtimeProtocolVersion: 1,
    buildId,
    sourceFingerprint,
    protectionLevel: "worker-wasm",
    algorithmFormat: "wasm",
    sourceMaps: false,
    assets,
  };
  writeArtifact(TEMPORARY_ROOT, "asset-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  writeArtifact(TEMPORARY_ROOT, "sbom.spdx.json", `${JSON.stringify(createSbom(), null, 2)}\n`);
  recordProtectedRelease(TEMPORARY_ROOT, {
    seed,
    sourceFingerprint,
    customerId: process.env.XSXB_PROTECTION_CUSTOMER_ID,
    compilerVersion: `esbuild-${esbuild.version}`,
  });
  commitOutput();
  process.stdout.write(`Built ${assets.length} hashed assets for ${buildId}.\n`);
}

buildProduction().catch((error) => {
  fs.rmSync(TEMPORARY_ROOT, { force: true, recursive: true });
  process.stderr.write(`Protected production build failed: ${error?.stack || error}\n`);
  process.exitCode = 1;
});
