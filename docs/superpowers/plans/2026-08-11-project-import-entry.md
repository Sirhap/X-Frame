# Project Import Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route empty animation projects to the project-scoped video/image import flow and keep populated projects opening directly in the tuning workbench.

**Architecture:** Add a derived `animationGroupCount` to server and browser project summaries. Keep routing decisions inside `app_mode_hubs.js`, where project cards and the recent-project CTA already share one renderer, and use the existing `/workspace/tools/organizer` route for project-owned import. Missing statistics preserve the current `/workspace` behavior for compatibility.

**Tech Stack:** Browser JavaScript modules, Node.js `node:test`, Playwright E2E, local project manifest files, Cloudflare static build.

## Global Constraints

- Keep video decoding and frame extraction inside the existing organizer; do not duplicate media-processing logic in the project hub.
- Empty projects must use `/workspace/tools/organizer?project=<id>` so imported frames stay in the selected project.
- Populated projects must use `/workspace?project=<id>`.
- Missing or invalid `animationGroupCount` must preserve the existing `/workspace` deep-link behavior.
- Every production async path touched by the change must retain explicit error handling.
- Follow the repository's existing JSDoc, Prettier, Node test, and Playwright conventions.

---

### Task 1: Expose animation-group counts in project summaries

**Files:**
- Modify: `tools/animation_tuner/server_project_view.js:92-180`
- Modify: `tools/animation_tuner/public/browser_runtime.js:500-625`
- Test: `tools/tests/server_project_view.test.js`
- Test: `tools/tests/browser_runtime.test.js`

**Interfaces:**
- `server_project_view` will return every client project with `animationGroupCount: number` derived from its manifest.
- Browser runtime will return every session project with `animationGroupCount: number` derived from its stored config groups.
- Existing config payloads remain valid; the new field is additive.

- [ ] **Step 1: Write the failing server summary test**

Add a `project view exposes animation group counts for project cards` test with two registry projects. Inject `readManifest` so one project has one animation with one frame and the other has no frames, then assert:

```js
assert.deepEqual(
  response.projects.map((project) => [project.id, project.animationGroupCount]),
  [
    ["ready", 1],
    ["empty", 0],
  ],
);
```

- [ ] **Step 2: Run the server test and verify it fails for the missing field**

Run:

```bash
node --test tools/tests/server_project_view.test.js
```

Expected: the new assertion fails because project summaries do not yet contain `animationGroupCount`.

- [ ] **Step 3: Write the failing browser-summary test**

Extend the browser runtime test fixture to commit a config containing one group, then assert the returned project summary reports one group:

```js
const snapshot = runtime.getSessionProjectConfig("browser-session");
assert.equal(snapshot.projects[0].animationGroupCount, 1);
```

- [ ] **Step 4: Run the browser runtime test and verify the new assertion fails**

Run:

```bash
node --test tools/tests/browser_runtime.test.js
```

Expected: the new assertion fails because the session registry currently has no derived group-count field.

- [ ] **Step 5: Implement server-side summary metadata**

Add a focused helper in `server_project_view.js` that counts manifest animations containing at least one usable frame, and use it for both `configResponse().projects` and `projectsResponse()`. Do not change the active `groups` payload or the existing project-store schema.

- [ ] **Step 6: Implement browser-session summary metadata**

Add a helper that maps `sessionRegistry.projects` to cloned summaries and reads the matching config from `sessionProjects`. Use it in `createEmptyConfig`, `getSessionProjectConfig`, and `commitSessionProjectConfig`, so IndexedDB hydration and post-import updates expose the same field.

- [ ] **Step 7: Run both focused tests and confirm they pass**

Run:

```bash
node --test tools/tests/server_project_view.test.js tools/tests/browser_runtime.test.js
```

Expected: all tests pass.

- [ ] **Step 8: Commit the metadata change**

```bash
git add tools/animation_tuner/server_project_view.js tools/animation_tuner/public/browser_runtime.js tools/tests/server_project_view.test.js tools/tests/browser_runtime.test.js
git commit -m "feat: expose project animation counts"
```

### Task 2: Route empty project cards to the import flow

**Files:**
- Modify: `tools/animation_tuner/public/app_mode_hubs.js:10-118`
- Modify: `tools/animation_tuner/public/app_i18n.js:110-125,454-471`
- Test: `tools/tests/app_mode_hubs.test.js`

**Interfaces:**
- `projectAnimationGroupCount(project, config, activeProjectId)` returns `number | null`.
- `projectHref(project, config, activeProjectId)` returns a project-scoped import URL for count `0`, a workspace URL for count `>0`, and the legacy workspace URL for `null`.
- Project cards expose `data-project-state="needs-import"` or `data-project-state="ready"` when the count is known.

- [ ] **Step 1: Write failing mode-hub tests**

Add tests for the new routing behavior:

```js
test("empty project cards open the project-scoped importer", () => {
  controller.renderProjects({
    activeProjectId: "empty",
    groups: [],
    projects: [{ id: "empty", label: "Empty", animationGroupCount: 0 }],
  });
  const card = fixture.elements["#projectHubList"].children[0];
  assert.equal(card.href, "/workspace/tools/organizer?project=empty");
  assert.equal(card.dataset.projectState, "needs-import");
});

test("populated project cards continue to the tuning workbench", () => {
  controller.renderProjects({
    activeProjectId: "ready",
    groups: [{ name: "idle" }],
    projects: [{ id: "ready", label: "Ready", animationGroupCount: 2 }],
  });
  assert.equal(fixture.elements["#projectHubContinue"].href, "/workspace?project=ready");
});
```

Also retain the existing missing-field test to prove legacy projects still use `/workspace`.

- [ ] **Step 2: Run the mode-hub tests and verify the new tests fail**

Run:

```bash
node --test tools/tests/app_mode_hubs.test.js
```

Expected: empty projects still produce `/workspace?project=empty`, and no project-state data attribute is present.

- [ ] **Step 3: Implement state-aware project links and copy**

Update `app_mode_hubs.js` so the recent-project CTA and cards call the same `projectHref` helper. Add localized strings for “导入视频 / 图片序列 →” and “还没有动画帧 · 可从视频抽帧或导入 PNG”, plus English equivalents. Keep all DOM creation through the existing element API.

- [ ] **Step 4: Run the mode-hub tests and confirm they pass**

Run:

```bash
node --test tools/tests/app_mode_hubs.test.js
```

Expected: empty, populated, and unknown-stat project cases all pass.

- [ ] **Step 5: Commit the navigation change**

```bash
git add tools/animation_tuner/public/app_mode_hubs.js tools/animation_tuner/public/app_i18n.js tools/tests/app_mode_hubs.test.js
git commit -m "fix: route empty projects to import"
```

### Task 3: Verify the complete project-to-import workflow

**Files:**
- Modify: `tools/tests/e2e/tuner.spec.js:136-166`
- Modify: `tools/tests/e2e/tuner.spec.js` only if the existing project fixture needs an isolated empty-project setup.

**Interfaces:**
- Project-center links expose a stable `data-project-state` attribute for browser assertions.
- `/workspace/tools/organizer?project=<id>` continues to open the existing organizer modal in project navigation context.

- [ ] **Step 1: Add an E2E assertion for an empty project card**

Open `/projects`, locate `[data-project-state="needs-import"]`, click it, and assert both the `project` query parameter and `#organizerModal` visibility. Assert that the tuning canvas is not the first visible surface for that navigation.

- [ ] **Step 2: Run the focused E2E test and fix only test-fixture setup if needed**

Run:

```bash
npx playwright test tools/tests/e2e/tuner.spec.js --grep "empty project"
```

Expected: the project-scoped organizer is visible and the URL keeps the selected project ID.

- [ ] **Step 3: Run the complete unit suite and formatting checks**

Run:

```bash
npm test
npm run check:syntax
npx prettier --check tools/animation_tuner/public/app_mode_hubs.js tools/animation_tuner/public/browser_runtime.js tools/animation_tuner/server_project_view.js tools/tests/app_mode_hubs.test.js tools/tests/browser_runtime.test.js tools/tests/server_project_view.test.js
```

Expected: zero failures and no formatting changes required.

- [ ] **Step 4: Run Cloudflare checks and verify the generated routes**

Run:

```bash
npm run check:cloudflare
```

Expected: the static build still produces the landing page at `/`, the workbench at `/workspace`, and the project-scoped organizer route remains available.

- [ ] **Step 5: Review the final diff and commit the E2E/verification changes**

```bash
git diff --check
git status --short
git add tools/tests/e2e/tuner.spec.js
git commit -m "test: cover empty project import entry"
```

## Plan self-review

- The design requirement for empty-project routing is covered by Tasks 1–3.
- The requirement to preserve populated-project and legacy deep links is covered by Task 2 tests.
- Server and IndexedDB/browser-only data paths are both covered by Task 1.
- Video extraction remains in the existing organizer; no duplicate media code is introduced.
- No `TBD`, `TODO`, or unspecified implementation steps remain.
