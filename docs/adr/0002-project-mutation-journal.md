# ADR-0002: Project Mutation Journal

## Status

Accepted

## Decision

Every project-writing MCP tool runs through one mutation journal. Managed JSON and affected frame paths are snapshotted before mutation, local failures roll back automatically, and retained revisions can be restored only through a dry-run token and explicit confirmation.

## Consequences

- Data drift has an attributable tool, revision, and restore path.
- Media mutations consume bounded local storage.
- Godot handoff failures remain explicit because external writes cannot be made fully atomic with local storage.
- Revisions are retained by count and byte budget.
