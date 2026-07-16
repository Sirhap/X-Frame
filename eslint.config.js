"use strict";

const browserGlobals = {
  ArrayBuffer: "readonly",
  Blob: "readonly",
  CSS: "readonly",
  DOMException: "readonly",
  FileReader: "readonly",
  ImageData: "readonly",
  MessageEvent: "readonly",
  URL: "readonly",
  Uint8Array: "readonly",
  Uint8ClampedArray: "readonly",
  Worker: "readonly",
  document: "readonly",
  globalThis: "readonly",
  importScripts: "readonly",
  module: "readonly",
  performance: "readonly",
  require: "readonly",
  self: "readonly",
  window: "readonly",
};

const nodeGlobals = {
  Buffer: "readonly",
  __dirname: "readonly",
  console: "readonly",
  module: "readonly",
  process: "readonly",
  require: "readonly",
};

module.exports = [
  {
    ignores: ["coverage/**", "node_modules/**", "playwright-report/**", "test-results/**"],
  },
  {
    files: [
      "tools/animation_tuner/public/batch_cutout_*core.js",
      "tools/animation_tuner/public/batch_cutout_worker*.js",
      "tools/animation_tuner/public/cutout_*core.js",
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: browserGlobals,
    },
    rules: {
      "no-constant-condition": "error",
      "no-dupe-keys": "error",
      "no-undef": "error",
      "no-unreachable": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  {
    files: [
      "tools/animation_tuner/server_io_worker.js",
      "tools/framepacker_perf_baseline.js",
      "tools/project_store.js",
      "tools/updater.js",
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: nodeGlobals,
    },
    rules: {
      "no-constant-condition": "error",
      "no-dupe-keys": "error",
      "no-undef": "error",
      "no-unreachable": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
];
