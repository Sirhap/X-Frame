# Organizer Smart Cutout Stacking Design

## Problem

The organizer opens its cutout workset as a child modal and remains visible but inert while the child is active. The organizer modal uses `z-index: 1001`. Only single-image cutout sessions receive `z-index: 1002`; organizer batch worksets keep the base cutout value `1000`, so the organizer covers the active child workbench and the unresolved workset promise makes the page appear frozen.

## Design

Mark every organizer-owned cutout workset independently of whether its editing mode is `single` or `batch`. The cutout UI controller will expose this state through a `worksetSession` class on `#cutoutModal`. The stylesheet will place that class above the organizer while retaining `singleEditSession` for single-mode layout and controls.

The existing workset promise, route, organizer inert state, apply/cancel behavior, and focus restoration remain unchanged.

## Error Handling and Edge Cases

- Standalone batch cutout must not receive the embedded-workset stacking class.
- Both organizer single-frame and batch worksets must remain above the organizer.
- Closing a workset must continue restoring organizer interactivity through the existing promise lifecycle.

## Verification

- Unit-test the session-class behavior for standalone, single workset, and batch workset states.
- Add a browser regression that opens organizer batch cutout and proves the cutout modal is the topmost layer.
- Run the focused tests, formatting/static checks, and project test suite.
