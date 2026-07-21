# Protected Algorithm Core

无第三方 crate 依赖的 Rust/WASM 图像算法内核。生产导出仅使用产品语义名称，不暴露参考内核编号。

仓库根目录的 `rust-toolchain.toml` 固定 Rust `1.85.1`、`rustfmt` 与 `wasm32-unknown-unknown` 目标，避免本机和 CI 使用不同编译器生成不可比较产物。

## 构建

```sh
cargo build \
  --manifest-path crates/protected_algorithm_core/Cargo.toml \
  --target wasm32-unknown-unknown \
  --release
```

`Cargo.toml` 的 release profile 启用 fat LTO、单 codegen unit、`panic=abort`、尺寸优化和符号裁剪。产物位于：

```text
crates/protected_algorithm_core/target/wasm32-unknown-unknown/release/protected_algorithm_core.wasm
```

## ABI

所有操作返回稳定状态码：`0` 成功，`1` 空指针，`2` 尺寸不匹配，`3` 溢出/超限，`4` 输出过短，`5` 缓冲区重叠，`6` 退化输入，`7` 非法参数，`8` 非活动/外部分配。图像最大为 16 MiPixels，单缓冲区最大为 128 MiB。

- `protected_core_reserve(length)` / `protected_core_release(pointer, length)`：带活动分配登记的线性内存所有权边界；错误长度、外部指针和重复释放返回状态 8。释放只把模块自有缓冲放回容量池，从不通过调用方数据重建 `Vec`；销毁 WASM 实例时统一回收线性内存。
- `protected_core_distance_field(...)`：二值种子遮罩转小端 `i16` 3-4-5 距离场。
- `protected_core_local_frame(...)`：PCA 局部坐标，固定 72 字节结果。
- `protected_core_shape_match(...)`：分层形状门，固定 64 字节结果。
- `protected_core_restore_edges(...)`：线性 RGB 边缘颜色恢复；颜色参数编码为 `0x00BBGGRR`。
- `protected_core_apply_cutout(...)`：产品级全局颜色替换/连通选区修复，共享混合恢复、Alpha、边缘恢复、方向去溢与保护色阶段。
- `protected_core_select_protection_colors(...)`：方向聚类、已有颜色覆盖与贪心保护色选择；可选全图原图/预览及尺寸执行 `0.0005` 候选过滤和 top-2 退化保留。

`protected_core_apply_cutout` 使用固定 64 字节配置，精确偏移见导出函数 Rustdoc。Worker 一次调用即可传递 RGBA、可选 255 遮罩、最多 32 个保护色并取得完整 RGBA，避免逐像素跨越 JS/WASM seam。

结果结构的精确偏移记录在各导出函数的 Rustdoc 中。调用方必须使用分离的输入、遮罩与输出分配；内核主动拒绝重叠范围，避免原始指针别名产生未定义行为。

## 验证

Rust 单元测试可用时执行：

```sh
cargo test --manifest-path crates/protected_algorithm_core/Cargo.toml
```

Node 差分测试会读取 `PROTECTED_CORE_WASM_PATH`，未设置时尝试上述默认 release 产物。默认缺少 WASM 会失败；只有显式设置 `ALLOW_MISSING_PROTECTED_CORE=1` 才允许开发环境跳过：

```sh
node --test tools/tests/wasm_protected_algorithm_core.test.js

ALLOW_MISSING_PROTECTED_CORE=1 \
  node --test tools/tests/wasm_protected_algorithm_core.test.js
```
