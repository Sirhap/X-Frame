# 算法保护迁移基线

状态：JavaScript 基线与最终 Rust/WASM 产品路径 P95 已锁定

核验日期：2026-07-21

## 功能基线

迁移差分以现有私有测试为权威来源：

- `tools/self_test_cutout_product*.js`：产品入口、Golden Corpus、参考色与修复组合。
- `tools/self_test_cutout_protection.js`：框选保护与方向保护色。
- `tools/self_test_cutout_tracking.js`：PCA、形状描述和跨帧匹配。
- `tools/self_test_frame_organizer_core.js`：帧相似度、重复、跳变和循环。
- `tools/tests/worker_client.test.js`：Transferable、取消、一次传输重试和输入快照。

RGBA、掩码和距离场要求逐字节一致；浮点描述符继续使用 `docs/algorithm-parity.md` 的既有误差合同。透明输入、空选区、一维图像、尺寸不匹配、取消和 Worker 重启均是阻断发布的边界条件。

## 性能基线

执行命令：

```powershell
npm run perf:framepacker:check
```

本机实测：

| 尺寸 | 模式 | 迭代 | 耗时 ms | MP/s | RSS 增量 MB | 输出哈希 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 512×512 | normal | 3 | 92.19 | 2.84 | 34.22 | `6cfeae9fb985b7fc` |
| 512×512 | referenceChromaKey | 3 | 70.60 | 3.71 | 17.50 | `f16fbfdf2c46c418` |
| 1024×1024 | normal | 2 | 262.08 | 4.00 | 49.13 | `34b83eaecc6330c0` |
| 1024×1024 | referenceChromaKey | 2 | 194.76 | 5.38 | 38.00 | `abf0797336f73fa2` |
| 2048×2048 | normal | 1 | 1017.07 | 4.12 | 122.66 | `4214e9bb1086286e` |
| 2048×2048 | referenceChromaKey | 1 | 715.67 | 5.86 | 65.41 | `d94f901d2c2edb78` |

这些数值是迁移前的本机回归基线，不伪装成 P95。WASM 验收必须针对每个尺寸单独采集足够样本并报告 P95；默认门槛为核心处理 P95 劣化不超过 15%。首次 WASM 下载/编译/初始化、Worker 传输、内核执行、PNG 编码和峰值内存必须分列，不能合并成单一平均值。

Phase 2 seam 收口后于同一台 macOS 主机复测，六项输出哈希全部保持一致：normal 为 89.32/255.32/994.24 ms，referenceChromaKey 为 68.95/193.08/711.36 ms。该次单次回归没有出现超过 15% 的劣化；它仍不是最终 WASM P95，不能替代 Phase 4 性能验收。

最终产品路径使用 `npm run perf:protected-wasm:check` 复测。脚本在每个计时样本前执行显式 GC，分别采集开发 JS Adapter 与生产 WASM Adapter 的完整 `referenceChromaKey` 产品流水线；哈希必须一致，WASM/JS P95 比率不得超过 1.15。

| 尺寸 | 样本 | JS P95 ms | WASM P95 ms | WASM/JS | 输出哈希 |
| --- | ---: | ---: | ---: | ---: | --- |
| 512×512 | 20 | 61.19 | 61.44 | 1.004 | `797a3b95b3fab13c` |
| 1024×1024 | 15 | 177.22 | 186.55 | 1.053 | `2c85ec69fbee154f` |
| 2048×2048 | 10 | 566.50 | 614.83 | 1.085 | `581312327b844103` |

测试环境为 macOS arm64、Node.js 24.11.1；WASM 初始化 0.33 ms，release 产物 126,905 bytes。三档均通过 15% 门禁。该数据针对核心产品处理路径，不把网络下载、PNG 编码或 CDN 延迟混入内核 P95；真实浏览器测试另行验证首次 WASM GET、MIME、无像素 POST 与三浏览器执行。

## 构建基线

`npm run build:production && npm run audit:production` 已验证白名单、内容哈希、无 Source Map、SBOM、源码指纹和私有发布记录。生产清单现在声明 `protectionLevel: worker-wasm` 与 `algorithmFormat: wasm`；`npm run audit:protected:final` 已在 Worker + 去符号 WASM 且无敏感 JS 降级路径的条件下转绿。

同一源码指纹使用 `rotation-a`/`rotation-b` 两个种子生成 `dca70c32ee51fba05931` 与 `34068cedb8a7f34940b7`，UI、产品算法和帧分析三个受保护角色的内容哈希均发生轮换。随后从后一版本回滚至前一版本并重新通过独立产物审计，最后恢复默认构建。
