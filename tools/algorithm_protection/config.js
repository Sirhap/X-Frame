"use strict";

const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const PUBLIC_ROOT = path.join(PROJECT_ROOT, "tools/animation_tuner/public");
const DIST_ROOT = path.join(PROJECT_ROOT, "dist");
const PROTECTED_CORE_WASM_PATH = path.resolve(
  process.env.PROTECTED_CORE_WASM_PATH ||
    path.join(
      PROJECT_ROOT,
      "crates/protected_algorithm_core/target/wasm32-unknown-unknown/release/protected_algorithm_core.wasm",
    ),
);

const SENSITIVE_PUBLIC_SCRIPTS = Object.freeze([
  "/batch_cutout_color_core.js",
  "/batch_cutout_connectivity_core.js",
  "/batch_cutout_core.js",
  "/batch_cutout_product_core.js",
  "/batch_cutout_protection_core.js",
  "/batch_cutout_reference_recovery_core.js",
  "/batch_cutout_reference_replace_core.js",
  "/batch_cutout_reference_input.js",
  "/cutout_local_tracking_core.js",
  "/cutout_quality_core.js",
  "/cutout_tracking_core.js",
  "/cutout_tracking_geometry_core.js",
  "/frame_organizer_core.js",
]);

const SENSITIVE_GLOBALS = Object.freeze([
  "BatchCutoutColorCore",
  "BatchCutoutConnectivityCore",
  "BatchCutoutCore",
  "BatchCutoutProductCore",
  "BatchCutoutProtectionCore",
  "BatchCutoutReferenceRecoveryCore",
  "BatchCutoutReferenceReplaceCore",
  "CutoutQualityCore",
  "CutoutTrackingCore",
  "CutoutTrackingGeometryCore",
  "FrameOrganizerCore",
  "ProtectedWasmKernelBridge",
]);

const FORBIDDEN_PATH_PATTERNS = Object.freeze([
  /(^|\/)docs?(\/|$)/i,
  /(^|\/)tests?(\/|$)/i,
  /(^|\/)(fixtures?|golden-corpus)(\/|$)/i,
  /\.map$/i,
  /_core\.js$/i,
  /\.(?:rs|ts|tsx|jsx|wat|dwarf)$/i,
]);

const FORBIDDEN_CONTENT_PATTERNS = Object.freeze([
  { label: "private kernel identifier", pattern: /fp_kernel_/i },
  { label: "private algorithm document", pattern: /浏览器端核心算法保护|Golden Corpus/i },
  ...SENSITIVE_GLOBALS.map((name) => ({
    label: `sensitive module symbol ${name}`,
    pattern: new RegExp(name, "i"),
  })),
]);

module.exports = Object.freeze({
  DIST_ROOT,
  FORBIDDEN_CONTENT_PATTERNS,
  FORBIDDEN_PATH_PATTERNS,
  PROJECT_ROOT,
  PROTECTED_CORE_WASM_PATH,
  PUBLIC_ROOT,
  SENSITIVE_GLOBALS,
  SENSITIVE_PUBLIC_SCRIPTS,
});
