# Media and Tuning Workflows

Use this reference for existing tuner operations beyond deterministic animation import and runtime wiring.

## Contents

- Local execution and project selection
- Batch cutout
- MCP (moved to x-frame-mcp)
- Video extraction and frame organization
- Transform and playback tuning
- Boxes, SFX, and image attachments
- Save, synchronization, and completion evidence

## Local Execution and Project Selection

- Keep source images, videos, audio, and Godot projects on the local machine.
- Start or reuse `tools/animation_tuner/server.js`; it listens on `127.0.0.1` by default.
- Select the exact XSXB project, profile, and animation before editing.
- Record the initial frame count and existing frame-indexed tuning, boxes, SFX, and attachments before destructive operations.
- Use an available browser-control capability for features implemented only in the local tuner UI. Inspect the page state and rendered frames before acting.
- Do not invent a CLI or direct JSON rewrite for a browser-only operation when doing so would bypass its remapping, confirmation, or synchronization behavior.

## Batch Cutout

Use the Batch Cutout panel for local multi-image background removal and animation-frame replacement.

Supported operations include:

- Load multiple local images or load the current animation group.
- Estimate a background color per image or use one or more manual background samples.
- Clear only edge-connected background or clear matching background across the image.
- Adjust perceptual keying, alpha low/high thresholds, hard transparency threshold, edge softness, edge recovery, despill/decontamination, and background search radius.
- Protect sampled colors or colors extracted from a selected rectangle.
- Apply rectangular smart clear, full clear, subject restoration, undo, and redo.
- Propagate a local repair through the sequence using motion prediction and shape matching.
- Export processed PNG files without changing the active animation.
- Replace the current animation only when processed image count equals the current frame count.

Workflow:

1. Load the intended source set and confirm file order and image count.
2. Start with automatic edge-connected background detection.
3. Inspect representative frames containing the hardest edges, similar foreground/background colors, weapons, VFX, hair, and semi-transparent details.
4. Add background samples or protected colors before increasing destructive tolerance.
5. Apply local repair on a representative frame and inspect propagated results, including skipped frames.
6. Prefer separate PNG export when replacement intent is absent.
7. Before replacing the current group, confirm exact frame-count equality and explicit overwrite intent.
8. After replacement, inspect the animation, save, sync Godot, and verify manifest frame paths and counts.

Do not claim a clean cutout solely because the batch completed. Check edge halos, missing foreground colors, accidental holes, alpha noise, and consistency across frames.

## MCP

XSXB MCP 已迁到 [x-frame-mcp](https://github.com/Sirhap/x-frame-mcp)。本文件只讲 Tuner 网页操作。

## Video Extraction and Frame Organization

Use the Frame Workset panel for local images, local video extraction, reordering, reduction, flipping, tagging, diagnostics, and animation replacement.

Video extraction:

- Decode the video locally in the browser; do not upload it.
- Select a start and end time and an extraction rate from 1–60 FPS.
- Keep a single extraction at or below 300 frames.
- If decoding fails, try a browser-compatible H.264 MP4 or WebM source.
- If memory use is excessive, shorten the clip, lower FPS, or reduce source resolution.
- Inspect extracted ordering and representative frames before applying the workset.

Frame workset operations:

- Include or exclude individual frames and invert selection.
- Reduce by keeping one frame per selected step.
- Restore source order.
- Horizontally flip selected frames.
- Import additional images or delete selected workset entries.
- Add human-readable frame tags.
- Diagnose isolated jump frames.
- Diagnose near-duplicate frames.
- Find candidate loop segments by endpoint similarity.

Diagnostics are suggestions, not automatic truth. Visually inspect flagged frames before deleting or excluding them.

Applying a workset:

1. Record original count, order, tuning, boxes, SFX, and attachments.
2. Confirm the final included frame order and transformed images.
3. Require explicit confirmation because Apply replaces the animation frame set.
4. Use the tuner Apply action so frame tuning, boxes, audio, and attachments are remapped together.
5. Confirm the resulting frame count and source-to-result mapping.
6. Inspect attack active frames, timing, reference frame, SFX, and attachment ownership after remapping.
7. Save, sync Godot, and run validation.

## Transform and Playback Tuning

The tuner supports Character, Group, and Frame transform layers.

- Tune uniform scale, X/Y scale, X/Y offset, and rotation at the intended layer.
- Keep broad actor sizing at Character level.
- Keep animation-specific alignment at Group level.
- Keep pose- or canvas-specific corrections at Frame level.
- Use the reference-frame overlay and black, white, transparent, or grid backgrounds for visual comparison.
- Preserve the same Character × Group × Frame × Scene transform semantics in tuner and Godot.
- Never use box offsets to correct sprite alignment.

Playback operations:

- Set group playback time or per-frame duration.
- Treat group time and per-frame duration overrides as alternative timing sources.
- Respect confirmations that clear the conflicting timing source.
- Disable intentionally unused frames without treating disabled state as a duration override.
- Preview the actual resulting cadence and action duration before saving.

## Boxes, SFX, and Image Attachments

Boxes:

- Tune hurtbox, hitbox, and collisionbox independently.
- Move a selected box by dragging its body.
- Reshape with the supported modifier and handles.
- Keep collisionbox grounded, unrotated, and conservative.
- Inspect representative poses and every materially different attack phase.

SFX:

- Bind local audio to the intended frame card.
- Preview the binding when browser playback is available.
- Confirm before deleting or replacing an existing binding.
- Preserve path-only bindings and stable frame keys across reload and Save.

Image attachments:

- Add local images to the intended owner frame.
- Use card order for above/below layer order.
- Copy or paste attachments only within the same project.
- Tune attachment local offset, scale, and rotation independently from the owner sprite.
- Inspect owner inheritance, facing, scene scale, and layer order in both preview and Godot.
- Keep attachments visual-only unless explicit gameplay-box support is added.

## Save, Synchronization, and Completion Evidence

Treat Save as the persistence and Godot synchronization boundary.

After every requested operation:

- Confirm no unsaved-edit indicator remains.
- Check `/api/config?project=<id>` for warnings.
- Confirm standalone and Godot-local manifests have the intended frame counts.
- Confirm frame-indexed visual, playback, box, SFX, and attachment data still targets the intended frames.
- Run `npm run check`, `npm test`, and strict project validation when project data or Godot synchronization changed.
- Report the initial and final frame counts, exported or replaced destinations, operations applied, warnings resolved, and any remaining artistic judgment.
