# ADR-0001: MCP Multimodal Review Artifacts

## Status

Accepted

## Decision

XSXB visual workflows return a bounded PNG in MCP tool content and a custom `xsxb://` resource link for the full artifact. The server does not invoke an LLM through sampling and does not infer whether the client model has vision. Version 2 attachment plans require an artifact-bound human or multimodal approval receipt.

## Consequences

- Text-only clients receive an explicit human-review fallback.
- Full images and GIFs do not inflate every tool result.
- Review evidence remains tied to project revision and content hashes.
- The MCP server must implement resources and mixed tool-result content.
