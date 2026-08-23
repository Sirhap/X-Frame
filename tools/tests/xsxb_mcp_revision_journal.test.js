"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProjectStore } = require("../project_store");
const { createProjectMutationJournal } = require("../xsxb_mcp_revision_journal");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-revision-journal-"));
  const projectStore = createProjectStore(root);
  projectStore.addProject({ id: "journal", label: "Journal" });
  const project = projectStore.activeProject("journal");
  const target = projectStore.projectPaths(project).tuning;
  return {
    root,
    projectStore,
    project,
    target,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test("mutation journal records, rolls back failure, and restores through a dry-run token", async () => {
  const current = fixture();
  try {
    const journal = createProjectMutationJournal({ root: current.root, projectStore: current.projectStore });
    const before = fs.readFileSync(current.target, "utf8");
    let observedPending = false;
    const committed = await journal.run({
      project: current.project,
      tool: "xsxb_update_timing",
      arguments: { frame: 0, duration: 2, secret: "redact-me" },
      paths: [current.target],
      mutate() {
        observedPending = journal.list(current.project).some((entry) => entry.status === "pending");
        const value = JSON.parse(before);
        value.revisionProbe = 2;
        fs.writeFileSync(current.target, `${JSON.stringify(value, null, 2)}\n`);
        return { ok: true };
      },
    });
    assert.equal(observedPending, true);
    assert.equal(committed.status, "committed");
    assert.match(committed.mutationRevisionId, /^revision_[a-f0-9]{24}$/u);
    const entries = journal.list(current.project);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].arguments.secret, "[REDACTED]");

    await assert.rejects(
      journal.run({
        project: current.project,
        tool: "xsxb_update_timing",
        arguments: {},
        paths: [current.target],
        mutate() {
          fs.writeFileSync(current.target, "broken");
          throw new Error("write failed");
        },
      }),
      /write failed/u,
    );
    assert.match(fs.readFileSync(current.target, "utf8"), /revisionProbe/u);

    const preview = journal.previewRestore(current.project, committed.mutationRevisionId);
    assert.equal(preview.dryRun, true);
    assert.ok(preview.restoreToken);
    const restored = await journal.restore({
      project: current.project,
      revisionId: committed.mutationRevisionId,
      restoreToken: preview.restoreToken,
      confirm: true,
    });
    assert.equal(restored.status, "restored");
    assert.equal(fs.readFileSync(current.target, "utf8"), before);
  } finally {
    current.cleanup();
  }
});

test("mutation journal snapshots and restores managed media directories", async () => {
  const current = fixture();
  try {
    const mediaDir = path.join(current.root, "workspace", "projects", "journal", "assets", "hero");
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, "old.png"), "old");
    const journal = createProjectMutationJournal({ root: current.root, projectStore: current.projectStore });
    const committed = await journal.run({
      project: current.project,
      tool: "xsxb_delete_animation",
      arguments: { animation_id: "hero" },
      paths: [mediaDir],
      mutate() {
        fs.rmSync(mediaDir, { recursive: true, force: true });
        return { deleted: true };
      },
    });
    assert.equal(fs.existsSync(mediaDir), false);
    const preview = journal.previewRestore(current.project, committed.mutationRevisionId);
    await journal.restore({
      project: current.project,
      revisionId: committed.mutationRevisionId,
      restoreToken: preview.restoreToken,
      confirm: true,
    });
    assert.equal(fs.readFileSync(path.join(mediaDir, "old.png"), "utf8"), "old");
  } finally {
    current.cleanup();
  }
});

test("restore token becomes stale when a media-only target changes after dry-run", async () => {
  const current = fixture();
  try {
    const mediaPath = path.join(current.root, "workspace", "projects", "journal", "frame.png");
    fs.mkdirSync(path.dirname(mediaPath), { recursive: true });
    fs.writeFileSync(mediaPath, "before");
    const journal = createProjectMutationJournal({ root: current.root, projectStore: current.projectStore });
    const committed = await journal.run({
      project: current.project,
      tool: "xsxb_cutout",
      arguments: {},
      paths: [mediaPath],
      mutate() {
        fs.writeFileSync(mediaPath, "after");
        return { changed: true };
      },
    });
    const preview = journal.previewRestore(current.project, committed.mutationRevisionId);
    fs.writeFileSync(mediaPath, "changed-after-preview");

    await assert.rejects(
      journal.restore({
        project: current.project,
        revisionId: committed.mutationRevisionId,
        restoreToken: preview.restoreToken,
        confirm: true,
      }),
      /restore_token is missing or stale/u,
    );
    assert.equal(fs.readFileSync(mediaPath, "utf8"), "changed-after-preview");
  } finally {
    current.cleanup();
  }
});

test("journal startup rolls back a pending mutation left by a dead process", async () => {
  const current = fixture();
  try {
    const journal = createProjectMutationJournal({ root: current.root, projectStore: current.projectStore });
    const before = fs.readFileSync(current.target, "utf8");
    const committed = await journal.run({
      project: current.project,
      tool: "xsxb_update_timing",
      arguments: {},
      paths: [current.target],
      mutate() {
        fs.writeFileSync(current.target, '{"mutated":true}\n');
        return { changed: true };
      },
    });
    const revisionPath = path.join(
      current.projectStore.projectWorkspaceDir(current.project),
      ".xsxb",
      "revisions",
      committed.mutationRevisionId,
      "revision.json",
    );
    const metadata = JSON.parse(fs.readFileSync(revisionPath, "utf8"));
    metadata.status = "pending";
    metadata.ownerPid = 999_999_999;
    fs.writeFileSync(revisionPath, `${JSON.stringify(metadata, null, 2)}\n`);
    fs.writeFileSync(current.target, '{"partiallyWritten":true}\n');

    const restarted = createProjectMutationJournal({
      root: current.root,
      projectStore: current.projectStore,
    });
    assert.equal(fs.readFileSync(current.target, "utf8"), before);
    const recovered = restarted
      .list(current.project)
      .find((entry) => entry.revisionId === committed.mutationRevisionId);
    assert.equal(recovered.status, "recovered_rollback");
  } finally {
    current.cleanup();
  }
});

test("journal rejects an unretainable snapshot before mutation", async () => {
  const current = fixture();
  let mutated = false;
  try {
    const before = fs.readFileSync(current.target, "utf8");
    const journal = createProjectMutationJournal({
      root: current.root,
      projectStore: current.projectStore,
      maxBytes: 8,
    });
    await assert.rejects(
      journal.run({
        project: current.project,
        tool: "xsxb_update_timing",
        arguments: {},
        paths: [current.target],
        mutate() {
          mutated = true;
          fs.writeFileSync(current.target, "changed");
        },
      }),
      /revision.*budget|snapshot.*retain/iu,
    );
    assert.equal(mutated, false);
    assert.equal(fs.readFileSync(current.target, "utf8"), before);
  } finally {
    current.cleanup();
  }
});

test("journal stores a bounded redacted summary instead of inline media and sensitive paths", async () => {
  const current = fixture();
  try {
    const journal = createProjectMutationJournal({ root: current.root, projectStore: current.projectStore });
    const largeData = `data:image/png;base64,${"A".repeat(200_000)}`;
    const committed = await journal.run({
      project: current.project,
      tool: "xsxb_import_animation",
      arguments: {
        file_path: "/Users/private/source.png",
        items: [{ name: "frame.png", data: largeData }],
        authorization: "Bearer secret",
      },
      paths: [current.target],
      mutate() {
        return { unchanged: true };
      },
    });
    const revisionPath = path.join(
      current.projectStore.projectWorkspaceDir(current.project),
      ".xsxb",
      "revisions",
      committed.mutationRevisionId,
      "revision.json",
    );
    const metadataText = fs.readFileSync(revisionPath, "utf8");
    const metadata = JSON.parse(metadataText);
    assert.ok(Buffer.byteLength(metadataText) < 64 * 1024);
    assert.doesNotMatch(metadataText, /AAAAAA/u);
    assert.doesNotMatch(metadataText, /Users\/private/u);
    assert.match(JSON.stringify(metadata.arguments), /sha256|REDACTED/u);
  } finally {
    current.cleanup();
  }
});

test("restore verifies snapshot bytes before replacing current project data", async () => {
  const current = fixture();
  try {
    const journal = createProjectMutationJournal({ root: current.root, projectStore: current.projectStore });
    const committed = await journal.run({
      project: current.project,
      tool: "xsxb_update_timing",
      arguments: {},
      paths: [current.target],
      mutate() {
        fs.writeFileSync(current.target, '{"current":true}\n');
        return { changed: true };
      },
    });
    const entry = journal
      .list(current.project)
      .find((revision) => revision.revisionId === committed.mutationRevisionId);
    const snapshotPath = path.join(
      current.projectStore.projectWorkspaceDir(current.project),
      ".xsxb",
      "revisions",
      committed.mutationRevisionId,
      entry.snapshots[0].snapshot,
    );
    fs.appendFileSync(snapshotPath, "tampered");
    const beforeRestore = fs.readFileSync(current.target, "utf8");
    const preview = journal.previewRestore(current.project, committed.mutationRevisionId);
    await assert.rejects(
      journal.restore({
        project: current.project,
        revisionId: committed.mutationRevisionId,
        restoreToken: preview.restoreToken,
        confirm: true,
      }),
      /snapshot.*integrity|hash mismatch/iu,
    );
    assert.equal(fs.readFileSync(current.target, "utf8"), beforeRestore);
  } finally {
    current.cleanup();
  }
});

test("restore token binds the persisted snapshot scope and integrity digest", async () => {
  const current = fixture();
  try {
    const journal = createProjectMutationJournal({ root: current.root, projectStore: current.projectStore });
    const committed = await journal.run({
      project: current.project,
      tool: "xsxb_update_timing",
      arguments: {},
      paths: [current.target],
      mutate() {
        fs.writeFileSync(current.target, '{"current":true}\n');
        return { changed: true };
      },
    });
    const preview = journal.previewRestore(current.project, committed.mutationRevisionId);
    const revisionPath = path.join(
      current.projectStore.projectWorkspaceDir(current.project),
      ".xsxb",
      "revisions",
      committed.mutationRevisionId,
      "revision.json",
    );
    const metadata = JSON.parse(fs.readFileSync(revisionPath, "utf8"));
    metadata.snapshots[0].snapshotHash = "0".repeat(64);
    fs.writeFileSync(revisionPath, `${JSON.stringify(metadata, null, 2)}\n`);
    await assert.rejects(
      journal.restore({
        project: current.project,
        revisionId: committed.mutationRevisionId,
        restoreToken: preview.restoreToken,
        confirm: true,
      }),
      /restore_token is missing or stale/u,
    );
  } finally {
    current.cleanup();
  }
});

test("journal refuses managed targets containing symlinks", async () => {
  const current = fixture();
  let external = "";
  try {
    const directory = path.join(current.root, "workspace", "projects", "journal", "linked-assets");
    fs.mkdirSync(directory, { recursive: true });
    fs.symlinkSync(current.target, path.join(directory, "escape.json"));
    const journal = createProjectMutationJournal({ root: current.root, projectStore: current.projectStore });
    await assert.rejects(
      journal.run({
        project: current.project,
        tool: "xsxb_import_animation",
        arguments: {},
        paths: [directory],
        mutate() {
          return {};
        },
      }),
      /symbolic link|symlink/iu,
    );
    external = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-journal-external-"));
    const linkedParent = path.join(current.root, "workspace", "projects", "journal", "linked-parent");
    fs.symlinkSync(external, linkedParent, "dir");
    const escapedTarget = path.join(linkedParent, "outside.json");
    fs.writeFileSync(path.join(external, "outside.json"), "outside");
    await assert.rejects(
      journal.run({
        project: current.project,
        tool: "xsxb_import_animation",
        arguments: {},
        paths: [escapedTarget],
        mutate() {
          return {};
        },
      }),
      /trusted project root|outside/iu,
    );
  } finally {
    if (external) fs.rmSync(external, { recursive: true, force: true });
    current.cleanup();
  }
});
