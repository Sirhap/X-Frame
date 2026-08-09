# 生产环境 Microsoft Edge 全链路验收报告

## 测试信息

- 测试时间：2026-08-08 21:00–23:52 CST
- 生产地址：`https://xsxb-fast.devops9527.dpdns.org`
- 浏览器：Microsoft Edge（Codex 内置 Computer Use 插件，用户态浏览器）
- 平台：macOS
- 本地代码基线：`main` / `400001c`
- 测试素材：`hero-fighter-frame-01.webp` 的临时副本 `/tmp/xsxb-test-frame.webp`
- 原则：只使用测试素材；未输入管理员凭据或激活码；未删除用户数据。

## 结论

导入、预览、创建动画、进入调参、主题切换、参数分类、批量抠图和授权门禁均能运行。当前生产环境仍有 3 个阻断级问题：浏览器动画创建后未提交到项目会话、零散切片内嵌资源 404、首页展示的在线视频去水印入口 404。

## 链路结果

| 链路 | 结果 | 现场结果 |
| --- | --- | --- |
| 首页 `/` | 通过 | 首页、主导航、工序卡片和页脚正常显示。 |
| 动画项目 `/projects` | 部分通过 | 页面和项目卡片正常；新建动画后项目仍显示 `0 个动画组`。 |
| 快速工具 `/tools` | 通过 | 抠图、序列处理、零散切片三个入口可点击。 |
| 首页导入 `/tools/import` | 通过 | 导入页正常显示，图片/视频选择器可用。 |
| 序列处理 `/tools/organizer` | 通过 | WebP 导入、缩略图、预览、动画信息、确认弹窗正常。 |
| 创建动画并进入调参 | 部分通过 | `edge-smoke` 1 帧动画成功进入 `/workspace`，但离开后丢失。 |
| 工作台 `/workspace` | 通过 | 预览画布、时间轴、主题、语言、变换/框体/特效入口正常。 |
| 导出动画包 | 通过（门禁） | 未激活时正确显示激活弹窗，未绕过授权。 |
| 批量抠图 `/tools/cutout` | 通过 | 图片导入后自动生成透明结果；参数、局部工具、批次输出入口正常。 |
| 零散切片 `/tools/scatter-slice` | 失败 | 外层工作台加载，但内嵌 `/scatter-slice.html?embedded=1` 返回 404，页面空白。 |
| 视频去水印 `/tools/watermark` | 失败 | Edge 显示 `HTTP ERROR 404`。 |
| 授权管理 `/admin/licenses` | 通过 | TOTP 管理员登录页正常；未提交凭据。 |
| 中英文切换 | 部分通过 | 主要工作台文本切换成功，但导航、标签和激活弹窗仍混有中文。 |

## Bug 记录

### P1：创建成功的浏览器动画离开工作台后丢失

复现步骤：

1. 打开 `/tools/organizer`。
2. 导入一张 WebP，动画名设为 `edge-smoke`。
3. 点击“导入动画组并进入调参”，确认创建。
4. 工作台显示 `edge-smoke - 1 帧`。
5. 进入 `/projects`，再打开 `browser-session`。

实际结果：项目库显示 `0 个动画组`；重新打开后工作台显示 `Loaded 0 animations`。

预期结果：至少在当前浏览器会话内保留刚创建的动画，并能从项目库重新打开。

代码定位：

- `tools/animation_tuner/public/app.js:74` 的 `createBrowserSessionAnimation()` 只执行 `config.groups.push(group)`。
- 该函数成功路径没有调用 `browserRuntime.commitSessionProjectConfig()`。
- 项目交接适配器已经在 `tools/animation_tuner/public/app.js:3628` 提供提交能力，说明缺的是创建流程中的事务提交。

建议：成功选择动画并完成画布初始化后，提交完整 `browserProjectSnapshot(activeProjectId())`；提交失败时回滚 `groups/profiles` 并保留导入器，避免先显示成功再丢数据。随后增加“导入 → 项目页 → 重新打开”的浏览器回归测试。

### P1：零散切片生产入口为空白

复现：打开 `/tools/scatter-slice`。

实际结果：外层路由加载，但控制台记录 `/scatter-slice.html?embedded=1` 为 404，内嵌区域为空白。

代码定位：

- `tools/animation_tuner/public/index.html:1031` 固定引用 `/scatter-slice.html?embedded=1`。
- `cloudflare/site/src/index.mjs:11` 只将 `/tools/scatter-slice` 映射到工作台。
- `tools/cloudflare/build_site.js:39` 依赖 `dist` 中已有该资源，当前生产产物未包含内嵌 HTML。

建议：把 scatter HTML/CSS/JS 纳入受保护生产产物，并在 Cloudflare 构建审计中断言 iframe URL 返回 200；同时给 iframe 增加加载失败提示和重试入口。

### P1：生产首页展示的视频去水印入口返回 404

复现：从首页进入“视频去水印”，或直接打开 `/tools/watermark`。

实际结果：`HTTP ERROR 404`。

代码定位：

- 首页在 `tools/animation_tuner/public/animation_factory.html:296` 发布该入口。
- Cloudflare Worker 的 `WORKBENCH_ROUTES`（`cloudflare/site/src/index.mjs:5`）没有 `/tools/watermark`。
- 本地版依赖 FFmpeg 服务端接口，Cloudflare 静态部署当前没有对应后端。

建议：若云端暂不支持，生产首页隐藏该卡片或明确标记“仅本地版”；若要上线，需要先提供云端处理后端和容量/超时/隐私策略，不能只补静态路由。

### P2：英文模式翻译不完整

实际结果：切换 EN 后，`Frame tuning workbench`、`Export Animation` 等已翻译，但左侧“项目/变换/框体/特效”、工具轨道、浏览器模式说明以及激活弹窗中的“激活码/获取激活码”等仍为中文。

代码定位：`tools/animation_tuner/public/index.html:45-111` 有多处静态中文未绑定 `data-i18n`；激活弹窗的可见标签也有静态中文。

建议：所有可见文本、title、aria-label 和空状态统一走词典；增加 EN 模式 DOM 测试，禁止核心工作区出现未列入白名单的中文文本。

## 可优化点

1. 建立单一生产路由清单，由首页卡片、Worker 路由和构建资产审计共同消费，避免“入口存在、部署资源不存在”。
2. 浏览器项目建议用 IndexedDB 做会话持久化，并给大型 data URL 设置容量检查与失败提示；纯内存状态不应被描述为“项目库”。
3. iframe 工具应提供超时、404 和版本不匹配的可视错误，不要只留下整块空白。
4. 自动试用接口返回 402 时不要以未处理资源错误污染控制台；可把“试用已失效”作为正常业务状态返回并安静展示。
5. Edge 首次载入部分工作台时短暂只显示背景，建议增加明确的加载骨架和超时提示，减少用户误判为页面空白。

## 控制台观察

- `/scatter-slice.html?embedded=1`：404，功能性错误。
- `/api/activation/device-challenge`、`/api/activation/trial-challenge`：402；当前 UI 最终能回落到“激活后可导出”，未绕过门禁。
- Cloudflare Insights beacon 被 Edge Tracking Prevention 拦截：非功能性错误，可忽略或在不需要分析时移除脚本。

## 修复后最小回归清单

1. 导入 2 帧并创建动画，进入调参后去项目库再返回，帧数、FPS、名称保持不变。
2. 刷新 `/workspace?project=browser-session`，验证预期的会话持久化策略和丢失提示。
3. `/scatter-slice.html?embedded=1` 直接访问返回 200；从 `/tools/scatter-slice` 能导入并切出至少一个元素。
4. 生产首页不再暴露不可用的 `/tools/watermark`，或该路由完整可用。
5. EN 模式检查工作台、导入器、抠图和激活弹窗，不出现非白名单中文。
