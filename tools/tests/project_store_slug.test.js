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

test("ORG-005 addProject does not persist a label longer than the role-name cap", () => {
  const html = fs.readFileSync(path.join(__dirname, "../animation_tuner/public/index.html"), "utf8");
  const maxLength = Number(html.match(/id="organizerProfileName"[\s\S]*?maxlength="(\d+)"/u)[1]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-project-name-"));
  try {
    const store = createProjectStore(root);
    const longName = "d".repeat(maxLength + 1);
    const registry = store.addProject({ label: longName, kind: "animation" });
    const created = registry.projects.find((project) => project.id !== "default");
    assert.ok(created);
    assert.ok(
      created.label.length <= maxLength,
      `ORG-005 stored ${created.label.length} chars; cap is ${maxLength}`,
    );
    assert.notEqual(created.label, longName);

    const eighty = store.addProject({ label: "e".repeat(maxLength), kind: "animation" });
    const accepted = eighty.projects.find((project) => project.label === "e".repeat(maxLength));
    assert.ok(accepted, "80-character project names must still be stored");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
