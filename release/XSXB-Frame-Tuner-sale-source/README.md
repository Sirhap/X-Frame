# XSXB Frame Tuner

XSXB Frame Tuner 是一个给 Godot 帧动画角色用的本地调参工作台，配套一个 Codex/Agent skill。它的目标很简单：让 Agent 负责导入、同步和验证素材，让人在网页里直观看帧、拖动角色、调碰撞框，然后把结果保存回 Godot 项目。

![XSXB Frame Tuner 截图](docs/screenshot.png)

## 功能

- 多项目隔离：每个 Godot 项目使用独立的 manifest、tuning、音频绑定、图片挂件和导入素材目录。
- 一句话批量导入：Agent 可以把同一条消息里的多组 PNG 动画作为一个批次导入到同一角色，并统一核对组数和帧数。
- 帧动画预览：支持逐帧选择、播放、暂停、参考帧、黑/白/透明背景和网格坐标。
- 本地批量抠图：支持多图导入、自动/手动背景取色、边缘连通或全图清除、边缘增强、去污、Alpha 双阈值、逐图颜色保护与矩形局部修复；局部修复可通过最近三帧运动预测、PCA 形状匹配和局部颜色重采样传播到整组；可批量导出 PNG，并可确认后替换当前动画组。
- 帧工作集整理：支持图片和视频导入；视频可在本地预览、选择起止片段、设置 1–60 FPS 并提取为帧。工作集还支持反选、减帧、恢复源顺序、水平翻转、导入/删除帧、帧标记，以及跳变帧、重复帧和循环段相似度诊断；应用时会同步重映射调参、碰撞框和帧绑定。
- 浏览器动画组：每次“处理新动画”可建立独立动画组，也可把处理结果加入当前组的附加素材；工作台可把当前组的帧、附加素材和完整调参数据导出为 ZIP 动画包。
- 三层变换：角色级、动画组级、单帧级分别保存缩放、偏移、旋转和禁用状态。
- 碰撞框调节：支持 hurtbox、hitbox、collisionbox，在画布中直接拖动和变形。
- 播放调节：支持组级时长、单帧时长、禁用帧，以及调参后的实际播放节奏。
- 帧音效和图片挂件：可以给指定帧绑定 SFX 或附加图片，保存后同步到 Godot 项目。
- Godot 同步：导入 PNG 序列或 SpriteFrames 后，会生成/刷新 `res://xsxb_frame_tuner/` 下的运行时数据和基础 runtime。
- 完整验证：可检查每帧框体、游戏本地数据、SFX、附加帧、场景系数、框体缩放和实际 gameplay 接线。

这个仓库不包含任何角色 PNG、音频、Godot 私有项目路径或调参数据。运行时产生的项目数据会留在本机，并被 `.gitignore` 排除。

## 仓库内容

- `tools/animation_tuner/`：本地 Webapp，默认服务地址是 `http://127.0.0.1:5179`。
- `docs/cutout-roadmap.md`：本地批量抠图的模块边界、当前覆盖范围和后续功能优先级。
- `tools/import_frames.js`：Agent 用来导入 PNG 序列的内部工具。
- `tools/import_batch.js`：Agent 用来一次导入多组 PNG 动画的内部工具。
- `tools/import_spriteframes.js`：Agent 用来从 Godot `.spriteframes.tres` 导入动画的内部工具。
- `tools/validate_import.js`：验证独立 tuner 与 Godot 项目的完整接线结果。
- `tools/godot_sync.js` 和 `tools/godot_runtime.js`：把调参数据、素材和 runtime 同步到 Godot 项目。
- `skills/xsxb-frame-tuner/`：配套 Codex/Agent skill。
- `data/`、`workspace/`、`audio/`：本地运行时目录。真实项目数据不提交。

## 安装方式

只提供 Agent 安装方式。把下面这段话交给 Codex 或其他支持 skills 的 Agent：

```text
请从本地项目目录安装并启用 `skills/xsxb-frame-tuner`。
安装后把仓库克隆到本机作为 XSXB Frame Tuner 工具根目录。
以后处理 Godot 帧动画角色导入、动画追加、碰撞框调参、音效/挂件同步时，默认使用 `$xsxb-frame-tuner`。
```

## 使用方式

macOS 可双击 `start_xsxb_frame_tuner.command` 启动本地服务和页面。使用期间需要保持启动器打开的终端窗口；关闭终端会同时停止本地服务。

服务启动后的站点入口：

- `/`：公开产品首页。
- `/workspace`：帧动画调参工作台。
- `/tools/import`、`/tools/organizer`、`/tools/cutout`：三个工具的稳定深链接。

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
npm run check
npm test
```

生成静态托管使用的白名单生产目录：

```powershell
npm run build:production
npm run audit:production
```

生产构建会生成内容哈希资源并拒绝 Source Map、文档、测试和未列入 manifest 的文件。授权边界与发布限制见 [`docs/production-asset-boundary.md`](docs/production-asset-boundary.md)。

## 服务部署

Node 服务支持平台注入的 `PORT` 和 `HOST` 环境变量。例如容器中可使用 `HOST=0.0.0.0 npm start` 对外监听。当前工作台包含项目写入、素材上传和 Godot 同步 API，但尚未内置多用户身份认证；公网部署前必须在反向代理或平台层增加访问控制，并为每个实例配置隔离的 `XSXB_ROOT`。不要直接把未鉴权的 Node 服务暴露到公网。

### 高级功能激活

导入、处理、调参和本地保存不要求激活。只有从工作台导出动画包时，系统才会根据当前动画实际使用的 Pro 功能决定是否校验激活状态；未使用 Pro 功能可直接导出。获取激活码入口为 <https://pay.ldxp.cn/shop/sirhao>。

服务端不保存明文激活码。本地 Node 开发服务器可通过以下环境变量配置：

- `XSXB_ACTIVATION_CODE_HASHES`：一个或多个逗号分隔的 SHA-256；激活码会先去除首尾空格并转为大写后再计算哈希。
- `XSXB_ACTIVATION_SECRET`：用于签发 HttpOnly 激活 Cookie 的持久随机密钥；多实例部署必须共享同一个值。

macOS 生成单个激活码哈希：

```bash
printf %s 'XSXB-PRO-示例激活码' | tr '[:lower:]' '[:upper:]' | shasum -a 256
```

如果没有同时配置 `XSXB_ACTIVATION_CODE_HASHES` 和至少 32 字符的持久
`XSXB_ACTIVATION_SECRET`，激活接口会安全地拒绝所有激活请求，不会生成临时签名密钥或使用开发环境万能码。

Cloudflare 正式部署使用 D1 自动试用与多设备授权，不使用 `XSXB_ACTIVATION_CODE_HASHES` 环境变量：浏览器首次进入托管工作台时无需激活码即可领取独立的 3 天试用，并生成不可导出的 ECDSA P-256 私钥。服务端使用浏览器、硬件、地区和显示环境等信号的加盐哈希辅助识别重复试用，但授权始终依赖设备私钥签名，设备指纹不能证明真实人员身份。D1 不保存原始设备指纹或原始 IP。

付费激活码可在管理后台设置任意正整数设备槽位，也可选择“不限设备”；同一设备重复激活不会占用新槽位，有限授权达到上限后拒绝新设备。激活码支持自定义 Unicode 文本、空格和符号，有效天数可填写任意能在公元 9999 年前产生到期时间的正整数，也可直接设为永久。用户可从工作台的“授权管理”主动填写或更换激活码，并查看当前到期时间。所有设备共享该激活码从首次激活开始计算的有效期。管理员可以在对应激活码下查看设备 ID、名称、地区、首次绑定、最后使用和撤销状态，并可删除绑定以重置槽位。完整配置见 [`cloudflare/site/README.md`](cloudflare/site/README.md)。

Cloudflare 首页右上角链接到独立的 `/admin/licenses` 激活码管理页面，不使用悬浮弹窗，工具工作台也不会显示该入口。管理员使用用户名和 Google Authenticator 兼容的 6 位 TOTP 登录，不使用密码；用户名由 `XSXB_ADMIN_USERNAME` 配置（省略时为 `admin`）。验证后可以查看、单个复制或批量复制新建激活码；迁移前仅保存哈希的旧码无法恢复原文。`XSXB_ADMIN_TOTP_SECRET` 必须以 Base32 形式通过 Worker 环境密钥设置，不得写入源码、Wrangler 配置或 D1。Google Authenticator 固定每 30 秒更新验证码，服务端只接受当前时间窗口，并阻止同一计数器重复使用。管理会话、D1 迁移与远程配置步骤见 [`cloudflare/site/README.md`](cloudflare/site/README.md)。

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
