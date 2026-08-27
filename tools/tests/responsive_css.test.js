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
  const css = fs.readFileSync(
    path.join(__dirname, "../animation_tuner/public/media_export_dialog.css"),
    "utf8",
  );
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
  const compact = css.match(/@media \(max-width: 1180px\) \{[\s\S]*?--shell-flow-height:\s*(\d+)px;/u);
  assert.ok(compact, "compact flow height");
  const flowHeight = Number(compact[1]);
  assert.ok(flowHeight <= 112, `flow header ${flowHeight}px should stay compact`);
});

test("adjustment scope cards wrap instead of ellipsizing the title", () => {
  const css = fs.readFileSync(path.join(__dirname, "../animation_tuner/public/controls_inputs.css"), "utf8");
  const title = css.match(/\.adjustModeCopy strong\s*\{[\s\S]*?\}/u);
  assert.ok(title, "adjustment title rule");
  assert.match(title[0], /white-space:\s*normal/);
  assert.doesNotMatch(title[0], /text-overflow:\s*ellipsis/);
});

test("short desktop workspace does not clamp the timeline into a fixed bottom dock", () => {
  const css = fs.readFileSync(path.join(__dirname, "../animation_tuner/public/responsive.css"), "utf8");
  const block = css.match(
    /@media \(min-width: 1121px\) and \(max-height: 760px\) \{[\s\S]*?\.workspace \{[\s\S]*?\}/,
  );
  assert.ok(block, "short-desktop workspace rule");
  assert.match(block[0], /grid-template-rows:\s*auto minmax\([^)]+\) auto auto/);
  assert.doesNotMatch(block[0], /clamp\(150px/);
});

test("workspace filmstrip stays at least 140px so laptop heights still show thumbs", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../animation_tuner/public/controls_workspace.css"),
    "utf8",
  );
  const workspace = css.match(/\.workspace\s*\{[\s\S]*?\}/u);
  assert.ok(workspace, "workspace grid");
  assert.match(workspace[0], /minmax\(140px,\s*min\(26vh,\s*264px\)\)/);
});

test("browser-only mode hides the sidebar save, not the context-bar save", () => {
  const css = fs.readFileSync(path.join(__dirname, "../animation_tuner/public/controls_panels.css"), "utf8");
  assert.match(css, /\.browserOnlyMode \.sidebar #save/);
  assert.match(css, /\.browserOnlyMode \.sidebar #saveState/);
  assert.doesNotMatch(css, /\.browserOnlyMode #save,/);
});

test("phone workspace stacks the sidebar under the canvas so filmstrip actions stay hittable", () => {
  const css = fs.readFileSync(path.join(__dirname, "../animation_tuner/public/app_shell.css"), "utf8");
  assert.match(
    css,
    /@media \(max-width: 1120px\) \{[\s\S]*?\.sidebar \{[\s\S]*?position:\s*fixed[\s\S]*@media \(max-width: 759px\) \{[\s\S]*?\.app \.sidebar \{[\s\S]*?position:\s*relative/u,
  );
});

test("phone cutout overlays zoom controls on the preview instead of reserving an empty row", () => {
  const css = fs.readFileSync(path.join(__dirname, "../animation_tuner/public/responsive.css"), "utf8");
  const phoneRules = css.match(/@media \(max-width: 700px\) \{[\s\S]*$/u);
  assert.ok(phoneRules, "phone cutout rules");
  assert.match(phoneRules[0], /\.cutoutCompare \{[\s\S]*?position:\s*relative/u);
  assert.match(phoneRules[0], /\.cutoutZoomControls \{[\s\S]*?position:\s*absolute/u);
  assert.match(phoneRules[0], /\.cutoutZoomControls \{[\s\S]*?flex:\s*0 0 auto/u);
});
