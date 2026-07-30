# Organizer Smart Cutout Stacking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make organizer batch smart cutout visibly open above its owning organizer instead of appearing frozen.

**Architecture:** Represent organizer ownership separately from single/batch editing mode by toggling a `worksetSession` class from `state.sourceKind`. Use that class only for stacking; retain `singleEditSession` for single-image layout semantics.

**Tech Stack:** Browser JavaScript, CSS, Node.js test runner, Playwright.

## Global Constraints

- Preserve the existing workset promise, route, apply/cancel, and focus lifecycle.
- Do not alter unrelated dirty-worktree changes.
- Do not create a commit without explicit user authorization.

---

### Task 1: Express embedded workset state in the UI

**Files:**

- Modify: `tools/animation_tuner/public/batch_cutout_ui_controller.js`
- Test: `tools/tests/batch_cutout_ui_controller.test.js`

**Interfaces:**

- Consumes: `state.sourceKind`, where `"workset"` identifies organizer-owned sessions.
- Produces: `#cutoutModal.worksetSession` while an organizer workset is active.

- [x] **Step 1: Write the failing test**

Add a class-list recording stub and assert that `renderSessionMode()` enables `worksetSession` for a batch workset while leaving `singleEditSession` disabled.

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-name-pattern="batch workset exposes" tools/tests/batch_cutout_ui_controller.test.js`

Expected: failure because `worksetSession` is never toggled.

- [x] **Step 3: Implement the state hook**

In `renderSessionMode()`, derive `const workset = state.sourceKind === "workset"` and call:

```js
elements.cutoutModal.classList.toggle("worksetSession", workset);
```

- [x] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command and expect one passing regression test.

### Task 2: Place organizer worksets above their owner

**Files:**

- Modify: `tools/animation_tuner/public/cutout_shell.css`
- Test: `tools/tests/e2e/tuner.spec.js`

**Interfaces:**

- Consumes: `.cutoutModal.worksetSession` from Task 1.
- Produces: an embedded cutout stacking level greater than the organizer's `1001`.

- [x] **Step 1: Write the failing browser regression**

Import at least two frames, click `#organizerBatchCutout`, wait for both modals, and assert that the numeric computed `z-index` of `#cutoutModal` is greater than that of `#organizerModal`.

- [x] **Step 2: Run the browser regression and verify RED**

Run: `npx playwright test tools/tests/e2e/tuner.spec.js --grep "batch smart cutout stays above" --project=chromium`

Expected: failure with cutout `1000` not greater than organizer `1001`.

- [x] **Step 3: Implement the minimal CSS rule**

Apply `z-index: 1002` to `.cutoutModal.worksetSession`, preserving the existing single-session selector for compatibility.

- [x] **Step 4: Run the browser regression and verify GREEN**

Run the Step 2 command and expect the regression to pass.

### Task 3: Verify the complete change

**Files:**

- Verify all files changed by Tasks 1 and 2.

**Interfaces:**

- Consumes: the UI state hook and stacking rule.
- Produces: fresh test, lint/format, and build evidence.

- [x] **Step 1: Run focused unit tests**

Run: `node --test tools/tests/batch_cutout_ui_controller.test.js tools/tests/batch_cutout_session_controller.test.js tools/tests/frame_organizer_actions.test.js`

- [x] **Step 2: Run formatting and syntax checks**

Run Prettier check on the modified JavaScript, CSS, and test files, followed by `node --check` for the modified JavaScript files.

- [x] **Step 3: Run the project suite**

Run: `npm test`

- [x] **Step 4: Review the final diff**

Confirm the diff contains only the workset class hook, stacking rule, regression coverage, and approved design/plan records.
