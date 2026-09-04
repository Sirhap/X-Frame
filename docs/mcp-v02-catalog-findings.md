# XSXB MCP v0.2 · 全目录用例实测

日期：2026-09-03  
路径：隔离 `service.callMcp` / `handleMessage`（与 live xsxb 同一套 handler）。6 个 agent 并行，每组独立临时 root，不改 `emberline_enemies` / `warrior_qa` 现有帧。  
Live 开工前 active：`emberline_enemies`。收尾仍是它。

素材：

- 目录夹具 `workspace/projects/mcp_catalog_qa/qa_src/`：`white_walk` 四帧白底蓝块、`ice_hang` 红身+挂冰、`stills/warrior_cut.png`+`sword_cut.png`（已抠）、`ice_slash_short.mp4`
- 战士皮肤原片备份（本轮静图未再转 JPG）：`/Users/sirhao/Downloads/图片素材/程序大陆/战士皮肤武器1`

用例定义：`docs/mcp-v02-catalog-cases.md`。原始回执：`docs/qa/catalog-v02-results/`。

---

## 1. 结论

44 个公开工具都打到了。52 条用例 **51 pass / 1 skip / 0 fail**。主路径（建项目、导入、快照拒绝、抠图、种脚、框/绑定、静图格子、导出、校验/同步）在隔离根上能走通。

没有新的挡主路径 P1。下列五项已修并复测。战士侧斜剑竖直轴（W1-4-5 / B1）本轮 **未复现**。

---

## 2. 问题（已修，复测 2026-09-03）

### P2. `export_sheet` 默认路径撞车 — **已修**

`grid:true` → `*_sheet.png`；`grid:false` → `*_sheet_view.png`。并写 `*.sheet.json` packing sidecar。复测两文件共存。

### P2. overlay `grid_divs=8x8` 切联系表 — **已修**

sidecar packing；仅传 overlay `grid_divs` 且与 `columns×rows` 不符 → `SLICE_PACKING_MISMATCH`。省略网格用 sidecar。C-2-4 用例已改。复测：8×8 被拒；省略网格 `frameCount=4`。

### P3. `shift_frames` +dy 裁挂冰 — **已修**

与 `plant_feet` 一样按 `destMaxY+1` 垫高并写回清单。复测 ice 38→42，青冰 16px 仍在。

### P3. `white_walk` 四帧相同 — **已修**

蓝块 x=4/8/12/16。未抠 overlay mse=11184。抠完 f0 vs f2 红/青错位（`docs/qa/catalog-v02-results/retest-overlay-keyed.png`）。

### P3. Grok 客户端只看到 summary — **已修（文本侧）**

`receiptSummary` 追加 `obs_v1_…` 和产物 basename，不摊 JSON。复测：`xsxb_get_animation: ok obs_v1_14187e894186a92c2a008cd0`。

---

## 3. Skip

| id | 原因 |
| --- | --- |
| C-8-4 | `warrior_cut` 已持剑。按目录「不要叠刃」skip。另用错 `overlay_id` 打到 `STALE_OVERLAY`，未写合成 PNG。`plan_place` 改打 `white_still`+刀。 |

战士皮肤目录里的 JPG 本轮没用：静图 MCP 拒 JPG；已有 PNG 抠图。短视频用了 `qa_src/ice_slash_short.mp4`（抽帧是战士+冰剑）。

---

## 4. 回归对照（战士 W1）

| 旧项 | 本轮 |
| --- | --- |
| B1 斜剑锁成竖直轴，pommel/tip 落在透明像素 | **未复现。** C-8-2：`direction≈(0.50,-0.87)`，柄 `{339,1319}` / 尖 `{1055,63}` 都不透明 |
| B2 着地帧 feetY 把冰花当靴底 | 本轮用合成 `ice_hang`（靴和冰断开 2px）。`feetY=19` 是红靴底，冰 `maxY=25`。**没**用战士挥砍着地帧，B2 不能算修 |
| 无 `create_project` | 已有；C-1-3 幂等 |

---

## 5. 眼睛抽查

- C-4-3 洋红四联：四根蓝条，白底没了（`docs/qa/catalog-v02-results/g3-previews/c43-cutout-preview.png`）
- C-4-4 overlay：人还在；绿盒身体、橙盒刀，不是「人没了」
- C-5-1/5-3：挂冰在靴下，种脚后冰仍可见；清单高度 38 = PNG 高度
- C-8-1 overlay：A1 空；握持 F6；刃 F3–G5

---

## 6. 分组回执

| 组 | 文件 | 范围 |
| --- | --- | --- |
| live 信封 | `docs/qa/catalog-v02-results/g0-live.json` | C-0、C-1-1 |
| g1 | `g1.json` | C-0、C-1、C-10、C-11 |
| g2 | `g2.json` | C-2、C-9 |
| g3 | `g3.json` + `g3-previews/` | C-3、C-4 |
| g5 | `g5.json` | C-5 |
| g67 | `g67.json` | C-6、C-7 |
| g8 | `g8.json` | C-8 |
| retest | `retest.json` + `retest-overlay-keyed.png` | 修复后隔离根复测 |
| live-retest | `live-retest/` | 活 `mcp_catalog_qa` + `handleMessage/callMcp`，17/17 pass |
| mcp-restart | `mcp-restart/` | 新拉起 `xsxb_mcp_server.js` stdio：initialize / tools/list / tools/call，13/13 pass |
| mcp-continue | `mcp-continue/` | 重启后继续：种脚/平移/analyze/validate/open_tuner，14/14 pass |
| session-reload | `session-reload/` | 本会话活 `xsxb__*` reload 后实测 |
