# XSXB Web、MCP 与本地 Bridge 架构

## 目标

将 XSXB Frame Tuner 的操作界面部署为网站，同时让 Codex 等 AI 客户端通过 MCP 操作本地图片、视频和 Godot 项目。

默认采用本地优先设计：

- 原始图片和视频保留在用户本机。
- 图像处理、视频拆帧和 Godot 文件写入在本机完成。
- 云端网站负责界面、账号和可选的调参数据同步。
- AI 通过受限 MCP 工具调用本地 Bridge，不直接访问任意文件或执行任意 Shell 命令。

## 组件职责

### Skill

Skill 是 AI 的工作流程和操作规则，负责：

- 理解动画导入、调参、同步和验证的完整流程。
- 决定工具调用顺序。
- 定义完成条件和人工确认条件。
- 引导 Codex 调用 XSXB MCP 工具。

Skill 不承载核心业务实现。

### MCP

MCP 为 Codex 提供语义化工具，例如：

- `xsxb_list_projects`
- `xsxb_import_animation`
- `xsxb_get_animation`
- `xsxb_update_frame_boxes`
- `xsxb_update_timing`
- `xsxb_reorganize_frames`
- `xsxb_sync_godot`
- `xsxb_validate_project`
- `xsxb_open_tuner`

MCP 工具只接受项目、角色、动画和帧等业务标识，不接受任意 Shell 命令或不受限制的文件路径。

### 本地 Bridge

本地 Bridge 是真正执行操作的常驻 Node.js 程序，负责：

- 读取和处理本地图片、视频。
- 管理本地项目数据。
- 保存动画调参和碰撞框。
- 同步和验证 Godot 项目。
- 为网页提供 HTTP/WebSocket 接口。
- 为 Codex 提供本地 MCP 接口。
- 校验网站 Origin、设备配对和操作权限。

本地 MCP Server 与 Bridge 可以运行在同一个 Node.js 进程中，共享相同的 Core Services。

### 云端网站

云端网站负责：

- 可视化动画和调参界面。
- 用户登录和设备配对。
- 展示 Bridge 的执行状态。
- 可选地同步调参 JSON、版本和项目元数据。

默认不上传原始图片、视频或完整 Godot 项目。

## 调用关系

```text
用户请求
  -> Codex
  -> XSXB Skill 决定工作流程
  -> MCP 调用语义化工具
  -> 本地 Bridge 执行业务操作
  -> 本地素材、项目数据和 Godot

云端网页
  -> 本地 Bridge
  -> 展示和修改同一套本地业务数据
```

Bridge 执行本地操作，Bridge 不负责启动或控制 Codex。

## 网页连接方式

第一阶段可以让网站连接只监听 `127.0.0.1` 的 Bridge，并实现：

- Origin 白名单。
- 一次性设备配对令牌。
- CORS 和 Private Network Access 处理。
- WebSocket 会话鉴权。

如果公网 HTTPS 页面无法稳定连接本地 HTTP 服务，则改为：

```text
本地 Bridge -> 主动连接云端安全通道
云端网页 -> 云端通道 -> 本地 Bridge
```

该通道默认只传递指令、状态和调参数据，不传递原始图片或视频。

## 当前实现

当前 `xsxb-frame-tuner` Skill 采用本地执行模式：

1. 定位或克隆本地 XSXB Frame Tuner 仓库。
2. 直接调用仓库中的 Node.js 导入、同步和验证脚本。
3. 直接读写本地素材目录和 Godot 项目。
4. 在任务完成后启动本地 Tuner Web 服务。
5. 用户通过 `http://127.0.0.1:5179` 打开本地界面。

当前仓库已经提供本地 STDIO MCP Server，并与工作台共用项目存储、附件、拖影、导入、调参、导出和 Godot 同步服务。Agent 可通过 31 个 `xsxb_*` 工具完成生产闭环；HTTP/WebSocket 设备配对 Bridge 仍属于后续云端连接阶段。

## 推荐迁移顺序

1. 从现有 `server.js` 和工具脚本中抽离 Core Services。
2. 保持现有本地网页继续使用 Core Services。
3. 增加本地 Bridge 和 MCP Server。
4. 将 Skill 改为优先调用 MCP 工具。
5. 部署云端网站并实现设备配对。
6. 根据需要增加云端调参同步、版本管理和多人协作。

迁移期间保留现有脚本作为兼容入口和故障回退方式。
