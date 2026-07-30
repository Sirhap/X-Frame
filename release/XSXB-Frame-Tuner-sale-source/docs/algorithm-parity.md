# FramePacker 算法等价性清单

本清单只把通过公式核对和固定夹具验证的实现标记为“等价”。界面相似、参数名称相同或流程结构相近均不视为算法等价。

## 验证等级

- `exact-js`：公开 JavaScript 包中保留了完整公式，当前实现按相同分支、常量和舍入规则重构，并有固定数值夹具。
- `kernel-rebuilt`：根据 WASM 参数结构和反编译指令独立重构，并通过覆盖边界输入的输出夹具。
- `structural`：流程和主要特征相同，但数值行为尚未证明一致。
- `pending`：尚未完成等价实现。

## 当前状态

| 能力 | 来源 | 状态 | 当前说明 |
|---|---|---|---|
| OKLab 去溢色 | 客户端 JavaScript | `exact-js` | 使用 15°/30° 色相平滑衰减、参考色度响应和 OKLab 反变换。 |
| 色键清理 | `fp_kernel_09` | `kernel-rebuilt` | 已按反编译分支重构透明替换、YCbCr 内外带和 OKLab 色相/色度门限；默认清理 40、柔边 30。 |
| 重复帧时序判定 | 客户端 JavaScript | `exact-js` | 保留相邻帧、持久锚点和自动阈值调整。 |
| 跳变帧时序判定 | 客户端 JavaScript | `exact-js` | 使用桥接相似度减去较弱邻帧相似度。 |
| 循环候选排序 | 客户端 JavaScript | `exact-js` | 使用完整自相似矩阵、自相关、凸包基线、边界筛选和长短偏好。 |
| 帧图像相似度 | 客户端 JavaScript | `exact-js` | Canvas 归一化为 256×256；使用预乘 Alpha 误差、透明权重和稳定角落背景排除。 |
| 3-4-5 距离场 | `fp_kernel_04` | `kernel-rebuilt` | 当前双向距离变换与反编译指令一致；仍需扩大随机夹具。 |
| 连通距离判定 | `fp_kernel_03` | `kernel-rebuilt` | 按非零候选和距离小于 10 的原始返回语义重构。 |
| 连通候选扩散 | `fp_kernel_06/10` | `kernel-rebuilt` | 已重构 RGBA 欧氏半径、种子预检、4 邻域扫描线扩散、超限整区拒绝和全局候选语义。 |
| PCA 局部坐标 | `fp_kernel_05` | `kernel-rebuilt` | 已重构非零点矩、稳定特征向量、15% 各向同性判定、方向继承、退化返回及投影跨度。 |
| 形状匹配 | `fp_kernel_11` | `kernel-rebuilt` | 已重构面积 0.769231～1.3、三段 PCA 比例门、面积 200 起的紧致度门及 nullable 分层结果。 |
| 颜色替换流水线 | `fp_kernel_07` | `kernel-rebuilt` | 已按反编译分支重构线性色轴恢复、合成反解、置信度混合、Alpha 重建及共享后处理顺序；mode 0/1/2/3、多档非零强度、显式去溢参考色与完整组合夹具均逐字节一致。 |
| 边缘颜色恢复 | `fp_kernel_08` | `kernel-rebuilt` | 已重构线性 RGB 投影、垂直残差、候选边缘膨胀及 0.5/0.9 分段修复，并锁定遮罩和颜色退化边界。 |
| 连通抠图去溢色 | `fp_kernel_13` | `kernel-rebuilt` | 已重构选区边界检测、4 邻域分层扩张、RGBA/线性 RGB/YCbCr 三种恢复模式、Alpha 边界约束和透明替换退化分支；半径 0～3、一维与二维夹具均逐字节一致。 |
| 框选保护色 | `fp_kernel_14` | `kernel-rebuilt` | 已重构 5000 点采样、RGB 分桶权重、YCbCr 方向聚类、亮度代表点、已有颜色覆盖、贪心覆盖率及 0/1/2 状态；固定多方向夹具的颜色顺序、覆盖率和状态与公开客户端一致。 |
| 最近颜色搜索 | `fp_kernel_01` | `kernel-rebuilt` | 已重构圆形半径、可选 Alpha、颜色距离优先、空间距离破同分及中心精确命中快路。 |

## 产品接入状态

- `fp_kernel_07/13` 已通过 `applyCutout()` 的感知色键产品入口接入，覆盖多背景样本、全局/连通选择、种子点、通用容差、边缘增强、三种去溢模式、Alpha 阈值、模糊与连续边缘恢复强度。
- `fp_kernel_14` 已接入框选保护路径，选择时会使用抠图预览 Alpha、全图原图/预览、已有保护色，并向界面返回 `coverage/status`。
- 预览、批量处理、ZIP 导出、工作集返回和动画组回写现统一经过 `applyProductCutout()` 与不可变 PNG 输出记录。20 帧合成 Golden Corpus 已锁定最终 RGBA SHA-256，并验证 ZIP 本地文件数据和动画回写载荷逐字节复用同一 PNG data URL。
- 真实浏览器已验证当前 20 帧动画组在普通模式和感知色键模式下均完成 `20/20` 预览生成且无控制台错误。隔离临时项目也已真实调用 20 帧动画覆盖接口，验证有效批次顺序写入、无效中间帧零修改回滚和重复目标拒绝。
- “智能清除”修复现通过选区 mask 调用共享 `applyCutout()`/参考 Kernel 流水线，保留连通选择、羽化、边缘恢复和去溢色语义，不再由 UI 层逐像素硬清 Alpha。
- 批量质量检测现同时覆盖循环首尾接缝、主体分裂、内部孔洞、画布边缘裁切、透明边缘 RGB 污染和可见残余背景色。`fp_kernel_07/13/14` 另有 48 组确定性随机小图，验证输出尺寸、输入不可变性和边界选区。
- FramePacker 新增代码按职责拆分：`BatchCutoutProductCore` 承载修复和产品编排，`BatchCutoutProtectionCore` 统一 fp07/fp14 的方向保护判定和框选覆盖算法，`BatchCutoutReferenceRecoveryCore` 封装 fp07/fp13 共享恢复流水线，`BatchCutoutReferenceReplaceCore` 封装候选扩散及颜色替换入口，`CutoutQualityCore` 独立承载质量检测，`BatchCutoutWorkerClient` 隐藏 Worker/同步降级和帧内取消。`BatchCutoutCore` 仅负责组合这些 Module 并保留兼容 facade；`npm run perf:framepacker` 提供 512/1024/2048 普通与参考色键产品路径基线。
- Canvas PNG 编码不具备跨浏览器字节等价性：同一 7×5 RGBA 夹具在 Chrome、Firefox、WebKit 中的 data URL 长度分别为 334、330、406。三者 Alpha 完全一致、完全不透明 RGB 完全一致；Firefox 半透明像素的预乘 RGB 最大舍入差为 2。因此跨浏览器合同限定为 Alpha/不透明像素完全一致、半透明可见颜色允许最多 2 个字节级舍入差，不宣称 PNG 编码字节等价。

## WASM 内核映射

项目中的 `tools/framepacker_reference_manifest.js` 固化了 14 个导出内核及公开加载器中的参数结构大小。`fp_kernel_00` 和 `fp_kernel_12` 是初始化/性能状态接口，不属于图像算法；其余 12 个为像素、掩码、选择和跟踪内核。

原 WASM 带客户端状态校验，不能把脱离原应用状态的直接调用结果当作算法输出。本项目不绕过该状态机，而是根据公开参数封装、反编译指令和可验证的 JavaScript 调用路径进行独立重构。

## 公开客户端对照夹具

- `fp_kernel_07`：全局/断开区域替换、RGBA 容差、255 mask、显式参考色、方向保护色、Alpha 高低阈值，以及 mode 0/1/2/3 在混合强度 25/50/75/100 下的字节输出；另有显式去溢参考色和完整共享流水线组合夹具。
- `fp_kernel_13`：半径 0 连通替换、255 mask、mode 0/1/2、半径 1/2/3、透明替换、同色非透明 Alpha 恢复，以及一维和二维边界扩张字节输出。
- `fp_kernel_14`：红、蓝、棕、黄、灰和背景绿组成的 8×8 方向夹具；锁定五个输出色的顺序、`coverage=82` 与 `status=0/1/2`。

公开 loader 的参数偏移已固化在 `tools/framepacker_reference_manifest.js`。测试只保存独立构造的输入/输出夹具，不包含或分发对方 JavaScript/WASM 文件。

## 完成标准

1. 每个内核至少覆盖零尺寸、透明像素、边界像素、掩码、极端参数和随机小图。
2. RGBA 内核逐字节比较；距离场和掩码要求完全一致；浮点描述符记录绝对和相对误差。
3. 未达到标准的功能在界面和文档中不得宣称“FramePacker 等价”。
4. 性能优化只能在等价测试通过后进行，且不能改变舍入、阈值和执行顺序。
