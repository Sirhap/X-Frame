import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const workerSources = [
  new URL("../authorization/src/index.mjs", import.meta.url),
  new URL("../artifact/src/index.mjs", import.meta.url),
];

/**
 * Parses the limited JSONC syntax used by checked-in Wrangler configurations.
 * @param {string} source JSONC source without comments.
 * @returns {Record<string, unknown>} Parsed configuration.
 */
function parseConfig(source) {
  return JSON.parse(source.replace(/,\s*([}\]])/gu, "$1"));
}

test("gate Workers contain no application logging calls", async () => {
  for (const sourceUrl of workerSources) {
    const source = await readFile(sourceUrl, "utf8");
    assert.doesNotMatch(source, /console\s*\./u);
  }
});

test("gate request contracts contain no user media fields", async () => {
  const source = await readFile(workerSources[0], "utf8");
  assert.doesNotMatch(source, /["'](?:image|mask|pixels|pixelSummary|fileName)["']/u);
});

test("deployment modes default to static hosting and configs contain secret names only", async () => {
  const modes = JSON.parse(
    await readFile(new URL("../deployment-modes.example.json", import.meta.url), "utf8"),
  );
  assert.equal(modes.defaultMode, "static");
  assert.equal(modes.modes.static.controlledDistribution, false);
  assert.equal(modes.modes.controlled.controlledDistribution, true);

  for (const configName of ["wrangler.authorization.jsonc", "wrangler.artifact.jsonc"]) {
    const config = parseConfig(await readFile(new URL(`../${configName}`, import.meta.url), "utf8"));
    assert.equal(config.compatibility_date, "2026-07-21");
    assert.ok(config.compatibility_flags.includes("nodejs_compat"));
    assert.equal(config.observability.enabled, true);
    assert.equal(config.observability.logs.invocation_logs, false);
    assert.equal(config.observability.traces.enabled, false);
    assert.equal(Object.hasOwn(config.vars, "TURNSTILE_SECRET"), false);
    assert.equal(Object.hasOwn(config.vars, "SESSION_SIGNING_KEY"), false);
  }
});
