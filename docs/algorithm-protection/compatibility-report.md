# 算法保护兼容性报告

核验日期：2026-07-21

状态：静态 Worker/WASM 最终验收通过；受控分发部署为可选后续项

## 已验证

- Chromium、Firefox、WebKit 均通过同一 `ProtectedAlgorithmRuntime` 产品请求，1×1 RGBA 输出逐字节一致。
- 浏览器处理窗口内只观察到无请求体的静态 GET；没有 `/api/` 请求，没有图片、RGBA、掩码或结果上传。
- UI 的产品抠图、框选保护、质量序列、修复传播、跳变、重复与循环分析均通过统一 runtime；生产路径禁止同步算法降级。
- 运行时覆盖协议版本、Transferable、取消、一次 Worker 传输重试、稳定错误码及显式失败。
- Cloudflare 受控门禁的 19 项测试覆盖服务端 Turnstile、Origin/版本绑定、短期会话、授权、限频、撤销、私有 R2 与隐私日志；静态模式仍为默认。
- 浏览器 artifact loader 的 7 项测试覆盖静态/受控模式、SHA-256、MIME/体积、超时、Abort 和无 JS fallback。
- Rust 1.85.1 已完成 8 项单测，12 项 P0/P1 JS/WASM 差分全部通过；RGBA、掩码、PCA、形状匹配和边缘恢复保持既有合同。
- 生产 Worker 已实际加载内容哈希 WASM；Chromium、Firefox、WebKit 均验证 `application/wasm`、仅本地 GET、无像素 POST，并得到逐字节一致的产品结果。
- `npm run audit:protected:final` 已验证最终清单只包含 UI、两类 Worker 胶水、样式和一个受保护 WASM 核心，不允许额外 JavaScript Core/fallback 角色。
- 512、1024、2048 产品路径 P95 分别为 JS 的 1.004、1.053、1.085 倍，均通过默认 1.15 门禁。

## 发布前仍需由部署负责人确认

- 确认核心源码、差分夹具和本文档所在仓库/构建输入的私有可见性；技术构建无法代替仓库权限治理。
- 若启用 Cloudflare 受控模式，需在目标账号部署 Worker/R2/KV/Turnstile 并验证生产域名、缓存、撤销和限频；当前默认仍是静态模式。
- 在目标 CDN 上记录 WASM 下载、首次 Worker 启动、PNG 编码和峰值内存；这些部署相关数据不能由本地内核 P95 替代。
- 发布重大版本前只提供 `dist/` 执行一次 AI 逆向演练，并记录恢复 interface、输出仿制率和耗时。

CI 已将 Rust/WASM 构建、最终审计、三浏览器矩阵和 P95 门禁设为必过项；发布仍必须执行更严格的 `audit:protected:final`，不得降级为普通隔离审计。
