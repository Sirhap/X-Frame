# XSXB Domain Context

## Animation Project

An XSXB-owned collection of profiles, animations, generated frames, tuning, bindings, review evidence, and an optional Godot handoff.

## Review Artifact

Immutable visual evidence produced from one project revision and one deterministic operation. It contains a bounded inline PNG, a full MCP resource, hashes, provenance, and a review policy.

## Attachment Plan

A revision-bound proposal that maps one attachment asset onto explicit animation frames. Version 2 plans are persisted, expire after seven days, bind a Review Artifact, and support atomic create or replace application.

## Project Revision

A restorable mutation journal entry containing the project revision before and after an MCP write plus snapshots of every managed path touched by that write.

## Frame Semantics

Deterministic analysis that separates the temporally persistent character body from transient source FX and reports body bounds, feet, confidence, and provenance for motion, cutout, box, and trail workflows.

## Godot Handoff

The explicit delivery step that mirrors reviewed XSXB data and runtime assets into a bound Godot project. A local XSXB commit can succeed while the handoff remains sync-pending.
