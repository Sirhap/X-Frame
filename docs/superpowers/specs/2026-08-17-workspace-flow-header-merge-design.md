# Workspace Flow Header Merge Design

## Problem

Workbench pages stack two identity headers. `#workspaceFlowHeader` already shows the project name, save state, stage tabs, stage tools, and account. The page header under it (`organizerHeader`, `cutoutHeader`, scatter title block, animation `#workspaceBreadcrumb`) repeats the project name and adds a second theme switch, a second account chip, breadcrumbs, and a decorative eyebrow (`SEQUENCE DESK / LOCAL`). The duplicate chrome steals vertical space and makes the current page feel like two apps stacked together.

## Goal

All workbench surfaces share one 52px flow header. The left cluster and the far-right actions change with the current route. Page-specific second headers that only repeat identity are removed. Task controls that belong to the work stay in the workbench.

## Header Slots

Keep `#workspaceFlowHeader` as the only workbench chrome row. Column order does not change:

1. **Context** — stage eyebrow + current title + save indicator.
2. **Stages** — 资源处理 / 动画编辑 / 交付与导出. Existing markup and `data-workspace-stage` sync stay as they are.
3. **Stage tools** — already swap by stage. No new tool list.
4. **Chrome** — one theme switch, `#workspaceAccount`, and `#workspaceFlowBack`. The back button is visible only on resource tool pages. Existing organizer/cutout home click handlers bind to this id instead of `#organizerHome` / `#cutoutHome`.

`--shell-flow-height` stays `52px`. Do not grow the bar to fit the old 22–24px page titles.

## Context Mapping

`XSXBNavigationContext` writes the context cluster from the same route and project inputs it already uses. Reuse existing i18n strings. Do not add a second title vocabulary.

| Route | Eyebrow | Title | Save indicator | Back |
| --- | --- | --- | --- | --- |
| `organizer` / import | `stageResources` | organizer `importTitle`（导入与处理动画） | hidden | existing organizer home label |
| `cutout` | `stageResources` | existing cutout title（批量抠图） | hidden | existing cutout home label |
| `scatter` | `stageResources` | `scatterSliceTitle` | hidden | return to tuning / quick tools, same rules as organizer |
| `animation`, `boxes`, `trails`, `audio`, `attachments` | `stageAnimation` | active project label | visible | hidden |
| `export`, `godot`, `codex-pet` | `stageDelivery` | active project label | visible | hidden |

Browser-session projects still use `browserSessionProject`. The project name appears once, in the title slot on animation and delivery pages. It must not also appear in a breadcrumb under the bar.

## What Leaves the Page Headers

- Remove `#workspaceBreadcrumb`, `#organizerBreadcrumb`, and `#cutoutBreadcrumb` from the visible chrome. Navigation context no longer renders those hosts.
- Delete `.organizerHeader` entirely. Its back, theme, and account controls move into the flow header; the import subtitle stays in the existing content intro.
- Replace `.cutoutHeader` with a compact action row that only contains `cutoutApplyGroup` and `cutoutAddProject`. Do not keep breadcrumb, `ALPHA LAB / LOCAL`, visible `h2`, subtitle, or theme switch.
- In `scatterIntegratedHeader`, remove the decorative eyebrow, visible `h1`, and intro paragraph. Keep `scatterProgress` and `#scatterResultSummary`.
- In the animation canvas toolbar, remove the breadcrumb and the theme switch. Keep canvas color, playback, ghost, undo, and the hint line.

Organizer and cutout import/workflow copy that already lives in the content band (`#organizerSubtitle` / import intro) stays there. It does not move into the flow header.

`#organizerModal` and `#cutoutModal` keep `aria-labelledby="workspaceFlowProject"`. There is no second visible or visually hidden page title.

## Account and Theme

`#workspaceAccount` remains the only account launcher. It already forwards to `#activationManage`. Delete `#organizerActivationManage` and stop mirroring status onto that chip in `activation_controller.js`. Session detail stays inside the account panel.

One theme switch lives in the flow header. Existing `[data-theme]` binding in `app_dom.js` / `app_events.js` / `app_project_state.js` keeps working against that single set. Do not leave duplicate theme buttons in organizer, cutout, or the canvas toolbar.

## Dynamic Update

`app_shell.js` already writes `data-workbench`, `data-workspace-stage`, `data-workspace-tool`, and `data-app-surface`. The flow header reads those attributes for stage/tool highlighting.

`XSXBNavigationContext.render()` becomes the writer for:

- eyebrow text
- `#workspaceFlowProject` text
- save-indicator hidden/shown
- back-button label, href/action, and hidden/shown

Bind and destroy stay on `xsxb:routechange`, `popstate`, and `body.class` mutations. Organizer/cutout open classes still decide the cutout back label (`returnOrganizer` vs `returnTuning` / `returnQuickTools`).

Do not add a second header controller.

## Responsive

The current short-viewport rule that sets `display: none` on `.workspaceFlowHeader` when organizer or cutout is open must be removed. After the merge that bar is the only identity and back control.

On narrow widths, shrink stage-tool padding first, then ellipsis the context title. Do not wrap the bar onto two rows and do not change `--shell-flow-height`.

Projects and quick-tools surfaces continue to hide the flow header, as they do today.

## Error Handling and Edge Cases

- Standalone / quick-tools context keeps the existing return labels (`returnQuickTools`) when a tool page is reached from `/tools`.
- Cutout opened from organizer still uses `returnOrganizer`. That label belongs on the flow-header back control, not on a second header.
- Missing project label falls back to `currentProject`, same as today’s breadcrumb logic.
- Save-indicator status values (`saving`, `error`, `conflict`) are unchanged; only visibility is route-based.
- Scatter remains a resource-stage tool. Its progress steps are body chrome, not flow-header tabs.

## Verification

- Rewrite `app_navigation_context.test.js` to assert eyebrow, title, save visibility, and back label for import, cutout-from-organizer, animation, delivery, and standalone/quick-tools.
- Update the organizer e2e that expects `#organizerTitle` to assert `#workspaceFlowProject` instead.
- Add or extend a focused UI assertion that the organizer/cutout/scatter identity header is gone and that theme buttons exist only in the flow header.
- Run the navigation-context unit tests, the updated e2e selector, formatting/static checks, and the project test suite.
