# Design: `xsxb_plan_place` — 图度自检后再贴图

Date: 2026-08-29  
Status: implemented  
Branch: `cursor/plan-place-brief-857a`

## Goal

用户确认「把两张图合一下」之后，agent 不得直接 `xsxb_place_image`。先完成一次 **图度自检**（读图 → 物理规则/验收 → 短方案），再按方案贴图。字段与流程保持 **通用**（人物+武器只是例子，不是订制配方）。

## Decisions (locked)

| Topic                | Choice                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Flow                 | **C**：读图 → 物理规则 + 验收 → 3～5 步方案 → 再 place                                    |
| Where                | **C**：skill / INSTRUCTIONS **强制**；MCP 提供可选计划工具；`xsxb_place_image` **不硬拦** |
| User confirm         | **C**：默认写完自检就执行；仅当用户说「先方案再贴」或 `await_confirm: true` 时停下等确认  |
| Implementation shape | **2**：新工具 `xsxb_plan_place`，镜像 `xsxb_plan_smear`（编译 `brief`，不写合成图）       |

## What 「图度」 means

**图度** = 动手前必须落盘（回执）的「这张合成在干什么、怎样算对」：

1. **读图** — 两张图上各自的接触部位、朝向/遮挡直觉（可带已 overlay 的 cell ids）
2. **物理规则** — 画面须遵守的约束（接触重合、姿态朝向、相对比例、前后层、工具不重画……）
3. **验收** — 合成后在 `verify_overlay` 上看什么算过
4. **短方案** — 3～5 步可执行动作（overlay → snap → scale/rotation/layer → verify → 可选 nudge）

不是领域订制 playbook（禁止「持刀 `measure_t≈0.15`」这类固定捷径写进图度模板）。

## Tool: `xsxb_plan_place`

### Role

- 校验并规范化 agent 的自检内容，编译 `receipt.brief`。
- **不**读取像素做 VLM；**不**写合成 PNG；坐标仍由后续 `overlay_grid` / `place_image` 解析。
- 与 `xsxb_plan_smear` 同骨架：catalog schema + 独立 compile 模块 + service 挂载。

### Input (generic)

| Field           | Required | Notes                                                                                                                                         |
| --------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `target_path`   | yes      | Target PNG under XSXB root                                                                                                                    |
| `object_path`   | yes      | Object PNG under XSXB root                                                                                                                    |
| `intent`        | yes      | One-line task (user wording or rewrite); min length enforced                                                                                  |
| `read`          | yes      | Object: `target_contact`, `object_contact` (strings); optional `target_cells` / `object_cells` (speakable ids); optional `notes`              |
| `physics`       | yes      | Non-empty string array (rules). Soft-check: reject empty; warn if fewer than 2                                                                |
| `accept`        | yes      | Non-empty string array (pass criteria)                                                                                                        |
| `plan`          | yes      | Array of 3–5 step strings (or objects `{step, detail}`)                                                                                       |
| `await_confirm` | no       | Boolean; default false. When true, receipt flags pause-before-place                                                                           |
| `proposed`      | no       | Optional draft of place args intent only: `layer`, `snap` hint (`alpha_centroid` preferred), rotation/scale **as prose** — not freehand `x,y` |

Schema: `additionalProperties: false`. Coerce `"true"`/`"false"` like other MCP tools. No domain keys (`hand`, `grip`, `weapon`, …).

### Output

```text
{
  brief: string,           // executable short brief for the agent
  intent, read, physics, accept, plan,
  await_confirm: boolean,
  proposed: object | null,
  warnings: string[],      // e.g. plan length, thin physics
  next: "await_user" | "place"  // derived from await_confirm
}
```

`brief` must state:

- Execute this brief; generic place skeleton is not enough alone.
- Use speakable cells + `snap: "alpha_centroid"` on contact patches; never freehand `x,y`.
- Tool composites only — does not redraw.
- If `await_confirm`, do not call `xsxb_place_image` until the user confirms.

### Hard rules for the compiler

- Reject freehand numeric `x`/`y` if somehow passed under `proposed`.
- Reject empty `intent` / `physics` / `accept` / `plan`.
- `plan.length` must be 3–5 inclusive.
- Cell ids in `read.*_cells`, if present, must match speakable grid ids (same regex as overlay).
- Paths must resolve inside the XSXB root (reuse existing path helpers); files must exist.

## Skill / INSTRUCTIONS gate

After user confirms a still-image composite:

1. Overlay both images (agent is the eye).
2. Fill and call `xsxb_plan_place` with 图度 fields.
3. If `receipt.next === "await_user"` **or** user previously asked for plan-first → show `brief`, wait.
4. Else execute `brief`: `xsxb_place_image` with contact-cell `alpha_centroid` snaps, then inspect `verify_overlay_path`.
5. Optional `nudge` / re-plan if verify fails rules in `accept`.

`xsxb_place_image` stays callable without `plan_id` (no hard gate). Skill text + INSTRUCTIONS + catalog description **require** the plan call for agent-led composites.

Bulk / trivial “stamp at known cells already planned” may skip only when the agent already has a prior `xsxb_plan_place` receipt for the same pair in-session — still no silent freehand.

## Non-goals

- No VLM inside MCP.
- No forcing `plan_id` on `xsxb_place_image` in v1.
- No sword/forearm/`measure_t≈0.15` recipes in brief templates.
- No redrawing hands/fingers; physics may state “closed fist reads as held; open palm stays open”.

## Module layout

| File                                                                            | Duty                                                 |
| ------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `tools/xsxb_mcp_place_brief.js`                                                 | `compilePlaceBrief(args)`                            |
| `tools/xsxb_mcp_tool_catalog.js`                                                | schema + name in `MCP_TOOL_NAMES` (near place tools) |
| `tools/xsxb_mcp_service.js`                                                     | wire handler                                         |
| `tools/xsxb_mcp_server.js`                                                      | INSTRUCTIONS one-liner pointing at plan-before-place |
| `skills/xsxb-frame-tuner/SKILL.md` + `references/media-and-tuning-workflows.md` | 图度 flow                                            |
| `mcp/README.md`                                                                 | short bullet                                         |
| `tools/tests/xsxb_mcp_place_brief.test.js`                                      | unit tests (failing first)                           |

Reuse path validation patterns from place/overlay; do not invent a second grid parser — import cell helpers from `xsxb_mcp_place.js` if exported, or share a tiny require of existing parsers.

## Testing

1. **Compiler**: valid minimal args → `brief` contains contact / `alpha_centroid` / does not redraw; `next` flips with `await_confirm`.
2. **Rejects**: empty physics, plan length 2 or 6, bad cell id, escaped path, freehand xy in proposed.
3. **Generic**: catalog description + brief template `doesNotMatch` held-weapon fast path / forearm / fixed `measure_t~0.1`.
4. **Catalog**: tool listed; schema `additionalProperties: false`; wired in service.
5. **INSTRUCTIONS / skill**: mention `xsxb_plan_place` before place for still composites.
6. No Playwright required for v1 (no UI); unit + schema tests suffice unless a future Tuner panel appears.

## Example (illustrative only — not a canned recipe)

User: 「这两张合一下。」  
Agent overlays → reads fist cells / handle cells →

```json
{
  "intent": "Composite object onto target at the contact patches so they read as one held piece",
  "read": {
    "target_contact": "opaque mass of the closed hand",
    "object_contact": "opaque mass of the handle segment",
    "target_cells": ["E5"],
    "object_cells": ["C4", "C5"]
  },
  "physics": [
    "Contact opaque centroids coincide",
    "Object long axis follows the observed limb pose, not source-upright by default",
    "Scale from a named body span on the target, not full-canvas width",
    "Layer under_target if the hand must occlude the grip",
    "Composite only — do not invent wrapping fingers"
  ],
  "accept": [
    "verify_overlay shows handle mass through the hand contact cells",
    "Object does not float a full cell away from the contact patch"
  ],
  "plan": [
    "crop_from contact regions if cells are coarse",
    "place with both anchors snap alpha_centroid",
    "set rotation/scale/layer from the pose read above",
    "inspect verify_overlay_path",
    "nudge only if accept fails by a few pixels"
  ]
}
```

Then place per `brief`.

## Rollout

1. Spec approval (this doc).
2. Implementation plan via writing-plans.
3. TDD: tests → `compilePlaceBrief` → catalog/service/docs.
4. Keep prior place-snap PR independent; this branch can merge after or alongside.

## Open for review

Only product call left for the reader: confirm this doc matches intent. No further design forks planned unless review requests changes.
