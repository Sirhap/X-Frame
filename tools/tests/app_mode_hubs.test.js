"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/app_mode_hubs");

/** Creates the DOM subset required by the project-hub renderer. */
function createElement(tagName = "div") {
  const attributes = new Map();
  return {
    tagName: tagName.toUpperCase(),
    children: [],
    dataset: {},
    hidden: false,
    append(...children) {
      this.children.push(...children);
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    replaceChildren(...children) {
      this.children = children;
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
  };
}

/** Creates a minimal project-hub document with inspectable output elements. */
function createFixture() {
  const elements = {
    "#projectHubRecent": createElement(),
    "#projectHubRecentTitle": createElement(),
    "#projectHubRecentSummary": createElement(),
    "#projectHubContinue": createElement("a"),
    "#projectHubList": createElement(),
    "#projectHubEmpty": createElement(),
    "#projectHubNew": createElement("button"),
  };
  return {
    elements,
    documentRef: {
      createElement,
      querySelector: (selector) => elements[selector] || null,
    },
  };
}

test("project cards opt into guarded document navigation", () => {
  const fixture = createFixture();
  const controller = createController({
    documentRef: fixture.documentRef,
    windowRef: { location: { origin: "http://localhost" } },
  });

  controller.renderProjects({
    activeProjectId: "active",
    projects: [
      { id: "active", label: "Active" },
      { id: "test", label: "test" },
    ],
  });

  const testCard = fixture.elements["#projectHubList"].children[1];
  assert.equal(testCard.href, "/workspace?project=test");
  assert.equal(testCard.getAttribute("data-document-navigation"), "");
});
