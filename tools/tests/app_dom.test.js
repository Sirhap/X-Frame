const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { createElements } = require("../animation_tuner/public/app_dom");

/**
 * Creates a small document-like object for testing selector registration
 * without requiring a browser DOM implementation.
 * @returns {{querySelector:(selector:string)=>object,querySelectorAll:(selector:string)=>object[]}}
 */
function createDocumentStub() {
  return {
    querySelector(selector) {
      return { selector };
    },
    querySelectorAll(selector) {
      return [
        { selector, index: 0 },
        { selector, index: 1 },
      ];
    },
  };
}

test("createElements preserves the main workbench DOM contract", () => {
  const elements = createElements(createDocumentStub());

  assert.equal(elements.stage.selector, "#stage");
  assert.equal(elements.filmstrip.selector, "#filmstrip");
  assert.equal(elements.save.selector, "#save");
  assert.equal(elements.appConfirmPanel.selector, "#appConfirmPanel");
  assert.equal(elements.appConfirmAlternate.selector, "#appConfirmAlternate");
  assert.equal(elements.appConfirmAccept.selector, "#appConfirmAccept");
  assert.deepEqual(elements.languageButtons, [
    { selector: "[data-language]", index: 0 },
    { selector: "[data-language]", index: 1 },
  ]);
  assert.deepEqual(elements.boxChoiceInputs, [
    { selector: "[data-box-choice]", index: 0 },
    { selector: "[data-box-choice]", index: 1 },
  ]);
});

test("createElements rejects an invalid document dependency", () => {
  assert.throws(() => createElements({}), /requires a document-like query interface/);
});

test("the frame editor is visible before application initialization", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../animation_tuner/public/index.html"), "utf8");

  assert.doesNotMatch(html, /homeHub|data-home-tool/);
  assert.match(html, /<canvas\s+id="stage"/);
  assert.doesNotMatch(html, /class="languageButton"/);
  assert.match(html, /class="desktopRecommendedBanner"/);
  const scaleInput = html.match(/<input[\s\S]*?id="baseScale"[\s\S]*?>/);
  const offsetInput = html.match(/<input[\s\S]*?id="baseX"[\s\S]*?>/);
  assert.ok(scaleInput);
  assert.ok(offsetInput);
  assert.doesNotMatch(scaleInput[0], /\breadonly\b/);
  assert.doesNotMatch(offsetInput[0], /\breadonly\b/);
  assert.match(html, /<div class="number stepNumber"/);
  assert.doesNotMatch(
    html,
    /<label class="number stepNumber"[\s\S]*data-step-target="baseX"/,
    "stepper buttons must not sit inside a label that retargets clicks",
  );
});

test("delivery summary does not touch the later modeHubsModule binding", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../animation_tuner/public/app.js"), "utf8");
  const match = source.match(/function updateDeliverySummary\(\) \{[\s\S]*?\nfunction /);
  assert.ok(match);
  assert.match(match[0], /globalThis\.XSXBModeHubs/);
  assert.doesNotMatch(match[0], /\bmodeHubsModule\b/);
});

test("single-frame filmstrip keeps room for the thumbnail", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "../animation_tuner/public/app_shell.css"), "utf8");
  assert.match(css, /\.singleFrameAnimation \.filmstripPanel\s*\{\s*max-height:\s*228px;/);
  assert.match(css, /@media \(max-width: 759px\)/);
});

test("organizer analysis and danger tools collapse behind labeled menus", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../animation_tuner/public/index.html"), "utf8");
  const css = fs.readFileSync(path.resolve(__dirname, "../animation_tuner/public/organizer_shell.css"), "utf8");
  assert.match(html, /<details class="organizerToolGroup organizerToolMenu organizerAnalysisTools"/u);
  assert.match(html, /<details class="organizerToolGroup organizerToolMenu organizerDangerTools"/u);
  assert.doesNotMatch(
    html,
    /<details class="organizerToolGroup organizerToolMenu organizerAnalysisTools"[^>]*\bopen\b/u,
  );
  assert.doesNotMatch(
    html,
    /<details class="organizerToolGroup organizerToolMenu organizerDangerTools"[^>]*\bopen\b/u,
  );
  assert.match(html, /<summary[^>]*data-organizer-i18n="analysisTools"/u);
  assert.match(html, /<summary[^>]*data-organizer-i18n="dangerTools"/u);
  assert.match(css, /\.organizerToolMenuPanel\s*\{[\s\S]*?position:\s*absolute/u);
});

test("export number fields expose their own accessible names", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../animation_tuner/public/index.html"), "utf8");
  for (const id of [
    "mediaExportScaleX",
    "mediaExportScaleY",
    "mediaExportOffsetX",
    "mediaExportOffsetY",
    "mediaExportGifFps",
    "mediaExportMp4Fps",
    "mediaExportSpeed",
  ]) {
    const input = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`, "u"));
    assert.ok(input, `${id} input`);
    assert.match(input[0], /aria-labelledby=|aria-label=/u, `${id} needs an accessible name`);
  }
  assert.match(html, /id="mediaExportSpeed"[^>]*type="number"/u);
  assert.doesNotMatch(html, /id="mediaExportSpeed"[^>]*type="hidden"/u);
  assert.match(html, /class="mediaExportPreviewModes"[^>]*hidden/u);
});

test("the Codex Pets project exposes custom-pet recovery controls", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../animation_tuner/public/index.html"), "utf8");
  const script = fs.readFileSync(path.resolve(__dirname, "../animation_tuner/public/app.js"), "utf8");

  assert.match(html, /id="removeCodexPet"/);
  assert.match(html, /id="restoreRemovedCodexPet"/);
  assert.match(html, /id="restoreCodexPetBackup"/);
  assert.match(script, /\/api\/codex-pets\/remove/);
  assert.match(script, /\/api\/codex-pets\/restore-backup/);
});
