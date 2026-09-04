# XSXB MCP v0.2 · 全目录工具用例

日期：2026-09-03

这是 **用例文档**（按项执行和验收），不是 `tools/tests/*.test.js` 的替代。自动化门禁仍走 `npm run check:mcp-v2`。

目标：目录里 **每一个** 公开工具至少打一次真实 `callMcp`（Cursor xsxb 或同进程 `service.callMcp`），覆盖 v0.2 回执、快照/overlay 新鲜度、以及会改像素的步骤必须看图。

眼睛仍是人（或 agent）打开 `preview.path` / overlay / gif / `grid=false` 表。`ok` / `confirmed` / `keyed` **不等于**角色还在。

## 隔离与素材

- **项目 id：** `mcp_catalog_qa`（本轮新建或幂等复用）。不要改 `emberline_enemies` / `warrior_qa` 的现有动画帧。
- **Godot：** 项目内自建空 `project.godot` 桩，只为 `bind` / `sync` / `validate layer=bind`。不要绑到游戏主工程。
- **素材（只读拷贝进本项目工作区）：**
  - `workspace/projects/mcp_v2_qa/qa_src/white_walk/` — 白底蓝块序列
  - `workspace/projects/mcp_v2_qa/qa_src/ice_hang/` — 红身 + 脚下青冰块
  - `workspace/projects/mcp_v2_qa/qa_src/stills/warrior_cut.png`、`sword_cut.png` — 已抠静图
- **切表：** 本轮用 `export_sheet` 产物再 `slice_sheet`，不另找商业表。
- **音效：** 测试 WAV（PCM）写进本项目 `.xsxb/`，不要用游戏资源。
- **跑完：** `xsxb_set_active_project` 恢复成开工前的 active（通常 `emberline_enemies`）。`delete_animation` 只删本项目里本轮建的 clip。

## 坐标系（不要混）

| 空间 | 工具 | 怎么说话 |
| --- | --- | --- |
| 静图 | `overlay_grid` / `place_image` / `plan_place` | 只报 A1 cell；带当次 `overlay_id` |
| 动画 | `export_sheet` / `plant_feet` / boxes / shift | `grid.cells` 组坐标；靴底 **y=-1**，不要黄色 0,0 |
| 感知 | `detect_regions` | 只报 `cells` + `regionId`；不得把 overlay 写到源 PNG |

动画像素写（抠图、重排、A1 cell）必须带观察回执的 `basis_snapshot_id`。静图 crop/place 必须带 `overlay_id`。

## 编号

`C-<组>-<序号>`。每条：**工具 → 前置 → 步骤 → 期望 → 失败即 → 看图**。

结果记在文末表：`pass` / `fail` / `skip`（写原因）。

---

### 0. 目录与回执信封

#### C-0-1 tools/list 与 catalog 同名同序

- **工具：** （initialize / tools/list，非 call）
- **前置：** xsxb 已重载，进程 env 含当前 `XSXB_MCP_REV`。
- **步骤：** 列出全部工具名。
- **期望：** 与 `MCP_TOOL_NAMES` 44 项完全一致，顺序一致。`xsxb_detect_regions` 在目录里。
- **失败即：** 缺工具、顺序乱、会话还是旧目录。
- **看图：** 无。

#### C-0-2 成功回执是 v2 envelope

- **工具：** 任一只读（用 `xsxb_list_projects`）。
- **步骤：** `callMcp`。
- **期望：** `schemaVersion === 2`；有 `ok, data, observation, execution, verification, escalation`。`ok` 只表示调用完成。
- **失败即：** 业务字段摊在顶层；或 text 把整份 JSON 再贴一遍。
- **看图：** 无。

---

### 1. 项目

#### C-1-1 列出项目

- **工具：** `xsxb_list_projects`
- **期望：** 能看到既有项目；记下开工前 `activeProjectId`。
- **失败即：** 空列表却声称有工程。
- **看图：** 无。

#### C-1-2 读取当前/指定项目

- **工具：** `xsxb_get_project`
- **步骤：** 不传 id 打 active；再传 `emberline_enemies` 只读。
- **期望：** 两条都返回；后者动画列表非空。本轮 **不** 对其 mutation。
- **失败即：** 把 QA 项目和游戏项目弄混。
- **看图：** 无。

#### C-1-3 创建隔离项目（幂等）

- **工具：** `xsxb_create_project`
- **步骤：** `project_id: mcp_catalog_qa`，`label`，`project_root` = 本项目内 Godot 桩。再打一次同一 id。
- **期望：** 第一次建出；第二次不复制第二份、不报错。
- **失败即：** 第二次覆盖掉别的项目。
- **看图：** 无。

#### C-1-4 绑定 Godot 桩

- **工具：** `xsxb_bind_godot`
- **前置：** C-1-3；桩目录有 `project.godot`。
- **期望：** 该项目 `projectRoot` 指向桩，不是游戏主工程。
- **失败即：** 绑到 `emberline` 游戏根。
- **看图：** 无。

#### C-1-5 设为当前再改回去

- **工具：** `xsxb_set_active_project`
- **步骤：** 设 `mcp_catalog_qa` → 后续本文件默认打它 → **全部测完后**设回 C-1-1 记下的 id。
- **期望：** 省略 `project_id` 时打到 QA；收尾 active 恢复。
- **失败即：** 测完把游戏工程丢成 active 不恢复。
- **看图：** 无。

---

### 2. 导入 / 切表

#### C-2-1 PNG 序列导入走循环夹具

- **工具：** `xsxb_import_animation`
- **步骤：** `source: png_sequence`，`directory` = 拷进来的 `white_walk`，`animation_id: catalog_walk`。
- **期望：** 4 帧；路径在 `mcp_catalog_qa` 工作区。
- **失败即：** 写进别的项目 assets。
- **看图：** 打开第 0 帧，应是白底蓝块（尚未抠）。

#### C-2-2 导入挂冰夹具

- **工具：** `xsxb_import_animation`
- **步骤：** 同样导入 `ice_hang` → `catalog_ice`。
- **期望：** ≥1 帧；脚下有青冰块。
- **看图：** 第 0 帧冰块在靴下、未出画也可。

#### C-2-3 读回动画 + 快照

- **工具：** `xsxb_get_animation`
- **步骤：** `animation_id: catalog_walk`。记下 `observation.snapshotId`。
- **期望：** `frames[].absolutePath` 存在；`snapshotId` 形如 `obs_v1_`。
- **失败即：** 无观察 id 却去做 cell 写。
- **看图：** 无（读元数据）。

#### C-2-4 切表（用联系表当 packed sheet）

- **工具：** `xsxb_slice_sheet`（依赖后面 C-9-1 的 sheet，可先 sheet 再切，或本条挪到导出之后执行）
- **步骤：** `file_path` = 本项目一张 `export_sheet` PNG。用回执的 `columns`/`rows`/`cell`/`pad`（或省略网格，读旁边的 `*.sheet.json`）。**不要**把 overlay 的 `grid_divs: 8x8` 当切表网格——那是种脚格子，不是打包列×行。切出目录用 `dest`（不是 `output_dir`）。overlay `grid_divs` 与 sidecar packing 不一致必须 `SLICE_PACKING_MISMATCH`。
- **期望：** 输出序号 PNG；`frameCount` 等于导出帧数（或 skip_empty 后的非空格）。不拿切表当走循环锁尺。
- **失败即：** 切完当锁脚高度；或 8×8 overlay 切出几十张碎片却标成功。
- **看图：** 打开切出的一格，应是单帧不是整表。

#### C-2-5 视频导入（有短片才跑）

- **工具：** `xsxb_import_video`
- **前置：** 仓库或 QA 目录有短 MP4 + ffmpeg。没有则 **skip**，写明路径缺失。
- **步骤：** `file_path` 短片，`animation_id: catalog_video`，可选 `duration`。
- **期望：** `importedFrameCount` ≥ 2。
- **失败即：** `in_place` 对视频成功。
- **看图：** 抽帧第 0 张存在即可；不在本条抠。

---

### 3. 观察与整理

默认动画：`catalog_walk`（未抠白底时 loop/duplicate 会被底板污染，C-4 抠完再跑分析更干净。顺序：先 C-4-2/4-3 再本段亦可。文档按「先有帧再分析」写，执行时若 preview 被白底污染，先抠再重跑。）

#### C-3-1 analyze

- **工具：** `xsxb_analyze`
- **步骤：** `preview: true`（或默认）。
- **期望：** `applied: false`；有 duplicates/loop/motion 之一；`preview.path` 存在。`execution.effect` 可以是 `unverifiable`（未改帧）。
- **失败即：** 把 analyze 当已经 `reorganize`。
- **看图：** 打开 `preview.path`。

#### C-3-2 find_duplicates / find_loop / find_motion

- **工具：** `xsxb_find_duplicates`、`xsxb_find_loop`、`xsxb_find_motion`
- **期望：** 各返回 order 或窗口；不写盘。`autoAdjustedThreshold` 时不要 apply duplicates。
- **失败即：** finder 改了 PNG。
- **看图：** 无强制；有 preview 则看。

#### C-3-3 无快照重排被拒

- **工具：** `xsxb_reorganize_frames`
- **步骤：** 传 `order`，不传 `basis_snapshot_id`。
- **期望：** `MISSING_SNAPSHOT`；帧顺序不变。
- **失败即：** 没快照也重排成功。
- **看图：** 无。

#### C-3-4 带快照重排

- **工具：** `xsxb_reorganize_frames`
- **步骤：** 用 C-3-1/C-2-3 的新快照；`order` 合法置换（可再排回）。`sync: false`。
- **期望：** `outputFrameCount` 对；需要的话再排回原序。
- **失败即：** 用过期 snapshot 仍成功。
- **看图：** 可选 sheet。

---

### 4. 抠图与感知

#### C-4-1 静图 file_path 抠白底

- **工具：** `xsxb_cutout`（`file_path`）
- **步骤：** 对工作区内白底 PNG；`key_mode: border_flood`，`key_color: #ffffff`。
- **期望：** 源文件字节不变；产物在 `.xsxb/`；洋红 `preview.path` 上主体还在。
- **失败即：** 源被改写；或 preview 里主体没了。
- **看图：** `preview.path`（洋红），不要用种脚格表。

#### C-4-2 动画抠图缺快照

- **工具：** `xsxb_cutout`
- **步骤：** `animation_id: catalog_walk`，border_flood + 白，**不传** `basis_snapshot_id`。
- **期望：** `MISSING_SNAPSHOT`；帧 PNG 字节不变。
- **失败即：** 先改盘再报 `STALE_SNAPSHOT`（v0.2 已修回归）。
- **看图：** 无（必须确认未写盘）。

#### C-4-3 动画抠图带快照

- **工具：** `xsxb_cutout`
- **步骤：** `get_animation` 取快照 → 同参抠图。
- **期望：** `ok`；`keyed: true`；回执 `observation.snapshotId` **不等于**传入的旧 id。
- **失败即：** `STALE_SNAPSHOT`；或 skip 却标 keyed。
- **看图：** `preview.path` 洋红四帧蓝块还在，白底没了。

#### C-4-4 detect_regions 只读

- **工具：** `xsxb_detect_regions`
- **步骤：** `file_path` = 已抠战士静图拷贝，`provider: code`，`targets: [subject, weapon]`，`grid_divs: 8x8`。overlay 用默认 `.xsxb/` 路径。
- **期望：** 候选只有 cells + regionId，无 `bbox`；源 PNG 不变。
- **失败即：** 回执带可写像素盒。
- **看图：** `overlayPath`（格子+框）。黑底已抠图上衣服仍可能很暗，不要判「人没了」。

#### C-4-5 detect overlay 不得盖源

- **工具：** `xsxb_detect_regions`
- **步骤：** `output_path` = 源 PNG 绝对路径。
- **期望：** `OVERWRITE_SOURCE`；源 hash 不变。
- **失败即：** 源被画上诊断图，或事后 `STALE_SNAPSHOT`。
- **看图：** 无（比 hash）。

---

### 5. 锁尺 / 种脚 / 平移 / 压缩

#### C-5-1 measure_frames

- **工具：** `xsxb_measure_frames`
- **步骤：** `catalog_ice` 或已抠 `catalog_walk`。
- **期望：** 每帧 `feetY` / bbox。冰块夹具上 `feetY` 是靴底不是冰下沿。
- **失败即：** 把挂冰当鞋底。
- **看图：** 对照帧 PNG。

#### C-5-2 plant dry_run

- **工具：** `xsxb_plant_feet`
- **步骤：** 默认（dry）；`catalog_ice`。
- **期望：** `dryRun: true`；`applied: false`；PNG 不变。
- **失败即：** dry 写盘。
- **看图：** 无。

#### C-5-3 plant apply 高度一致

- **工具：** `xsxb_plant_feet`
- **步骤：** `apply: true`，`sync: false`。默认证 `y=-1`（锁画布最后一行像素）。
- **期望：** 靴底在原逻辑底附近；挂冰仍在；**清单 `frames[].height` === 解码 PNG 高度**。再 apply 一次 `dy === 0`。
- **失败即：** 清单 32、PNG 38；或种到 0,0 裁 1px。
- **看图：** 洋红 flatten 或 `grid=false` 表；冰在脚底之下仍可见。

#### C-5-4 register_clip 只预览

- **工具：** `xsxb_register_clip`
- **步骤：** `reference_animation_id` 或 `target_bbox`；**不要 apply**（避免本轮烤比例）。
- **期望：** 有 plan / scale；`applied: false`。
- **失败即：** 没说 apply 却改了 PNG。
- **看图：** 无。

#### C-5-5 shift_frames 格子 + 快照

- **工具：** `xsxb_shift_frames`
- **步骤：** `export_sheet` 或已知 `grid_divs: 8x8`；`get_animation` 快照；`from`/`to` 用 cell id。可再 shift 回来。
- **期望：** 无快照且带 cell → `MISSING_SNAPSHOT`；有快照则 `dx/dy` 为格差。
- **失败即：** 自己把 overlay 数字换算成画布像素。
- **看图：** 平移后主体仍完整。

#### C-5-6 compress_frames dry_run

- **工具：** `xsxb_compress_frames`
- **步骤：** `dry_run: true`。
- **期望：** 不写盘；像素稍后 apply 才可能变体积、不得变颜色。本轮可只 dry。
- **失败即：** dry 改字节。
- **看图：** 无。

---

### 6. 框 / 时间轴 / 视觉 / 换帧

以下写工具都要当前 `basis_snapshot_id`（A1）或至少在改盘前 `get_animation`。

#### C-6-1 update_frame_boxes 缺快照

- **工具：** `xsxb_update_frame_boxes`
- **步骤：** `hurtbox.min/max` 用 A1，不传 snapshot。
- **期望：** `MISSING_SNAPSHOT`。
- **失败即：** 没快照写了框。

#### C-6-2 update_frame_boxes 带快照

- **工具：** `xsxb_update_frame_boxes`
- **步骤：** 新鲜 snapshot + `A1`/`B2` 一类小框。`sync: false`。
- **期望：** 写回成功；`get_animation include=[boxes]` 能读到。
- **看图：** 无强制（几何）。

#### C-6-3 estimate_boxes dry_run

- **工具：** `xsxb_estimate_boxes`
- **步骤：** `dry_run: true`。
- **期望：** 预览框；不持久化（除非文档写 apply/replace）。
- **失败即：** dry 覆盖已有框。

#### C-6-4 update_timing

- **工具：** `xsxb_update_timing`
- **步骤：** 改一帧 duration 或 fps（小改），`sync: false`。
- **期望：** 读回一致。
- **看图：** 无。

#### C-6-5 estimate_visual / set_visual_transform

- **工具：** `xsxb_estimate_visual`、`xsxb_set_visual_transform`
- **步骤：** estimate 不 apply；set 可设 group `visual_size` 再清或还原。不要本轮 `cutout apply_visual` 除非明确要烤。
- **期望：** 估到正数 scale；set 只改 tuning 不改 PNG（未 bake）。
- **失败即：** 把 estimate 当成已锁脚。
- **看图：** 无（未 bake）。

#### C-6-6 replace_frame

- **工具：** `xsxb_replace_frame`
- **步骤：** 用同尺寸工作区 PNG 换 `catalog_walk` 第 0 帧；`sync: false`。可换回。超大 IHDR 的假 PNG 应 `PNG_PIXEL_LIMIT`（可用单元对照，现场不必造 16k 图）。
- **期望：** 路径仍是工作区帧；boxes 还在。
- **看图：** 打开该帧确认换成预期图。

---

### 7. 绑定（附加、SFX、拖尾）

走循环夹具上可以绑，但 **不要** 把 Hermite 拖尾当走循环验收。本段用 `catalog_walk` 或单独两帧即可。

#### C-7-1 add_attachment

- **工具：** `xsxb_add_attachment`
- **步骤：** `hand` 组坐标或 cell + snapshot；贴一张小 PNG。`sync: false`。
- **期望：** 绑定可读；`remove_binding dry_run` 能列到它。
- **看图：** 导出 gif/sheet 时若 bake 了附加则看一眼。

#### C-7-2 add_sfx

- **工具：** `xsxb_add_sfx`
- **步骤：** 短 WAV；绑到一帧。`sync: false`。
- **期望：** `get_animation include=[sfx]` 有该项。
- **看图：** 无。

#### C-7-3 add_attack_trail polyline

- **工具：** `xsxb_add_attack_trail`
- **步骤：** `path_kind: polyline`，两根 sticks，`sync: false`。不要默认 smooth_arc。
- **期望：** `useMesh: false`；sticks 存盘。
- **失败即：** polyline 仍出 Hermite 网格。
- **看图：** 无（本条不验收月牙）。

#### C-7-4 plan_smear

- **工具：** `xsxb_plan_smear`
- **步骤：** 对静图或单帧 overlay 读到的格子填 `motion` / `frames[]`；`path_kind: polyline`；颜色从素材取样不是死红。
- **期望：** 只有 brief，不写 smear PNG。
- **失败即：** 跳过 plan 去 GenerateImage。
- **看图：** 无（停在 brief）。

#### C-7-5 remove_binding

- **工具：** `xsxb_remove_binding`
- **步骤：** 先 `dry_run` 再删本轮 attachment 或 trail。`sync: false`。
- **期望：** dry 不删；apply 后读回没有该项。
- **失败即：** dry 就删了。
- **看图：** 无。

---

### 8. 静图格子与贴合

素材：已抠 `warrior_cut` / `sword_cut` 拷进本项目。站姿已持剑时 **不要** 再 place 一把刀（叠刃）。本轮贴合用「人」+「单独刀」两张，或跳过 place 合成若只有持剑图——若只有持剑图，C-8-4 **skip** 并写明叠刃风险。

#### C-8-1 overlay_grid

- **工具：** `xsxb_overlay_grid`
- **步骤：** 对人 PNG，8×8。
- **期望：** `overlay_id`；`cells.A1` 无像素盒；源不变。
- **看图：** `overlay_path`，只报 cell id。

#### C-8-2 measure_image

- **工具：** `xsxb_measure_image`
- **步骤：** 刀图 `t: "2/3"`；人图 `anchor: alpha_bottom`。
- **期望：** 柄/尖可分；脚点是静图像素空间，不与动画 y=-1 混用。
- **看图：** 对照刀图哪头粗。

#### C-8-3 plan_place

- **工具：** `xsxb_plan_place`
- **步骤：** intent / read / physics / accept / 3–5 步 plan。
- **期望：** `plan_id`；`brief` 可执行。
- **失败即：** 无接触格就自由 x,y。
- **看图：** 无。

#### C-8-4 place_image

- **工具：** `xsxb_place_image`
- **前置：** 两张 overlay；**不是**已经持剑再叠刀。
- **步骤：** 带双方 `overlay_id`、cell 锚、`plan_id`；`layer` 与 brief 一致。
- **期望：** `verify_overlay_path` 存在；`verify.status` 不是 noop。错 `overlay_id` → `STALE_OVERLAY`。
- **失败即：** 自由 x,y；或叠第二把刃。
- **看图：** `verify_overlay_path` 与合成 PNG。

---

### 9. 导出

#### C-9-1 export_sheet 机器格

- **工具：** `xsxb_export_sheet`
- **步骤：** `grid_divs: 8x8`，`catalog_walk` 或 ice。
- **期望：** 源动画 PNG 不变；`grid.cells` 有组坐标。
- **失败即：** OCR 格子数字去写回。
- **看图：** 表存在；写回用 JSON 不看图上数字。

#### C-9-2 export_sheet 给人看

- **工具：** `xsxb_export_sheet`
- **步骤：** `grid: false`。
- **期望：** 无人眼种地刻度。
- **看图：** 打开表看动作/主体，不要用默认 220 种脚格当「腿还在」。

#### C-9-3 export_overlay

- **工具：** `xsxb_export_overlay`
- **步骤：** 两帧红青叠。
- **期望：** 文件存在。
- **看图：** 打开 overlay。

#### C-9-4 export_gif

- **工具：** `xsxb_export_gif`
- **前置：** ffmpeg。
- **步骤：** 默认品红底。
- **期望：** 文件头 GIF；能播。
- **看图：** 播一遍；细节以 sheet 为准。

#### C-9-5 export_pack_slot

- **工具：** `xsxb_export_pack_slot`
- **步骤：** `dest` = 本项目内空目录，如 `.xsxb/pack_slot_qa`。
- **期望：** 帧被拷到 dest；不覆盖游戏 pack。
- **失败即：** dest 指到 emberline 游戏资源。
- **看图：** dest 内 PNG 与源一致。

---

### 10. 校验 / 同步 / Tuner

#### C-10-1 validate standalone

- **工具：** `xsxb_validate_project`
- **步骤：** `project_id: mcp_catalog_qa`，`layer: standalone`（不要 `require_gameplay`）。
- **期望：** 能跑完；桩工程没有 gameplay 不算本轮失败。
- **失败即：** 用 gameplay 层去卡 QA 桩。
- **看图：** 无。

#### C-10-2 sync_godot 到桩

- **工具：** `xsxb_sync_godot`
- **前置：** 已 bind 到桩。
- **步骤：** `project_id: mcp_catalog_qa`。
- **期望：** 同步到桩目录；**游戏主工程文件数不变**。
- **失败即：** 往 emberline 写帧。
- **看图：** 无（可 ls 桩目录）。

#### C-10-3 open_tuner

- **工具：** `xsxb_open_tuner`
- **步骤：** `project_id: mcp_catalog_qa`，`animation_id: catalog_walk`。若担心拉起常驻进程：先 `start: false` 探听，再决定是否 `start: true`。
- **期望：** 返回 workspace URL；已在跑则 reused。
- **失败即：** 当成导入/同步已完成。
- **看图：** 可选打开 Tuner；非必须截 UI。

---

### 11. 删除与收尾

#### C-11-1 delete_animation dry_run

- **工具：** `xsxb_delete_animation`
- **步骤：** 对本轮 `catalog_*` 之一 `dry_run: true`。
- **期望：** 动画仍在。
- **失败即：** dry 删了。

#### C-11-2 delete_animation apply（可选）

- **工具：** `xsxb_delete_animation`
- **步骤：** 只删明确标了可扔的 clip（例如 `catalog_video` 或重复导入）。**不要**删 `mcp_v2_qa` / 游戏工程动画。
- **期望：** 该 clip 从本项目清单消失。
- **看图：** 无。

#### C-11-3 恢复 active

- **工具：** `xsxb_set_active_project`
- **步骤：** 设回 C-1-1 的 id。
- **期望：** `get_project` 默认又是游戏/原 active。
- **失败即：** 离开时 active 停在 QA。

---

## 工具覆盖核对（44）

| 工具 | 用例 |
| --- | --- |
| xsxb_list_projects | C-0-2, C-1-1 |
| xsxb_get_project | C-1-2 |
| xsxb_create_project | C-1-3 |
| xsxb_import_video | C-2-5 |
| xsxb_slice_sheet | C-2-4 |
| xsxb_import_animation | C-2-1, C-2-2 |
| xsxb_get_animation | C-2-3 |
| xsxb_find_loop | C-3-2 |
| xsxb_find_duplicates | C-3-2 |
| xsxb_find_motion | C-3-2 |
| xsxb_analyze | C-3-1 |
| xsxb_update_frame_boxes | C-6-1, C-6-2 |
| xsxb_estimate_boxes | C-6-3 |
| xsxb_update_timing | C-6-4 |
| xsxb_set_visual_transform | C-6-5 |
| xsxb_estimate_visual | C-6-5 |
| xsxb_measure_frames | C-5-1 |
| xsxb_register_clip | C-5-4 |
| xsxb_reorganize_frames | C-3-3, C-3-4 |
| xsxb_replace_frame | C-6-6 |
| xsxb_shift_frames | C-5-5 |
| xsxb_plant_feet | C-5-2, C-5-3 |
| xsxb_compress_frames | C-5-6 |
| xsxb_add_attack_trail | C-7-3 |
| xsxb_plan_smear | C-7-4 |
| xsxb_add_attachment | C-7-1 |
| xsxb_add_sfx | C-7-2 |
| xsxb_remove_binding | C-7-5 |
| xsxb_delete_animation | C-11-1, C-11-2 |
| xsxb_sync_godot | C-10-2 |
| xsxb_validate_project | C-10-1 |
| xsxb_set_active_project | C-1-5, C-11-3 |
| xsxb_bind_godot | C-1-4 |
| xsxb_cutout | C-4-1, C-4-2, C-4-3 |
| xsxb_export_gif | C-9-4 |
| xsxb_export_sheet | C-9-1, C-9-2 |
| xsxb_export_overlay | C-9-3 |
| xsxb_export_pack_slot | C-9-5 |
| xsxb_measure_image | C-8-2 |
| xsxb_detect_regions | C-4-4, C-4-5 |
| xsxb_overlay_grid | C-8-1 |
| xsxb_plan_place | C-8-3 |
| xsxb_place_image | C-8-4 |
| xsxb_open_tuner | C-10-3 |

## 执行结果

日期：2026-09-03。6 组并行 agent，隔离 `createXsxbMcpService({root})` + `handleMessage/callMcp`（v2 信封）。未改 `emberline_enemies` / `warrior_qa` 帧。Live active 收尾仍是 `emberline_enemies`。原始回执：`docs/qa/catalog-v02-results/`。问题汇总：`docs/mcp-v02-catalog-findings.md`。

52 条：51 pass / 1 skip / 0 fail。`skip` 必须写原因。

| id | 结果 | 笔记 |
| --- | --- | --- |
| C-0-1 | pass | tools/list 44 名，与 `MCP_TOOL_NAMES` 同序；含 `xsxb_detect_regions` |
| C-0-2 | pass | 信封仍是 v2。list_projects text=`xsxb_list_projects: ok`。get_animation text 现含 `obs_v1_…`，不含 `activeProjectId`。复测通过 |
| C-1-1 | pass | live 可见 6 个项目；开工前 active=`emberline_enemies` |
| C-1-2 | pass | 省略 id → live `emberline_enemies`（47 动画）；QA 隔离根 → `mcp_catalog_qa`。未 mutation 游戏项目 |
| C-1-3 | pass | 第一次 `created=true`；第二次 `created=false` 不报错、不复制 |
| C-1-4 | pass | `projectRoot` 指向隔离 godot 桩，不是 emberline 游戏根 |
| C-1-5 | pass | 隔离根设为 `mcp_catalog_qa`；live active 未改 |
| C-2-1 | pass | `catalog_walk` 4 帧，路径在隔离工作区。第 0 帧白底蓝块未抠 |
| C-2-2 | pass | `catalog_ice` 2 帧。第 0 帧红身、青冰在靴下、画内 |
| C-2-3 | pass | `absolutePath` 存在；`snapshotId=obs_v1_ed4024aac305e1c0debff978` |
| C-2-4 | pass | overlay `grid_divs=8x8` → `SLICE_PACKING_MISMATCH`。省略网格读 sidecar → `frameCount=4` columns=4。复测通过 |
| C-2-5 | pass | `ice_slash_short.mp4` → 8 帧。`in_place:true` 被拒。第 0 帧战士+冰剑存在，本条未抠 |
| C-3-1 | pass | `applied=false`；有 duplicates/loop/motion；`preview.path` 在；`effect=unverifiable`。未当 reorganize |
| C-3-2 | pass | 三 finder 不写盘。duplicates `order=[0]`（四帧相同）；loop 空/`oneShotLikely`；motion `[0,1,2,3]` |
| C-3-3 | pass | 无快照 → `MISSING_SNAPSHOT`；顺序/字节不变 |
| C-3-4 | pass | 过期快照 → `STALE_SNAPSHOT`；新鲜快照置换再排回，`outputFrameCount=4` |
| C-4-1 | pass | 源 hash 不变；产物 `.xsxb/`；洋红 preview 蓝块还在 |
| C-4-2 | pass | `MISSING_SNAPSHOT`；帧字节未改（不是先写再 STALE） |
| C-4-3 | pass | `keyed=true`；新 snapshotId；洋红四帧蓝块、白底没了 |
| C-4-4 | pass | 候选只有 cells+regionId，无 bbox；源不变。overlay 人还在（黑底暗衣未判没了） |
| C-4-5 | pass | `OVERWRITE_SOURCE`；源 hash 不变 |
| C-5-1 | pass | ice `feetY=19`=靴底；冰下沿 `maxY=25`。未把挂冰当鞋 |
| C-5-2 | pass | `dryRun=true` `applied=false`；PNG hash 不变 |
| C-5-3 | pass | apply 后清单高===PNG 38；靴底贴原底行；冰仍在 y=34–37；再 apply `dy=0` |
| C-5-4 | pass | 未 apply；`applied=false` `scale=1.7778`；PNG 不变 |
| C-5-5 | pass | 无快照+cell 仍拒。+dy 现垫高：ice 38→42，青冰像素仍在。复测通过 |
| C-5-6 | pass | dry 不写盘；`rewritten=0` |
| C-6-1 | pass | A1 无快照 → `MISSING_SNAPSHOT`；框未写 |
| C-6-2 | pass | 新鲜 snapshot 写 A1/B2；`include=[boxes]` 读回 offset `-7,-27` size 10×10 |
| C-6-3 | pass | dry 不覆盖已有框；replace+dry 只预览 |
| C-6-4 | pass | 帧 1 `duration_ms=90` 读回一致 |
| C-6-5 | pass | `groupScale=0.833` `applied=false`；set/clear 只改 tuning，PNG 不变 |
| C-6-6 | pass | 工作区路径仍是帧文件；boxes 还在。走循环夹具四帧相同，像素看不出换图 |
| C-7-1 | pass | 绑定可读；`remove_binding dry_run` 列到且未删 |
| C-7-2 | pass | 测试 WAV 绑帧 2；`include=[sfx]` 有 `audio/wav` |
| C-7-3 | pass | polyline `useMesh=false` `generated=false`；sticks 存盘 |
| C-7-4 | pass | 只有 brief；色从剑取样 `#14C0FF`；无 smear PNG |
| C-7-5 | pass | dry 不删；apply 后该项消失 |
| C-8-1 | pass | `overlay_id=ovl_f0a1d9827ccd`；`cells.A1` 只有 id；源不变 |
| C-8-2 | pass | 斜剑 `direction≈(0.50,-0.87)`，柄/尖都落在不透明像素。人脚 `alpha_bottom` 是图像素 `{684,1138}`，不是 y=-1。旧竖直轴 bug 本轮未复现 |
| C-8-3 | pass | `plan_id=pln_7621b5400f52`；brief 可执行。目标用 `white_still` 避免叠刃 |
| C-8-4 | skip | 叠刃风险：`warrior_cut` 已持剑。错 `overlay_id` → `STALE_OVERLAY`，未写合成 PNG |
| C-9-1 | pass | 默认 `*_sheet.png` + `*.sheet.json` sidecar。源 PNG 不变 |
| C-9-2 | pass | 默认 `*_sheet_view.png`，与 C-9-1 不再撞车。复测通过 |
| C-9-3 | pass | 未抠仍是整幅不透明白（alpha 叠）。mse=11184（四帧已不同）。抠后再叠：红/青错位块。复测通过 |
| C-9-4 | pass | 头 `GIF89a`。四帧已不同，GIF 不再是静帧 |
| C-9-5 | pass | dest 在隔离 `.xsxb/pack_slot_qa`；4 帧 hash 一致；不是 emberline pack |
| C-10-1 | pass | `layer=standalone` 跑完；桩上 19 条 gameplay 错误不记本轮失败 |
| C-10-2 | pass | emberline 文件数 18057→18057；桩 1→16 且出现 `xsxb_frame_tuner` |
| C-10-3 | pass | `start:false` `launched=false`；返回 `http://127.0.0.1:5179/workspace?...catalog_walk` |
| C-11-1 | pass | dry `deleted=false`；`catalog_walk` 仍在 |
| C-11-2 | pass | 只删了本轮 `catalog_walk_tmp`；`catalog_walk` 仍在 |
| C-11-3 | pass | 隔离根 active=`mcp_catalog_qa`；live omit-id 仍是 `emberline_enemies` |

## 明确不做

- 改 `emberline_enemies` / `warrior_qa` 现有帧
- 站姿已持剑再 `place_image` 叠刃
- 走循环上验收 Hermite 刀光
- 把 `ok`/`keyed` 当视觉通过
- 未看 `preview.path` 就继续 playbook
