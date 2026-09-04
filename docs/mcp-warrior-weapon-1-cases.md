# 战士皮肤武器1 · MCP 真实用例

日期：2026-09-03

这是 **用例文档**（给人 / agent 按项执行和验收），不是单元测试清单。自动化对照见文末。

目标：用同一套真实素材，走完 MCP 几大项（接入、抠图、分析、静图贴合、种脚/比例、导出、挥砍图度）。不把「刚改的 overlay_id / 质心」当成唯一项。

眼睛仍是人（或 agent）看 overlay；几何在 MCP 内。不引入 VLM、AX、`[0,1000]`。

## 素材

目录：`/Users/sirhao/Downloads/图片素材/程序大陆/战士皮肤武器1`

| 角色 | 文件 | 说明 |
| --- | --- | --- |
| 站姿人+刀 | `grok-0408eaa1-f413-40cb-946b-5f62c9cc9a65.jpg` | 1408×1408，黑底，右手持冰大剑 |
| 单独刀 | `grok-051b0079-1bac-4d13-bba7-382a2b950bd3.jpg` | 1408×1408，斜置冰大剑，黑底 |
| 挥砍片 | `grok-02f3d442-6875-4ff5-a0b9-a677668bf8c4-720p.mp4` | 944×944，约 6s / 145 帧，idle→挥砍 |

同目录还有其它站姿 JPG 和竖屏 MP4，本表是默认主路径。JPG 必须先转成 PNG（MCP 静图/抠图只吃 PNG），并拷进当前 Tuner 项目工作区（`file_path` 要在 XSXB 根内）。

黑底按生成板处理：`xsxb_cutout` 用 `key_mode: "border_flood"` + `key_color: "#000000"`。保护冰蓝高光，不要把刀刃抠空。

## 坐标系（两项不要混）

| 空间 | 工具 | 怎么说话 |
| --- | --- | --- |
| 静图 | `xsxb_overlay_grid` / `place_image` | 只报 A1 式 cell id；带当次 `overlay_id`。`view` 是原图像素。 |
| 动画 | `xsxb_export_sheet` / `inspectFeet` / `plant_feet` | `grid.cells[row][col]` 组坐标。脚底种到 **y=-1**，不要种到黄色 0,0。 |

不要把静图 `overlay_id` / `view` 拿去填动画 `grid.cells`，反过来也不行。

## 用例

编号：`W1-项-序号`。每条：**前置 → 步骤 → 期望 → 失败即**。

---

### 1. 素材接入

#### W1-1-1 列出项目并设为当前

- **前置：** 本地 Tuner 项目已存在（或测试夹具建好 `warrior`）。
- **步骤：** `xsxb_list_projects` → `xsxb_set_active_project` `project_id` 对上该项目。
- **期望：** 回执里能看到该项目；后续省略 `project_id` 打到它。
- **失败即：** 空列表、设完仍打到别的项目。

#### W1-1-2 导入挥砍片

- **前置：** 有 ffmpeg；短检可用转好的 320×320、约 0.8s / 10fps 片段（避免一次 base64 145 张 944 图）。全量导入是另一次手跑，不挡主路径。
- **步骤：** `xsxb_import_video` `file_path` = 短片（或原 MP4），`animation_id` 如 `ice_slash`，`fps` 与片一致。
- **期望：** `importedFrameCount` ≥ 4；`xsxb_get_animation` 帧数一致；每帧 PNG 在工作区。
- **失败即：** 0 帧、路径在根外、`in_place` 对视频成功（视频抽取禁止 in_place）。

#### W1-1-3 静图进工作区

- **前置：** 两张 JPG 在素材目录。
- **步骤：** 转 PNG，拷进项目工作区，记 `warrior.png` / `sword.png`。
- **期望：** 两张都能被 `xsxb_overlay_grid` / `xsxb_cutout file_path` 打开。
- **失败即：** 仍是 JPG 就调 overlay/cutout（会拒）。

---

### 2. 抠图

#### W1-2-1 站姿人抠黑底

- **前置：** W1-1-3。
- **步骤：** `xsxb_cutout` `file_path` = `warrior.png`，`key_mode: "border_flood"`，`key_color: "#000000"`。
- **期望：** `verify.status` = `confirmed`，`processedFrameCount` ≥ 1；四角透明；透明像素比例大约 0.35–0.97；冰蓝主体还在（刀/霜不是整片被掏空）。源 PNG 不变，产物在 `.xsxb/`。
- **失败即：** 报告成功但四角仍黑；或人/刀被抠没。

#### W1-2-2 单独刀抠黑底

- **前置：** 同上，对象是 `sword.png`。
- **步骤：** 同 W1-2-1。
- **期望：** 四角透明；刀的冰蓝/高光还在。记下 `sword_cut` 路径。
- **失败即：** 刀轮廓被吃成空壳，或黑底还在。

#### W1-2-3 已抠过再抠是 noop 而不是假失败

- **前置：** W1-2-1 的产物。
- **步骤：** 对 **已抠 PNG**（不是源图）再 `xsxb_cutout` 一次。
- **期望：** 仍成功；`verify.status` = `suspected_noop`（合法 skip）。不要改成抛错打断。
- **失败即：** 对源图再抠却标 noop（源图边框还是黑的，应再抠）；或 noop 被当成失败。

#### W1-2-4 动画帧抠黑底

- **前置：** W1-1-2。
- **步骤：** `xsxb_cutout` `animation_id` = `ice_slash`，同样 `border_flood` + `#000000`。
- **期望：** `confirmed`；第 0 帧四角透明；冰蓝还在。
- **失败即：** 全 skip 却标 `confirmed`；或刀光/刀刃被当成背景清掉。

---

### 3. 分析整理

#### W1-3-1 analyze 一次出预览

- **前置：** 已导入（最好已抠）。
- **步骤：** `xsxb_analyze` `animation_id` = `ice_slash`。
- **期望：** `applied: false`；有 duplicates；有 loop 或 motion；`preview.path` 文件存在。不要对每个候选再 `export_sheet`。
- **失败即：** 把回执当已 `reorganize`；`autoAdjustedThreshold` 时直接 apply order（除非传了 `auto_adjust`）。

#### W1-3-2 挥砍片当 one-shot 看

- **前置：** W1-3-1。
- **步骤：** 看 `loop.oneShotLikely` 和 preview。本片是短爆发挥砍，不是走跑循环。
- **期望：** 更像 motion 窗口，而不是把整段当成循环 gait。人眼看 preview，不要只信推荐 period。
- **失败即：** 未看片就 `reorganize` 成循环。

---

### 4. 静图格子、量刀、图度贴合

（含本轮 fusion：overlay_id、默认质心、cells 不泄像素、verify、next、plan_id。）

#### W1-4-1 overlay 站姿抠完图

- **前置：** W1-2-1 产物。
- **步骤：** `xsxb_overlay_grid` `file_path` = 抠完的人。默认 8×8。
- **期望：** `overlay_id` 形如 `ovl_` + 12 位 hex；`cells.A1` 只有 `{ id: "A1" }`，**没有** `x1/y1/x2/y2`；1408 全图格宽 ≥ 40 → `next: "crop_from"`；`overlay_path` 给人看。源图不变。
- **失败即：** 回执带像素盒；没有 `overlay_id`；全图粗格不给 `next`。

#### W1-4-2 crop_from 手部接触格

- **前置：** W1-4-1。人眼看 overlay，只报手/握把那一格（及需要的邻格）。
- **步骤：** 再 `xsxb_overlay_grid`，`crop_from: { parent_view, cells, padding_cells, overlay_id }`，`overlay_id` 必须是 **父** overlay 的 id。
- **期望：** 新 `overlay_id` 与父不同；已裁块不再提示 `next: crop_from`。
- **失败即：** 用错父 id 却成功；或把动画 `grid.cells` 填进 `parent_view`。

#### W1-4-3 换图后旧 overlay_id 硬失败

- **前置：** 已有 id。改 PNG 字节（再抠、换文件、或改 view）。
- **步骤：** `crop_from` / `place_image` 仍带旧 `overlay_id`。
- **期望：** `STALE_OVERLAY`，不静默贴到错图。
- **失败即：** 旧 A1 仍能 place。

#### W1-4-4 省略 overlay_id（兼容）

- **前置：** 旧脚本/非 agent-led。
- **步骤：** `place_image` 不带 `overlay_id`。
- **期望：** 仍可合成；`warnings` 写明未做新鲜度校验。Skill：agent-led **必须**带 id。
- **失败即：** 省略 id 直接拒（破坏兼容）；或 agent 路径也不带 id。

#### W1-4-5 量单独刀

- **前置：** W1-2-2。
- **步骤：** `xsxb_measure_image` `file_path` = 抠完的刀，`t: "2/3"`（柄往尖）。
- **期望：** `pommel` / `tip` / `at` 有有限坐标；轴长明显大于噪声（> 20px）。厚端是柄，薄端是尖。
- **失败即：** 把尖当柄；或自己把 `at` 换成画布像素再去填 place 的自由 `x,y`。

#### W1-4-6 量人脚（静图）

- **前置：** W1-2-1。
- **步骤：** `xsxb_measure_image` `anchor: "alpha_bottom"`。
- **期望：** 不透明脚点，与 place 的 `alpha_support` 同一套几何。
- **失败即：** 和动画组坐标 `y=-1` 混用。

#### W1-4-7 图度再 place

- **前置：** 两张抠完图都 overlay 过；用户确认要合成。
- **步骤：**
  1. `xsxb_plan_place`：intent、read（接触格）、physics≥2、accept、3–5 步 plan；`proposed.layer` / `snap`。
  2. 执行 `receipt.brief`。
  3. `xsxb_place_image` 带 `plan_id`、人侧 `overlay_id` + 手部 cells（不写 snap/derive → 默认 `alpha_centroid`）；刀侧 `measure_t` 握把；`layer` 与 brief 同向。
- **期望：** `plan_id` 形如 `pln_` + 12 hex；`next: place`（除非 `await_confirm`）；place `verify.status` 不是 `suspected_noop`；合成图冰蓝还在。禁止自由 `x,y`。
- **失败即：** 无 plan 的 agent-led 直接 place（catalog 允许无 plan，但本用例要求有）；或默认落到格心导致握把漂在掌外。

#### W1-4-8 plan 错配

- **前置：** brief 写了 `under_target` 或 `front` + 质心。
- **步骤：** place 改成相反 `layer`，或显式 `derive: "center"`。
- **期望：** `PLAN_MISMATCH`。
- **失败即：** 带了 `plan_id` 仍按错 layer/格心贴完。

---

### 5. 种脚与比例

#### W1-5-1 量动画帧

- **前置：** 动画已抠。
- **步骤：** `xsxb_measure_frames`。
- **期望：** 每帧有 `feetY` / bbox / body。`feetY` 是靴底，连着的亮刀光不算进去。
- **失败即：** 把刀光下沿当鞋底去种。

#### W1-5-2 种脚到 y=-1

- **前置：** 已量；人眼用当次 sheet/`inspectFeet` 核对靴底格。
- **步骤：** `xsxb_plant_feet` 先 `dry_run`，再 `apply: true`。默认 `target_y: -1`。
- **期望：** dry 不写盘；apply 后靴底在最后一行像素附近（组坐标 y=-1）。**不要**种到 0,0。
- **失败即：** 种到黄色 0,0 裁掉 1px 鞋底；或把静图 overlay 的 A1 填进 `to` 却当组坐标。

#### W1-5-3 估比例（本轮不改算法）

- **前置：** 已种或已量。
- **步骤：** `xsxb_estimate_visual` `target_height`（或对照 idle 的 `reference_animation_id`）。先不要 `apply`，看 `groupScale`。
- **期望：** `targetHeight` 对得上；`groupScale` > 0。写像素要另走 `xsxb_cutout apply_visual` + canvas。
- **失败即：** 把估倍率当成已经锁脚/已经烤进 PNG。

---

### 6. 导出

#### W1-6-1 联系表（机器格子）

- **前置：** 动画已抠、已种（或明确未种）。
- **步骤：** `xsxb_export_sheet` `grid_divs: "8x8"`（或按画幅填 density）。
- **期望：** `outputPath` 存在；`grid.cells[row][col]` 有组坐标；`lastPixel.group.y === -1`。源动画 PNG 不变。写回用 JSON，不要 OCR 格子数字。
- **失败即：** 把 overlay 上的行列号手抄成画布像素。

#### W1-6-2 给人看的表

- **前置：** 要看动作/刀光，不是种地。
- **步骤：** `xsxb_export_sheet` `grid: false`。
- **期望：** 图上没有 0,0 / -1 刻度干扰。GIF 另出。
- **失败即：** 人眼验收还开着种地网格。

#### W1-6-3 GIF

- **前置：** ffmpeg。
- **步骤：** `xsxb_export_gif`。默认品红底（避免透明脚在黑底上跳）。
- **期望：** 文件头 `GIF87a` / `GIF89a`；能播。挥砍的弓形拖影以 sheet 为准（正向播可能藏 7 字）。
- **失败即：** 只看 GIF 就过刀光。

---

### 7. 挥砍图度（不在本用例里画刀光）

#### W1-7-1 plan_smear

- **前置：** 已抠帧；用 **静图** `xsxb_overlay_grid` 看某一帧 PNG（不要用动画 `grid.cells` 当 overlay_id）。
- **步骤：** 人眼追刀头格子。`xsxb_plan_smear`：`motion` 写本片读到的路径，`path_kind: "polyline"`（折线月牙，不要默认 Hermite），`color` 从刀刃冰蓝取样（不要写死红），`frames[]` 锁 start/end/head。end 不要落在 striking-mass 那一格。
- **期望：** 只有 `brief` + 锁定格；**不**写出 smear PNG。执行 brief 才是后面 GenerateImage / cutout / place，本用例停在 brief。
- **失败即：** 跳过 plan 直接 GenerateImage；或把牛来 D1→G3 当本片配方。

---

## 明确不做（本套用例）

- 对 Tuner UI 做 Computer Use / AX / 拟人鼠标
- MCP 内 VLM、YOLO、`[0,1000]`
- 静图 `view` 与动画 `grid.cells` 共用一套 overlay_id
- 在 W1-7 里画完月牙并宣称过眼（那是另一轮，要人看 sheet）

## 可执行对照

自动化只覆盖文档的一条主路径（短片 + 两张静图），用来防回归，**不能代替**人眼看 overlay / sheet：

```bash
node --test tools/tests/xsxb_mcp_real_warrior_weapon.test.js
```

无素材目录或无 ffmpeg 时 skip。已列入 `npm run check:mcp`。
