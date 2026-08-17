# Workspace Flow Header Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One 52px route-aware workbench header, plus a always-visible organizer tool strip with loop-find in analysis.

**Architecture:** `XSXBNavigationContext` writes `#workspaceFlowEyebrow`, `#workspaceFlowProject`, save visibility, and `#workspaceFlowBack`. Page identity headers go away. Organizer/cutout click handlers bind to the shared back button. Empty-import CSS no longer hides edit/analysis/remove.

**Tech Stack:** Vanilla JS (node:test), `index.html`, existing shell/organizer CSS.

## Global Constraints

- `--shell-flow-height` stays `52px`.
- Reuse existing i18n keys; do not add a second title vocabulary.
- One theme switch and one account launcher in the flow header.
- `#organizerModal` / `#cutoutModal` use `aria-labelledby="workspaceFlowProject"`.
- Do not hide `.workspaceFlowHeader` on short viewports when tools are open.

---

### Task 1: Navigation context writes the flow header

**Files:**

- Modify: `tools/animation_tuner/public/app_navigation_context.js`
- Test: `tools/tests/app_navigation_context.test.js`

**Interfaces:**

- Consumes: `getRoute()`, `getContext()`, `translate()`, `projectLabel()`, optional `toolTitle(route)`
- Produces: `render()` sets eyebrow, title, `save.hidden`, `back.hidden`, `back.textContent`

- [ ] **Step 1: Write the failing tests** for import, cutout-from-organizer, animation, delivery, standalone, and scatter.
- [ ] **Step 2: Run** `node --test tools/tests/app_navigation_context.test.js` — expect FAIL.
- [ ] **Step 3: Implement** `render()` against `#workspaceFlowEyebrow`, `#workspaceFlowProject`, `#workspaceSaveIndicator`, `#workspaceFlowBack`.
- [ ] **Step 4: Re-run tests** — expect PASS.
- [ ] **Step 5: Commit** after the remaining UI tasks land together.

### Task 2: Single flow-header chrome

**Files:**

- Modify: `tools/animation_tuner/public/index.html`
- Modify: `tools/animation_tuner/public/app_shell.css`
- Modify: `tools/animation_tuner/public/app.js`
- Modify: `tools/animation_tuner/public/app_shell.js`
- Modify: `tools/animation_tuner/public/frame_organizer.js`
- Modify: `tools/animation_tuner/public/frame_organizer_ui.js`
- Modify: `tools/animation_tuner/public/batch_cutout_events.js`
- Modify: `tools/animation_tuner/public/activation_controller.js`
- Modify: `tools/tests/e2e/tuner.spec.js`
- Modify: `tools/tests/activation_controller.test.js`

Move theme + `#workspaceFlowBack` into the flow header. Delete `.organizerHeader`. Replace `.cutoutHeader` with apply/add/close. Strip scatter identity and canvas breadcrumb/theme. Alias organizer/cutout home to `#workspaceFlowBack`. Scatter back navigates via app shell.

### Task 3: Organizer toolbar always visible

**Files:**

- Modify: `tools/animation_tuner/public/index.html`
- Modify: `tools/animation_tuner/public/responsive.css`
- Modify: `tools/animation_tuner/public/organizer_shell.css`
- Modify: `tools/animation_tuner/public/app_shell.css`
- Modify: `tools/animation_tuner/public/frame_organizer_grid.js`
- Modify: `tools/animation_tuner/public/frame_organizer_ui.js`
- Modify: `tools/animation_tuner/public/frame_organizer.js`
- Modify: `tools/animation_tuner/public/frame_organizer_text.js`
- Modify: `tools/tests/frame_organizer_ui.test.js`
- Modify: `tools/tests/frame_organizer_grid.test.js`
- Modify: `tools/tests/e2e/tuner.spec.js`
- Modify: `tools/tests/e2e/closed_loops.spec.js`

Move `#organizerFindLoop` into `.organizerAnalysisTools`. Delete empty-import and `showMoreTools` hide rules. Remove `#organizerMoreTools`. Keep disable rules. Update empty-workset copy.

### Task 4: Verify

Run `node --test tools/tests/app_navigation_context.test.js tools/tests/frame_organizer_ui.test.js tools/tests/frame_organizer_grid.test.js tools/tests/activation_controller.test.js` plus prettier/node --check on touched JS.
