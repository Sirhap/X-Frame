# Scatter Slice Box Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make detected scatter-slice rectangles selectable, movable, resizable, numerically editable, and safely deletable before export.

**Architecture:** Add a DOM-free editor core for rectangle geometry and deletion selection, then connect it to the existing scatter-slice page through Pointer Events and a small coordinate inspector. Existing detection, grouping, thumbnail rendering, and export remain the single data pipeline and consume the edited `state.boxes`.

**Tech Stack:** Browser JavaScript, Canvas 2D, Pointer Events, HTML/CSS, Node.js `node:test`, Playwright with Microsoft Edge.

## Global Constraints

- Keep all rectangle coordinates as integer source-image pixels.
- Clamp every rectangle to the source bounds with a minimum size of `1 × 1`.
- Do not add dependencies or perform pixel-level image editing.
- Preserve existing ESLint and Prettier conventions and add JSDoc to new functions.
- Preserve existing user changes in the dirty worktree; only touch files named in this plan.
- All asynchronous browser test operations use Playwright's awaited APIs and existing error reporting.

---

### Task 1: Pure rectangle editor core

**Files:**
- Create: `tools/animation_tuner/public/scatter_slice_editor_core.js`
- Create: `tools/tests/scatter_slice_editor_core.test.js`

**Interfaces:**
- Produces: `normalizeBox(box, bounds)`, `moveBox(box, dx, dy, bounds)`, `resizeBox(box, handle, dx, dy, bounds)`, `pointFromClient(clientPoint, rect, bounds)`, `hitTestBoxes(boxes, point, selectedIndex, handleRadius)`, and `selectionAfterDelete(length, deletedIndex)`.
- `handle` is one of `n`, `ne`, `e`, `se`, `s`, `sw`, `w`, or `nw`; hit results are `{index, action:"move"|"resize", handle?:string}` or `null`.

- [ ] **Step 1: Write failing geometry tests**

```js
test("moving a slice preserves its size and clamps it to source bounds", () => {
  assert.deepEqual(moveBox({ x: 8, y: 5, w: 4, h: 3, pixels: 12 }, 10, -20, { width: 12, height: 10 }), {
    x: 8, y: 0, w: 4, h: 3, pixels: 12,
  });
});

test("all resize handles change only their owned edges", () => {
  assert.deepEqual(resizeBox(box, "nw", -3, -2, bounds), { x: 2, y: 3, w: 13, h: 10, pixels: 130 });
  assert.deepEqual(resizeBox(box, "se", 4, 3, bounds), { x: 5, y: 5, w: 14, h: 11, pixels: 154 });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tools/tests/scatter_slice_editor_core.test.js`

Expected: FAIL because `scatter_slice_editor_core.js` does not exist.

- [ ] **Step 3: Implement geometry and validation**

Use a UMD wrapper matching `scatter_slice_core.js`. Normalize bounds and box values to finite rounded integers, clamp movement, and compute resize edges without allowing an edge to cross its opposite edge.

- [ ] **Step 4: Write failing coordinate, hit-test, and deletion tests**

```js
test("client coordinates map to source pixels and selected handles win hit testing", () => {
  assert.deepEqual(pointFromClient({ x: 60, y: 45 }, { left: 10, top: 5, width: 100, height: 80 }, { width: 200, height: 160 }), { x: 100, y: 80 });
  assert.deepEqual(hitTestBoxes([box], { x: 15, y: 9 }, 0, 2), { index: 0, action: "resize", handle: "e" });
});

test("deletion chooses the next slice then falls back to the previous slice", () => {
  assert.equal(selectionAfterDelete(3, 1), 1);
  assert.equal(selectionAfterDelete(3, 2), 1);
  assert.equal(selectionAfterDelete(1, 0), null);
});
```

- [ ] **Step 5: Run tests and verify RED, then implement and verify GREEN**

Run: `node --test tools/tests/scatter_slice_editor_core.test.js`

Expected before implementation: FAIL on missing exported behavior. Expected after implementation: all editor-core tests PASS.

### Task 2: Editing controls and rendering

**Files:**
- Modify: `tools/animation_tuner/public/scatter-slice.html`
- Modify: `tools/animation_tuner/public/scatter_slice.css`
- Modify: `tools/animation_tuner/public/scatter_slice.js`

**Interfaces:**
- Consumes: Task 1 editor-core functions through `window.XSXBScatterSliceEditorCore`.
- Produces: mutually exclusive `edit` and `sample` modes, `X/Y/W/H` numeric controls, selected-box handles, and unified edit commits.

- [ ] **Step 1: Add the editor script and accessible controls**

Add `#scatterEditMode`, `#scatterSampleMode`, and `#scatterBoxX/#scatterBoxY/#scatterBoxW/#scatterBoxH`. Load `/scatter_slice_editor_core.js` immediately before `/scatter_slice.js`. Buttons use `aria-pressed`; numeric fields are disabled without a selected box.

- [ ] **Step 2: Add layout and visual states**

Style a compact two-button mode switch and four-column numeric inspector. Render eight high-contrast handles on the selected box and set the canvas cursor based on the current hit target.

- [ ] **Step 3: Connect selection and numerical editing**

Add `state.toolMode` and `state.pointerEdit`. Successful detection switches to edit mode. Numerical commits call `normalizeBox`, update the selected object in place, clear `sliceCanvasCache`, rebuild groups while preserving export inclusion, and call `renderAll()`.

- [ ] **Step 4: Connect pointer movement and resizing**

On `pointerdown`, convert coordinates, hit-test handles before box interiors, select the hit box, and capture the pointer. On `pointermove`, call `moveBox` or `resizeBox` from the original rectangle and redraw only the preview. On `pointerup` or `pointercancel`, release capture and commit one regroup/render pass.

- [ ] **Step 5: Unify deletion and keyboard safety**

Extract `deleteSelectedBox()` from the existing button handler. Call it from the button and from `Delete`/`Backspace` only when the event target is not an input, select, textarea, button, link, or contenteditable node.

- [ ] **Step 6: Run focused syntax and unit checks**

Run: `node --check tools/animation_tuner/public/scatter_slice_editor_core.js && node --check tools/animation_tuner/public/scatter_slice.js && node --test tools/tests/scatter_slice_editor_core.test.js tools/tests/scatter_slice_core.test.js tools/tests/scatter_slice_groups.test.js tools/tests/scatter_slice_smart_cutout.test.js`

Expected: all checks PASS.

### Task 3: Browser behavior and project verification

**Files:**
- Create: `tools/tests/e2e/scatter_slice_edit.spec.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: the real `/tools/scatter-slice` page and existing Playwright Edge configuration.
- Produces: a regression test covering real controls, numerical edits, pointer edits, and deletion.

- [ ] **Step 1: Write the failing browser test**

```js
test("detected slices can be edited and deleted before export", async ({ page }) => {
  await page.goto("/tools/scatter-slice");
  await page.locator("#scatterSample").click();
  await expect.poll(() => page.locator(".sliceCard").count()).toBeGreaterThan(0);
  await expect(page.locator("#scatterEditMode")).toHaveAttribute("aria-pressed", "true");

  const originalX = Number(await page.locator("#scatterBoxX").inputValue());
  await page.locator("#scatterBoxX").fill(String(originalX + 3));
  await page.locator("#scatterBoxX").blur();
  await expect(page.locator("#scatterBoxX")).toHaveValue(String(originalX + 3));

  const beforeDelete = await page.locator(".sliceCard").count();
  await page.locator("#scatterPreview").focus();
  await page.keyboard.press("Delete");
  await expect(page.locator(".sliceCard")).toHaveCount(beforeDelete - 1);
});
```

- [ ] **Step 2: Run browser test and verify RED**

Run: `npx playwright test tools/tests/e2e/scatter_slice_edit.spec.js --project=edge`

Expected: FAIL before the editing controls exist.

- [ ] **Step 3: Complete real pointer assertions**

Read the selected X/Y/W/H fields and canvas bounding box, drag the selected rectangle center by a fixed source-pixel delta, then drag its east handle. Assert X changes after movement and W changes after resizing.

- [ ] **Step 4: Register the editor core in focused checks**

Extend `check:scatter-slice` with syntax, Prettier, and `node:test` coverage for `scatter_slice_editor_core.js` and `scatter_slice_editor_core.test.js` without changing unrelated package scripts.

- [ ] **Step 5: Format and run the focused suite**

Run: `npx prettier --write tools/animation_tuner/public/scatter-slice.html tools/animation_tuner/public/scatter_slice.css tools/animation_tuner/public/scatter_slice_editor_core.js tools/animation_tuner/public/scatter_slice.js tools/tests/scatter_slice_editor_core.test.js tools/tests/e2e/scatter_slice_edit.spec.js package.json`

Run: `npm run check:scatter-slice`

Run: `npx playwright test tools/tests/e2e/scatter_slice_edit.spec.js --project=edge`

Expected: focused unit/static suite and Edge browser test PASS with no console errors.

- [ ] **Step 6: Verify the existing running app**

Reload `http://127.0.0.1:5179/tools/scatter-slice`, load the built-in sample, and manually verify edit/sample mode switching, box selection, movement, resize handles, numerical editing, button deletion, keyboard deletion, and group/export state.
