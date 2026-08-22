# XSXB MCP Workbench Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and
> superpowers:test-driven-development task-by-task.

**Goal:** Close the MCP/workbench/Godot loop for weapon attachments and attack trails without breaking
existing MCP clients.

**Architecture:** Extend the shared attachment utility with canonical identity and geometry, add a focused
weapon planner, compose attachment/trail rendering in one export boundary, and keep
`createXsxbMcpService()` as the compatibility facade.

**Tech Stack:** Node.js CommonJS, JSON-RPC MCP, PNG utilities, Playwright Edge, Node test runner.

## Global Constraints

- macOS and Node.js 18+.
- Existing tool names, parameter coercions, and receipt fields remain compatible.
- New functions have JSDoc and all changed files pass Prettier and ESLint project gates.
- Tests precede production changes and must be observed failing for the intended reason.
- User-owned untracked files in the original checkout are never copied, modified, or committed.

---

### Task 1: Canonical attachment identity

- [x] Add failing utility and service tests proving MCP-created attachments match the workbench key.
- [x] Add metadata fallback tests for legacy simplified keys.
- [x] Implement shared canonical key/matching helpers and full MCP attachment metadata.
- [x] Run focused tests, revert the production change, observe regression failure, restore, and rerun.

### Task 2: Weapon attachment planning

- [x] Add failing geometry tests for rotated/scaled grip placement and shortest-angle interpolation.
- [x] Add failing service tests for `xsxb_plan_attachment`, revision/hash guards, and confirmed apply.
- [x] Implement the deterministic weapon planner and annotated preview output.
- [x] Extend `xsxb_add_attachment` with plan application, atomic rollback, and quality receipts.
- [x] Run the focused Red-Green mutation check.

### Task 3: Weapon-derived trails

- [ ] Add failing tests that derive stick bottoms/tops from persisted weapon transforms.
- [ ] Reject mixed manual and derived sticks and invalid or discontinuous weapon poses.
- [ ] Implement derived sticks and diagnostic receipts while preserving manual/default behavior.
- [ ] Run the focused Red-Green mutation check.

### Task 4: Workbench-parity composite exports

- [ ] Add pixel fixtures proving below/behind/character/above/front layer order.
- [ ] Add GIF and sheet integration tests for attachments, trails, and visual transforms.
- [ ] Implement a shared composite renderer with content-hash asset caching.
- [ ] Reuse one lazy Playwright session and close it from the MCP service lifecycle.
- [ ] Add count-based performance tests and run the focused Red-Green mutation check.

### Task 5: MCP contract and architecture

- [ ] Add failing catalog tests for 31 tools, workflow content, annotations, and output schemas.
- [ ] Add protocol negotiation and service-close transport tests.
- [ ] Implement `xsxb_get_workflow`, concise instructions, annotations, output schemas, and negotiation.
- [ ] Extract domain handlers without changing the compatibility facade.
- [ ] Update MCP and architecture documentation.

### Task 6: Verification and delivery

- [ ] Run `npm run check:mcp` and the usability audit.
- [ ] Run the complete Node test suite.
- [ ] Run Edge E2E and visual tests for the user-visible workbench behavior.
- [ ] Run the MCP performance baseline and `git diff --check`.
- [ ] Request code review, fix all critical/important findings, and rerun affected gates.
