"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProjectStore, normalizeRegistry, requireFps, sanitizeFps, slug } = require("../project_store");

test("slug keeps slash-separated ids distinct from underscore ids", () => {
  assert.equal(slug("foo/bar"), "foo-bar");
  assert.equal(slug("foo_bar"), "foo_bar");
  assert.notEqual(slug("foo/bar"), slug("foo_bar"));
  assert.equal(slug(".."), "project");
  assert.equal(slug(""), "project");
});

test("fps helpers reject invalid values and keep a default fallback", () => {
  assert.equal(requireFps(undefined), 12);
  assert.equal(requireFps("24"), 24);
  assert.throws(() => requireFps("abc"), /fps must be a finite number/);
  assert.throws(() => requireFps(0), /fps must be a finite number/);
  assert.equal(sanitizeFps("abc"), 12);
  assert.equal(sanitizeFps(0), 12);
});

test("normalizeRegistry keeps a default project after another project is added", () => {
  const registry = normalizeRegistry({
    schemaVersion: 1,
    activeProjectId: "hero",
    projects: [
      { id: "default", label: "Legacy", projectRoot: "/tmp/legacy-godot" },
      { id: "hero", label: "Hero", projectRoot: "/tmp/hero-godot" },
    ],
  });
  assert.deepEqual(
    registry.projects.map((project) => project.id),
    ["default", "hero"],
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-registry-default-"));
  try {
    const store = createProjectStore(root);
    store.writeRegistry({
      schemaVersion: 1,
      activeProjectId: "default",
      projects: [{ id: "default", label: "Legacy", projectRoot: "" }],
    });
    store.addProject({ id: "hero", label: "Hero" });
    const next = store.readRegistry();
    assert.ok(next.projects.some((project) => project.id === "default"));
    assert.ok(next.projects.some((project) => project.id === "hero"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
