"use strict";

const { expect, test: base } = require("@playwright/test");
const { resetE2EWorkspace, resolveE2ERoot } = require("./e2e_fixture");

const test = base.extend({
  _resetE2EFixture: [
    async ({}, use) => {
      resetE2EWorkspace(resolveE2ERoot());
      await use();
    },
    { auto: true },
  ],
});

module.exports = { expect, test };
