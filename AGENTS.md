# XSXB-Frame-Tuner 开发约定

## 改动必须有真实测试

任何改过的功能都要有对应的、真正会失败的测试。只跑单元测试不算验证完成。

1. **先复现再修**：改 bug 前先写一个能复现该 bug 的失败测试，确认它失败，再动实现代码。
2. **验证测试有效**：修好之后，临时把修复回退一次，确认测试重新失败。测不出回归的测试等于没测。
3. **UI 行为走浏览器**：只要用户能点到、看到的行为（弹窗、进度、遮罩、路由切换、卡顿），就必须有 `tools/tests/e2e/` 里的 Playwright 用例，用 `npx playwright test --project=edge` 真跑一遍。`--project=chromium` 不存在，可用 `edge` 与 `edge-touch`。
4. **性能回归要可观测**：卡顿类问题不要用「耗时上限」这种依赖机器的断言。改成可计数的信号，例如在页面里包一层 `HTMLCanvasElement.prototype.toDataURL` 统计编码次数，断言它随帧数线性增长。
5. **不许凭猜测报完成**：向用户汇报前必须贴出实际执行过的命令与结果。没跑过就说没跑过。
6. **图像算法要断言像素**：抠图、描边、水印这类改像素的功能，测试素材不能用 1×1 或纯色图——那种图里「算法正确」和「算法原样返回」看起来一模一样。用「背景 + 已知面积主体」的合成图，断言输出的透明像素比例，覆盖白 / 绿幕 / 近黑三种背景。
7. **参数表只留一份**：测试不要把默认参数表抄一遍再逐项断言，那只能证明两份副本一致。直接和被测模块导出的常量比对，并另外断言这套参数跑出来的**结果**。

## 新增前端模块

- `tools/animation_tuner/public/` 下的新模块要写成同时支持 `module.exports` 与 `window.XSXB*` 的 UMD 风格，方便 Node 里做单元测试。
- 不要把逻辑内联写在 `index.html` 的 `<script>` 里，那样无法测试。抽成模块后由 `index.html` 引入。
- 新模块要同时登记到 `package.json` 的 `format:check` 与一个 `check:*` 脚本里。
- 如果 `index.html` 依赖某个新脚本，在 `tools/tests/cloudflare_site_html.test.js` 加断言，避免 Cloudflare 构建把它漏掉。

## 常用校验命令

```bash
ALLOW_MISSING_PROTECTED_CORE=1 node --test tools/tests/*.test.js   # 全量单元测试
npm run check:frame-organizer-actions                              # 单模块门禁
npx playwright test --project=edge                                 # 真实浏览器
npm run test:visual                                                # 视觉基线（缩放截图对比）
npm run check:e2e-fixture                                          # e2e 种子重置
npx prettier --write <files>                                       # 提交前格式化
```

Playwright 用例通过 `tools/tests/e2e/fixtures.js` 在每个测试前把 `XSXB_E2E_ROOT` 还原成 seed-project。不要在用例之间依赖前一个测试写入的项目或动画。

## 排查 e2e 时的几个坑

- **复位不能原地删目录**：上一个测试的服务端写入可能还没落盘，原地 `rm -rf` 会以 `ENOTEMPTY` 失败，删掉 `data/projects.json` 更会让在途请求把服务器整个打挂。复位改成把目录 `rename` 进 `.reset-trash` 再懒删。
- **复位要自检**：`resetFixtureRoot` 结束时断言 seed-project 只剩 `hero/idle`。漏删会在很久之后才炸成「动画目录已存在」，很难回溯。
- **要看服务器 stderr**：设 `XSXB_E2E_REUSE_SERVER=1` 后手工起 `node tools/tests/e2e/start_server.js`，Playwright 就会复用它，服务端异常直接可读。
- **命中检测别只用 `toBeInViewport()`**：它允许部分可见，元素中心点跑到视口外时 `elementFromPoint` 会返回 `null`。断言前先判断中心点是否在视口内，并把遮挡元素名写进报错。
- **视觉基线是有意改动才刷新**：刷 `--update-snapshots` 之前先看 `test-results/*-diff.png` 和 `*-actual.png`，确认是设计变更而不是布局塌了。
- **`dist/` 会过期**：`protected_wasm.spec.js` 跑的是生产构建。改了 `index.html` 引用的脚本要先 `npm run build:production`，否则新脚本 404，页面在 `<head>` 里就抛错。

## 抠图参数的已知陷阱

容差滑块的下限是 `-1`，那是它的**关闭档**：参考替换按 `距离 <= 容差` 判定，`-1` 匹配不到任何像素。`smart_cutout_defaults.js` 里曾把 `tolerance` 写成 `-1`，导致「智能抠图」跑完、进度条走完、状态显示「已回写 N 帧」，但白底图一个像素都没抠掉（绿幕图只剩 alpha≈13 的灰雾，勉强看着像抠了）。滑块自身的默认值是 `1`，`PROCESSING_PARAMETER_RANGES.tolerance.fallback` 也是 `1`。改这套参数时先用 `tools/tests/smart_cutout_defaults.test.js` 验结果，别只看数值合不合法。

**这份参数是前端和 MCP 共用的。** `xsxb_cutout` 经 `scatter_slice_smart_cutout` 走同一套默认值，所以前端抠图的参数 bug 会等量地出现在 MCP 工具里。改动之后两边都要验。

**「已抠过」的判定别只看四角。** `alreadyCutOut` 原来只采样四个角像素，一张背景还在、但角上恰好透明的帧会被判为「抠过了」直接 skip，回执照样报成功——又是一次「报告干了活、其实没动」。现在改成采样整圈边框、过半透明才算抠过：背景还在的帧边框几乎全不透明，已抠帧只在主体或刀光出画的地方贴边，两者余量都很大。别把阈值调到 0.9 那么紧，刀光扫过底边就能占掉 12%。

**抠图必须可逆。** 智能抠图写回的是 `editedCanvas`；单帧再进抠图台时要用 `cutoutSourceCanvas`（没有就退回 `editedCanvas`）当源，不能拿抠完的结果当源再抠一遍，否则调参只能越抠越空，参数还原也不可能回到原图。第一次写回时钉住源图，翻转时源图一起翻转。

## MCP 的约定

- **工具参数在 `call()` 里按 schema 校验**。目录声明了 `additionalProperties: false`，`xsxb_mcp_schema.js` 会真的执行它：拼错的参数直接报错并提示最接近的正确名字，而不是被丢掉、让工具拿默认值跑完。
- **校验不能收紧现有用法**。handler 一直接受 agent 常发的 `fps: "12"`、`sync: "true"`，校验器要放行这些，只拒绝无法解释的输入。`xsxb_mcp_schema.test.js` 里有一组专门守这个宽容度的用例。
- **新增 schema 关键字要同步校验器**。`xsxb_mcp_schema.test.js` 会遍历整个目录，用到校验器不认识的关键字就直接失败——加 `exclusiveMinimum` 那次就是它当场抓出来的。
- **写盘路径要留在 XSXB 根目录内**。帧路径本来就有沙箱。MCP 预览产物（GIF、sheet、overlay、默认 place / 散图抠图）写到**当前 Tuner 项目工作区的 `.xsxb/`**，不要堆到 MCP 仓库根目录的 `exports/`。相对 `output_path` 挂在 `.xsxb/` 下；绝对路径必须落在根目录内，且不能写进仓库根 `exports/`。动画帧本身仍写回项目 assets。agent 传入的 `file_path` 有 64 MB 上限，靠 `requireExistingFile` 的 stat 拦下，不会先读进内存。
- **模块分工**：`xsxb_mcp_tool_catalog.js` 只放 schema 声明，`xsxb_mcp_arguments.js` 放参数规整，`xsxb_mcp_processes.js` 放 ffmpeg 与 Tuner 子进程，`xsxb_mcp_service.js` 只剩共享状态的 handler 闭包。新工具按这个分工放，别再堆回一个文件。
- **别丢目标**：过几轮对话或修完一刀代码之后，仍以用户最初要的那件东西为终点。中间修的缺陷、回执、具象结果（拖影/GIF/网格）都不是新任务。详见 `.cursor/rules/keep-user-goal.mdc`。

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: root `CONTEXT.md` and `docs/adr/`, created lazily. See `docs/agents/domain.md`.
