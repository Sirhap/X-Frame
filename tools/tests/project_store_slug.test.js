"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { slug } = require("../project_store");

test("slug keeps slash-separated ids distinct from underscore ids", () => {
  assert.equal(slug("foo/bar"), "foo-bar");
  assert.equal(slug("foo_bar"), "foo_bar");
  assert.notEqual(slug("foo/bar"), slug("foo_bar"));
  assert.equal(slug(".."), "project");
  assert.equal(slug(""), "project");
});
