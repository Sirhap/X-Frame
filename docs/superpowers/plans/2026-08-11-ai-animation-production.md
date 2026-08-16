# AI Animation Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project-local, machine-readable animation production workflow and an auto-discoverable skill that supports both supplied media and generated animation assets.

**Architecture:** Keep `skills/xsxb-frame-tuner` as the existing execution skill. Add a small pure contract module for normalization/validation and a Node CLI that orchestrates inspect, plan, import, validate, and start operations through existing project tools. The new `skills/xsxb-animation-production` skill translates natural language into the contract, chooses the supplied-media or generate-then-integrate route, and delegates deterministic work to the CLI and existing XSXB skill.

**Tech Stack:** Node.js 18 CommonJS, built-in `node:test`, `node:child_process`, existing XSXB importer/sync/validation modules, Markdown skill metadata, `quick_validate.py`.

## Global Constraints

- Preserve all unrelated working-tree changes; modify only files listed in each task.
- Do not overwrite source media or existing animation data unless the contract contains explicit `replace: true`.
- Resolve project bindings by exact Godot project root; never reuse one XSXB id for another root.
- Keep CLI output JSON-compatible and send errors to stderr with non-zero exit status.
- Every new JavaScript function must have a concise JSDoc comment when its purpose or contract is not obvious.
- Run each focused test after its implementation and run `npm run check:quick` before reporting completion.

---

### Task 1: Define and validate the animation production contract

**Files:**
- Create: `tools/animation_production_contract.js`
- Test: `tools/tests/animation_production_contract.test.js`

**Interfaces:**
- `normalizeContract(raw, options)` returns `{ version, projectRoot, profile, clips, identity, artifacts }` with normalized absolute paths and defaults.
- `validateContract(raw, options)` returns `{ ok, errors, warnings }` without modifying the filesystem.
- `loadContract(filePath, options)` reads JSON and returns the normalized contract or throws an actionable error.

- [ ] **Step 1: Write the failing tests**

  Cover these exact behaviors:

  ```js
  test("normalizes motion into one clip and applies safe defaults", () => {
    const result = normalizeContract({
      version: 1,
      projectRoot: "/tmp/game",
      profile: "Hero One",
      motion: { id: "run", source: { kind: "png-sequence", path: "frames/run" }, frameCount: 8 },
    }, { baseDir: "/tmp/job" });

    assert.equal(result.profile, "Hero_One");
    assert.equal(result.clips[0].id, "run");
    assert.equal(result.clips[0].fps, 12);
    assert.equal(result.clips[0].anchor, "canvas_bottom_center");
    assert.equal(result.clips[0].replace, false);
    assert.equal(result.clips[0].source.path, "/tmp/job/frames/run");
  });

  test("rejects unsafe or incomplete contracts", () => {
    const result = validateContract({
      version: 2,
      projectRoot: "",
      profile: "",
      clips: [{ id: "", source: { kind: "png-sequence", path: "" }, fps: 0 }],
    }, { baseDir: "/tmp/job" });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /version|projectRoot|profile|clip|fps|source/i);
  });

  test("marks non-PNG media as browser-required instead of pretending it is importable", () => {
    const result = normalizeContract({
      version: 1,
      projectRoot: "/tmp/game",
      profile: "hero",
      clips: [{ id: "intro", source: { kind: "video", path: "intro.mov" }, frameCount: 24 }],
    }, { baseDir: "/tmp/job" });

    assert.equal(result.clips[0].execution, "browser-required");
  });
  ```

- [ ] **Step 2: Run the focused test to verify it fails**

  Run:

  ```bash
  node --test tools/tests/animation_production_contract.test.js
  ```

  Expected: FAIL because `tools/animation_production_contract.js` does not yet exist.

- [ ] **Step 3: Implement the minimal contract module**

  Support version `1`, `motion` or non-empty `clips`, `png-sequence`, `generated`, `spriteframes`, and `video` source kinds. Normalize profile and clip ids with the existing `slug` helper, resolve relative source paths from `options.baseDir`, default `fps` to `12`, `type` to `actor`, `anchor` to `canvas_bottom_center`, `loop` to `true`, `rootMotion` to `in-place`, `direction` to `auto`, and `replace` to `false`. Set `execution` to `cli-import` for PNG/generated sequences and `browser-required` for video/SpriteFrames until their existing specialized workflow is selected. Reject absolute source paths outside their declared path without silently rewriting them.

- [ ] **Step 4: Run the focused test to verify it passes**

  Run:

  ```bash
  node --test tools/tests/animation_production_contract.test.js
  ```

  Expected: all contract tests PASS.

- [ ] **Step 5: Run formatting and syntax checks**

  Run:

  ```bash
  node --check tools/animation_production_contract.js
  npx prettier --check tools/animation_production_contract.js tools/tests/animation_production_contract.test.js
  ```

### Task 2: Add the deterministic AI workflow CLI

**Files:**
- Create: `tools/animation_production_workflow.js`
- Test: `tools/tests/animation_production_workflow.test.js`
- Modify: `package.json` (add `animation:workflow` script only)

**Interfaces:**
- `parseArgs(argv)` returns `{ command, contract, projectRoot, project, json, replace, port, timeoutMs }`.
- `runWorkflow(command, options)` returns `{ ok, stage, errors, warnings, plan, artifacts }` and never calls `process.exit`.
- CLI commands are `inspect`, `plan`, `import`, `sync`, `validate`, and `start`.
- `runWorkflow` accepts injected `runProcess`, `isPortOpen`, and `startServer` functions so tests can exercise behavior without a long-lived server or shell mock.

- [ ] **Step 1: Write the failing tests**

  Cover these exact behaviors:

  - `plan` returns normalized JSON and does not create registry, workspace, or Godot files.
  - `inspect` reports a missing `project.godot` and missing PNG source with `stage: "inspect"` and `ok: false`.
  - `import` constructs an argument array for `tools/import_frames.js` for one clip and `tools/import_batch.js` for two clips; it passes `--replace` only when explicitly requested.
  - `sync` resolves an existing registry project by exact Godot root and delegates to `godot_sync.js` without requiring a second import.
  - `validate` passes `--project` and `--project-root`, returns the parsed validator JSON, and preserves warnings as warnings.
  - `start` returns an existing `http://127.0.0.1:<port>` URL when the port is open and does not spawn a second server.
  - CLI errors are serializable and use a non-zero exit code when invoked with a missing contract.

- [ ] **Step 2: Run the focused test to verify it fails**

  Run:

  ```bash
  node --test tools/tests/animation_production_workflow.test.js
  ```

  Expected: FAIL because the workflow module does not yet exist.

- [ ] **Step 3: Implement the minimal workflow CLI**

  Load and normalize the contract before every command. `inspect` checks the resolved Godot root, `project.godot`, profile/clip ids, source folders, and PNG counts. `plan` only returns normalized data. `import` performs preflight for all clips, then invokes the existing importer with `process.execPath` and argument arrays; one clip uses `tools/import_frames.js`, multiple PNG clips use `tools/import_batch.js`, and unsupported media returns `browser-required` without mutating data. `sync` resolves the registered XSXB project and delegates to `godot_sync.js` without creating a new binding. `validate` invokes `tools/validate_import.js --strict --require-gameplay` and parses its JSON. `start` probes the requested port, reuses it when open, otherwise launches `npm run start:local` with `cwd` set to the tuner root and returns the URL plus the child pid. Avoid shell interpolation and catch spawn, JSON, filesystem, and timeout failures.

- [ ] **Step 4: Run the focused test to verify it passes**

  Run:

  ```bash
  node --test tools/tests/animation_production_workflow.test.js
  ```

  Expected: all workflow tests PASS.

- [ ] **Step 5: Add the package command and run checks**

  Add:

  ```json
  "animation:workflow": "node tools/animation_production_workflow.js"
  ```

  Run:

  ```bash
  node --check tools/animation_production_workflow.js
  npx prettier --check tools/animation_production_workflow.js tools/tests/animation_production_workflow.test.js package.json
  npm run animation:workflow -- --help
  ```

### Task 3: Create the auto-discoverable production skill

**Files:**
- Create: `skills/xsxb-animation-production/SKILL.md`
- Create: `skills/xsxb-animation-production/agents/openai.yaml`
- Create: `skills/xsxb-animation-production/references/animation-contract.md`

**Interfaces:**
- Skill trigger name: `xsxb-animation-production`.
- Skill body must route to `tools/animation_production_workflow.js` for deterministic stages and to `xsxb-frame-tuner` for existing tuner operations.
- Skill must require a final report containing contract path, route, actual media properties, validation evidence, browser-only checks, and blockers.

- [ ] **Step 1: Initialize the skill folder**

  Run the skill creator initializer with the project skill directory and a references resource:

  ```bash
  python3 /Users/sirhao/.codex/skills/.system/skill-creator/scripts/init_skill.py \
    xsxb-animation-production \
    --path skills \
    --resources references \
    --interface display_name="XSXB Animation Production" \
    --interface short_description="Produce and integrate Godot frame animations with AI" \
    --interface default_prompt="Use $xsxb-animation-production to plan, generate or import an animation, sync it to Godot, validate it, and open the local tuner."
  ```

- [ ] **Step 2: Replace the generated body with the project workflow**

  Write imperative instructions under 500 lines. Include the two route decision, project-root safety, contract creation, canonical identity/key-pose rules for generated media, CLI command examples, when to delegate to `xsxb-frame-tuner`, browser-only boundaries, no-fake-success rules, and the final delivery report. Reference `references/animation-contract.md` for the field table rather than duplicating the full schema.

- [ ] **Step 3: Write the compact contract reference**

  Document the supported version-1 fields, defaults, execution values, sample JSON, and the distinction between `in-place` raster loops and runtime root motion. Keep it focused on information future agents need while executing a request.

- [ ] **Step 4: Validate the skill metadata**

  Run:

  ```bash
  python3 /Users/sirhao/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/xsxb-animation-production
  wc -l skills/xsxb-animation-production/SKILL.md
  ```

  Expected: validator exits `0`; the skill body is under 500 lines.

### Task 4: Integrate documentation and run the complete verification set

**Files:**
- Modify: `README.md` (add the project-local AI production command and the new skill to the existing Agent usage section)
- Modify: `docs/superpowers/specs/2026-08-11-ai-animation-production-design.md` only if implementation decisions materially differ from the approved design

- [ ] **Step 1: Add concise README usage examples**

  Document these commands without requiring the user to manually construct importer arguments:

  ```bash
  npm run animation:workflow -- plan --contract <animation-constraints.json> --json
  npm run animation:workflow -- import --contract <animation-constraints.json> --json
  npm run animation:workflow -- sync --contract <animation-constraints.json> --project <xsxb_project_id> --json
  npm run animation:workflow -- validate --contract <animation-constraints.json> --json
  npm run animation:workflow -- start --port 5179 --json
  ```

  Also document that no-source requests are handled by the new skill's generation route and that video/SpriteFrames may require the existing browser/specialized workflow.

- [ ] **Step 2: Run focused tests and project quick checks**

  Run:

  ```bash
  node --test tools/tests/animation_production_contract.test.js tools/tests/animation_production_workflow.test.js
  npm run check:quick
  ```

- [ ] **Step 3: Run the complete relevant import/validation tests**

  Run:

  ```bash
  node --test tools/tests/import_frames.test.js tools/tests/project_inspection.test.js tools/tests/server_validation.test.js tools/tests/animation_production_contract.test.js tools/tests/animation_production_workflow.test.js
  ```

  If one of the optional filenames is absent, run the existing matching import/validation test files listed by `find tools/tests -maxdepth 1 -type f` and record the exact command used.

- [ ] **Step 4: Review the final diff and skill files**

  Run:

  ```bash
  git diff --check
  git status --short
  git diff -- tools/animation_production_contract.js tools/animation_production_workflow.js skills/xsxb-animation-production README.md package.json
  ```

  Confirm no unrelated user changes are staged or overwritten, then report paths and fresh verification evidence.
