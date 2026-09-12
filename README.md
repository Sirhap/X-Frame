# X-Frame

X-Frame 是一个给 Godot 帧动画角色用的本地调参工作台，配套一个 Codex/Agent skill。它的目标很简单：让 Agent 负责导入、同步和验证素材，让人在网页里直观看帧、拖动角色、调碰撞框，然后把结果保存回 Godot 项目。

![X-Frame 截图](docs/screenshot.png)

## 功能

- 双入口工作流：“动画项目”用于长期管理动画组与调参，“快速工具”可不建项目地完成批量抠图、序列处理、零散切片和视频去水印；上述媒体入口支持文件选择、拖放、剪贴板粘贴以及带确认保护的素材清空。
- 多项目隔离：每个 Godot 项目使用独立的 manifest、tuning、音频绑定、图片挂件和导入素材目录。
- 一句话批量导入：Agent 可以把同一条消息里的多组 PNG 动画作为一个批次导入到同一角色，并统一核对组数和帧数。
- 帧动画预览：支持逐帧选择、播放、暂停、参考帧、黑/白/透明背景和网格坐标。
- 本地批量抠图：支持多图导入、自动/手动背景取色、边缘连通或全图清除、边缘增强、去污、Alpha 双阈值、逐图颜色保护与矩形局部修复；可在同一画布生成本地规则 A/B 候选、拖动分割线比较，并将所选方案应用到当前、选中或全部帧；局部修复可通过最近三帧运动预测、PCA 形状匹配和局部颜色重采样传播到整组；可批量导出 PNG，也可将结果加入动画项目。
- 帧工作集整理：支持图片和视频导入；视频可在本地预览、选择起止片段、设置 1–60 FPS 并提取为帧。工作集还支持反选、减帧、恢复源顺序、水平翻转、导入/删除帧、帧标记，以及跳变帧、重复帧和循环段相似度诊断；应用时会同步重映射调参、碰撞框和帧绑定。
- 零散切片：可按组生成多个动画，也可按“组从上到下、组内从左到右”顺序合并为一个动画，并在最大透明画布中底部居中对齐。
- 视频去水印：支持本地视频预览、最多 8 个带时间范围的矩形选区、角落快捷选区、FFmpeg `delogo` 和保留重叠前景的智能白印修复；上传会话相互隔离，导出任务串行处理并提供实时进度和本地下载。
- 安全项目交接：快速结果默认新建动画组；替换既有组需显式选择并确认帧数、调参、碰撞框、音频与挂件的迁移影响。混合新建和替换的批次要么全部成功，要么全部回滚。
- 浏览器动画组：每次“处理新动画”可建立独立动画组，也可把处理结果加入当前组的附加素材；工作台可把当前组的帧、附加素材和完整调参数据导出为 ZIP 动画包。
- 三层变换：角色级、动画组级、单帧级分别保存缩放、偏移、旋转和禁用状态。
- 碰撞框调节：支持 hurtbox、hitbox、collisionbox，在画布中直接拖动和变形。
- 播放调节：支持组级时长、单帧时长、禁用帧，以及调参后的实际播放节奏。
- 帧音效和图片挂件：可以给指定帧绑定 SFX 或附加图片，保存后同步到 Godot 项目。
- 攻击拖尾：可在画布中编辑拖尾棍子、前后图层、纹理、渐变和持续时间，并把数据、纹理、Shader 与渲染器同步到 Godot。
- Lite 工作流：提供独立的帧序列/精灵表导入、预设保存，以及按持续时间驱动的拖尾与音频导出。
- Codex Pets：可读取内置和自定义宠物图集，在工作台调参，并将可写的自定义宠物安全回写且保留备份。
- Godot 同步：导入 PNG 序列或 SpriteFrames 后，会生成/刷新 `res://xsxb_frame_tuner/` 下的运行时数据和基础 runtime。
- 完整验证：可检查每帧框体、游戏本地数据、SFX、附加帧、场景系数、框体缩放和实际 gameplay 接线。

这个仓库不包含任何角色 PNG、音频、Godot 私有项目路径或调参数据。运行时产生的项目数据会留在本机，并被 `.gitignore` 排除。

## 仓库内容

- `tools/animation_tuner/`：本地 Webapp，默认服务地址是 `http://127.0.0.1:5179`。
- `tools/frame_tuner_lite/`：与完整 Godot 工作流隔离的 Lite 服务、导入器和数据存储。
- `tools/attack_trails.js` 与 `tools/runtime/xsxb_attack_trail_*`：拖尾数据校验、纹理同步和 Godot 运行时。
- `docs/cutout-roadmap.md`：本地批量抠图的模块边界、当前覆盖范围和后续功能优先级。
- `tools/import_frames.js`：Agent 用来导入 PNG 序列的内部工具。
- `tools/import_batch.js`：Agent 用来一次导入多组 PNG 动画的内部工具。
- `tools/import_spriteframes.js`：Agent 用来从 Godot `.spriteframes.tres` 导入动画的内部工具。
- `tools/validate_import.js`：验证独立 tuner 与 Godot 项目的完整接线结果。
- `tools/godot_sync.js` 和 `tools/godot_runtime.js`：把调参数据、素材和 runtime 同步到 Godot 项目。
- `skills/xsxb-animation-production/`：从动画需求、生成/已有素材到导入、同步、验证和启动工作台的上层 Codex/Agent skill。
- `skills/xsxb-frame-tuner/`：具体 XSXB 导入、整理、调参、Godot runtime 同步和验证执行层 skill。
- MCP 已迁到独立仓库 [x-frame-mcp](https://github.com/Sirhap/x-frame-mcp)。本仓 `mcp/README.md` 只留指向。
- `data/`、`workspace/`、`audio/`：本地运行时目录。真实项目数据不提交。

## 安装方式

只提供 Agent 安装方式。把下面这段话交给 Codex 或其他支持 skills 的 Agent：

```text
请从本地项目目录安装并启用 `skills/xsxb-animation-production`，并确保它可以调用 `skills/xsxb-frame-tuner`。
安装后把仓库克隆到本机作为 X-Frame 工具根目录。
以后处理 Godot 帧动画制作、角色导入、动画追加、碰撞框调参、音效/挂件同步时，默认使用 `$xsxb-animation-production`；具体 XSXB 数据操作继续使用 `$xsxb-frame-tuner`。
```

Cursor 或其他 MCP 客户端接入本地 STDIO 服务时，见独立仓库 [x-frame-mcp](https://github.com/Sirhap/x-frame-mcp)，说明在该仓 `mcp/README.md`。本仓库不再带 MCP 实现。

## 使用方式

macOS 可双击 `start_x_frame.command` 启动本地服务和页面。使用期间需要保持启动器打开的终端窗口；关闭终端会同时停止本地服务。

需要隔离的 Lite 工作流时运行 `npm run start:lite`；可用 `npm run validate:lite` 检查 Lite 数据。

服务启动后的站点入口：

- `/`：公开产品首页。
- `/projects`：动画项目中心，用于新建、继续或切换项目。
- `/tools`：快速工具中心，可不建项目地处理素材。
- `/workspace`：帧动画调参工作台。
- `/tools/organizer`、`/tools/cutout`、`/tools/scatter-slice`、`/tools/watermark`：序列处理、批量抠图、零散切片和视频去水印的快速工具深链；`/tools/import` 作为序列导入的兼容入口保留。
- `/workspace/tools/organizer`、`/workspace/tools/cutout`：保留当前项目和动画组上下文的处理深链。

快速工具的处理结果可直接下载，也可加入指定动画项目。加入成功后会保留当前会话并提供目标动画组链接；未加入项目的大图结果不会持久化，离开页面或刷新前请先下载或加入项目。

视频去水印要求本机终端可直接运行 `ffmpeg` 和 `ffprobe`，浏览器预览支持 MP4、M4V、MOV 与 WebM。视频与导出文件仅写入本机 `output/watermark-studio/`，单个视频上限为 1 GB；临时会话和完成任务默认保留两小时。

安装后，建议继续用自然语言让 Agent 操作，不需要手动跑导入脚本。常用说法：

```text
用 $xsxb-frame-tuner 把 <Godot项目路径> 里的角色 SpriteFrames 接入 tuner。
```

```text
用 $xsxb-frame-tuner 给 <Godot项目路径> 的 hero 添加 idle 动画，PNG 序列在 <PNG序列路径>，12fps，导入后打开 tuner。
```

```text
用 $xsxb-frame-tuner 给 <Godot项目路径> 的 hero 一次加入 idle、run、jump、stand_attack，路径分别是 <四个PNG目录>，导入后检查每组框体并完整接入游戏。
```

```text
用 $xsxb-frame-tuner 检查当前 Godot 项目的 XSXB runtime 是否和 tuner 保存的数据一致。
```

如果希望直接使用项目内的机器可读工作流，也可以在本地运行：

```bash
npm run animation:workflow -- plan --contract <animation-constraints.json> --json
npm run animation:workflow -- import --contract <animation-constraints.json> --json
npm run animation:workflow -- sync --contract <animation-constraints.json> --project <xsxb_project_id> --json
npm run animation:workflow -- validate --contract <animation-constraints.json> --json
npm run animation:workflow -- start --port 5179 --json
```

没有现成帧素材时，让 `$xsxb-animation-production` 先根据描述建立约束、canonical 角色参考和关键姿势，再使用可用的本地/已授权生成工具产出 PNG 序列；生成工具不可用时，Agent 会保留契约并报告阻塞，不会伪造已完成动画。视频和 SpriteFrames 等浏览器/专用导入流程仍由现有工作台和 `$xsxb-frame-tuner` 接管。

Agent 会负责选择/创建 XSXB 项目、批量复制帧素材、生成 manifest、逐组检查初始框体、同步完整 runtime 到 Godot、连接实际 gameplay，并在验证通过后启动 Webapp。打开页面后，人可以继续做艺术性微调并点击保存。

## 本地数据

本机生成的数据默认放在这些位置：

```text
data/projects/<project_id>/
workspace/projects/<project_id>/assets/
audio/projects/<project_id>/
```

这些目录会保存项目绑定、导入帧、attachments、音效和调参结果。它们默认不会进入 Git 仓库。

## 维护验证

代码没有外部运行依赖，只需要 Node.js。维护者可以让 Agent 执行项目检查，检查内容等价于：

```powershell
npm run check:quick
npm run check
npm test
```

`npm run check:quick` 只运行语法、ESLint、Prettier 和类型检查，适合本地迭代；`npm run check`
通过 `tools/quality_gate.js` 的数据驱动 `full` 配置保持完整生产检查顺序。任一子检查失败时，门禁会立即停止并保留其退出码。

生成静态托管使用的白名单生产目录：

```powershell
npm run build:production
npm run audit:production
```

生产构建会生成内容哈希资源并拒绝 Source Map、文档、测试和未列入 manifest 的文件。授权边界与发布限制见 [`docs/production-asset-boundary.md`](docs/production-asset-boundary.md)。

## 服务部署

Node 服务支持平台注入的 `PORT` 和 `HOST` 环境变量。例如容器中可使用 `HOST=0.0.0.0 npm start` 对外监听。当前工作台包含项目写入、素材上传和 Godot 同步 API，但尚未内置多用户身份认证；公网部署前必须在反向代理或平台层增加访问控制，并为每个实例配置隔离的 `XSXB_ROOT`。不要直接把未鉴权的 Node 服务暴露到公网。

### 高级功能激活

导入、处理、调参和本地保存不要求 Pro 授权。托管工作台使用邮箱验证码注册/登录，每个浏览器登录状态保持 7 天；设备数量不受限制。高级导出按邮箱账户的 Pro 权益校验，未使用 Pro 功能可直接导出。获取激活码入口为 <https://pay.ldxp.cn/shop/sirhao>。

服务端不保存明文激活码。本地 Node 开发服务器可通过以下环境变量配置：

- `XSXB_ACTIVATION_CODE_HASHES`：一个或多个逗号分隔的 SHA-256；激活码会先去除首尾空格并转为大写后再计算哈希。
- `XSXB_ACTIVATION_SECRET`：用于签发 HttpOnly 激活 Cookie 的持久随机密钥；多实例部署必须共享同一个值。

macOS 生成单个激活码哈希：

```bash
printf %s 'XSXB-PRO-示例激活码' | tr '[:lower:]' '[:upper:]' | shasum -a 256
```

如果没有同时配置 `XSXB_ACTIVATION_CODE_HASHES` 和至少 32 字符的持久
`XSXB_ACTIVATION_SECRET`，激活接口会安全地拒绝所有激活请求，不会生成临时签名密钥或使用开发环境万能码。

Cloudflare 正式部署使用 D1 邮箱账户授权，不使用 `XSXB_ACTIVATION_CODE_HASHES` 环境变量。任意有效邮箱可通过 Resend 发送的 6 位验证码注册；验证码有效 10 分钟，浏览器会话有效 7 天。D1 仅保存验证码哈希、会话令牌哈希和客户端 IP 的密钥哈希，不保存验证码、会话令牌或原始 IP。

付费激活码首次兑换时绑定当前邮箱，不可被其他邮箱重复使用；一个邮箱可以绑定多个激活码，任一有效授权即可开启 Pro。激活码继续支持自定义 Unicode、有效天数、永久、兑换期限、撤销和恢复。后台还可配置新账户默认 Pro，并对单个邮箱设置继承、开启或关闭。完整配置见 [`cloudflare/site/README.md`](cloudflare/site/README.md)。

Cloudflare 首页右上角提供普通用户“登录 / 注册”入口，进入工作台后自动打开邮箱验证码登录。独立的 `/admin/licenses` 后台不在普通账户入口中暴露，并由 Worker 服务端检查管理员工作台 Cookie；未认证访问会跳转 `/admin/login`，直接访问 `/admin.html` 返回 404。管理员必须同时提供 `XSXB_ADMIN_USERNAME`（生产环境为 `sirhao`）、环境密钥 `PASSWORD` 和 Google Authenticator 兼容的 6 位 TOTP。登录后管理员可直接进入工作台并拥有 Pro 权限；管理员工作台会话与邮箱账户会话使用独立 Cookie，退出任一身份不会撤销另一身份。验证后可以查看、单个复制或批量复制新建激活码；迁移前仅保存哈希的旧码无法恢复原文。`PASSWORD` 与 `XSXB_ADMIN_TOTP_SECRET` 必须通过 Worker Secret 设置，不得写入源码、Wrangler 配置或 D1。Google Authenticator 固定每 30 秒更新验证码，服务端只接受当前时间窗口，并阻止同一计数器重复使用。管理会话、D1 迁移与远程配置步骤见 [`cloudflare/site/README.md`](cloudflare/site/README.md)。

本地开发使用独立环境文件，避免开发码进入正式启动流程：

```bash
cp .env.local.example .env.local
# 将本地开发码规范化为大写后生成 SHA-256，并填入 .env.local
printf %s 'YOUR-LOCAL-CODE' | tr '[:lower:]' '[:upper:]' | shasum -a 256
npm run start:local
```

`.env.local` 已被 Git 忽略；普通 `npm start` 不会读取该文件，生产环境仍必须显式提供正式激活配置。

对已绑定的 Godot 项目还可以运行：

```powershell
node tools\validate_import.js --project <xsxb_project_id> --project-root "<Godot项目路径>" --require-gameplay --strict
```

## License

MIT
