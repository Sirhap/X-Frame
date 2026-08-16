# Animation Contract v1

Use this file when creating or reviewing `animation-constraints.json` for the local production CLI.

## Minimal shape

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
      "type": "actor",
      "anchor": "canvas_bottom_center",
      "loop": true,
      "rootMotion": "in-place",
      "direction": "right",
      "replace": false
    }
  ]
}
```

## Fields

| Field                 | Required                | Default                | Notes                                                                                                         |
| --------------------- | ----------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `version`             | yes                     | none                   | Must be `1`.                                                                                                  |
| `projectRoot`         | yes                     | none                   | Exact Godot root containing `project.godot`.                                                                  |
| `profile`             | yes                     | none                   | Stable character/profile id; normalized with the project slug rules.                                          |
| `motion`              | one of `motion`/`clips` | none                   | A single clip shorthand. The CLI normalizes it to `clips`.                                                    |
| `clips[].id`          | yes                     | none                   | Stable animation id; use `idle`, `run`, `jump`, `attack`, etc.                                                |
| `clips[].source.kind` | yes                     | `png-sequence`         | `png-sequence` and `generated` use CLI import; `video` and `spriteframes` are `browser-required`/specialized. |
| `clips[].source.path` | yes                     | none                   | Relative to the contract directory or an explicit absolute local path.                                        |
| `clips[].frameCount`  | recommended             | detected               | The CLI compares it with the actual PNG count when supplied.                                                  |
| `clips[].fps`         | no                      | `12`                   | Positive number.                                                                                              |
| `clips[].type`        | no                      | `actor`                | Use `vfx`, `effect`, or `prop` only when the runtime should not receive actor boxes.                          |
| `clips[].anchor`      | no                      | `canvas_bottom_center` | Grounded actor default; preserve an existing authored anchor.                                                 |
| `clips[].loop`        | no                      | `true`                 | Death/non-loop actions must set `false`.                                                                      |
| `clips[].rootMotion`  | no                      | `in-place`             | Raster subject stays registered; runtime applies translated movement separately.                              |
| `clips[].direction`   | no                      | `auto`                 | Record `left`/`right` only after inspecting the source or requirement.                                        |
| `clips[].replace`     | no                      | `false`                | Replacement requires explicit intent. The CLI flag `--replace` is the stronger job-level override.            |

## Source execution

The contract module emits one of these execution values:

- `cli-import`: the source is a local PNG directory and can be passed to `import_frames.js` or `import_batch.js` after preflight.
- `browser-required`: the source needs the existing workbench or a specialized importer. Keep the contract, do not pretend the CLI imported it.

Generated animation is not a separate runtime format: after generation, assemble the frames as a stable PNG sequence and set `source.kind` to `generated` or `png-sequence`. Preserve canonical identity and key-pose evidence beside the contract.

## Acceptance fields

An optional `acceptance` object can record hard checks for the producing Agent, for example:

```json
{
  "sameCanvas": true,
  "stableIdentity": true,
  "firstLastIdentical": true,
  "strictImport": true,
  "requireGameplay": true
}
```

These fields document intent; the actual gate is the generated artifact inspection, continuity check, and `validate_import.js --strict --require-gameplay` result. Keep deviations explicit rather than weakening the contract after a failure.
