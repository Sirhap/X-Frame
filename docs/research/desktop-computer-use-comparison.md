# 三个开源 Computer Use 项目的源码对比及对 XSXB MCP 的启示

研究日期：2026-09-03

## 结论先行

这三个项目不是同一种实现的三个版本，而是三条明显不同的路线：

| 项目 | 核心感知 | 定位与执行 | 验证 | 最值得借鉴的部分 |
| --- | --- | --- | --- | --- |
| EZComputerCtrl MCP | Windows 截图交给 VLM，一次性生成带语义和 bbox 的对象 JSON | MCP 暴露 `object_id`；内部把 `[0,1000]` bbox 换算成桌面像素并点击中心 | 当前公开工具默认只确认“动作已下发”，要求 Agent 再 `see` | 上层不接触坐标的对象化接口 |
| computer-use-helper / cua-driver | helper 只是路由 Skill；真正的 cua-driver 同时返回 Accessibility 树和窗口截图 | 首选快照绑定的 AX 元素令牌，失败后才走窗口像素、前台、桌面降级 | 动作事实与任务后置条件严格分离，`verify_state` 单独判定 | 完整的 freshness、精确窗口绑定、执行路由梯和结果契约 |
| Enikk | 本地 YOLO 检图标、RapidOCR 读文字，必要时再把截图交给 VLM | LLM 选择 `[0,1000]` 坐标，按窗口客户区换算后用 pynput/pyautogui 操作 | 系统提示要求重新分析；另有 OCR 轮询 `wait_for`，但普通动作不自动闭环 | 低成本本地 OCR/检测层与可观测 SoM 覆盖图 |

对 XSXB MCP，最有价值的架构来源是 **cua-driver**；最有价值的可选感知组件来源是 **Enikk**；EZComputerCtrl 值得保留的是“语义对象而非坐标”的接口方向，但不应复制“每次感知都调用 VLM”“复用无 freshness 的旧快照”或“动作发出即成功”。

## 研究范围与固定版本

结论只使用仓库源码、仓库文档及项目所引用的官方上游源码：

- `JucieOvo/ezcomputerctrl-mcp`：[`2ba84484b445e783261dfee63ef0ae1a71e5a4fc`](https://github.com/JucieOvo/ezcomputerctrl-mcp/tree/2ba84484b445e783261dfee63ef0ae1a71e5a4fc)
- `Mo-Morris/computer-use-helper`：[`5ab50818eee7c15b983b83778b73ff5ac80c1f60`](https://github.com/Mo-Morris/computer-use-helper/tree/5ab50818eee7c15b983b83778b73ff5ac80c1f60)
- helper 指向的实际驱动 `trycua/cua`：[`986b6f257b1afddef0cbd4815bb2744eab7eadba`](https://github.com/trycua/cua/tree/986b6f257b1afddef0cbd4815bb2744eab7eadba/libs/cua-driver)
- `gtt116/enikk`：[`3d7a3f0de675293f8d67b013595ef4ac4b94f35e`](https://github.com/gtt116/enikk/tree/3d7a3f0de675293f8d67b013595ef4ac4b94f35e)

## 1. EZComputerCtrl MCP：VLM 把屏幕直接压缩成语义对象

### 感知来源

它是纯视觉路线，不读取 Windows UI Automation/Accessibility 树。`capture.py` 用 Pillow `ImageGrab` 截取活动窗口或逐显示器截图，同时用 Win32 API 读取活动窗口标题、可见窗口矩形和截图在虚拟桌面的原点；多显示器不会拼成超宽图，而是逐屏送入感知链路。[截图与原点](https://github.com/JucieOvo/ezcomputerctrl-mcp/blob/2ba84484b445e783261dfee63ef0ae1a71e5a4fc/src/ezcomputerctrl/capture.py#L88-L162) [窗口枚举与 DPI](https://github.com/JucieOvo/ezcomputerctrl-mcp/blob/2ba84484b445e783261dfee63ef0ae1a71e5a4fc/src/ezcomputerctrl/capture.py#L239-L282)

截图通过 OpenAI-compatible `chat.completions` 送给多模态模型，要求返回固定 JSON；结果经过 Pydantic 结构校验，而不是由上层 Agent 自己读图。[VLM 调用及结构校验](https://github.com/JucieOvo/ezcomputerctrl-mcp/blob/2ba84484b445e783261dfee63ef0ae1a71e5a4fc/src/ezcomputerctrl/perception.py#L103-L171) 提示协议只保留 `action_area`、`tab_header` 两类对象，bbox 统一为 `[0,1000]`，并要求 actions、confidence、位置说明等字段。[感知协议](https://github.com/JucieOvo/ezcomputerctrl-mcp/blob/2ba84484b445e783261dfee63ef0ae1a71e5a4fc/src/ezcomputerctrl/protocol.py#L36-L51)

代码与依赖中没有 OCR、YOLO 或 UIA 路径，因此它的识别准确率、延迟和 token/推理成本直接依赖 VLM。

### 元素定位与精确点击

MCP 对外只暴露 `see`、`click(object_id)`、`scroll(object_id)`、`move_to(object_id)`、`type_text`、`hotkey`，把 bbox 和真实坐标藏在服务端。[MCP 工具面](https://github.com/JucieOvo/ezcomputerctrl-mcp/blob/2ba84484b445e783261dfee63ef0ae1a71e5a4fc/src/ezcomputerctrl/mcp_server.py#L224-L317)

内部先把模型的归一化 bbox 乘以截图宽高，再加 `origin_x/origin_y` 变成虚拟桌面像素。对象 ID 由类型、名称、分组、位置桶生成，并在下一帧用名称/分组和 IoU 尝试复用。[坐标换算与稳定 ID](https://github.com/JucieOvo/ezcomputerctrl-mcp/blob/2ba84484b445e783261dfee63ef0ae1a71e5a4fc/src/ezcomputerctrl/semantic.py#L184-L277)

点击并不是控件级调用，而是取 bbox 中心点后 `SetCursorPos` + 鼠标 down/up；输入则先根据中心点找顶层窗口、置前、点击，再以 Win32 Unicode `SendInput` 输入；快捷键也通过虚拟键码发送。[中心点动作路由](https://github.com/JucieOvo/ezcomputerctrl-mcp/blob/2ba84484b445e783261dfee63ef0ae1a71e5a4fc/src/ezcomputerctrl/executor.py#L190-L249) [鼠标与键盘底层](https://github.com/JucieOvo/ezcomputerctrl-mcp/blob/2ba84484b445e783261dfee63ef0ae1a71e5a4fc/src/ezcomputerctrl/executor.py#L307-L405)

精度来源因此是：VLM bbox 精度 + DPI/多屏原点换算 + 中心点是否恰好可点。它没有 AX 默认动作、hit-test 复核或控件边界内安全点选择。

### 执行后验证与局限

仓库虽然有 `ActionWatcher`，能比较对象出现/消失、状态变化和错误/成功关键词，[监看器实现](https://github.com/JucieOvo/ezcomputerctrl-mcp/blob/2ba84484b445e783261dfee63ef0ae1a71e5a4fc/src/ezcomputerctrl/watcher.py#L41-L84) 但当前公开执行路径没有调用 `_watch_after_action`：`execute_action` 直接返回 `ResultStatus.SUCCESS`，并明确要求调用者主动再 `see`。[当前动作返回](https://github.com/JucieOvo/ezcomputerctrl-mcp/blob/2ba84484b445e783261dfee63ef0ae1a71e5a4fc/src/ezcomputerctrl/controller.py#L242-L289) `_watch_after_action` 在源码中仅有定义、无调用点。[未接入的重观测路径](https://github.com/JucieOvo/ezcomputerctrl-mcp/blob/2ba84484b445e783261dfee63ef0ae1a71e5a4fc/src/ezcomputerctrl/controller.py#L648-L724)

另一个风险是动作会复用 `state_store.last_snapshot`，没有 TTL、内容哈希或 snapshot token；界面在 `see` 后改变时，旧 `object_id` 仍可能落到旧像素。[旧快照复用](https://github.com/JucieOvo/ezcomputerctrl-mcp/blob/2ba84484b445e783261dfee63ef0ae1a71e5a4fc/src/ezcomputerctrl/controller.py#L260-L277)

平台只支持 Windows，使用 `ctypes.windll.user32`，无 macOS Accessibility/Screen Recording 权限模型。

## 2. computer-use-helper / cua-driver：Accessibility 优先的分层执行器

### 先澄清项目边界

`computer-use-helper` 自己没有驱动源码。仓库只有 README、Skill 和 License；README 明确称 Skill 是“路由规则”，实际 UI 树与控件操作依赖外部 `trycua/cua-driver`。[helper 的真实定位](https://github.com/Mo-Morris/computer-use-helper/blob/5ab50818eee7c15b983b83778b73ff5ac80c1f60/README.md#L5-L17) [依赖声明](https://github.com/Mo-Morris/computer-use-helper/blob/5ab50818eee7c15b983b83778b73ff5ac80c1f60/README.md#L33-L43)

helper 的价值是给 Hermes/Agent 一条实用路由规则：开应用/窗口管理优先 AppleScript 或系统命令，读控件优先 cua-driver，截图用于非 AX 区域和结果确认，坐标点击最后使用。[路由顺序](https://github.com/Mo-Morris/computer-use-helper/blob/5ab50818eee7c15b983b83778b73ff5ac80c1f60/SKILL.md#L44-L92)

以下“核心实现”来自它明确引用的官方上游 `trycua/cua-driver`。

### 感知来源与定位

`get_window_state(pid, window_id)` 默认同时返回 Accessibility 树和该窗口截图，不让调用者先选“AX 模式”或“视觉模式”。动作时才决定用元素令牌还是像素。[双通道感知](https://github.com/trycua/cua/blob/986b6f257b1afddef0cbd4815bb2744eab7eadba/libs/cua-driver/rust/Skills/cua-driver/SKILL.md#L479-L531)

macOS 截图主路径使用 ScreenCaptureKit 的 `SCScreenshotManager` 和 desktop-independent window filter，原生失败才退到 `screencapture -l`。[截图后端](https://github.com/trycua/cua/blob/986b6f257b1afddef0cbd4815bb2744eab7eadba/libs/cua-driver/rust/crates/platform-macos/src/capture.rs#L1-L25) 捕获计划绑定 window id、owner pid、layer、bounds，并在输出前再次校验窗口身份；发生变化会重建一次，再变则 fail closed，避免旧窗口像素逸出。[身份校验与重建](https://github.com/trycua/cua/blob/986b6f257b1afddef0cbd4815bb2744eab7eadba/libs/cua-driver/rust/crates/platform-macos/src/capture.rs#L559-L620)

Accessibility 元素缓存按 `(pid, window_id)` 保存一次树遍历得到的原生句柄。[元素缓存](https://github.com/trycua/cua/blob/986b6f257b1afddef0cbd4815bb2744eab7eadba/libs/cua-driver/rust/crates/cua-driver-core/src/element_cache.rs#L1-L35) 每次快照生成新的 `snapshot_id` 和不透明 `element_token`；旧 token 在新快照后失效，裸 `element_index` 必须与同一 `snapshot_id` 一起使用。[freshness 约束](https://github.com/trycua/cua/blob/986b6f257b1afddef0cbd4815bb2744eab7eadba/libs/cua-driver/rust/Skills/cua-driver/SKILL.md#L332-L360)

后台动作发出前还会重新读取 WindowServer ownership、当前 AXWindows 成员、最小化/隐藏状态、同进程其他顶层窗口以及元素祖先，任何无法证明的事实都 fail closed，防止输入落到同进程的兄弟窗口。[精确目标事实采集](https://github.com/trycua/cua/blob/986b6f257b1afddef0cbd4815bb2744eab7eadba/libs/cua-driver/rust/crates/platform-macos/src/ax/exact_target.rs#L1-L8) [窗口和元素归属判断](https://github.com/trycua/cua/blob/986b6f257b1afddef0cbd4815bb2744eab7eadba/libs/cua-driver/rust/crates/platform-macos/src/ax/exact_target.rs#L142-L205)

### 精确点击和输入

标准路由梯是：直接 API/CLI 或类型化业务动作 → 后台 Accessibility → 同一快照的后台像素 → 有证据时显式前台 → 单次桌面兜底。[完整路由梯](https://github.com/trycua/cua/blob/986b6f257b1afddef0cbd4815bb2744eab7eadba/libs/cua-driver/rust/Skills/cua-driver/SKILL.md#L90-L109)

- 传 `element_token` 时走 Accessibility：macOS `AXPress`/`AXShowMenu`/`AXPick`，Windows 对应 UIA Invoke，Linux 对应 AT-SPI action；这条路径与 z-order 无关并可做原生回读。
- 传窗口内 `x,y` 时走像素路径；坐标必须来自同一个 `get_window_state` 截图，驱动结合截图缩放比、窗口 bounds 和 backing scale 换算到真实屏幕。
- 普通后台动作失败或被判为疑似 no-op 时才升级像素；像素仍失败才在已有授权下显式 `delivery_mode:"foreground"`。

这些动作时机和选择写在同一套官方契约中。[AX/PX 动作选择](https://github.com/trycua/cua/blob/986b6f257b1afddef0cbd4815bb2744eab7eadba/libs/cua-driver/rust/Skills/cua-driver/SKILL.md#L514-L555) 点击实现也明确将元素路径映射到 AX action，将像素路径映射到窗口定向 CGEvent，并拒绝不完整或含糊的目标。[click 工具契约](https://github.com/trycua/cua/blob/986b6f257b1afddef0cbd4815bb2744eab7eadba/libs/cua-driver/rust/crates/platform-macos/src/tools/click.rs#L126-L198) [AXPress/AXShowMenu 映射](https://github.com/trycua/cua/blob/986b6f257b1afddef0cbd4815bb2744eab7eadba/libs/cua-driver/rust/crates/platform-macos/src/tools/click.rs#L1477-L1484)

### 验证和纠错

cua-driver 最值得复制的是它不把“输入已经投递”当成“用户任务完成”：

- `ActionResult.effect` 只描述执行器能确认到什么，值为 `confirmed/partial/unverifiable/suspected_noop/refused`；
- `VerifyStateOutput` 单独检查调用者定义的后置条件，值为 `satisfied/unsatisfied/unknown`，只有 `satisfied` 是成功终态；
- screenshot 是证据，驱动不替 Agent 发明视觉业务含义；
- escalation 只是建议，自动重试决定留给上层 harness。

[动作事实与后置条件契约](https://github.com/trycua/cua/blob/986b6f257b1afddef0cbd4815bb2744eab7eadba/libs/cua-driver/docs/action-result-contract.md#L1-L35) [独立验证语义](https://github.com/trycua/cua/blob/986b6f257b1afddef0cbd4815bb2744eab7eadba/libs/cua-driver/docs/action-result-contract.md#L73-L86) [升级由上层决定](https://github.com/trycua/cua/blob/986b6f257b1afddef0cbd4815bb2744eab7eadba/libs/cua-driver/docs/action-result-contract.md#L116-L129)

### macOS 权限和限制

macOS 需要 Accessibility 与 Screen Recording 两项 TCC 授权，源码分别使用 `AXIsProcessTrusted` 和 `CGPreflightScreenCaptureAccess` 探测。[权限探测](https://github.com/trycua/cua/blob/986b6f257b1afddef0cbd4815bb2744eab7eadba/libs/cua-driver/rust/crates/platform-macos/src/permissions/status.rs#L36-L67) Accessibility 未授权时不能读/操作 AX；只有 Screen Recording 缺失时仍可在 `include_screenshot:false` 下完成纯 AX 流程，但不能像素点击或做视觉验证。[权限降级边界](https://github.com/trycua/cua/blob/986b6f257b1afddef0cbd4815bb2744eab7eadba/libs/cua-driver/rust/Skills/cua-driver/MACOS.md#L221-L238)

TCC 授权绑定负责进程/应用身份，因此正式运行使用 `CuaDriver.app` daemon 保持稳定 bundle identity；任意终端直接拉 raw daemon 不能等价继承授权。[进程身份说明](https://github.com/trycua/cua/blob/986b6f257b1afddef0cbd4815bb2744eab7eadba/libs/cua-driver/README.md#L45-L59)

局限仍然存在：Electron/Catalyst 的 AXValue 可能“回显成功但画面未变”，Canvas/WebGL 可能无有效树；因此必须交叉核对同一状态里的树和像素，而不能迷信 Accessibility。[典型树失真](https://github.com/trycua/cua/blob/986b6f257b1afddef0cbd4815bb2744eab7eadba/libs/cua-driver/rust/Skills/cua-driver/SKILL.md#L479-L496)

## 3. Enikk：本地 YOLO + OCR 的低成本视觉预解析

### 感知来源

Enikk 是 Windows-only Computer Use Agent，不是 MCP server；它把自身工具注册进 Hermes `tools.registry`，再由 `run_agent.AIAgent` 调用。[Hermes 工具注册](https://github.com/gtt116/enikk/blob/3d7a3f0de675293f8d67b013595ef4ac4b94f35e/enikk/tool_decorator.py#L228-L260) [Agent 装配](https://github.com/gtt116/enikk/blob/3d7a3f0de675293f8d67b013595ef4ac4b94f35e/enikk/eternity.py#L263-L293)

窗口截图使用 `mss` 捕获 Win32 客户区，默认先把窗口置前；桌面模式捕获所有显示器组成的虚拟屏幕。[窗口/桌面捕获](https://github.com/gtt116/enikk/blob/3d7a3f0de675293f8d67b013595ef4ac4b94f35e/enikk/game/capture.py#L15-L55)

`UIParser` 先等比压缩截图，再并行执行：

1. YOLO ONNX：letterbox 到 `640×640`、阈值过滤、xywh→xyxy、反 letterbox、NMS；
2. RapidOCR：输出文字、置信度和 bbox；
3. 合并：OCR 位于图标内时用文字补强图标，图标包含于文字时去掉图标，YOLO 重叠时保留较小框；
4. 全部 bbox 和 center 归一化到 `[0,1000]`。

[模型初始化](https://github.com/gtt116/enikk/blob/3d7a3f0de675293f8d67b013595ef4ac4b94f35e/enikk/ui_parser.py#L140-L206) [YOLO 坐标还原与归一化](https://github.com/gtt116/enikk/blob/3d7a3f0de675293f8d67b013595ef4ac4b94f35e/enikk/ui_parser.py#L228-L299) [OCR 与融合](https://github.com/gtt116/enikk/blob/3d7a3f0de675293f8d67b013595ef4ac4b94f35e/enikk/ui_parser.py#L301-L380) [并行流水线和中心点](https://github.com/gtt116/enikk/blob/3d7a3f0de675293f8d67b013595ef4ac4b94f35e/enikk/ui_parser.py#L382-L416)

`analyze(hwnd)` 返回结构化 `ui_elements`、原图路径、带框 SoM 图路径、尺寸、鼠标位置和时间戳。需要 VLM 时，`read_image` 再把图像作为 multimodal tool result 交给 Agent；因此 VLM 是按需层，不是每次解析的必经路径。[analyze 返回](https://github.com/gtt116/enikk/blob/3d7a3f0de675293f8d67b013595ef4ac4b94f35e/enikk/controller.py#L268-L322) [按需读图](https://github.com/gtt116/enikk/blob/3d7a3f0de675293f8d67b013595ef4ac4b94f35e/enikk/controller.py#L381-L405)

### 精确点击和输入

Agent 从 `ui_elements[].center` 选择归一化坐标，再调用 `click(x,y,hwnd)`。执行层每次重新读取窗口客户区，计算 `left + x/1000*width`、`top + y/1000*height`，置前窗口后物理点击。[click 工具](https://github.com/gtt116/enikk/blob/3d7a3f0de675293f8d67b013595ef4ac4b94f35e/enikk/controller.py#L407-L422) [坐标换算](https://github.com/gtt116/enikk/blob/3d7a3f0de675293f8d67b013595ef4ac4b94f35e/enikk/game/input.py#L80-L107)

点击用 pynput，鼠标沿带随机抖动的三次 Bézier 曲线移动并最终落到精确目标；键盘和滚轮用 pyautogui。Unicode/CJK 文本通过覆盖系统剪贴板后 `Ctrl+V` 输入。[鼠标动作](https://github.com/gtt116/enikk/blob/3d7a3f0de675293f8d67b013595ef4ac4b94f35e/enikk/game/input.py#L23-L78) [输入实现](https://github.com/gtt116/enikk/blob/3d7a3f0de675293f8d67b013595ef4ac4b94f35e/enikk/game/input.py#L166-L212)

这里的“精确”仍是视觉 bbox 中心 + 最新窗口客户区换算，不是控件级精确。它没有 snapshot token、对象 ID、动作前窗口内容哈希或 UIA hit-test；窗口虽然会置前，但截图和点击之间界面变化时没有 stale 拒绝。

### 验证、纠错和局限

系统提示要求 UI 任务遵循“发现窗口 → analyze → act → re-analyze”，但这是 Agent 提示约束，不是执行器强制闭环。[Agent 工作流](https://github.com/gtt116/enikk/blob/3d7a3f0de675293f8d67b013595ef4ac4b94f35e/enikk/prompts.py#L14-L23)

`wait_for` 会定时重新 analyze，并用简单字符位置相似度轮询 OCR 文字，可验证“某文本出现”；普通 click/type 返回的 `success:true` 只证明输入函数运行完。[OCR 轮询](https://github.com/gtt116/enikk/blob/3d7a3f0de675293f8d67b013595ef4ac4b94f35e/enikk/controller.py#L614-L669)

主要局限：Windows-only；捕获和输入通常抢前台；YOLO 只给通用 `icon` 标签，真正语义主要来自 OCR 或上层 VLM；0.01 YOLO 阈值较低，虽有 NMS/融合仍可能产生噪声；输入会覆盖用户剪贴板且源码未恢复原内容；没有结构化的任务后置条件与 freshness 契约。

## 4. 对当前 XSXB MCP 的启示

### 当前已经具备，不应重复造轮子

1. **结构化返回已经存在。** MCP server 对每个成功和失败结果都同时返回文本与 `structuredContent`，这比只给 Agent 自然语言稳定。[`structuredContent`](../../mcp/xsxb_mcp_server.js#L53-L67)
2. **视觉依据已经有 freshness。** `overlay_id` 是源 PNG 内容与 view 的哈希；图像或视图变化会抛 `STALE_OVERLAY`。[overlay 哈希与拒绝](../../mcp/xsxb_mcp_place.js#L197-L225)
3. **已经是领域语义工具，而非桌面点击器。** `xsxb_place_image` 接收 target/object anchor、cell、snap、scale、layer 等业务语义，并明确拒绝 freehand `x,y`，由 MCP 内部换算像素。[拒绝无依据坐标](../../mcp/xsxb_mcp_place.js#L1041-L1058)
4. **已经有 verify 回执与可视证据。** place 完成后可生成 verify overlay，并返回 `verify.status/checks`；其中 `buildPlaceVerify` 也诚实声明只验证几何，不声称“视觉上真的握在手里”。[几何 verify](../../mcp/xsxb_mcp_place.js#L1403-L1427) [place 回执](../../mcp/xsxb_mcp_place.js#L1521-L1563)

### P0：优先落地

#### P0-1 统一分离“执行事实”和“任务后置条件”

借鉴 cua-driver，所有 mutation receipt 逐步统一为：

```json
{
  "execution": {
    "status": "completed|partial|refused|failed",
    "route": "domain_algorithm|geometry_snap|local_perception|agent_visual",
    "artifacts_written": ["..."]
  },
  "verification": {
    "status": "satisfied|unsatisfied|unknown",
    "checks": [],
    "evidence": []
  },
  "task_outcome": "unknown"
}
```

`execution.completed` 只能表示文件/元数据写入或算法运行完成；只有明确的业务后置条件满足时才返回 `verification.satisfied`。例如 place 的 anchor 映射正确不能自动等价于“武器握持自然”，后者应保持 `unknown`，交给 verify overlay + Agent/用户判断。

#### P0-2 将 overlay freshness 扩展成通用 observation token

保留现有 `overlay_id/STALE_OVERLAY`，并把同一原则扩到所有“先观察、后写入”的链路：

```json
{
  "snapshot_id": "obs_...",
  "scope": {"project_id":"...","animation_id":"...","frame_id":"..."},
  "source_hashes": {"png":"...","metadata":"..."},
  "view_hash": "...",
  "created_at": "..."
}
```

mutation 接收 `basis_snapshot_id`；源 PNG、项目 revision、animation/frame 或 view 任一变化即返回 `STALE_SNAPSHOT`。这能覆盖 overlay 以外的 measure→register、analyze→reorganize、preview→place 等竞态。对于由 cells 驱动的写操作，建议把目前“缺 overlay_id 只 warning”逐步收紧为默认拒绝，保留显式 override 而不是静默执行。[当前缺 stamp 仅警告](../../mcp/xsxb_mcp_place.js#L1370-L1387)

#### P0-3 把路由梯写成 XSXB 领域策略

路由不应照搬桌面坐标，而应是：

1. 直接领域算法/元数据工具（measure、register、cutout、place、shift）；
2. 确定性图像几何/alpha snap；
3. 可选本地 OCR/检测/特征算法；
4. speakable overlay + Agent 视觉判断；
5. 用户确认或显式人工定位。

每次只在上一层返回 `unverifiable/suspected_noop/unsupported` 后升级；不要默认走更昂贵、更不确定的视觉层。

### P1：高价值增强

#### P1-1 可选的本地 OCR/检测降级层

借鉴 Enikk，把本地模型定位为“候选生成器”，而不是最终裁判：

- OCR 可用于导入素材中的真实文字/标识，**不要 OCR XSXB 自己绘制的 overlay 标签**；那些标签已有 `cells` JSON 真值。
- 小型检测器或传统 CV 可用于候选人物、武器、手部、特效区域；保留 bbox、confidence、model_version。
- 将本地候选与 alpha/连通域/现有业务规则融合，低置信度只生成 overlay 供 Agent 看，不直接写入项目。
- VLM 仅在本地结构不足且任务确需语义判断时调用。

#### P1-2 在回执中公开“依据”和“升级建议”

每个工具返回闭合枚举的 `route`、`effect`、`evidence`、`escalation`，例如：

```json
{
  "effect": "unverifiable",
  "route": "geometry_snap",
  "evidence": [{"kind":"anchor_mapping","ok":true}],
  "escalation": {"target":"agent_visual","reason":"semantic_fit_unproven"}
}
```

上层 Agent 可以据此决定是否打开 overlay、换算法或询问用户，而不是根据一段 warning 文本猜测。

### P2：仅在将来做真实桌面控制时引入

如果 XSXB MCP 将来要操作 Godot、Blender、Finder 或 Tuner 的真实窗口，再引入 cua-driver 式精确目标：`app identity + pid + window_id + snapshot-bound element token`，并采用 AX → 同快照像素 → 显式前台的动作梯。macOS 端必须把 Accessibility/Screen Recording 的 TCC bundle identity、权限检查和无录屏时的 AX-only 降级作为独立平台适配层；不要把这些平台复杂性污染现有图像领域模块。

## 5. 明确不建议引入的做法

1. **不要把现有领域工具退化成全局坐标点击。** `xsxb_place_image` 的 cell/snap/anchor/scale/layer 比桌面 `[0,1000]` 坐标更深、更可测试；桌面点击只能作为将来驱动外部 App 的边缘适配器。
2. **不要默认每一步调用 VLM。** EZ 的全 VLM 路径接口漂亮，但成本、延迟、可重复性和 bbox 漂移都不适合 XSXB 的确定性图像处理主链。VLM 应是最后的语义判断层。
3. **不要把“函数返回 success”写成“任务完成”。** EZ 当前动作路径和 Enikk 普通点击都存在这个问题；XSXB 应采用 action fact + postcondition 两层语义。
4. **不要长期复用无 stamp 的坐标或对象 ID。** 任一 observation-derived mutation 必须绑定源内容、view 和领域 scope；界面/素材变化要 fail closed。
5. **不要让 OCR 重新识别 MCP 自己生成的网格编号。** 当前 `grid.cells`/overlay receipt 已是无损结构化真值，OCR 只会引入错误。

## 6. 推荐实施顺序

1. P0：先定义统一 `execution/verification/evidence/escalation` receipt schema，并在 place/plant/shift/reorganize 中试点。
2. P0：抽出通用 snapshot/freshness 模块，把 `overlay_id` 的内容哈希做法推广到 observation-derived mutation。
3. P0：把 XSXB 领域路由梯写入 MCP instructions 和测试，确保不会因新增视觉能力绕开已有领域工具。
4. P1：用 feature flag 做本地 OCR/检测原型，只输出候选与证据，不直接 mutation；测准确率、耗时和误触发率后再决定是否保留。
5. P2：只有出现明确的外部桌面控制需求时，才设计 macOS/Windows window adapter，并优先复用成熟 cua-driver，而不是在 XSXB 内自写 Accessibility 和全局输入栈。
