# 战士皮肤武器1 · 视频/动画半 · MCP 实测

日期：2026-09-03  
路径：user-xsxb MCP（会话刚 reload），不是 Node 单元测试主路径。  
素材：`grok-02f3d442-6875-4ff5-a0b9-a677668bf8c4-720p.mp4`（944×944，6.04s，145 帧 @24fps）。  
项目：活 Tuner 里没有 `warrior`；MCP 也没有建项目工具。落到独立项目 `test` / `mcp_imports` / `ice_slash`。  
片源：ffmpeg 短转码拷进 `workspace/projects/test/.xsxb/`（工具要读根内路径）。全量 145 帧未导，慢，见 W1-1-2。

短片窗口：先导片头 0–0.8s（蓄力站姿）证明 import；再 `replace` 成 **1.6–2.4s @10fps 320×320**（8 帧）才盖到过顶→下劈→冰花。后续用例都在这 8 帧上。

产物（项目 `.xsxb/`）：

- `ice_slash_short.mp4` / `ice_slash_strike.mp4`
- `mcp_imports_ice_slash_analyze.png`
- `ice_slash_preplant_sheet.png` / `ice_slash_grid_sheet.png` / `ice_slash_human_sheet.png`
- `ice_slash.gif`（头 `GIF89a`，品红底）
- `ice_slash_f0_grid.png` 等静图 overlay

---

## 用例结果

### W1-1-1 列出项目并设为当前 → **pass**（附缺口）

- `xsxb_list_projects`：3 项，`emberline_enemies` 当时 active。
- `xsxb_set_active_project` `project_id=test` 后，再 list：`test.active=true`，`activeProjectId=test`。
- 后续省略 `project_id` 会打到它；本轮仍显式传 `test`，避免和静图 sibling 抢 active。

缺口：没有 `warrior` 夹具，也没有 MCP `create_project`。用现成 `test` 完成路径，没有假装建了新项目。

### W1-1-2 导入挥砍片 → **pass**

- 负例：`xsxb_import_video` `in_place=true` `animation_id=ice_slash_inplace`  
  回执：`ok:false` `in_place is not supported for video extraction; extracted frames are temporary.`  
  期望：视频禁止 in_place。实际：硬失败。符合。
- 正例：`file_path`=`…/test/.xsxb/ice_slash_short.mp4`，`fps=10`，`animation_id=ice_slash`  
  `importedFrameCount=8`，`extractedFrameCount=8`，PNG 在 `workspace/projects/test/assets/mcp_imports/ice_slash/frame_0001.png`…`_0008.png`。
- `xsxb_get_animation` `frames=summary`：`frameCount=8`，样例 `exists:true`。
- 第二次 `replace=true` 换成 1.6s 窗口，同样 8 帧。全量 145×944 未跑（慢，不挡主路径）。

### W1-2-4 动画帧抠黑底 → **pass**

- `xsxb_cutout` `animation_id=ice_slash` `key_mode=border_flood` `key_color=#000000` `receipt=full`
- 回执：`verify.status=confirmed`，`processedFrameCount=8`，`skippedFrameCount=0`，`keyed=true`
- 像素（第 0/3/5/7 帧）：四角 `a=0`；透明比 0.86–0.91；冰蓝不透明像素仍在（第 0 帧 ice=6510）；不透明纯黑=0。刀和霜还在。
- 人眼：第 0 帧过顶蓄力、第 7 帧冰花下劈都还在。

附：`receipt=full` 时 `inspectFeet=null`，没有种脚 overlay。种脚只能另走 `export_sheet`。

### W1-3-1 analyze 一次出预览 → **pass**

- `xsxb_analyze`：`applied:false`，`decodeCount=8`
- `duplicates` 有（threshold 88，drop `[2]`，`autoAdjustedThreshold=null`）——未 apply order
- `loop.recommended=null`，`motion.start=4 end=7`
- `preview.path` 存在：`workspace/projects/test/.xsxb/mcp_imports_ice_slash_analyze.png`（`kind=motion`，4 帧，无种地网格）
- 没有对每个候选再 `export_sheet`

### W1-3-2 挥砍片当 one-shot 看 → **pass**

- `loop.oneShotLikely=true`，note：`No loop candidate. Inspect sheets or use xsxb_find_motion.`
- 人眼预览：4→举刀，5→下劈拖影，6→月牙冰弧，7→着地冰花。是短爆发，不是走跑循环。
- **没有** `reorganize_frames` 成循环。

### W1-5-1 量动画帧 → **fail**

- `xsxb_measure_frames` 每帧都有 `feetY` / bbox / body。蓄力帧 0–5：`feetY` 225–234（靴底附近，maxY 还低约 20–30px 的冰靴/挂冰）。
- **失败即命中：** 帧 6–7（着地冰花）`feetY=267/268`，几乎等于 bbox 底（267/272）。行采样：y=257–272 几乎全是冰蓝冰花，不是靴底。Skill 写「feetY 是靴底，连着的亮刀光不算」——本片着地帧把刀光/冰花下沿当成鞋底。

### W1-5-2 种脚到 y=-1 → **pass**（被 5-1 带脏）

- dry_run：`applied:false`，表：帧 0–5 `dy` 85–94，帧 6–7 `dy` 51–52，`targetY=-1`。未写盘。
- `apply:true` 后复测：所有帧 `feetY=319`（画布最后一行 = 组坐标 `y=-1`）。**没有**种到黄点 0,0。
- 人眼：蓄力帧靴底贴底；着地帧是冰花贴底，身子相对蓄力帧偏高（因为 5-1 的 feetY 吃了冰花，dy 更小）。
- 副作用：蓄力帧原先 maxY=254、feetY=225，+94 后挂在靴下的冰晶被裁出画布（bboxH 196→167）。种的是测量鞋底，不是不透明最底。

写回用的是 plant 自己的 group Y，没有 OCR overlay 数字，也没有把静图 A1 填进 `to`。

### W1-5-3 估比例 → **pass**

- `xsxb_estimate_visual` `target_height=160` `metric=body` `apply=false`
- `targetHeight=160`，`nativeHeight=168.5`，`groupScale=0.95`（>0），`applied:false`
- 没有当成已经锁脚/已经烤进 PNG。没有 idle 对照动画，用的是 `target_height`。

### W1-6-1 联系表（机器格子） → **pass**（附格子缺口）

- `xsxb_export_sheet` `grid_divs=8x8` → `…/test/.xsxb/ice_slash_grid_sheet.png`
- `grid.lastPixel.group.y === -1`，`canvas.y=319`
- `grid.cells[row][col]` 有组坐标；`legend` 代码生成。未 OCR。
- 人眼：种地网格、黄 0,0、底边 -1 都在；棋盘底，刀光在 sheet 上可读。

缺口：`divs.x=8` 但 `cells` 只有 col 0–6（7 列），缺 group `x=120` 那一列。最右刀尖格在 JSON 里对不上 8×8。

### W1-6-2 给人看的表 → **pass**

- `grid:false` → `ice_slash_human_sheet.png`，回执 `grid.enabled=false` `reason: grid disabled`
- 人眼：无 0,0 / -1 刻度。8 帧蓄力→举刀→月牙→冰花，刀光以这张为准。

### W1-6-3 GIF → **pass**

- `xsxb_export_gif` 默认品红。文件头 `GIF89a`，94800 bytes，8 帧 / 800ms。
- 能看：品红底、人在画布下半、冰蓝刀还在。
- 弓形拖影以 human sheet 为准（正向 GIF 在本环境里只能稳定看到单帧）。没有只凭 GIF 过刀光。

### W1-7-1 plan_smear → **pass**

- 静图 `xsxb_overlay_grid` 盖的是**帧 PNG**（`frame_0001/0005/0006/0007/0008`），不是动画 `grid.cells`。`overlay_id` 形如 `ovl_`+12 hex；`cells.A1={id}` 无像素盒。
- 人眼追刀头（本片，不是牛来 D1→G3）：
  - 帧 0：尖 F5，蓄力右上
  - 帧 4：尖 ~E4，举到顶
  - 帧 5：刃 C5，已扫过 F5，朝 B5
  - 帧 6：月牙左下，头 C7，外沿 A8
  - 帧 7：着地扇，头 G8，外沿 H7
- 取样冰蓝（刀刃峰值，不是写死红）：`#54befb`
- `xsxb_plan_smear` `path_kind=polyline` `layer=behind`：只有 `brief` + 锁定格，`useMesh=false`，无 smear PNG。**没有** GenerateImage。
- 回执 `reference` 仍举牛来例子，并写明 example only。

320×320 / 8×8 格宽 40px，overlay 仍给 `next: crop_from`（静图 1408 的粗格逻辑套到动画帧上偏吵）。未再 crop。

---

## Bugs（可复现）

### B-CLIP-1 着地帧 feetY 吃冰花

- 工具：`xsxb_measure_frames` / 随后 `xsxb_plant_feet`
- 参数：`project_id=test` `profile_id=mcp_imports` `animation_id=ice_slash`
- 回执：帧 6 `feetY=267`，帧 7 `feetY=268`（种脚 dry_run `dy=52/51`）；帧 0–5 为 225–234
- 期望：靴底；连着的亮刀光/冰花不算
- 实际：着地帧量的是冰花下沿。apply 后冰花贴 `y=-1`，身子相对蓄力帧偏高

### B-CLIP-2 cutout `receipt=full` 没有 inspectFeet

- 工具：`xsxb_cutout` `receipt=full`
- 回执：`inspectFeet: null`（有 metrics.feetY）
- 期望：full 带 overlay grid，方便种前核对
- 实际：null。种脚只能另 `export_sheet`

### B-CLIP-3 动画 sheet `grid_divs=8x8` 缺最后一列

- 工具：`xsxb_export_sheet` `grid_divs=8x8`
- 回执：`divs.x=8`，`cells` 每行 col 0–6，没有 col 7（`x=120`）
- 期望：8 列组坐标都能写回
- 实际：7 列。最右格要靠猜或换 density

### B-CLIP-4 种脚按 feetY 平移会裁掉靴下挂冰

- 工具：`xsxb_plant_feet` `apply=true` `target_y=-1`
- 帧 0：种前 maxY=254、feetY=225；种后 maxY=319、bboxH 196→167
- 期望：靴底到最后一行，靴/冰晶轮廓还在
- 实际：测量点以下约 29px 被移出 320 画布

### B-CLIP-5 overlay 默认目录跟 active 走，且动画帧也喊 crop_from

- 工具：`xsxb_overlay_grid`（schema **没有** `project_id`）
- 第一次盖 `frame_0006.png` 未给 `output_path`，写到 `workspace/.xsxb/frame_0006_grid.png`（不是 `workspace/projects/test/.xsxb/`）
- 320 帧格宽 40px 仍 `next: crop_from`
- 期望：动画帧 overlay 落到当前动画项目；小画幅不必逼 crop
- 实际：跟 registry active 走，和静图 sibling 可能抢同一 `.xsxb`

未发明成功的缺口：MCP **没有** `create_project`；`import_video` **没有** `ss`/`duration`（窗口要 ffmpeg 先切）；从 PNG 取样 hex 要出 MCP。

---

## MCP 使用难点

1. 活会话只有 `test` / `emberline_enemies` / `codex_pets`。真实素材用例默认 `warrior` 不存在，只能借用 `test`。
2. `file_path` 必须在 XSXB 根内。Downloads 原片要先转码拷进 `.xsxb/`。原片 6s，默认 `-t 0.8` 从 0 切会整段错过挥砍；要先按秒抽帧看窗口（本片约 1.6–2.4s）。
3. 静图 overlay（A1 / overlay_id）和动画 `grid.cells`（组坐标、y=-1）必须分开。W1-7-1 必须 overlay **帧 PNG**。
4. `overlay_grid` 不能传 `project_id`，active 被 sibling 改掉就会写到别人的 `.xsxb`。
5. `cutout` 短回执没有种脚图；`receipt=full` 这次也没有。agent 容易在没 overlay 时按 feetY 盲种。
6. 着地冰花帧，feetY 数字看起来合法，不看 sheet 会对 5-1/5-2 报假成功。
7. GIF 在对话里往往只能稳定看到一帧；刀光验收必须 human sheet（`grid=false`）。
8. `plan_smear` 的 `reference` 永远带着牛来 D1→G3。不用它当本片配方，但回执很诱人照抄。

---

## 优化点

1. MCP 增加 `create_project`（或用例文档写明用哪个现成 id）。
2. `import_video` 增加 `start_time`/`duration`（或明确要求 agent 先 ffmpeg），避免片头 0.8s 假导入。
3. `measure_frames`/`plant_feet` 着地 VFX：feetY 与 body 一样剥靴下连着的亮冰/刀光；dry_run 带一张种后预览 sheet。
4. `cutout receipt=full` 真正给出 `inspectFeet`；或 short 就给 `sheetPath`。
5. `export_sheet` 8×8 补上最后一列，或回执写清「右/上边缘格因 0,0 在画外而省略」。
6. `overlay_grid` 加 `project_id`；动画帧（短边 ≤512 或格宽 ≤40）不要默认 `next: crop_from`。
7. 从帧 PNG 取样「刀刃主色」做成 MCP 小工具，避免 agent 写死红或出站解码。
8. `plan_smear` 的 `reference` 收到 `animation_id≠niulai_*` 时降级为一句「example only」，少把 D1→G3 铺在 brief 旁边。
