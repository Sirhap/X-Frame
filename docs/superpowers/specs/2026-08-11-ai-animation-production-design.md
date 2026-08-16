# AI Animation Production Design

**Date:** 2026-08-11  
**Status:** Approved and implemented

## Goal

让 Codex 或其他支持 skills 的 Agent 能在本地启动 XSXB Frame Tuner 后，从自然语言动画需求开始，选择“已有素材工程处理”或“无素材生成后处理”路线，并将结果可靠地导入 Godot、同步 runtime、验证 gameplay 接线和打开工作台。

## Scope

### In scope

- 新增项目专用的上层 skill：`skills/xsxb-animation-production/`。
- 保留 `skills/xsxb-frame-tuner/` 作为导入、调参、同步和验证的执行层；上层 skill 通过 skill 名称复用它。
- 统一使用一个数据驱动的动画生产契约，至少覆盖角色身份、动作、帧数、FPS、画布、锚点、循环、方向、根位移、输出格式和验收条件。
- 支持两条入口：
  - 有 PNG、SpriteFrames、视频或已有帧集时，直接进入检查、整理、导入、调参和同步。
  - 没有可用帧素材时，先生成 canonical 角色参考、关键姿势和帧序列；生成工具不可用时，保留可继续执行的计划和明确阻塞原因。
- 提供一个项目内 AI 工作流入口，用于检查环境、生成/校验契约、执行导入、同步、严格验证和启动本地服务；浏览器专属操作仍由工作台完成。
- 让所有输出保留在用户指定的本地路径或项目 `artifacts/` 下，保留中间帧和验证报告以便复查。

### Out of scope

- 不内置新的云端图像或视频生成服务，不上传用户素材。
- 不重写现有导入、Godot runtime 或浏览器工作台的数据模型。
- 不自动覆盖原始素材、已有动画或 gameplay 场景；替换操作必须由请求明确授权。
- 不把启动本地服务误认为动画制作完成。

## User-facing behavior

以下请求都应能触发上层 skill：

```text
用 XSXB Frame Tuner 给我的 Godot 项目制作一个 12 帧、12fps、可循环的 run 动画；帧素材在 /tmp/hero-run。
```

```text
根据“像素风程序员角色向右奔跑”的描述制作动画，接入我的 Godot 项目并打开工作台。
```

```text
当前 tuner 已经启动，检查 hero 的 idle/run 是否完整同步到 Godot，并修复可验证的问题。
```

Agent 必须先解析目标 Godot 根目录、XSXB 项目/profile、素材来源和替换意图；无法安全判断会绑定哪一个项目或是否覆盖数据时才提问。

## Architecture

采用“生产编排层 + 执行层 + 浏览器层”的三层结构：

```text
自然语言需求
      |
      v
xsxb-animation-production skill
      | 生成/读取 animation-constraints.json
      | 选择生成、导入、整理或修复路线
      v
项目 AI 工作流入口
      | inspect / plan / import / sync / validate / start
      v
现有 tools/import_*.js + godot_sync + validate_import
      |
      v
Godot 项目 + 本地 Webapp 工作台
```

上层 skill 负责意图、约束、路线和交付报告；`xsxb-frame-tuner` skill 负责现有 XSXB 数据操作；项目 CLI 负责可重复、可测试的确定性编排。工作台只承担需要可视判断或浏览器 API 的操作，例如批量抠图、视频解码预览、拖拽框体和最终画面检查。

## Animation production contract

每次生产任务在产物目录写入 `animation-constraints.json`。单动画使用 `motion`，多动画使用 `clips`。最小结构如下：

```json
{
  "version": 1,
  "projectRoot": "/absolute/path/to/godot-project",
  "profile": "hero",
  "identity": { "reference": "reference/hero.png", "style": "pixel-art" },
  "clips": [
    {
      "id": "run",
      "source": { "kind": "png-sequence", "path": "source/run" },
      "frameCount": 12,
      "fps": 12,
      "loop": true,
      "anchor": "canvas_bottom_center",
      "rootMotion": "in-place",
      "direction": "right",
      "replace": false,
      "acceptance": {
        "sameCanvas": true,
        "stableIdentity": true,
        "firstLastIdentical": true,
        "strictImport": true
      }
    }
  ]
}
```

契约中的硬约束优先于推断默认值。根位移与栅格帧内容分开：循环帧保持共同锚点，世界位移交给运行时；第一帧和最后一帧的像素一致性只在循环或用户明确要求时作为硬约束。生成路线必须保留 canonical identity reference 和关键姿势，避免每帧重新发散角色外观。

## Execution routes

### Route A: existing media

1. 检查素材路径、PNG 尺寸、自然排序、透明度、帧数和来源是否可读。
2. 检查项目 registry，按精确 Godot 根目录绑定或创建 XSXB 项目/profile。
3. 将素材路径写入契约并执行现有单组或批量 importer。
4. 对循环、重复帧、跳变帧、锚点和代表帧做确定性/视觉检查。
5. 只在用户授权替换时传递 `--replace`；原始素材始终保留。
6. 同步 Godot runtime，运行 `validate_import.js --require-gameplay --strict`。

### Route B: generate then integrate

1. 将自然语言转换为契约，并明确没有素材时的默认画布、FPS、帧数和循环策略。
2. 选择可用的本地或已授权生成工具；生成 canonical 参考、少量 proof key poses，再生成完整帧序列。
3. 用确定性脚本完成排序、尺寸归一、透明背景、锚点注册、帧命名和动画包构建。
4. 执行与 Route A 相同的导入、框体检查、Godot 同步和严格验证。
5. 若生成工具不可用，输出契约、关键姿势说明、期望输入目录和可继续运行的命令，不伪造已完成的帧或验证结果。

## Project workflow entry

新增一个小型 Node CLI 模块，使用现有 CommonJS 风格和 `node:test`：

- `inspect`：校验 Godot 根目录、Node 版本、素材来源、项目绑定和本地依赖。
- `plan`：读取契约，规范化 profile/clip/source/replace 字段，并输出 JSON 计划；不修改项目数据。
- `import`：根据规范化计划调用现有 `import_frames.js` 或 `import_batch.js`。
- `sync`：调用现有同步流程或通过现有 importer 触发同步，并记录结果。
- `validate`：执行严格导入验证并输出机器可读 JSON。
- `start`：复用 `npm run start:local` 或 Node server，探测已有端口后返回 URL；不重复启动服务。

CLI 默认 `--json` 输出，错误写 stderr 并使用非零退出码；每个阶段都返回明确的 `ok`, `stage`, `errors`, `warnings` 和 `artifacts` 字段。不会把 shell 字符串拼接为命令，路径通过 `spawnSync`/`spawn` 参数数组传递。

## Error handling and safety

- 拒绝不存在的 Godot 根目录、无 `project.godot` 的目录、无 PNG 的 source 目录和无效 FPS/帧数。
- 拒绝把一个 XSXB project id 绑定到不同 Godot 根目录。
- `replace` 默认为 false；覆盖源目录、删除帧、应用工作集或替换已有动画前必须有显式请求。
- 批量导入前先完成全部 source preflight；单组失败时输出失败动画和已完成动画，不宣称全批次成功。
- 异步/子进程调用捕获退出码、stdout、stderr 和超时；服务器启动后必须探测健康入口。
- 失败时保留契约、计划、日志和已生成中间产物，便于从失败阶段继续。

## Testing and acceptance

- 为 CLI 参数解析、契约规范化、路由选择、路径隔离、JSON 输出和失败退出码补 `node:test`。
- 先写测试并确认在 CLI 不存在时失败，再实现最小入口；随后运行针对性测试和完整相关测试。
- 使用现有 fixture 或临时目录验证：单动画导入、多动画批量导入、无 source、不同 Godot 根目录冲突、重复启动检测和严格验证结果透传。
- 运行 skill creator 的 `quick_validate.py` 检查新 skill 元数据；检查 `SKILL.md` 小于 500 行且只包含必要流程。
- 最终运行项目 `npm run check:quick`、新增 CLI 测试和与 import/validation 相关的现有测试；若 Godot 不可用，明确报告未验证的运行时项。

## Delivery report

最终 skill 要求 Agent 报告：契约路径、生产路线、profile/animation、帧数/FPS/循环、tuner 和 Godot 产物路径、验证命令与结果、浏览器人工检查项、已知偏差和下一步建议。只报告实际完成和已验证的内容，不用“已启动”代替“已制作/已接入”。
