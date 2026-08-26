# XSXB MCP

本目录是给人看的安装入口，不是独立产品仓库。STDIO 服务仍在仓库内：

- `../tools/xsxb_mcp_server.js`：JSON-RPC 传输与 `initialize.instructions`
- `../tools/xsxb_mcp_service.js`：工具实现
- `../docs/mcp-bridge-architecture.md`：Web / Skill / MCP / 本地 Bridge 职责

不要把实现拆到单独的 MCP 仓库。改能力时改 `tools/`，这里只更新安装说明。

## 谁能读到什么

| 读者                  | 能自动看到                                                      | 需要自己打开                       |
| --------------------- | --------------------------------------------------------------- | ---------------------------------- |
| 已接入本 MCP 的 Agent | `initialize.instructions`、`tools/list`、每次 `tools/call` 回执 | 本 README、skill                   |
| 人                    | 无（多数客户端不展示 `instructions`）                           | 本 README、示例配置、主仓库 README |

别人克隆本仓库后，读本目录即可接入。他们读不到你本机 `~/.cursor/mcp.json`，也读不到你的 Godot 路径和项目数据。

## 接入 Cursor

1. 仓库根目录需要能跑 `node`。抠图 / 视频抽帧还需要本机 `ffmpeg`。
2. 把 [`cursor.mcp.example.json`](cursor.mcp.example.json) 合并进 Cursor 的 MCP 配置。
3. 重启 Cursor MCP，或在 MCP 面板重载 `xsxb`。
4. 用 `xsxb_list_projects` 确认服务已起来。

Cursor 配置可以放在：

- 用户级 `~/.cursor/mcp.json`
- 打开了本仓库时的项目级 `.cursor/mcp.json`

示例默认假定 **工作区根目录就是 `XSXB-Frame-Tuner/`**：

```json
{
  "mcpServers": {
    "xsxb": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/tools/xsxb_mcp_server.js"]
    }
  }
}
```

如果工作区是外层 `3D-images-tools/`，把路径改成：

```text
${workspaceFolder}/XSXB-Frame-Tuner/tools/xsxb_mcp_server.js
```

不要写本机绝对路径。命令行自检：

```bash
npm run mcp:start
```

## Agent 规则（人也应知道）

服务在 `initialize` 里下发同一段说明，大意是：

- 改数据前先 `xsxb_list_projects` 或 `xsxb_get_project`
- 同步前先 `xsxb_bind_godot`
- 导入用 `xsxb_import_animation`（支持 `start_frame` / `end_frame` / `replace`）；`xsxb_import_video` 只是视频别名
- 抠图用 `xsxb_cutout`（网页同一套智能抠图和滑块；可传 `tolerance` / `feather` / `protected_colors` 等，省略则用共用智能档；已抠帧默认跳过，除非 `force`；回执带 `bodyHeight` / `nearWhite`，`metrics=false` 可关）
- 视频做成循环动画：导入 → `xsxb_find_duplicates`（`threshold` / `duplicate_ratio` 即整理台重复比例滑块，55–100，默认 88）去重复帧 → `xsxb_cutout` → `xsxb_find_loop` → 每个候选 `xsxb_export_sheet`（格子上有绝对帧号，`mark_frame` 标出一格供二次剔除）→ 选最流畅的一组 `xsxb_reorganize_frames` → 以其中一个动画为模版 `xsxb_estimate_visual` 统一比例 → `xsxb_export_gif`
- 循环段用 `xsxb_find_loop`（已导入动画、PNG 目录或 `file_paths`）；重复 hold 用 `xsxb_find_duplicates`；单次动作去头尾 hold 用 `xsxb_find_motion`；应用候选时再 `xsxb_reorganize_frames` 传 `order`
- 统一角色大小先 `xsxb_estimate_visual`（对照参考动画或 `target_height`），或手填 `xsxb_set_visual_transform`；要把组/帧缩放写进像素时用 `xsxb_cutout apply_visual` 加画布，不要在 MCP 外烤图
- 预览用 `xsxb_export_gif`（尊重单帧时长和组/帧 `visual_size`）或 `xsxb_export_sheet` 拼表（格子带调参台组坐标网格，脚底 `0,0`，身体在负 y）。`grid_density` 加密网格线；图上标的是与回执 `grid.cells[row][col]` 对应的行列号。组坐标由代码写在 JSON / `grid.legend` 里，**不要 OCR**。写回用 `grid.cells[row][col]`（row 0 是顶、col 0 是左，`x,y` 是该格左上角组坐标）。AI 按任务和画布大小填 `grid_density`（sparse/normal/dense）、`grid_divs`（如 `8x8`）或 `grid_x`/`grid_y`，以及 `grid_scope`（canvas|subject）；省略则用自动步长。源 PNG 不变
- 写回只报网格上的组坐标：`xsxb_shift_frames` 的 `from`/`to` 或 `dx`/`dy`、框的 `min`/`max`、挂件的 `hand`+`t`、拖尾棍子、视觉偏移。不要自己换成画布像素。改完再 `export_sheet` 核对
- `xsxb_shift_frames` 已在目录（`MCP_TOOL_NAMES` / `tools/list`）。客户端报 not found 是会话目录过期，重载 `xsxb` MCP，不要跳过种植，也不要把 overlay 数字换成画布像素。`grid_divs` / `grid_density` 在 `xsxb_export_sheet` / `xsxb_cutout` 上已经可用
- 黄色 `0,0` 在位图外：`canvasAnchor` 的 `y` 是 `height`，最后一行像素是组坐标 `y=-1`。`to: "0,0"` 会裁掉 1px 鞋底，鞋底种到 `y=-1`
- `metrics.feetY` 会把连着的刀光/辉光算进去。看 overlay 上的靴子种植，不要信 `feetY`
- 量刀图长轴用 `xsxb_measure_image`：厚端是柄，薄端是尖；`t=0.5` 中间、`t=2/3` 或 `"2/3"` 是柄往尖的三分之二。落到舞台时把同一 `t` 和手上的组坐标交给 `xsxb_add_attachment`，不要自己减 `localFromCenter`
- `xsxb_find_duplicates` 回执若带 `autoAdjustedThreshold`，不要直接 `reorganize` 那个 `order`，除非传了 `auto_adjust`
- 挂件/音效用 `file_path`；拖尾可传 `sticks` 与 `texture_path`
- `xsxb_open_tuner` 会在本机 Tuner 没起来时拉起服务
- 默认项目用 `xsxb_set_active_project`
- 先改框和时长，再显式同步
- 验证用 `layer=standalone|bind|gameplay`
- 误导入先 `dry_run` 再删
- 如实回报工具结果，不要编造成功
- MCP 报错、缺能力、或必须离开 MCP 才能做完时：告诉用户，并提到 `XSXB-Frame-Tuner` 项目。带上工具名、参数、回执或错误、期望结果、实际结果。不要静默绕过缺口

完整条文以 `tools/xsxb_mcp_server.js` 的 `INSTRUCTIONS` 为准。Skill 侧见 `skills/xsxb-frame-tuner/SKILL.md` 的 MCP Feedback。

## 当前工具

`xsxb_list_projects` · `xsxb_get_project` · `xsxb_set_active_project` · `xsxb_bind_godot` · `xsxb_import_animation` · `xsxb_import_video` · `xsxb_get_animation` · `xsxb_find_loop` · `xsxb_find_duplicates` · `xsxb_find_motion` · `xsxb_cutout` · `xsxb_estimate_visual` · `xsxb_set_visual_transform` · `xsxb_estimate_boxes` · `xsxb_update_frame_boxes` · `xsxb_update_timing` · `xsxb_replace_frame` · `xsxb_shift_frames` · `xsxb_reorganize_frames` · `xsxb_add_attack_trail` · `xsxb_add_attachment` · `xsxb_add_sfx` · `xsxb_remove_binding` · `xsxb_delete_animation` · `xsxb_sync_godot` · `xsxb_validate_project` · `xsxb_export_gif` · `xsxb_export_sheet` · `xsxb_measure_image` · `xsxb_open_tuner`

工具只接受项目、角色、动画、帧等业务标识，不接受任意 Shell 或不受限文件路径。
