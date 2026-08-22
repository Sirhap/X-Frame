"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProjectStore } = require("../project_store");
const { createTestWav, createXsxbMcpService } = require("../xsxb_mcp_service");
const { encodePngRgba } = require("../xsxb_mcp_cutout");

/**
 * Builds a 16x16 transparent PNG with one opaque body block.
 * @param {number} [shift=0] Horizontal body shift in pixels.
 * @returns {Buffer} Encoded PNG.
 */
function bodyFrame(shift = 0) {
  const width = 16;
  const height = 16;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 4; y <= 12; y += 1) {
    for (let x = 6 + shift; x <= 9 + shift; x += 1) {
      rgba.set([200, 40, 40, 255], (y * width + x) * 4);
    }
  }
  return encodePngRgba(rgba, width, height);
}

/**
 * Builds a horizontal tapered weapon whose thick left end is the pommel.
 * @returns {Buffer} Encoded PNG.
 */
function weaponFrame() {
  const width = 24;
  const height = 12;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let x = 2; x <= 21; x += 1) {
    const half = x < 7 ? 2 : x < 17 ? 1 : 0;
    for (let y = 6 - half; y <= 6 + half; y += 1) {
      rgba.set([220, 220, 240, 255], (y * width + x) * 4);
    }
  }
  return encodePngRgba(rgba, width, height);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-mcp-bind-"));
  const godotRoot = path.join(root, "godot");
  fs.mkdirSync(godotRoot, { recursive: true });
  fs.writeFileSync(path.join(godotRoot, "project.godot"), '[application]\nconfig/name="Bind Test"\n');
  const presetPath = path.join(
    root,
    "tools/animation_tuner/public/presets/attack_trails/dynamic_trail_luma.png",
  );
  fs.mkdirSync(path.dirname(presetPath), { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, "../animation_tuner/public/presets/attack_trails/dynamic_trail_luma.png"),
    presetPath,
  );
  const store = createProjectStore(root);
  store.addProject({ id: "bind-test", label: "Bind Test", projectRoot: godotRoot });
  const sequenceDir = path.join(root, "seq");
  fs.mkdirSync(sequenceDir);
  fs.writeFileSync(path.join(sequenceDir, "a.png"), bodyFrame(0));
  fs.writeFileSync(path.join(sequenceDir, "b.png"), bodyFrame(2));
  return {
    root,
    store,
    sequenceDir,
    service: createXsxbMcpService({ root }),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

async function importedFixture() {
  const current = fixture();
  await current.service.call("xsxb_import_animation", {
    source: "png_sequence",
    directory: current.sequenceDir,
    project_id: "bind-test",
    animation_id: "walk",
  });
  return current;
}

test("get_animation include reads back boxes, timing, sfx, attachments, and trails", async () => {
  const current = await importedFixture();
  try {
    await current.service.call("xsxb_update_frame_boxes", {
      frame: 0,
      hurtbox: { offset: { x: 1, y: 2 }, size: { x: 8, y: 9 } },
    });
    await current.service.call("xsxb_update_timing", { frame: 1, duration_ms: 250 });
    const wavPath = path.join(current.root, "hit.wav");
    fs.writeFileSync(wavPath, createTestWav());
    await current.service.call("xsxb_add_sfx", { file_path: wavPath, frame: 1, id: "hit-sound" });
    const attachmentPath = path.join(current.root, "glow.png");
    fs.writeFileSync(attachmentPath, bodyFrame(1));
    await current.service.call("xsxb_add_attachment", {
      file_path: attachmentPath,
      frame: 0,
      id: "glow",
    });
    await current.service.call("xsxb_add_attack_trail", { id: "slash-trail" });

    const full = await current.service.call("xsxb_get_animation", {
      animation_id: "walk",
      include: ["boxes", "timing", "sfx", "attachments", "trails"],
    });
    assert.ok(full.boxes["0"], "frame 0 box override is returned");
    assert.equal(full.boxes["0"].hurtbox.size.x, 8);
    assert.equal(full.timing.frameOverrides["1"].durationMs, 250);
    assert.equal(full.sfx.length, 1);
    assert.equal(full.sfx[0].id, "hit-sound");
    assert.equal(full.sfx[0].frame, 1);
    assert.equal(full.sfx[0].hasData, true);
    assert.equal(full.sfx[0].data, undefined, "sfx base64 payload is omitted");
    assert.equal(full.attachments.length, 1);
    assert.equal(full.attachments[0].id, "glow");
    assert.equal(full.attachments[0].frame, 0);
    assert.equal(full.trails.length, 1);
    assert.equal(full.trails[0].id, "slash-trail");

    const summary = await current.service.call("xsxb_get_animation", {
      animation_id: "walk",
      frames: "summary",
      include: ["sfx"],
    });
    assert.equal(summary.summary, true);
    assert.equal(summary.sfx.length, 1);

    const bare = await current.service.call("xsxb_get_animation", { animation_id: "walk" });
    assert.equal(bare.boxes, undefined, "sections stay opt-in");

    await assert.rejects(
      current.service.call("xsxb_get_animation", { animation_id: "walk", include: ["nope"] }),
      /Unknown include section/,
    );
  } finally {
    current.cleanup();
  }
});

test("update_frame_boxes and update_timing apply many frames in one call", async () => {
  const current = await importedFixture();
  try {
    const boxResult = await current.service.call("xsxb_update_frame_boxes", {
      frames: [
        { frame: 0, hurtbox: { size: { x: 5, y: 5 } } },
        { frame: 1, hitbox: { size: { x: 6, y: 3 } } },
      ],
    });
    assert.equal(boxResult.updatedFrames, 2);
    assert.equal(boxResult.updates.length, 2);
    assert.equal(boxResult.frame, undefined, "batch response has no single-frame fields");

    const single = await current.service.call("xsxb_update_frame_boxes", {
      frame: 0,
      hitbox: { size: { x: 4, y: 4 } },
    });
    assert.equal(single.frame, 0, "single-frame response keeps its shape");
    assert.ok(single.boxes.hurtbox, "earlier hurtbox patch is preserved");

    const timingResult = await current.service.call("xsxb_update_timing", {
      frames: [
        { frame: 0, duration_ms: 100 },
        { frame: 1, disabled: true },
      ],
    });
    assert.equal(timingResult.playbackUpdates.length, 2);
    assert.equal(timingResult.playbackUpdates[0].durationMs, 100);
    assert.equal(timingResult.playbackUpdates[1].disabled, true);

    const readBack = await current.service.call("xsxb_get_animation", {
      include: ["boxes", "timing"],
    });
    assert.equal(readBack.boxes["0"].hitbox.size.x, 4);
    assert.equal(readBack.boxes["1"].hitbox.size.x, 6);
    assert.equal(readBack.timing.frameOverrides["0"].durationMs, 100);
    assert.equal(readBack.timing.frameOverrides["1"].disabled, true);

    await assert.rejects(
      current.service.call("xsxb_update_frame_boxes", { frames: [{ frame: 0 }] }),
      /at least one of hurtbox/,
    );
    await assert.rejects(
      current.service.call("xsxb_update_frame_boxes", { frames: [{ frame: 99, hitbox: {} }] }),
      /Frame must be an integer/,
    );
  } finally {
    current.cleanup();
  }
});

test("remove_binding deletes sfx, attachments, and trails with dry_run preview", async () => {
  const current = await importedFixture();
  try {
    const wavPath = path.join(current.root, "hit.wav");
    fs.writeFileSync(wavPath, createTestWav());
    await current.service.call("xsxb_add_sfx", { file_path: wavPath, frame: 0, id: "hit-sound" });
    const attachmentPath = path.join(current.root, "glow.png");
    fs.writeFileSync(attachmentPath, bodyFrame(1));
    await current.service.call("xsxb_add_attachment", {
      file_path: attachmentPath,
      frame: 1,
      id: "glow",
    });
    await current.service.call("xsxb_add_attack_trail", { id: "slash-trail" });

    const preview = await current.service.call("xsxb_remove_binding", {
      kind: "sfx",
      id: "hit-sound",
      dry_run: true,
    });
    assert.equal(preview.dryRun, true);
    assert.equal(preview.removedCount, 1);
    let readBack = await current.service.call("xsxb_get_animation", { include: ["sfx"] });
    assert.equal(readBack.sfx.length, 1, "dry_run keeps the binding");

    const removedSfx = await current.service.call("xsxb_remove_binding", {
      kind: "sfx",
      id: "hit-sound",
      frame: 0,
    });
    assert.equal(removedSfx.removedCount, 1);
    assert.equal(removedSfx.remainingCount, 0);
    assert.equal(removedSfx.removed[0].data, undefined, "receipt omits base64 audio");

    const removedAttachment = await current.service.call("xsxb_remove_binding", {
      kind: "attachment",
      id: "glow",
    });
    assert.equal(removedAttachment.removedCount, 1);

    const removedTrail = await current.service.call("xsxb_remove_binding", {
      kind: "trail",
      id: "slash-trail",
    });
    assert.equal(removedTrail.removedCount, 1);

    readBack = await current.service.call("xsxb_get_animation", {
      include: ["sfx", "attachments", "trails"],
    });
    assert.equal(readBack.sfx.length, 0);
    assert.equal(readBack.attachments.length, 0);
    assert.equal(readBack.trails.length, 0);

    await assert.rejects(
      current.service.call("xsxb_remove_binding", { kind: "sfx", id: "missing" }),
      /binding not found: missing.*\(none\)/,
    );
    await assert.rejects(
      current.service.call("xsxb_remove_binding", { kind: "trail", id: "x", frame: 0 }),
      /frame is not applicable/,
    );
    await assert.rejects(
      current.service.call("xsxb_remove_binding", { kind: "bogus", id: "x" }),
      /"kind" must be one of: sfx, attachment, trail/,
    );
  } finally {
    current.cleanup();
  }
});

test("xsxb_add_attachment binds many frames in one call", async () => {
  const current = await importedFixture();
  try {
    const attachmentPath = path.join(current.root, "sword.png");
    fs.writeFileSync(attachmentPath, bodyFrame(0));
    const added = await current.service.call("xsxb_add_attachment", {
      file_path: attachmentPath,
      id: "ember_sword",
      scale: 0.13,
      frames: [
        { frame: 0, offset_x: 1, offset_y: -2 },
        { frame: 1, offset_x: 3, offset_y: -4 },
      ],
      sync: false,
    });
    assert.equal(added.updatedFrames, 2);
    assert.equal(added.bindings.length, 2);
    assert.equal(added.bindings[0].frame, 0);
    assert.equal(added.bindings[1].transform.offset.x, 3);
    const readBack = await current.service.call("xsxb_get_animation", { include: ["attachments"] });
    assert.equal(readBack.attachments.length, 2);
    assert.equal(readBack.attachments[0].id, "ember_sword");
    assert.equal(readBack.attachments[1].frame, 1);
    assert.equal(readBack.attachments[1].transform.offset.y, -4);
  } finally {
    current.cleanup();
  }
});

test("xsxb_add_attachment writes workbench-compatible identity and complete asset geometry", async () => {
  const current = await importedFixture();
  try {
    const attachmentPath = path.join(current.root, "sword.png");
    fs.writeFileSync(attachmentPath, bodyFrame(1));

    const added = await current.service.call("xsxb_add_attachment", {
      file_path: attachmentPath,
      frame: 1,
      id: "sword",
      scale: 1.5,
      rotation: 30,
      sync: false,
    });

    const binding = added.binding;
    assert.match(
      binding.key,
      /^bind-test:player:mcp_imports:actor:walk:workspace\/projects\/bind-test\/assets\/mcp_imports\/walk:1$/u,
    );
    assert.equal(binding.metadata.projectId, "bind-test");
    assert.equal(binding.metadata.tuningTarget, "player");
    assert.equal(binding.metadata.profileId, "mcp_imports");
    assert.equal(binding.metadata.groupType, "actor");
    assert.equal(binding.metadata.animation, "mcp_imports/walk");
    assert.equal(binding.metadata.frame, 1);
    assert.equal(binding.width, 16);
    assert.equal(binding.height, 16);
    assert.match(binding.assetHash, /^[a-f0-9]{64}$/u);
    assert.ok(binding.assetId);
    assert.equal(binding.transform.scale, 1.5);
    assert.equal(binding.transform.scaleX, 1.5);
    assert.equal(binding.transform.scaleY, 1.5);

    const paths = current.store.projectPaths(current.store.readRegistry().projects[0]);
    const assets = current.store.readJson(paths.attachmentAssets, []);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].id, binding.assetId);
    assert.equal(assets[0].assetHash, binding.assetHash);
  } finally {
    current.cleanup();
  }
});

test("xsxb_plan_attachment previews a revision-bound weapon plan and add_attachment applies it", async () => {
  const current = await importedFixture();
  try {
    const weaponPath = path.join(current.root, "weapon.png");
    const weaponBytes = weaponFrame();
    fs.writeFileSync(weaponPath, weaponBytes);
    const paths = current.store.projectPaths(current.store.readRegistry().projects[0]);

    const planResult = await current.service.call("xsxb_plan_attachment", {
      animation_id: "walk",
      file_path: weaponPath,
      kind: "weapon",
      grip_t: 0.2,
      anchors: [
        { frame: 0, hand: { x: -2, y: -6 }, tip: { x: 6, y: -10 }, layer: "below" },
        { frame: 1, hand: { x: 2, y: -7 }, tip: { x: 10, y: -3 }, layer: "above" },
      ],
    });

    assert.equal(planResult.plan.entries.length, 2);
    assert.equal(planResult.plan.requiresVisualReview, true);
    assert.match(planResult.plan.planId, /^weapon_/u);
    assert.match(planResult.plan.baseRevision, /^[a-f0-9]{64}$/u);
    assert.ok(fs.existsSync(planResult.previewPath));
    assert.deepEqual(current.store.readJson(paths.frameImageAttachments, []), []);
    assert.deepEqual(current.store.readJson(paths.attachmentAssets, []), []);

    await assert.rejects(
      current.service.call("xsxb_add_attachment", {
        animation_id: "walk",
        file_path: weaponPath,
        plan: planResult.plan,
        confirm: false,
        sync: false,
      }),
      /explicit confirmation/u,
    );

    fs.writeFileSync(weaponPath, bodyFrame());
    await assert.rejects(
      current.service.call("xsxb_add_attachment", {
        animation_id: "walk",
        file_path: weaponPath,
        plan: planResult.plan,
        confirm: true,
        sync: false,
      }),
      /source changed/u,
    );
    fs.writeFileSync(weaponPath, weaponBytes);

    const originalTuning = current.store.readJson(paths.tuning, {});
    current.store.writeJson(paths.tuning, { ...originalTuning, revisionProbe: true });
    await assert.rejects(
      current.service.call("xsxb_add_attachment", {
        animation_id: "walk",
        file_path: weaponPath,
        plan: planResult.plan,
        confirm: true,
        sync: false,
      }),
      /Project data changed after planning/u,
    );
    current.store.writeJson(paths.tuning, originalTuning);

    const applied = await current.service.call("xsxb_add_attachment", {
      animation_id: "walk",
      file_path: weaponPath,
      plan: planResult.plan,
      confirm: true,
      sync: false,
    });
    assert.equal(applied.status, "applied");
    assert.equal(applied.updatedFrames, 2);
    assert.equal(applied.requiresVisualReview, true);
    assert.equal(applied.previewPath, planResult.previewPath);
    const readBack = await current.service.call("xsxb_get_animation", {
      animation_id: "walk",
      include: ["attachments"],
    });
    assert.equal(readBack.attachments.length, 2);
    assert.ok(readBack.attachments.every((attachment) => attachment.key.startsWith("bind-test:")));
  } finally {
    current.cleanup();
  }
});

test("xsxb_plan_attachment keeps alpha-bounds effect placement explicitly reviewable", async () => {
  const current = await importedFixture();
  try {
    const effectPath = path.join(current.root, "effect.png");
    fs.writeFileSync(effectPath, bodyFrame(1));

    const planned = await current.service.call("xsxb_plan_attachment", {
      animation_id: "walk",
      file_path: effectPath,
      kind: "effect",
      start_frame: 0,
      end_frame: 1,
    });

    assert.equal(planned.plan.attachmentKind, "effect");
    assert.equal(planned.plan.entries.length, 2);
    assert.equal(planned.requiresVisualReview, true);
    assert.ok(
      planned.plan.entries.every(
        (entry) => entry.alignment.spatialMode === "alpha_bounds" && entry.alignment.spatialConfidence < 1,
      ),
    );
  } finally {
    current.cleanup();
  }
});

test("xsxb_add_attack_trail derives blade sticks from a confirmed weapon attachment plan", async () => {
  const current = await importedFixture();
  try {
    const weaponPath = path.join(current.root, "weapon.png");
    fs.writeFileSync(weaponPath, weaponFrame());
    const planned = await current.service.call("xsxb_plan_attachment", {
      animation_id: "walk",
      file_path: weaponPath,
      kind: "weapon",
      id: "held-sword",
      grip_t: 0.2,
      anchors: [
        { frame: 0, hand: { x: -2, y: -6 }, tip: { x: 6, y: -10 }, layer: "below" },
        { frame: 1, hand: { x: 2, y: -7 }, tip: { x: 10, y: -3 }, layer: "above" },
      ],
    });
    await current.service.call("xsxb_add_attachment", {
      animation_id: "walk",
      file_path: weaponPath,
      plan: planned.plan,
      confirm: true,
      sync: false,
    });

    const trail = await current.service.call("xsxb_add_attack_trail", {
      animation_id: "walk",
      attachment_id: "held-sword",
      grip_t: 0.2,
      id: "weapon-slash",
      sync: false,
    });

    assert.equal(trail.sourceAttachmentId, "held-sword");
    assert.equal(trail.derivedStickCount, 2);
    assert.ok(
      Math.hypot(
        trail.segment.sticks[0].bottom.x - planned.plan.entries[0].grip.x,
        trail.segment.sticks[0].bottom.y - planned.plan.entries[0].grip.y,
      ) <= 0.000001,
    );
    assert.ok(
      Math.hypot(
        trail.segment.sticks[0].top.x - planned.plan.entries[0].tip.x,
        trail.segment.sticks[0].top.y - planned.plan.entries[0].tip.y,
      ) <= 0.000001,
    );
    assert.equal(trail.segment.sticks[0].layer, "behind");
    assert.equal(trail.segment.sticks[1].layer, "front");
    await assert.rejects(
      current.service.call("xsxb_add_attack_trail", {
        animation_id: "walk",
        attachment_id: "held-sword",
        sticks: [
          { frame: 0, top: { x: 1, y: 1 }, bottom: { x: 0, y: 0 } },
          { frame: 1, top: { x: 2, y: 2 }, bottom: { x: 0, y: 0 } },
        ],
        sync: false,
      }),
      /cannot be combined/u,
    );
  } finally {
    current.cleanup();
  }
});

test("estimate_boxes fills every frame, previews with dry_run, and skips existing overrides", async () => {
  const current = await importedFixture();
  try {
    const project = current.store.activeProject("bind-test");
    const tuningPath = current.store.projectPaths(project).tuning;
    const tuning = JSON.parse(fs.readFileSync(tuningPath, "utf8"));
    tuning.frame_box_overrides = {};
    fs.writeFileSync(tuningPath, JSON.stringify(tuning, null, 2));

    const preview = await current.service.call("xsxb_estimate_boxes", { dry_run: true });
    assert.equal(preview.dryRun, true);
    assert.equal(preview.estimatedFrames, 2);
    assert.ok(preview.frames[0].boxes.hurtbox, "preview returns estimated boxes");
    const untouched = JSON.parse(fs.readFileSync(tuningPath, "utf8"));
    assert.deepEqual(untouched.frame_box_overrides, {}, "dry_run does not persist");

    const applied = await current.service.call("xsxb_estimate_boxes", {});
    assert.equal(applied.estimatedFrames, 2);
    assert.equal(applied.skippedExistingFrames, 0);
    const readBack = await current.service.call("xsxb_get_animation", { include: ["boxes"] });
    assert.ok(readBack.boxes["0"].hurtbox);
    assert.ok(readBack.boxes["1"].collisionbox);

    const skipped = await current.service.call("xsxb_estimate_boxes", {});
    assert.equal(skipped.estimatedFrames, 0);
    assert.equal(skipped.skippedExistingFrames, 2);

    const replaced = await current.service.call("xsxb_estimate_boxes", { replace: true });
    assert.equal(replaced.estimatedFrames, 2);
  } finally {
    current.cleanup();
  }
});

test("add_attack_trail keeps stick layer and reverseDirection and spans the swing", async () => {
  const current = await importedFixture();
  try {
    const trail = await current.service.call("xsxb_add_attack_trail", {
      id: "cleave",
      sticks: [
        {
          frame: 0,
          top: { x: -10, y: -40 },
          bottom: { x: 10, y: -8 },
          layer: "behind",
          reverseDirection: true,
        },
        {
          frame: 1,
          top: { x: 40, y: -12 },
          bottom: { x: 8, y: -6 },
          layer: "front",
          reverseDirection: false,
        },
      ],
      sync: false,
    });
    assert.equal(trail.segment.sticks[0].layer, "behind");
    assert.equal(trail.segment.sticks[0].reverseDirection, true);
    assert.equal(trail.segment.sticks[1].layer, "front");
    assert.equal(trail.frameSpan, 1);
    assert.equal(trail.segment.sticks[0].framePhase, 0);
    assert.equal(trail.segment.sticks[1].framePhase, 1);
    assert.ok(trail.centerTravel > 20, "centers must move for this authored pair");
    assert.ok(trail.edgeTravel > 20, "blade edges must travel");
    assert.ok(
      trail.segment.beforeStopChaseMultiplier > 0.08 && trail.segment.beforeStopChaseMultiplier < 0.3,
    );
    assert.equal(trail.note, null);
  } finally {
    current.cleanup();
  }
});
