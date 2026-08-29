# MCP vendored dependencies

Copies of the Node modules MCP needs so this folder can later become a
standalone package. Tuner UI stays in `tools/animation_tuner/`; these files
are not the frontend.

Do not copy `tools/xsxb_mcp_*.js` shims into here — they point back at `mcp/`.

`xsxb_root.js` is MCP-only: vendored `validate_import` / `import_spriteframes`
resolve the workspace via `XSXB_ROOT` or the nearest `package.json`.
