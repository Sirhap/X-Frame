"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("mobile shell removes desktop rail padding when the rail becomes a top bar", () => {
  const css = fs.readFileSync(path.join(__dirname, "../animation_tuner/public/app_shell.css"), "utf8");
  assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*?\.app,[\s\S]*?padding-left:\s*0;/u);
});

test("disabled workbench controls keep readable text and announce their disabled state", () => {
  const css = fs.readFileSync(path.join(__dirname, "../animation_tuner/public/controls_inputs.css"), "utf8");
  assert.match(css, /button:disabled\s*\{[\s\S]*?color:\s*var\(--muted\)/u);
  assert.match(css, /button:disabled\s*\{[\s\S]*?cursor:\s*not-allowed/u);
});

test("embedded export footer does not stick over the parameter list", () => {
  const css = fs.readFileSync(path.join(__dirname, "../animation_tuner/public/media_export_dialog.css"), "utf8");
  const embeddedFooter = css.match(
    /\.mediaExportDialog\[data-presentation="embedded"\] \.mediaExportFooter\s*\{[\s\S]*?\}/u,
  );
  assert.ok(embeddedFooter, "embedded export footer rule");
  assert.match(embeddedFooter[0], /position:\s*static/);
  assert.doesNotMatch(embeddedFooter[0], /position:\s*sticky/);
});

test("narrow chrome keeps the desktop banner below the tool rail", () => {
  const css = fs.readFileSync(path.join(__dirname, "../animation_tuner/public/app_shell.css"), "utf8");
  const banner = css.match(/@media \(max-width: 759px\) \{[\s\S]*?\.desktopRecommendedBanner \{[\s\S]*?\}/u);
  assert.ok(banner, "narrow banner rule");
  assert.match(banner[0], /top:\s*64px/);
  assert.match(css, /@media \(max-width: 1120px\) \{[\s\S]*?\.sidebar \{[\s\S]*?position:\s*fixed/u);
  assert.match(css, /\.organizerDownstreamMenu > div \{[\s\S]*?left:\s*0/u);
});

test("narrow flow header reserves less than a quarter of a 720px screen with the rail", () => {
  const css = fs.readFileSync(path.join(__dirname, "../animation_tuner/public/app_shell.css"), "utf8");
  const compact = css.match(
    /@media \(max-width: 1180px\) \{[\s\S]*?--shell-flow-height:\s*(\d+)px;/u,
  );
  assert.ok(compact, "compact flow height");
  const flowHeight = Number(compact[1]);
  assert.ok(flowHeight <= 112, `flow header ${flowHeight}px should stay compact`);
});
