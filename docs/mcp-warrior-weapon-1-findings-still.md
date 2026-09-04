# 战士皮肤武器1 · 静图半 · MCP 实测

> MCP 实现已迁到 [x-frame-mcp](https://github.com/Sirhap/x-frame-mcp)。本文是当时的实测记录。

日期：2026-09-03  
路径：user-xsxb MCP（会话刚 reload），不是 Node 单元测试主路径。  
素材：`grok-0408eaa1-f413-40cb-946b-5f62c9cc9a65.jpg`（人+冰剑）、`grok-051b0079-1bac-4d13-bba7-382a2b950bd3.jpg`（单独斜置冰剑），皆 1408×1408 黑底。  
项目：`xsxb_list_projects` 当时 active 是 `emberline_enemies`；与视频 sibling 一样落到独立项目 `test`。`xsxb_set_active_project` `project_id=test` 后省略 `project_id` 打到它。Tuner 工作区活着，没有调用 `xsxb_open_tuner`。

工作区 PNG：

- 源：`workspace/projects/test/warrior-weapon-1/warrior.png`、`sword.png`（sips 从 JPG 转出，RGB，源 JPG 未进 MCP）
- 抠图产物：`workspace/projects/test/.xsxb/warrior_cut.png`、`sword_cut.png`
- overlay 实际落点：`workspace/.xsxb/warrior_cut_grid.png` 等（**不是**项目 `.xsxb/`，见下）
- 合成：`workspace/projects/test/.xsxb/warrior_placed.png` + `warrior_placed_verify.png`

未导入视频、未种动画帧。

---

## 用例结果

### W1-1-3 静图进工作区 → **pass**

- 两张 JPG 转 PNG 后拷进 `test` 工作区，1408×1408 RGB。
- `xsxb_overlay_grid` 对两张 PNG 都能打开（`overlay_id` `ovl_4cc6969c48d5` / `ovl_a49ef5edd603`）。
- `xsxb_cutout` `file_path` 也能打开（见 W1-2-1/2）。
- 负例：把原 JPG 拷进同一目录再 overlay → `ok:false` `file_path must be a PNG.` `code=xsxb_tool_error`。符合「仍是 JPG 会拒」。

### W1-2-1 站姿人抠黑底 → **pass**

- `xsxb_cutout` `file_path=…/warrior.png` `key_mode=border_flood` `key_color=#000000`（未加 `protected_colors`）
- 回执：`verify.status=confirmed`，`processedFrameCount=1`，`skippedFrameCount=0`，`output_path=…/test/.xsxb/warrior_cut.png`
- 源 `warrior.png` 仍是 RGB，未被覆盖。
- 像素：四角 `(0,0,0,0)`；透明比 **0.8973**（落在 0.35–0.97）；冰蓝不透明像素约 11.8 万；不透明近黑 = 0。
- 人眼（棋盘底）：人、刀、霜还在，黑底没了。刀刃没有整片被掏空，本轮不必保护冰蓝。

缺口：`file_path` 抠图回执没有动画那套 `keyed` / `bodyHeight` / 透明比，只能自己量像素。

### W1-2-2 单独刀抠黑底 → **pass**

- 同样参数，对象 `sword.png`。
- 回执：`confirmed`，`processedFrameCount=1`，`sword_cut` = `…/test/.xsxb/sword_cut.png`
- 像素：四角透明；透明比 **0.8671**；冰蓝约 19.4 万；不透明近黑 = 0。
- 人眼（棋盘底）：斜置冰剑、柄缠绕、浮冰碎片还在。

### W1-2-3 已抠过再抠是 noop → **pass**

- 对 **已抠** `warrior_cut.png` 再 `xsxb_cutout`（同样 `border_flood` + `#000000`）
- 回执：仍成功；`verify.status=suspected_noop`；`processedFrameCount=0`；`skippedFrameCount=1`；写出 `warrior_cut_cut.png` 但跳过处理。
- **没有**当成失败抛错。未对源图误标 noop（源图边框仍不透明，W1-2-1 是 `confirmed` 不是 noop）。

### W1-4-1 overlay 站姿抠完图 → **pass**（附路径缺陷）

- `xsxb_overlay_grid` `file_path=…/warrior_cut.png` 默认 8×8
- `overlay_id=ovl_303e5af96f22`（`ovl_` + 12 hex）
- `cells.A1={id:"A1"}`，没有 `x1/y1/x2/y2`
- `cell_width_px=176` ≥ 40 → `next=crop_from`
- 源抠图未改。人眼 overlay：人在 D–E 列，**手/握把在 F6**，柄/pommel 邻格 **E6**，刃往 G2。

缺陷：默认 `overlay_path` 写成 `workspace/.xsxb/warrior_cut_grid.png`，不是当前项目 `workspace/projects/test/.xsxb/`。抠图/place 走项目 `.xsxb`，overlay 掉到 Tuner 根 `workspace/.xsxb`。实现上 `overlayGridImage` 调 `resolveOutputPath` 时没把 `options.artifactDir` 传进去，回退 `mcpArtifactDir("", root)`。

### W1-4-2 crop_from 手部接触格 → **pass**（附覆盖）

- 人眼只报接触格 **E6、F6**（握把 + 邻格），`padding_cells=1`，`overlay_id` 用父 `ovl_303e5af96f22`，`parent_view` 为全图 `{x:0,y:0,width:1408,height:1408,rows:8,cols:8}`。
- 新 `overlay_id=ovl_ab788fa83153`（与父不同）；`view` 仍是原图像素 `{x:528,y:704,width:704,height:528}`；回执 **没有** `next: crop_from`。
- 人眼裁块：掌/握在 **D3**，柄往下 D4。

缺陷：默认输出名仍是 `warrior_cut_grid.png`，把父 overlay **覆盖掉了**。要留全图格子必须自己设 `output_path`。

### W1-4-3 换图后旧 overlay_id 硬失败 → **pass**

- `crop_from` 仍带未抠图的 `ovl_4cc6969c48d5`（换文件/再抠后的旧戳）  
  → `ok:false` `code=STALE_OVERLAY`  
  `crop_from overlay_id is stale for the current PNG and view. Received ovl_4cc6969c48d5.`
- `xsxb_place_image` 用裁块 `view` 却填父 id `ovl_303e5af96f22`  
  → `STALE_OVERLAY` `target_anchor overlay_id is stale for the current PNG and view.`
- **没有**静默贴到错图。

### W1-4-4 省略 overlay_id（兼容） → **pass**

- `place_image` 不带 `overlay_id`（也没 `plan_id`），`output_path=warrior_placed_noolay.png`
- 合成成功；`warnings`: `target_anchor.overlay_id omitted: overlay freshness was not checked`
- 默认 snap 是 `alpha_centroid`（`resolved.mode=snap`）。没有因为缺 id 直接拒。

### W1-4-5 量单独刀 → **fail**

斜置冰剑（bbox 约 323–1055 × 63–1325，宽 732、高 1262）。`t="2/3"` 被接受（schema 写 number，实际字符串也能进）。

回执：

- `pommel={x:693.4,y:1325}`，`tip={x:693.4,y:63}`，`direction={x:0,y:-1}`，`length=1262`
- `at`（t=2/3）=`{x:693.4,y:483.7}`

像素抽查：pommel、tip、t=2/3 **都是透明**。只有竖直中线穿过刀身的一段（y≈495–1068）不透明。人眼刀轴是底左柄 → 顶右尖，不是画布竖线。

期望：有限坐标且落在刀上；轴长 > 20；厚端是柄、薄端是尖。  
实际：轴被 AABB 启发式锁成竖直（`extentY >= extentX * 1.15` 时不做 PCA），端点落在 bbox 外的透明处。厚/薄在这条假轴上没有意义。

`t=0.25` 的 `at={x:693.4,y:1009.5}` 碰巧不透明（深青），但不是柄。

同工具对未抠 RGB 站姿图会把整张画布当主体（水平 0→1407），必须先抠再量。

### W1-4-6 量人脚（静图） → **pass**

- `xsxb_measure_image` `anchor=alpha_bottom` on `warrior_cut.png`
- `space=image_pixels`（没有组坐标 `y=-1`）
- `at={x:684,y:1138}`，`alpha_support` 同点，`bbox.maxY=1137`
- 与 place 的 `alpha_support` 同一套几何。没有拿去填动画 `plant_feet`。

### W1-4-7 图度再 place → **pass**（附缺陷）

第一次 `xsxb_plan_place` 在 `read.object_cells=["C7"]`（眼睛看到的刀柄格），brief `plan_id=pln_dc245ee4fd2f`，`next=place`。  
按用例用 `object_anchor.measure_t=0.25` + 该 `plan_id` place → **`PLAN_MISMATCH`** `plan_id object cells do not match object_anchor.cells.`  
catalog/用例允许刀侧 `measure_t`，但校验把「读到的格子」当成必须出现在 `object_anchor.cells` 里，和 `measure_t` 互斥。

第二次 brief **不填** `object_cells`：`plan_id=pln_194fd0830df8`。  
`xsxb_place_image` 带该 id、人侧裁块 `overlay_id=ovl_ab788fa83153` + cells `D3`（省略 snap/derive）、刀侧 `measure_t=0.25`、`layer=under_target`、`scale.relative` 全图身高 D3–E7。

回执：写出 `warrior_placed.png`；`resolved.snap=alpha_centroid`；`verify.status=unverified`（因为 `aspect mismatch: scaled by one edge`）；checks `anchor_mapped` / `snap_opaque` / `under_target_cover` 皆 `ok`；**不是** `suspected_noop`。

人眼（品红底）：第二把冰蓝刀叠在原持剑上，手仍在柄区，不是漂在空白格。冰蓝还在。禁止自由 `x,y` —— 本次没有。

不能算视觉合格的「换刀」：站姿图本来就有剑；`measure_t` 轴又是错的，新刀不是按真柄贴的。

### W1-4-8 plan 错配 → **pass**

在 `pln_194fd0830df8`（`proposed.layer=under_target`，`snap=alpha_centroid`）上：

- `layer=front` → `PLAN_MISMATCH` `plan_id proposed.layer is under_target, place used front.` **没有**按错 layer 贴完。
- `target_anchor.derive=center` → `PLAN_MISMATCH` `plan_id proposed.snap is alpha_centroid, target_anchor used derive.`

顶层误传 `derive`（不在 schema）→ `xsxb_invalid_arguments`，不是 PLAN_MISMATCH。

---

## Bugs

1. **斜置武器 `measure_image` 轴错（W1-4-5）**  
   - 工具：`xsxb_measure_image`  
   - 参数：`file_path=…/sword_cut.png`，`t="2/3"`（及 `0.25`）  
   - 回执：`direction={0,-1}`，pommel/tip 在 x≈693 的竖线两端  
   - 期望：沿刀的对角长轴，端点在不透明刃/柄上  
   - 实际：`measureLongAxis` 在 `extentY >= extentX * 1.15` 时强制竖直，跳过 PCA。本刀宽 732、高 1262，命中该分支。pommel/tip/t=2/3 像素透明。

2. **`plan_place` 的 `read.object_cells` 会卡死 `measure_t` place（W1-4-7 第一刀）**  
   - 工具：`xsxb_place_image` + `plan_id=pln_dc245ee4fd2f`  
   - 参数：`object_anchor.measure_t=0.25`（无 cells），`layer=under_target`  
   - 错误：`PLAN_MISMATCH` `object cells do not match object_anchor.cells`  
   - 期望：用例写「刀侧 measure_t 握把」；`object_cells` 只是读图笔记  
   - 实际：`assertPlanMatches` 在 `object_cells` 非空时要求 `object_anchor.cells` 同集，与 `measure_t` 不能组合。workaround：brief 里不填 `object_cells`。

3. **`overlay_grid` 默认写到 Tuner `workspace/.xsxb/`，不是当前项目 `.xsxb/`（W1-4-1）**  
   - 工具：`xsxb_overlay_grid`  
   - 实际路径：`…/XSXB-Frame-Tuner/workspace/.xsxb/warrior_cut_grid.png`  
   - 期望：与 cutout/place 一样 `workspace/projects/test/.xsxb/`  
   - 实际：`overlayGridImage` 未把 `options.artifactDir` 传给 `resolveOutputPath`。

4. **crop_from 默认覆盖父 overlay 文件（W1-4-2）**  
   - 同一默认名 `*_grid.png`。父 8×8 图被裁块覆盖，回看全图格子只能重跑或事先改 `output_path`。

5. **相对缩放一出现宽高警告，`verify.status` 永远不能 `confirmed`（W1-4-7）**  
   - 回执：`warning=aspect mismatch: scaled by one edge, not stretched`，checks 全 ok，但 `status=unverified`（`scaleWarning` 直接降级）。  
   - 期望：几何检查过了应能 `confirmed`，警告单独留在 `warnings`。

---

## MCP 使用难点

- 静图 `view`/`overlay_id` 与动画 `grid.cells` 必须分清；本半只用了前者。裁块后格子重编号（全图手=F6，裁块掌=D3），place 必须用**当次** overlay 的格子 + `overlay_id`。
- Agent-led 必须带 `overlay_id`；省略能合成但只给 warning。旧 id 硬失败，这点好用。
- `plan_place` 的 `read.*_cells` 不是注释：会参与 PLAN_MISMATCH。眼睛看到的刀格如果只是笔记，不要放进 `object_cells`，否则无法 `measure_t`。
- `measure_t` 的 `at` 是回执像素，不能再拿去填自由 `x,y`（工具会拒）。轴错时只能换 cells+snap，或先修轴。
- overlay 和 cutout 产物目录不一致，按 `overlay_path` 回执找图，不要猜项目 `.xsxb/`。
- 1408 默认 8×8 一定会 `next=crop_from`；不裁就 place 格子太粗。
- JPG 必须先转 PNG 且路径在 XSXB 根内；MCP 没有「素材接入」工具，拷文件是 agent 在壳里做的。
- 站姿图已经持剑，再 place 一把刀只会叠刃，不是换装。

---

## 优化点

- `measureLongAxis`：对角线武器不要用 AABB 长短边抢 PCA；端点应落到不透明像素（或沿轴夹紧到 alpha）。
- `assertPlanMatches`：有 `measure_t` 时不要拿 `read.object_cells` 对 `object_anchor.cells`；或 schema/brief 写明 object_cells 与 measure_t 互斥。
- `overlayGridImage` 把 `artifactDir` 传进 `resolveOutputPath`；crop 默认加 `_crop` 后缀以免盖掉父图。
- `file_path` 抠图回执补上透明比 / 四角 / keyed，避免 agent 另写像素脚本才能验收 W1-2。
- 相对缩放的 aspect warning 不要把 `verify.status` 从 `confirmed` 打成 `unverified`。
- 需要 `warrior` 夹具或 MCP `create_project`：现在只能借用 `test`（视频半同一结论）。

---

## 本半未跑

W1-1-1/1-2、W1-2-4、W1-3、W1-5、W1-6、W1-7（视频 sibling）。
