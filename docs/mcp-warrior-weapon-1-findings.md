# 战士皮肤武器1 · MCP 实测报告

> MCP 实现已迁到 [x-frame-mcp](https://github.com/Sirhap/x-frame-mcp)。本文是当时的实测记录。

日期：2026-09-03  
路径：user-xsxb MCP（会话刚 reload），不是 Node 单元测试。  
素材：站姿人+刀 JPG、单独斜置冰剑 JPG（皆 1408×1408 黑底）、挥砍片 MP4（944×944，6.04s，145 帧 @24fps）。  
项目：活 Tuner 里没有 `warrior`，MCP 也没有 `create_project`。两半都落到现成项目 `test`。静图省略 `project_id` 打到它；挥砍片仍显式传 `test`，避免抢 active。

静图半：JPG 转 PNG 后进 `workspace/projects/test/warrior-weapon-1/`，未导视频。  
挥砍片半：原片前 0.8s 是蓄力站姿；先用这段证明 import，再 `replace` 成 **1.6–2.4s @10fps 320×320**（8 帧）才盖到过顶→下劈→冰花。后续动画用例都在这 8 帧上。全量 145×944 未导（慢，不挡主路径）。

分半底稿仍在：`docs/mcp-warrior-weapon-1-findings-still.md`、`docs/mcp-warrior-weapon-1-findings-clip.md`。用例定义见 `docs/mcp-warrior-weapon-1-cases.md`。

---

## 1. 结论

主路径能走通：接入 → 抠黑底 → 静图格子/图度贴合 → 挥砍分析/种脚/导出/plan_smear，工具链没有在中途断掉。最大坑有两处，都会交出「看起来成功、几何是错的」回执——静图斜置冰剑被 `measure_image` 锁成竖直轴（pommel/tip 落在透明像素），挥砍着地帧把冰花下沿当成靴底，种脚跟着种歪。

---

## 2. 用例结果表

共 24 条 W1-*。两半互补：静图半未跑动画项，挥砍片半未跑静图贴合项；合起来没有 blocked。

| 用例 | 半边 | 结果 | 备注 |
| --- | --- | --- | --- |
| W1-1-1 列出项目并设为当前 | 挥砍片 | pass | 无 `warrior` 夹具，借用 `test` |
| W1-1-2 导入挥砍片 | 挥砍片 | pass | 视频 `in_place` 硬失败（符合）；窗口是 1.6–2.4s，不是片头 0.8s |
| W1-1-3 静图进工作区 | 静图 | pass | JPG 会拒（`file_path must be a PNG`）；PNG 可 overlay/cutout |
| W1-2-1 站姿人抠黑底 | 静图 | pass | `confirmed`；透明比 0.8973；源 RGB 未覆盖；冰蓝还在 |
| W1-2-2 单独刀抠黑底 | 静图 | pass | `confirmed`；透明比 0.8671；斜剑/柄/浮冰还在 |
| W1-2-3 已抠过再抠是 noop | 静图 | pass | `suspected_noop`，skip，不当失败；源图未误标 noop |
| W1-2-4 动画帧抠黑底 | 挥砍片 | pass | 8 帧 `confirmed`/`keyed=true`；刀和霜还在。`receipt=full` 时 `inspectFeet=null` |
| W1-3-1 analyze 一次出预览 | 挥砍片 | pass | `applied:false`；有 `preview.path`；未对每个候选再 export_sheet |
| W1-3-2 挥砍片当 one-shot 看 | 挥砍片 | pass | `oneShotLikely=true`；未 reorganize 成循环 |
| W1-4-1 overlay 站姿抠完图 | 静图 | pass | `overlay_id` 合格，格宽 176→`next=crop_from`。默认 overlay 写到 Tuner `workspace/.xsxb/` |
| W1-4-2 crop_from 手部接触格 | 静图 | pass | 新人眼格 D3；新 id。默认名覆盖父 overlay 文件 |
| W1-4-3 换图后旧 overlay_id 硬失败 | 静图 | pass | `STALE_OVERLAY`，未静默贴错图 |
| W1-4-4 省略 overlay_id（兼容） | 静图 | pass | 能合成；warning：未做新鲜度校验 |
| W1-4-5 量单独刀 | 静图 | **fail** | 斜剑被锁成竖直轴；pommel/tip/t=2/3 像素透明 |
| W1-4-6 量人脚（静图） | 静图 | pass | `alpha_bottom` 图像素，未混进动画 `y=-1` |
| W1-4-7 图度再 place | 静图 | pass | 第一次 `object_cells`+`measure_t` → `PLAN_MISMATCH`；第二次不填格子才贴上。`verify=unverified`（aspect warning）。视觉上是叠刃，不是换刀 |
| W1-4-8 plan 错配 | 静图 | pass | 错 layer / 错 derive → `PLAN_MISMATCH`，未按错参数贴完 |
| W1-5-1 量动画帧 | 挥砍片 | **fail** | 蓄力帧 feetY 还像靴底；着地帧 6–7 把冰花下沿当鞋底 |
| W1-5-2 种脚到 y=-1 | 挥砍片 | pass | 种到组坐标 `y=-1`，不是黄点 0,0。被 5-1 带脏：着地帧冰花贴底、身子偏高 |
| W1-5-3 估比例 | 挥砍片 | pass | `groupScale=0.95`，`applied:false`；未当成已锁脚/已烤 PNG |
| W1-6-1 联系表（机器格子） | 挥砍片 | pass | `lastPixel.group.y === -1`。`divs.x=8` 但 cells 只有 col 0–6 |
| W1-6-2 给人看的表 | 挥砍片 | pass | `grid:false`；刀光以这张为准 |
| W1-6-3 GIF | 挥砍片 | pass | `GIF89a`，品红底，8 帧。弓形拖影仍以 human sheet 为准 |
| W1-7-1 plan_smear | 挥砍片 | pass | overlay 的是帧 PNG；只有 brief，无 smear PNG、无 GenerateImage。320 帧仍喊 `crop_from` |

---

## 3. Bug

只收两份底稿 Bugs 节里写过的项。缺口（没有 `create_project`、`import_video` 没有时间窗、file_path 抠图回执缺透明比）放第 5 节，不当新 bug。

### B1. 斜置武器测成竖直轴（静图 W1-4-5）

- **严重度：** P1 挡主路径（刀侧 `measure_t` 贴合建立在这条轴上）
- **现象：** 对角冰剑的 pommel / tip / t=2/3 都落在透明像素；回执轴是画布竖线，不是刀轴。
- **复现：** `xsxb_measure_image`，`file_path` = 抠完的 `sword_cut.png`，`t="2/3"`（`0.25` 同样竖直）。刀 bbox 约 732×1262。
- **期望 vs 实际：** 期望有限坐标且落在刃/柄上，轴长 > 20，厚端柄、薄端尖。实际 `direction={0,-1}`，`pommel={693.4,1325}`，`tip={693.4,63}`，`length=1262`。`measureLongAxis` 在 `extentY >= extentX * 1.15` 时跳过 PCA、强制竖直。人眼轴是底左柄 → 顶右尖。`t=0.25` 的 `at` 碰巧不透明，但不是柄。

### B2. 着地帧 feetY 把冰花当下沿靴底（挥砍片 W1-5-1）

- **严重度：** P1 挡主路径（种脚吃的就是这个数）
- **现象：** 帧 6–7（着地冰花）`feetY` 几乎等于 bbox 底；行采样 y=257–272 几乎全是冰蓝冰花。
- **复现：** `xsxb_measure_frames`，`project_id=test` `profile_id=mcp_imports` `animation_id=ice_slash`。随后 `xsxb_plant_feet`。
- **期望 vs 实际：** 期望靴底，连着的亮刀光/冰花不算（skill 原文）。实际帧 0–5 为 225–234（靴底附近）；帧 6/7 为 267/268。apply 后所有帧 `feetY=319`（最后一行 = `y=-1`），但着地帧是冰花贴底，身子相对蓄力帧偏高。dry_run 里帧 6–7 的 `dy` 只有 51–52，蓄力帧是 85–94。

### B3. `plan_place` 的 `object_cells` 卡死 `measure_t`（静图 W1-4-7）

- **严重度：** P2 错结果（校验把读图笔记当成必须出现的 anchor cells）
- **现象：** 按用例「眼睛看到的刀柄格写入 brief，place 用 `measure_t`」第一次直接 `PLAN_MISMATCH`。
- **复现：** `xsxb_plan_place` `read.object_cells=["C7"]` → `plan_id=pln_dc245ee4fd2f`；`xsxb_place_image` 带该 id，`object_anchor.measure_t=0.25`（无 cells），`layer=under_target`。
- **期望 vs 实际：** 期望 `object_cells` 只是读图笔记，catalog/用例允许刀侧 `measure_t`。实际 `assertPlanMatches` 在 `object_cells` 非空时要求 `object_anchor.cells` 同集，与 `measure_t` 不能组合。workaround：brief 里不填 `object_cells`（第二次 `pln_194fd0830df8` 才贴上）。

### B4. 相对缩放一条边就永远 `unverified`（静图 W1-4-7）

- **严重度：** P2 错结果（几何检查过了，验收信号被警告打掉）
- **现象：** place 写出合成图，`anchor_mapped` / `snap_opaque` / `under_target_cover` 皆 ok，但 `verify.status=unverified`。
- **复现：** `xsxb_place_image` + `scale.relative` 按全图身高 D3–E7 缩一把边。
- **期望 vs 实际：** 期望几何过了可以 `confirmed`，警告留在 `warnings`。实际 `aspect mismatch: scaled by one edge, not stretched` 经 `scaleWarning` 直接降级。不是 `suspected_noop`。

### B5. 动画 sheet `8×8` 缺最后一列（挥砍片 W1-6-1）

- **严重度：** P2 错结果（最右格写不回 JSON）
- **现象：** `divs.x=8`，每行只有 col 0–6，没有 col 7（group `x=120`）。
- **复现：** `xsxb_export_sheet` `grid_divs=8x8`，动画 `ice_slash`（320×320，种脚后）。
- **期望 vs 实际：** 期望 8 列组坐标都能写回。实际 7 列。人眼 sheet 上种地网格、黄 0,0、底边 -1 都在；缺的是 JSON 最右列。

### B6. 种脚按 feetY 平移会裁掉靴下挂冰（挥砍片 W1-5-2）

- **严重度：** P2 错结果（轮廓被移出画布）
- **现象：** 蓄力帧种完后，靴底贴底，但原先挂在靴下的冰晶出画。
- **复现：** `xsxb_plant_feet` `apply=true` `target_y=-1`。帧 0：种前 maxY=254、feetY=225；种后 maxY=319，bboxH 196→167。
- **期望 vs 实际：** 期望靴底到最后一行，靴/冰晶轮廓还在。实际测量点以下约 29px 被移出 320 画布。种的是测量鞋底，不是不透明最底。与 B2 独立：蓄力帧 feetY 并未吃冰花，照样裁。

### B7. overlay 默认写到 Tuner `workspace/.xsxb/`（静图 W1-4-1 + 挥砍片 B-CLIP-5）

- **严重度：** P3 摩擦
- **现象：** 抠图/place 在项目 `workspace/projects/test/.xsxb/`；overlay 掉到 Tuner 根 `workspace/.xsxb/`。schema 没有 `project_id`，跟 registry active 走，静图/挥砍片可能抢同一目录。
- **复现：** `xsxb_overlay_grid` 不给 `output_path`。静图：`warrior_cut_grid.png`。挥砍片：`frame_0006_grid.png`。
- **期望 vs 实际：** 期望与 cutout/place 一样落在当前项目 `.xsxb/`。实际 `overlayGridImage` 调 `resolveOutputPath` 时没传 `options.artifactDir`，回退 `mcpArtifactDir("", root)`。

### B8. crop_from 默认覆盖父 overlay 文件（静图 W1-4-2）

- **严重度：** P3 摩擦
- **现象：** 裁块仍用默认名 `warrior_cut_grid.png`，把父 8×8 全图格子盖掉。
- **复现：** 对 W1-4-1 的 overlay 再 `crop_from`（接触格 E6、F6，`padding_cells=1`，父 `overlay_id=ovl_303e5af96f22`），不设 `output_path`。
- **期望 vs 实际：** 期望留下全图格子。实际父文件被覆盖；要留全图必须自己设 `output_path` 或重跑。

### B9. cutout `receipt=full` 没有 inspectFeet（挥砍片 W1-2-4）

- **严重度：** P3 摩擦
- **现象：** 动画抠图 full 回执里 `inspectFeet: null`（有 `metrics.feetY`），种前没有格子 overlay。
- **复现：** `xsxb_cutout` `animation_id=ice_slash` `key_mode=border_flood` `key_color=#000000` `receipt=full`。
- **期望 vs 实际：** 期望 full 带种脚 overlay。实际 null；只能另走 `export_sheet`。

### B10. 小画幅动画帧仍默认 `next: crop_from`（挥砍片 W1-7-1）

- **严重度：** P3 摩擦
- **现象：** 320×320 / 8×8 格宽正好 40px，overlay 仍提示再裁。静图 1408 的粗格逻辑套到动画帧上偏吵。
- **复现：** `xsxb_overlay_grid` 盖 `ice_slash` 的帧 PNG（如 `frame_0001/0005/0006/0007/0008`）。
- **期望 vs 实际：** 期望小画幅不必逼 crop。实际仍 `next: crop_from`。本轮未再 crop。

---

## 4. MCP 使用难点

这些是 agent 用工具时踩的坑，不是上面那些像素/几何 bug 本身。

1. **没有战士项目，也没有建项目工具。** 用例默认 `warrior`；活会话只有 `test` / `emberline_enemies` / `codex_pets`。两半都借用 `test`，没有假装建了新项目。静图设完 active 后省略 `project_id`；挥砍片仍显式传，避免 sibling 改掉 active。
2. **JPG / 根外路径进不来。** MCP 没有素材接入工具。JPG 必须先转 PNG；`file_path` 必须在 XSXB 根内。原片在 Downloads 时要 ffmpeg 转码拷进项目 `.xsxb/`。拷文件是 agent 在壳里做的。
3. **视频没有时间窗参数。** `import_video` 没有 `ss`/`duration`。本片默认从 0 切 0.8s 会整段错过挥砍（片头是蓄力）。要先按秒抽帧看窗口，本片实际用的是 1.6–2.4s。
4. **两套坐标不要混。** 静图是 `overlay_id` + A1 格 + `view`（原图像素）；动画是 `grid.cells` 组坐标、脚底 `y=-1`。W1-7-1 必须 overlay **帧 PNG**，不能拿动画 sheet 的格子当 `overlay_id`。裁块后格子重编号（全图手=F6，裁块掌=D3），place 必须用**当次** overlay 的格子 + id。
5. **`overlay_id` 省略能合成，旧 id 硬失败。** Agent-led 必须带当次 id；省略只给 warning。旧戳 `STALE_OVERLAY`，这点好用。
6. **`plan_place` 的 `read.*_cells` 不是注释。** 会参与 `PLAN_MISMATCH`。眼睛看到的刀格如果只是笔记，不要放进 `object_cells`，否则无法 `measure_t`（见 B3）。
7. **`measure_t` 的 `at` 不能填回自由 `x,y`。** 工具会拒。轴错时（B1）只能换 cells+snap，或先修轴。未抠 RGB 站姿图会被整张画布当主体，必须先抠再量。
8. **overlay 和 cutout 产物目录不一致。** 按回执 `overlay_path` 找图，不要猜项目 `.xsxb/`（见 B7）。`overlay_grid` 不能传 `project_id`。
9. **1408 默认 8×8 一定会 `next=crop_from`。** 不裁就 place 格子太粗。320 帧格宽 40px 也会喊 crop（见 B10），不必每次都跟。
10. **种脚前要看 sheet，不要信 feetY。** `receipt=full` 这次也没有 `inspectFeet`。着地冰花帧的 feetY 看起来合法，不看 sheet 会对 W1-5-1/5-2 报假成功。
11. **GIF 在对话里往往只能稳定看到一帧。** 刀光验收必须 `export_sheet` `grid=false` 的 human sheet，不要只凭 GIF 过刀光。
12. **`plan_smear` 的 `reference` 永远带着牛来 D1→G3。** 回执写了 example only，但仍很诱人照抄。本片刀头是自己追的（帧 0 尖 F5 … 帧 7 头 G8），颜色从刀刃取样 `#54befb`，不是写死红。从 PNG 取样 hex 要出 MCP。
13. **站姿图已经持剑。** 再 place 一把刀只会叠刃，不是换装。即便 bypass B3，B1 的假轴也让新刀不是按真柄贴的。

---

## 5. 优化点

按落点归类。不改产品代码，只记两半已经提出的方向。

**工具**

- `measureLongAxis`：对角线武器不要用 AABB 长短边抢 PCA；端点应落到不透明像素（或沿轴夹紧到 alpha）。
- `measure_frames` / `plant_feet`：着地 VFX 的 feetY 与 body 一样剥靴下连着的亮冰/刀光；dry_run 带一张种后预览 sheet。
- `assertPlanMatches`：有 `measure_t` 时不要拿 `read.object_cells` 对 `object_anchor.cells`；或 schema/brief 写明二者互斥。
- `import_video` 增加 `start_time`/`duration`（或明确要求 agent 先 ffmpeg），避免片头 0.8s 假导入。
- MCP 增加 `create_project`（或用例文档写明用哪个现成 id / `warrior` 夹具）。
- 从帧 PNG 取样「刀刃主色」做成小工具，避免 agent 写死红或出站解码。

**回执**

- `cutout receipt=full` 真正给出 `inspectFeet`；或 short 就给 `sheetPath`。`file_path` 抠图回执补上透明比 / 四角 / keyed，避免为验收 W1-2 另写像素脚本。
- 相对缩放的 aspect warning 不要把 `verify.status` 从 `confirmed` 打成 `unverified`。
- `export_sheet` 8×8 补上最后一列，或回执写清「右/上边缘格因 0,0 在画外而省略」。
- `plan_smear` 的 `reference` 在 `animation_id≠niulai_*` 时降级为一句 example only，少把 D1→G3 铺在 brief 旁边。

**skill / catalog**

- 写明：`object_cells` 会参与 PLAN_MISMATCH，笔记不要进 brief；刀侧 `measure_t` 时 brief 留空格子。
- 写明：静图 `view`/`overlay_id` 与动画 `grid.cells` 分家；种脚用 JSON 组坐标，不要 OCR overlay 数字，不要把静图 A1 填进 `to`。
- 写明：挥砍片先看秒数窗口，不要默认切片头；GIF 不算刀光验收。

**工作区路径**

- `overlayGridImage` 把 `artifactDir` 传进 `resolveOutputPath`，与 cutout/place 一样落到当前项目 `.xsxb/`。
- `overlay_grid` 加 `project_id`，不要只跟 registry active。
- crop 默认加 `_crop` 后缀，避免盖掉父 `*_grid.png`。
- 动画帧（短边 ≤512 或格宽 ≤40）不要默认 `next: crop_from`。
