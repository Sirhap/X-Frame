# Stage Zoom & Pan Handfeel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make main-stage zoom/pan feel like a normal animation tool: single-step wheel zoom, empty-canvas pan on Transform, middle/Space pan, Ctrl+/- and pinch, preserve custom view on resize.

**Architecture:** Fix duplicate event wiring in `app.js`, then extend `app_events_stage_pointer.js` / `app_keyboard.js` / `app_stage_view.js` using the existing `zoomViewAt` / pan modes. Prefer cutout’s middle/Space pan patterns without adding a Hand tool.

**Tech Stack:** Vanilla JS stage modules, Node test runner, Playwright e2e where pointer behavior needs a browser.

---

## File map

| File | Change |
|------|--------|
| `tools/animation_tuner/public/app.js` | Remove duplicate stage wheel / pointer / keyboard binds |
| `tools/animation_tuner/public/app_events_stage_pointer.js` | Middle pan; Space-drag pan coordination; transform hit-only frame drag |
| `tools/animation_tuner/public/app_stage_view.js` | Preserve custom view on resize; ensure pinch/wheel share path |
| `tools/animation_tuner/public/app_keyboard.js` | Ctrl/Cmd +/- zoom; Space tap vs held-for-pan |
| `tools/animation_tuner/public/app_events.js` | Wire any new keyboard/zoom hooks if needed |
| `tools/animation_tuner/public/index.html` / i18n | Shortcut guide lines |
| `tools/tests/app_stage_view.test.js` (or existing) | Unit coverage |
| `tools/tests/app_events_stage_pointer.test.js` | Hit-test / pan mode coverage |
| `tools/tests/e2e/tuner.spec.js` or focused spec | Regression for wheel double-fire + transform empty pan |

---

### Task 1: Remove duplicate stage listeners

**Files:**
- Modify: `tools/animation_tuner/public/app.js`
- Test: `tools/tests/` stage/events tests (extend or add)

**Steps:**
1. Locate duplicate `wheel` / `lostpointercapture` / `pointerleave` / `keyboardController.bind()` in `app.js` (~3498–3521) that already run via `app_events.js`
2. Write a failing test or assertion that wheel zoom applies a single factor per event
3. Delete the duplicate binds
4. Run the focused unit/e2e check
5. Commit: `fix: stop double-binding stage wheel and keyboard`

### Task 2: Transform empty-canvas pan

**Files:**
- Modify: `tools/animation_tuner/public/app_events_stage_pointer.js`
- Modify: `tools/animation_tuner/public/app.js` (`hitTestDirectManipulationFrame` if hit ignores geometry)
- Test: pointer unit test

**Steps:**
1. Write failing test: transform mode + pointer outside sprite → pan mode
2. Change hit test so frame-transform only starts when pointer hits the sprite
3. Empty primary-drag remains pan
4. Run tests
5. Commit: `fix: pan empty stage while transform tab is active`

### Task 3: Middle-button and Space-drag pan

**Files:**
- Modify: `tools/animation_tuner/public/app_events_stage_pointer.js`
- Modify: `tools/animation_tuner/public/app_keyboard.js`
- Reference: `batch_cutout_ui_controller.js` middle/Space pan

**Steps:**
1. Write failing tests for middle-button pan and Space+drag pan
2. Space tap (no movement past threshold) keeps play/pause
3. Implement middle pan always; Space-drag pan while Space held
4. Run tests
5. Commit: `feat: pan stage with middle mouse and Space-drag`

### Task 4: Ctrl/Cmd +/- and pinch

**Files:**
- Modify: `tools/animation_tuner/public/app_keyboard.js`
- Modify: `tools/animation_tuner/public/app_events_stage_pointer.js` / `app_stage_view.js` if needed for gesture events

**Steps:**
1. Add Ctrl/Cmd + `=`/`+` and `-` → center zoom via existing `setStageZoom`
2. Map trackpad pinch to the same wheel/zoom-at-pointer path (or `gesture`/`wheel` ctrlKey handling as already present in browsers)
3. Tests for keyboard zoom clamps
4. Commit: `feat: add ctrl-plus-minus and pinch zoom on stage`

### Task 5: Preserve custom view on resize + shortcut copy

**Files:**
- Modify: `tools/animation_tuner/public/app_stage_view.js`
- Modify: shortcut guide in `index.html` / `app_i18n.js`

**Steps:**
1. Fail then fix: `stageViewMode === "custom"` resize does not call fit/actual reset
2. Document wheel / middle / Space-drag / Ctrl+/- in shortcut UI
3. Run `npm run check:*` relevant modules + Playwright smoke for stage if present
4. Commit: `fix: keep custom stage view across resize`

### Task 6: Verify and ship notes

**Steps:**
1. Run unit suite for touched modules
2. Run Playwright edge smoke covering stage if available
3. Note: prior uncommitted cutout-source + progress z-index fixes remain separate unless user asks to bundle
