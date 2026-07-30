#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { applyAlignmentPlan, createAlignmentPlan, validateAlignment } = require("./attachment_alignment_core");

const ROOT = path.resolve(__dirname, "..");

/**
 * Prints command usage.
 * @returns {void}
 */
function usage() {
  console.log(`Usage:
  node tools/auto_align_attachments.js --project <id> --profile <id> --animation <id> \
    --assets <folder|group|all|group:key|ids:id1,id2> --frames <all|1-8,10> --plan <plan.json> \
    [--strategy strict|resample|active] [--spatial identity|auto] [--direction auto|left|right]

  node tools/auto_align_attachments.js --apply <plan.json> --confirm

  node tools/auto_align_attachments.js --project <id> --profile <id> --animation <id> --validate

Notes:
  --frames is one-based for humans; persisted frame indexes remain zero-based.
  --strategy defaults to strict. Resample and active plans require visual review.
  --spatial auto proposes reviewable transforms from owner/effect Alpha bounds.
  --plan only writes the plan file and never modifies project data.
  --apply requires --confirm and rejects projects changed since planning.
`);
}

/**
 * Parses simple long-form CLI arguments.
 * @param {string[]} argv Argument tokens.
 * @returns {Record<string,string|boolean>} Parsed options.
 */
function parseArgs(argv) {
  const args = {};
  const booleanFlags = new Set(["confirm", "help", "no-sync", "validate"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (booleanFlags.has(key)) {
      args[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

/**
 * Reads and parses a plan JSON file.
 * @param {string} filePath Plan path.
 * @returns {object} Parsed plan.
 */
function readPlan(filePath) {
  const absolutePath = path.resolve(filePath);
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`Cannot read plan ${absolutePath}: ${error.message}`);
  }
}

/**
 * Atomically writes a generated plan.
 * @param {string} filePath Destination path.
 * @param {object} plan Alignment plan.
 * @returns {string} Absolute destination path.
 */
function writePlan(filePath, plan) {
  const absolutePath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, absolutePath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
  return absolutePath;
}

/**
 * Builds a concise review summary from a plan.
 * @param {object} plan Alignment plan.
 * @returns {object} Review summary.
 */
function planSummary(plan) {
  return {
    planId: plan.planId,
    target: `${plan.projectId}/${plan.profileId}/${plan.animationId}`,
    entries: plan.entries.length,
    frames: `${plan.entries[0].displayFrame}-${plan.entries.at(-1).displayFrame}`,
    assets: `${plan.entries[0].asset.name} -> ${plan.entries.at(-1).asset.name}`,
    canvas: plan.canvas,
    mappingStrategy: plan.mappingStrategy || "strict",
    selectedSourceFrames: plan.sequenceAnalysis?.selectedSourceFrames || [],
    mappingConfidence: Number(plan.sequenceAnalysis?.confidence ?? 1),
    spatialMode: plan.spatialMode || "identity",
    requiresVisualReview: plan.requiresVisualReview,
    existingAttachmentsPreserved: true,
  };
}

/**
 * Executes one CLI operation and returns its structured result.
 * @param {string[]} argv CLI tokens.
 * @param {string} [root=ROOT] Tuner root.
 * @returns {object} Operation result.
 */
function run(argv, root = ROOT) {
  const args = parseArgs(argv);
  if (args.help) return { operation: "help" };
  if (args.apply) {
    const plan = readPlan(String(args.apply));
    return {
      operation: "apply",
      planPath: path.resolve(String(args.apply)),
      ...applyAlignmentPlan({
        root,
        plan,
        confirmed: Boolean(args.confirm),
        syncGodot: !args["no-sync"],
      }),
    };
  }
  if (args.validate) {
    if (!args.profile || !args.animation) {
      throw new Error("Validation requires --profile and --animation.");
    }
    return {
      operation: "validate",
      ...validateAlignment({
        root,
        projectId: args.project ? String(args.project) : "",
        profileId: String(args.profile),
        animationId: String(args.animation),
      }),
    };
  }
  if (!args.plan || !args.profile || !args.animation) {
    throw new Error("Planning requires --plan, --profile, and --animation.");
  }
  const plan = createAlignmentPlan({
    root,
    projectId: args.project ? String(args.project) : "",
    profileId: String(args.profile),
    animationId: String(args.animation),
    assets: args.assets ? String(args.assets) : "group",
    frames: args.frames ? String(args.frames) : "all",
    strategy: args.strategy ? String(args.strategy) : "strict",
    spatial: args.spatial ? String(args.spatial) : "identity",
    direction: args.direction ? String(args.direction) : "auto",
  });
  const planPath = writePlan(String(args.plan), plan);
  return { operation: "plan", planPath, plan, summary: planSummary(plan) };
}

/**
 * Runs the executable boundary with user-facing error handling.
 * @returns {void}
 */
function main() {
  try {
    const result = run(process.argv.slice(2));
    if (result.operation === "help") {
      usage();
      return;
    }
    console.log(
      JSON.stringify(result.operation === "plan" ? { ...result, plan: undefined } : result, null, 2),
    );
    if (result.operation === "validate" && !result.ok) process.exitCode = 2;
  } catch (error) {
    console.error(`Attachment automation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { parseArgs, planSummary, readPlan, run, writePlan };
