"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { analyzePngAlpha, parsePng, recommendSpatialTransform } = require("./attachment_sequence_analysis");
const { projectDataRevision } = require("./attachment_alignment_core");
const { reslash, slug } = require("./project_store");
const { decodePngRgba, encodePngRgba } = require("./xsxb_mcp_cutout");
const { requireExistingFile, requireFrameIndex, resolveProjectOutputPath } = require("./xsxb_mcp_arguments");
const { planWeaponTransforms, renderWeaponPlanFrame } = require("./xsxb_mcp_attachment_planner");
const { measureLongAxis, parseGripT, renderContactSheet } = require("./xsxb_mcp_visual_qa");

/**
 * Creates the revision-bound attachment planning handler.
 * @param {{root:string,projectStore:object,animationFor:Function,resolveAnimationFramePath:Function,attachmentBindingForSelection:Function,reviewArtifacts?:object,savePlan?:(project:object,plan:object)=>object,registerPlan?:(plan:object)=>void}} dependencies Service context.
 * @returns {(args?:object)=>object} MCP handler.
 */
function createPlanAttachmentHandler(dependencies) {
  const {
    root,
    projectStore,
    animationFor,
    resolveAnimationFramePath,
    attachmentBindingForSelection,
    reviewArtifacts,
    savePlan,
    registerPlan,
  } = dependencies;

  async function planAttachment(args = {}) {
    const report = (stage, progress, total = 4) => {
      if (args.__execution?.signal?.aborted) {
        throw args.__execution.signal.reason || new Error("MCP request cancelled.");
      }
      args.__execution?.progress?.({ progress, total, message: stage });
    };
    report("measure_attachment", 0);
    const selection = animationFor(args);
    const { project, profile, animation } = selection;
    const kind = String(args.kind || "weapon").toLowerCase();
    if (!new Set(["weapon", "effect"]).has(kind)) throw new Error('kind must be "weapon" or "effect".');
    const applyMode = String(args.apply_mode || "create").toLowerCase();
    if (!new Set(["create", "replace"]).has(applyMode)) {
      throw new Error('apply_mode must be "create" or "replace".');
    }
    const absolute = requireExistingFile(args.file_path, "Attachment image");
    if (!/\.png$/i.test(absolute)) throw new Error("Attachment image must be a PNG.");
    const assetBuffer = fs.readFileSync(absolute);
    const assetHash = crypto.createHash("sha256").update(assetBuffer).digest("hex");
    const image = decodePngRgba(absolute);
    let gripT = null;
    let measured = null;
    let weapon = null;
    let planned;
    if (kind === "weapon") {
      if (args.grip_t === undefined) throw new Error("grip_t is required for weapon attachment planning.");
      gripT = parseGripT(args.grip_t, NaN);
      if (!Number.isFinite(gripT) || gripT < 0 || gripT > 1) {
        throw new Error("grip_t must be a number between 0 and 1.");
      }
      measured = measureLongAxis(image.data, image.width, image.height, {
        t: gripT,
        pommelHint: args.pommel_hint,
        tipHint: args.tip_hint,
        flipAxis: args.flip_axis === true,
      });
      weapon = {
        grip: measured.localFromCenter,
        tip: { x: measured.tip.x - image.width / 2, y: measured.tip.y - image.height / 2 },
      };
      planned = planWeaponTransforms({
        frameCount: animation.frames?.length || 0,
        weapon,
        anchors: args.anchors,
        startFrame: args.start_frame,
        endFrame: args.end_frame,
      });
    } else {
      const frames = animation.frames || [];
      const startFrame =
        args.start_frame === undefined ? 0 : requireFrameIndex(args.start_frame, frames.length - 1);
      const endFrame =
        args.end_frame === undefined
          ? frames.length - 1
          : requireFrameIndex(args.end_frame, frames.length - 1);
      if (endFrame < startFrame) throw new Error("end_frame must be greater than or equal to start_frame.");
      const attachmentAnalysis = analyzePngAlpha(absolute);
      planned = [];
      for (let frame = startFrame; frame <= endFrame; frame += 1) {
        if ((frame - startFrame) % 4 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
          if (args.__execution?.signal?.aborted) {
            throw args.__execution.signal.reason || new Error("MCP request cancelled.");
          }
        }
        const ownerPath = resolveAnimationFramePath(project, frames[frame]?.path);
        if (!ownerPath || !fs.existsSync(ownerPath)) {
          throw new Error(`Frame ${frame} has no generated PNG for effect planning.`);
        }
        const recommendation = recommendSpatialTransform({
          owner: analyzePngAlpha(ownerPath),
          attachment: attachmentAnalysis,
          direction: "auto",
        });
        planned.push({
          frame,
          layer: "above",
          transform: recommendation.transform,
          gripErrorPx: 0,
          tipAngleErrorDeg: 0,
          spatialConfidence: Math.min(0.95, recommendation.confidence),
          diagnostics: recommendation.diagnostics,
        });
      }
    }
    if (planned.length > 240) {
      throw new Error("Attachment planning is limited to 240 reviewed frames per plan.");
    }
    report("plan_transforms", 1);
    const animationId = String(animation.id || animation.name);
    const groupKey = `${profile.id}/${animationId}`;
    const logicalId = slug(args.id || path.basename(absolute, path.extname(absolute)), "attachment");
    const assetId = `asset_${crypto
      .createHash("sha256")
      .update(`${groupKey}:${assetHash}`)
      .digest("hex")
      .slice(0, 32)}`;
    const targetPath = path.join(
      projectStore.projectWorkspaceDir(project),
      "attachments",
      profile.id,
      animationId,
      `${assetHash.slice(0, 16)}${path.extname(absolute).toLowerCase()}`,
    );
    const relativePath = reslash(path.relative(root, targetPath));
    const baseRevision = projectDataRevision(projectStore, project);
    const ownerFrames = [];
    let ownerPixels = 0;
    for (const [index, entry] of planned.entries()) {
      if (index % 8 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
        if (args.__execution?.signal?.aborted) {
          throw args.__execution.signal.reason || new Error("MCP request cancelled.");
        }
      }
      const frame = animation.frames?.[entry.frame];
      const ownerPath = resolveAnimationFramePath(project, frame?.path);
      if (!ownerPath || !fs.existsSync(ownerPath)) {
        throw new Error(`Frame ${entry.frame} has no generated PNG for attachment planning.`);
      }
      const ownerBuffer = fs.readFileSync(ownerPath);
      const ownerPng = parsePng(ownerBuffer);
      ownerPixels += ownerPng.width * ownerPng.height;
      ownerFrames.push({
        frame,
        ownerPath,
        ownerFrameHash: crypto.createHash("sha256").update(ownerBuffer).digest("hex"),
      });
    }
    if (ownerPixels > 32 * 1024 * 1024) {
      throw new Error("Attachment review frames exceed the 32-megapixel planning budget.");
    }
    const planSeed = {
      projectId: project.id,
      profileId: profile.id,
      animationId,
      logicalId,
      assetHash,
      baseRevision,
      gripT,
      kind,
      applyMode,
      anchors: args.anchors,
      startFrame: args.start_frame,
      endFrame: args.end_frame,
      pommelHint: args.pommel_hint,
      tipHint: args.tip_hint,
      flipAxis: args.flip_axis === true,
      planned: planned.map((entry, index) => ({
        frame: entry.frame,
        layer: entry.layer,
        transform: entry.transform,
        hand: entry.hand,
        tip: entry.tip,
        ownerFrameHash: ownerFrames[index].ownerFrameHash,
      })),
    };
    const planId = `${kind}_${crypto
      .createHash("sha256")
      .update(JSON.stringify(planSeed))
      .digest("hex")
      .slice(0, 24)}`;
    const entries = planned.map((entry, index) => {
      const binding = attachmentBindingForSelection(selection, entry.frame);
      const frame = ownerFrames[index].frame;
      return {
        entryId: `${planId}:${index}`,
        instanceId: `${logicalId}_${String(entry.frame).padStart(4, "0")}`,
        logicalId,
        sequenceIndex: index,
        frameIndex: entry.frame,
        displayFrame: entry.frame + 1,
        frameId: String(frame?.id || ""),
        framePath: String(frame?.path || ""),
        ownerFrameHash: ownerFrames[index].ownerFrameHash,
        key: binding.key,
        metadata: binding.metadata,
        asset: {
          id: assetId,
          name: String(args.name || path.basename(absolute)),
          path: relativePath,
          sourcePath: absolute,
          assetHash,
          type: "image/png",
          width: image.width,
          height: image.height,
          groupKey,
          registered: false,
        },
        canvasCompatibility: {
          mode: frame?.width === image.width && frame?.height === image.height ? "shared" : "local",
          ownerWidth: Number(frame?.width || 0),
          ownerHeight: Number(frame?.height || 0),
          assetWidth: image.width,
          assetHeight: image.height,
        },
        layer: entry.layer,
        layerOrder: entry.layer === "below" ? -1 : 1,
        transform: entry.transform,
        hand: entry.hand,
        grip: entry.grip,
        tip: entry.tip,
        gripErrorPx: entry.gripErrorPx,
        tipAngleErrorDeg: entry.tipAngleErrorDeg,
        alignment: {
          mappingStrategy: kind === "weapon" ? "weapon_anchors" : "frame_alpha_bounds",
          spatialMode: kind === "weapon" ? "hand_tip" : "alpha_bounds",
          spatialConfidence: kind === "weapon" ? 1 : entry.spatialConfidence,
          ...(kind === "weapon" ? { gripT } : { diagnostics: entry.diagnostics }),
        },
      };
    });
    const paths = projectStore.projectPaths(project);
    const rawAttachments = projectStore.readJson(paths.frameImageAttachments, []);
    const targetIds = new Set(entries.map((entry) => String(entry.instanceId)));
    const existingTargets = (Array.isArray(rawAttachments) ? rawAttachments : []).filter((attachment) =>
      targetIds.has(String(attachment.id)),
    );
    if (applyMode === "replace" && existingTargets.length !== entries.length) {
      const missing = entries
        .map((entry) => String(entry.instanceId))
        .filter((id) => !existingTargets.some((attachment) => String(attachment.id) === id));
      throw new Error(
        `replace planning requires every target attachment to exist. Missing: ${missing.join(", ") || "unknown"}.`,
      );
    }
    if (applyMode === "create" && existingTargets.length) {
      throw new Error(
        `create planning found existing attachment instances (${existingTargets.map((entry) => entry.id).join(", ")}); use apply_mode=replace.`,
      );
    }
    const previousBindings = existingTargets.map((attachment) => ({
      id: String(attachment.id),
      hash: crypto.createHash("sha256").update(JSON.stringify(attachment)).digest("hex"),
    }));
    const plan = {
      schemaVersion: 2,
      kind: "xsxb-attachment-alignment-plan",
      attachmentKind: kind,
      planId,
      createdAt: new Date().toISOString(),
      root,
      projectId: project.id,
      profileId: profile.id,
      animationId,
      groupKey,
      logicalId,
      applyMode,
      previousBindings,
      baseRevision,
      sourcePath: absolute,
      sourceHash: assetHash,
      ...(kind === "weapon" ? { gripT, weapon: { ...weapon, measured } } : {}),
      requiresVisualReview: true,
      entries,
    };
    const previewFrames = [];
    for (const entry of entries) {
      if (entry.sequenceIndex % 8 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
        if (args.__execution?.signal?.aborted) {
          throw args.__execution.signal.reason || new Error("MCP request cancelled.");
        }
      }
      const ownerPath = ownerFrames[entry.sequenceIndex].ownerPath;
      previewFrames.push(renderWeaponPlanFrame(decodePngRgba(ownerPath), image, entry));
    }
    report("render_review", 2);
    const preview = renderContactSheet(previewFrames, {
      cell: Math.min(512, Math.max(64, ...previewFrames.map((frame) => Math.max(frame.width, frame.height)))),
      pad: 8,
      columns: Math.min(5, previewFrames.length),
      startIndex: entries[0].frameIndex,
      markFrame: entries[0].frameIndex,
      grid: true,
      anchorMode: String(animation.anchorMode || "canvas_bottom_center"),
    });
    const workspaceRoot = projectStore.projectWorkspaceDir(project);
    const requestedPreview = String(args.preview_path || "");
    if (requestedPreview && !/\.png$/i.test(requestedPreview)) {
      throw new Error("preview_path must end with .png.");
    }
    const previewPath = requestedPreview
      ? resolveProjectOutputPath(workspaceRoot, requestedPreview, "preview_path")
      : resolveProjectOutputPath(
          workspaceRoot,
          path.join("exports", `${profile.id}_${animationId}_${planId}.png`),
          "preview_path",
        );
    fs.mkdirSync(path.dirname(previewPath), { recursive: true });
    fs.writeFileSync(previewPath, encodePngRgba(preview.data, preview.width, preview.height));
    plan.previewPath = previewPath;
    if (!reviewArtifacts) throw new Error("Review artifact store is required for v2 attachment plans.");
    const reviewArtifact = reviewArtifacts.create({
      project,
      kind: `${kind}_attachment_plan`,
      sourcePath: previewPath,
      revision: baseRevision,
      parameters: { planId, applyMode, frameCount: entries.length, logicalId },
      pinned: true,
    });
    report("persist_plan", 3);
    plan.reviewArtifactId = reviewArtifact.artifactId;
    plan.reviewArtifactHash = reviewArtifact.artifactHash;
    plan.reviewThumbnailHash = reviewArtifact.thumbnail.hash;
    plan.reviewPolicy = reviewArtifact.reviewPolicy;
    plan.createdAtMs = Date.now();
    const persistedPlan = savePlan ? savePlan(project, plan) : plan;
    const finalPlan = structuredClone(persistedPlan);
    registerPlan?.(finalPlan);
    const compact = String(args.response_mode || "full") === "compact";
    const publicPlan = compact
      ? {
          planId,
          attachmentKind: kind,
          projectId: project.id,
          profileId: profile.id,
          animationId,
          logicalId,
          applyMode,
          baseRevision,
          sourceHash: assetHash,
          frameCount: entries.length,
          reviewArtifactId: reviewArtifact.artifactId,
          reviewArtifactHash: reviewArtifact.artifactHash,
        }
      : finalPlan;
    const result = {
      projectId: project.id,
      profileId: profile.id,
      animationId,
      planId,
      planSchemaVersion: 2,
      responseMode: compact ? "compact" : "full",
      plan: publicPlan,
      previewPath,
      frameCount: entries.length,
      requiresVisualReview: true,
      reviewArtifactId: reviewArtifact.artifactId,
      reviewArtifactHash: reviewArtifact.artifactHash,
      reviewPolicy: reviewArtifact.reviewPolicy,
      gripErrorPx: Math.max(0, ...entries.map((entry) => Number(entry.gripErrorPx || 0))),
      tipAngleErrorDeg: Math.max(0, ...entries.map((entry) => Number(entry.tipAngleErrorDeg || 0))),
    };
    report("complete", 4);
    return result;
  }

  return planAttachment;
}

module.exports = { createPlanAttachmentHandler };
