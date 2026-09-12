---
name: xsxb-animation-production
description: Use when an AI agent needs to create, import, organize, validate, or integrate Godot frame animations in the local X-Frame, whether frames already exist or must be generated; trigger for PNG sequences, SpriteFrames, videos, animation-constraints.json, or requests to open and use the local tuner.
---

# XSXB Animation Production

Turn an animation request into a reproducible local production job. Use one `animation-constraints.json` contract, route supplied media and generated media through the same XSXB import/sync/validation gates, and report only properties that were actually checked.

Use `tools/animation_production_workflow.js` directly or through the `animation:workflow` npm script for deterministic stages.

## Choose the route

- **Supplied media:** use when the request includes PNG folders, a SpriteFrames resource, a video, or an existing frame set. Preserve the source and inspect it before import.
- **Generate then integrate:** use when no usable frame source exists. Define the contract, create a canonical identity reference and a small proof of key poses, generate or author the frame sequence with an available local/authorized tool, then continue through the supplied-media route.
- **Browser-required:** use the existing workbench for video decoding, batch cutout, visual frame organization, drag-based box tuning, or any `video`/`spriteframes` source that the CLI reports as `browser-required`.

Do not invent frames, claim a generation tool ran, or treat a started server as a completed animation.

For generated frame sequences, apply `constrained-animation-generation` when available so identity, timing, loop endpoints, anchors, and continuity are explicit before handing PNGs to this project.

## Required workflow

1. Resolve the exact Godot project root, XSXB project id/profile, requested animation ids, source paths, and replacement intent. Ask only when binding or overwriting the wrong project could result.
2. Read [references/animation-contract.md](references/animation-contract.md), then create `animation-constraints.json` beside the job outputs. Use absolute `projectRoot` and stable relative source paths from the contract directory.
3. Run a read-only plan and inspect before any mutation:

   ```bash
   npm run animation:workflow -- plan --contract "<job>/animation-constraints.json" --json
   npm run animation:workflow -- inspect --contract "<job>/animation-constraints.json" --project "<xsxb_project_id>" --json
   ```

4. If frames are supplied, check natural ordering, dimensions, alpha, frame count, identity consistency, anchor, FPS, loop endpoint policy, and direction. Keep source files unchanged.
5. If frames are not supplied:
   - lock one canonical identity/style reference;
   - define key poses and normalized beat times before generating in-betweens;
   - keep the canvas, bottom anchor, proportions, handedness, camera, and lighting stable;
   - generate a small proof first when identity or motion feasibility is uncertain;
   - assemble stable numbered PNGs and record the actual count in the contract;
   - stop with a clear blocker and preserve the contract if no generation capability is available.
6. For PNG/generated sequences, run the deterministic import command. Pass `--replace` only when the user explicitly requested replacement:

   ```bash
   npm run animation:workflow -- import \
     --contract "<job>/animation-constraints.json" \
     --project "<xsxb_project_id>" \
     --replace \
     --json
   ```

   Omit `--replace` for additive imports. A single clip uses `import_frames.js`; multiple CLI-compatible clips use `import_batch.js`.
   When frames or tuning already exist in the bound XSXB project, refresh Godot without reimporting:

   ```bash
   npm run animation:workflow -- sync \
     --contract "<job>/animation-constraints.json" \
     --project "<xsxb_project_id>" \
     --json
   ```

7. Delegate operations owned by the existing `xsxb-frame-tuner` skill—cutout, organizer, attachments, boxes, SFX, Godot runtime wiring, and gameplay checks—to that skill. Read its required references before editing or syncing.
8. For browser-only work, keep the local server bound to loopback, use the user's Microsoft Edge/Chrome session when available, inspect rendered frames rather than only API responses, save the workbench state, and return to deterministic validation.
9. Validate the synchronized result:

   ```bash
   npm run animation:workflow -- validate \
     --contract "<job>/animation-constraints.json" \
     --project "<xsxb_project_id>" \
     --json
   ```

   The underlying gate must include `--strict --require-gameplay`. Treat warnings as review items and errors as incomplete work.

10. Start or reuse the tuner only after the relevant import/sync/validation stage:

    ```bash
    npm run animation:workflow -- start --port 5179 --json
    ```

    If the command reports `reused: true`, refresh the project/animation list. Otherwise wait for the returned URL to accept connections before opening the workbench.

## Contract and animation rules

- Use `version: 1`, `profile`, and `clips` or one `motion`; keep `frameCount`, `fps`, `anchor`, `loop`, `rootMotion`, `direction`, `replace`, and `source` explicit when they are hard requirements.
- Use `canvas_bottom_center` for grounded actors unless the existing project proves another authored anchor.
- Keep raster locomotion frames in place. Put world displacement in gameplay/root motion; do not shift the subject across frames to fake movement.
- For loops, make the intended first and final visual frames identical and avoid a duplicate hold during runtime playback. For non-loops, preserve the intended terminal pose.
- Keep attack anticipation, hit, follow-through, and recovery distinct; do not turn gameplay hit metadata into detached effect text.
- Preserve canonical identity across every clip. Do not regenerate unchanged layers or redesign the character to hide a continuity failure.
- Never use collision/hit/hurt box offsets to position the sprite. Keep boxes in local gameplay space and apply the same Character/Group/Frame/facing/scene transforms to visuals and boxes.

## Safety and failure handling

- Keep source media and intermediate frames. Write generated job artifacts under the requested job directory or `artifacts/`; do not write to Downloads or a temporary path that runtime assets will reference.
- Reject missing `project.godot`, missing source folders/files, empty PNG directories, invalid FPS/frame counts, and project-id/root conflicts.
- Do not delete frames, apply an organizer workset, replace an animation, or overwrite source media without explicit intent.
- If a child process fails, preserve its stderr/stdout and identify the failing stage. If a validator returns JSON with `ok: false`, report its errors even when the process output is otherwise parseable.
- If an operation is `browser-required`, stop the CLI route and use the appropriate existing tuner flow; do not report a partial CLI import as success.

## Final report

Report the contract path, route, exact project/profile, clip ids, actual frame count/FPS/dimensions/loop behavior, source and generated artifact paths, tuner and Godot paths, importer/sync/validation commands and results, browser-only visual checks, known deviations/blockers, and one concrete next step. Distinguish “server started” from “animation imported”, “runtime synchronized”, and “gameplay validated”.
