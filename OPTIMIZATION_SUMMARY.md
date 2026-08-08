# 项目优化总结

当前项目（XSXB-Frame-Tuner）优化点：

- **check脚本**：100+子检查过长过慢。合并为2-3个核心脚本（syntax/lint + test + cloudflare）。
- **node_modules**：48MB。切换pnpm减体积。
- **protected releases**：bundle JS 500k+。清理冗余或压缩。
- **测试**：大量重复test文件。可部分合并或跳过。
- **perf baseline**：过多。合并到单脚本。

无代码级大bug，但脚本/依赖膨胀是明显痛点。