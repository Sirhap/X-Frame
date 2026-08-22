# XSXB MCP Workbench Optimization Design

## Goal

Make MCP-authored frame attachments, weapons, and attack trails behave identically in the animation
workbench, MCP previews, persisted project data, and Godot output while preserving every existing MCP
tool contract.

## Compatibility

- Keep the existing 29 tool names, accepted parameter coercions, defaults, and receipt fields.
- Add `xsxb_get_workflow` and `xsxb_plan_attachment` for a total of 31 tools.
- Keep manual attachment transforms and manual attack-trail sticks available.
- Read legacy attachment keys through metadata and write canonical workbench keys on the next edit.

## Attachment Identity and Geometry

One shared attachment utility owns canonical frame keys, metadata matching, transform normalization, and
point transforms. Group coordinates use the character foot as `(0, 0)` and negative y above the floor.
Attachment offsets locate the image center relative to that origin.

Weapon placement requires explicit hand anchors. A weapon anchor supplies a hand point and either a tip
point or rotation plus scale. `xsxb_measure_image` supplies the source grip and tip. Planning rotates and
scales the source grip-to-tip vector, then translates the image so the transformed grip lands on the hand.
Transforms between anchors interpolate position, logarithmic scale, and the shortest rotation arc. The
plan is immutable, revision-bound, content-hash-bound, previewable, and requires explicit confirmation.

## Trail Derivation and Composite Rendering

When `xsxb_add_attack_trail` receives `attachment_id`, each matching weapon instance supplies a stick:
the transformed weapon tip is `top` and transformed grip is `bottom`. Manual sticks remain authoritative
and cannot be combined with derived sticks.

MCP export uses the workbench layer order: below attachments, behind trails, character, above attachments,
front trails. Character visual transforms also affect attachment and trail coordinates. GIF and sheet
exports include attachments and trails by default and expose independent opt-out flags.

## Agent Experience and Lifecycle

Detailed workflows move from the initialization paragraph into `xsxb_get_workflow`. Every tool advertises
a title, complete risk annotations, and an output schema. Protocol negotiation supports the stable MCP
revisions used by the server. The compositor owns one lazy browser session per MCP service and releases it
through `service.close()` when STDIO ends.

## Verification

All behavior changes use failing tests first. Geometry tests use hand-derived literal expectations; image
tests assert pixels and layer order; workbench behavior runs in Edge. Performance assertions count decodes,
asset loads, browser launches, and JSON reads rather than elapsed time.
