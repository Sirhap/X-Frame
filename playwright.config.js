"use strict";

const crypto = require("node:crypto");
const { defineConfig, devices } = require("@playwright/test");

const E2E_ACTIVATION_CODE = "XSXB-E2E-ONLY";
const E2E_ACTIVATION_HASH = crypto.createHash("sha256").update(E2E_ACTIVATION_CODE).digest("hex");

module.exports = defineConfig({
  testDir: "./tools/tests/e2e",
  timeout: 30000,
  // Keep existing visual-baseline names while the test project moves from generic Chromium to Edge.
  snapshotPathTemplate: "{snapshotDir}/{testFilePath}-snapshots/{arg}-chromium-{platform}{ext}",
  use: {
    baseURL: "http://127.0.0.1:5189",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tools/tests/e2e/start_server.js",
    env: {
      ...process.env,
      PORT: "5189",
      XSXB_ACTIVATION_CODE_HASHES: E2E_ACTIVATION_HASH,
      XSXB_ACTIVATION_SECRET: "xsxb-e2e-secret-never-used-outside-tests",
    },
    reuseExistingServer: false,
    timeout: 10000,
    url: "http://127.0.0.1:5189",
  },
  projects: [
    { name: "edge", use: { browserName: "chromium", channel: "msedge" } },
    {
      name: "edge-touch",
      grep: /@touch/,
      use: { ...devices["Pixel 7"], browserName: "chromium", channel: "msedge" },
    },
  ],
  workers: 1,
});
