# 生产资产与授权边界

状态：Phase 0 基线

核验日期：2026-07-21

## 1. 当前授权事实

- 本地仓库的根许可证是 MIT。`package.json` 声明 `license: MIT`，并已设置 `private: true` 和失败型 `prepublishOnly`，用于阻止当前混合源码包被 npm 发布。
- 当前本地 Git 配置没有 `origin` 或其他远程地址，因此不能仅凭本地副本证明远程仓库当前是公开还是私有。
- 本轮未获得 npm registry 的可靠发布历史证据。发布前必须通过组织账号或 registry 记录再次核验。
- 已经按照 MIT 许可证向第三方提供过的源码和版本，其既有授权不能通过后续闭源撤销。

因此，当前仓库内已有算法源码必须按“可能已经公开”处理。后续新增的受保护 Rust/WASM 内核应放在明确的私有源码边界中，并通过构建产物或私有包输入本仓库；不能只修改本仓库的许可证后宣称历史实现已经私有化。

## 2. 资产分级

| 级别         | 资产                                                            | 发布策略                                   |
| ------------ | --------------------------------------------------------------- | ------------------------------------------ |
| 公开源码     | UI、控制器、本地服务、当前 MIT 历史代码                         | 可以进入源码仓库，不直接复制到生产静态目录 |
| 私有算法输入 | 后续 Rust 内核、Golden Corpus、随机种子、逆向报告、客户构建种子 | 仅存在于私有仓库和受控 CI                  |
| 生产公开产物 | `dist/index.html`、哈希 JS/CSS、未来去符号 WASM、最小 manifest  | 仅通过白名单构建产生                       |
| 本地私密数据 | 原始图片、视频、RGBA、掩码、项目绑定和导出结果                  | 不进入构建、日志或远程发布                 |

## 3. Phase 1 发布白名单

生产目录只允许：

```text
dist/
  index.html
  asset-manifest.json
  assets/
    ui.<sha256-prefix>.js
    styles.<sha256-prefix>.css
    algorithm-worker.<sha256-prefix>.js
    analysis-worker.<sha256-prefix>.js
  sbom.spdx.json
```

构建器从开发 `index.html` 推导有序入口，不复制 `public/`、`docs/`、`tests/`、夹具或 Source Map。两个 Worker 会内联其 `importScripts` 依赖，从而不发布可按原文件名直接下载的 Core JS。构建还生成最小 SPDX SBOM，并用完整源码指纹派生 `buildId`。

Phase 1 的 UI bundle 仍包含现有 MIT JavaScript 算法。它降低直接复制和误发布风险，但不构成算法保密。只有完成 Runtime seam 和 Rust/WASM 迁移，并从 UI bundle 删除同步 JS 实现后，才能满足“生产环境不存在敏感 JS 降级路径”的最终验收项。

## 4. 发布门禁

每次发布前必须执行：

```powershell
npm run build:production
npm run audit:production
```

审计失败时不得上传部分产物。`asset-manifest.json` 记录每个公开资产的完整 SHA-256 和字节数，部署系统应把整个 `dist/` 作为不可分割版本发布和回滚。

当前页面仍调用 `/api/config`、保存与项目同步 API。单独部署 `dist/` 可以加载 UI 和本地算法，但不能提供完整项目管理功能；Cloudflare/Vercel 部署必须同时实现兼容的 API Adapter，或将该产物交给现有 Node 服务托管。纯静态 404 不应被误判为算法构建失败。

## 5. Phase 2 前置决策

进入 Runtime seam 实施前必须确认：

1. 私有内核的仓库、许可证和 CI 访问主体。
2. 生产 Adapter 与开发 Adapter 的独立入口，禁止通过运行时环境变量选择敏感降级。
3. Worker 取消、崩溃重试、输入快照和峰值内存合同。
4. Cloudflare/Vercel 的缓存键、授权 Cookie、CORS 和私有产物存储策略。
