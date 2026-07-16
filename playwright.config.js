"use strict";

const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tools/tests/e2e",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:5189",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tools/animation_tuner/server.js",
    env: { ...process.env, PORT: "5189" },
    reuseExistingServer: false,
    timeout: 10000,
    url: "http://127.0.0.1:5189",
  },
  workers: 1,
});
