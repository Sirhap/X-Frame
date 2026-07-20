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

  assert.match(html, /<section id="homeHub"[^>]*\shidden>/);
  assert.match(html, /<canvas id="stage"/);
});
