"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const QUALITY_GATE_ENTRY_SCRIPTS = new Set(["check", "check:quick"]);

const QUALITY_GATE_PROFILES = Object.freeze({
  quick: Object.freeze([
    "check:quality-gate",
    "check:server-save",
    "check:syntax",
    "lint",
    "format:check",
    "format:mutations",
    "typecheck",
  ]),
  full: Object.freeze([
    "check:quality-gate",
    "check:server-save",
    "check:syntax",
    "check:clipboard-media",
    "check:watermark",
    "check:scatter-slice",
    "check:app-shell",
    "check:mutations",
    "check:server-persistence",
    "check:server-media",
    "check:asset-pipeline",
    "check:server-io",
    "check:tracking-geometry",
    "check:batch-color",
    "check:batch-connectivity",
    "check:batch-image",
    "check:batch-text",
    "check:batch-preview-renderer",
    "check:batch-events-preview",
    "check:batch-navigation",
    "check:batch-processing-helpers",
    "check:batch-settings",
    "check:batch-reference-input",
    "check:godot-templates",
    "check:app-lifecycle",
    "check:app-save",
    "check:app-transform-runtime",
    "check:app-box-adjustment",
    "check:app-adjustment-inputs",
    "check:app-frame-edit-state",
    "check:app-attachment-manipulation",
    "check:app-playback-inputs",
    "check:app-tool-actions",
    "check:app-project-state",
    "check:app-events",
    "check:frame-organizer-text",
    "check:frame-organizer-ui",
    "check:frame-organizer-actions",
    "check:production-build",
    "check:algorithm-gate",
    "lint",
    "format:check",
    "format:mutations",
    "typecheck",
  ]),
});

/**
 * Validates profile integrity before any child process runs.
 * @param {Record<string, readonly string[]>} profiles Named quality gate profiles.
 * @param {Record<string, string>} packageScripts Available npm scripts.
 * @returns {void}
 */
function validateQualityGateProfiles(profiles, packageScripts) {
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) {
    throw new TypeError("Quality gate profiles must be an object.");
  }
  if (!packageScripts || typeof packageScripts !== "object" || Array.isArray(packageScripts)) {
    throw new TypeError("Package scripts must be an object.");
  }

  for (const [profileName, scriptNames] of Object.entries(profiles)) {
    if (!Array.isArray(scriptNames) || scriptNames.length === 0) {
      throw new Error(`Quality gate profile "${profileName}" must contain at least one script.`);
    }
    const seenScriptNames = new Set();
    for (const scriptName of scriptNames) {
      if (seenScriptNames.has(scriptName)) {
        throw new Error(`Quality gate profile "${profileName}" contains duplicate script "${scriptName}".`);
      }
      if (QUALITY_GATE_ENTRY_SCRIPTS.has(scriptName)) {
        throw new Error(`Quality gate profile "${profileName}" contains recursive script "${scriptName}".`);
      }
      if (!Object.hasOwn(packageScripts, scriptName)) {
        throw new Error(`Quality gate profile "${profileName}" references unknown script "${scriptName}".`);
      }
      seenScriptNames.add(scriptName);
    }
  }
}

/**
 * Runs one npm script and preserves its exit status for the quality gate caller.
 * @param {string} scriptName Existing npm script name.
 * @param {{cwd?:string,env?:NodeJS.ProcessEnv}} [options] Child process options.
 * @returns {void}
 */
function runNpmScript(scriptName, options = {}) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCommand, ["run", scriptName], {
    cwd: options.cwd || PROJECT_ROOT,
    env: options.env || process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    throw new Error(`Unable to start npm script "${scriptName}": ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    const failure = new Error(
      result.signal
        ? `npm script "${scriptName}" terminated with signal ${result.signal}.`
        : `npm script "${scriptName}" failed with exit code ${result.status}.`,
    );
    failure.exitCode = Number.isInteger(result.status) ? result.status : 1;
    throw failure;
  }
}

/**
 * Executes one quality gate profile sequentially and stops at the first failure.
 * @param {string} profileName Profile to execute.
 * @param {{profiles?:Record<string,readonly string[]>,runScript?:(scriptName:string)=>void,logger?:Pick<Console,"log">}} [options] Testable execution adapters.
 * @returns {void}
 */
function runQualityGate(profileName, options = {}) {
  const profiles = options.profiles || QUALITY_GATE_PROFILES;
  const scriptNames = profiles[profileName];
  if (!Array.isArray(scriptNames)) {
    throw new Error(`Unknown quality gate profile "${profileName}".`);
  }
  const runScript = options.runScript || runNpmScript;
  const logger = options.logger || console;
  scriptNames.forEach((scriptName, index) => {
    logger.log(`[quality-gate] ${index + 1}/${scriptNames.length} ${scriptName}`);
    runScript(scriptName);
  });
}

/**
 * Runs the command-line quality gate entry point.
 * @param {string[]} args Command-line arguments after the executable and script path.
 * @returns {void}
 */
function main(args) {
  if (args.length > 1) throw new Error("Usage: node tools/quality_gate.js [quick|full]");
  const profileName = args[0] || "full";
  const packageScripts = require("../package.json").scripts;
  validateQualityGateProfiles(QUALITY_GATE_PROFILES, packageScripts);
  runQualityGate(profileName);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`[quality-gate] ${error.message}`);
    process.exitCode = Number.isInteger(error.exitCode) ? error.exitCode : 1;
  }
}

module.exports = {
  QUALITY_GATE_PROFILES,
  main,
  runNpmScript,
  runQualityGate,
  validateQualityGateProfiles,
};
