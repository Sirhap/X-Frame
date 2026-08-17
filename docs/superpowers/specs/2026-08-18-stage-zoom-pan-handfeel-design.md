# Stage Zoom & Pan Handfeel Design

Date: 2026-08-18  
Status: approved (approach A)  
Scope: main animation tuner `#stage` only (not cutout / scatter / organizer)

## Problem

Zoom and pan on the animation edit stage feel clumsy: wheel zoom jumps, pan is often stolen by transform/box/attachment drags, and common gestures (middle-drag, Space-drag, pinch, Ctrl+/-) are missing or conflicting.

## Goals

- Keep editing tools usable while always allowing view navigation
- Match common DCC handfeel (AE / Spine / Aseprite-like)
- Smallest change set: fix wiring bugs + add proven gestures; no new Hand tool mode

## Non-goals

- Dedicated Hand tool in the toolbar
- Minimap, inertia, animated zoom
- Changing cutout / organizer navigation (already closer to the target)

## Behavior

### Zoom

| Input | Behavior |
|-------|----------|
| Wheel over stage | Zoom toward pointer (`zoomViewAt`); one notch = one step (remove duplicate listeners) |
| Pinch on trackpad | Same path as wheel zoom toward pointer |
| Ctrl/Cmd + `=`/`+` and `-` | Zoom about stage center |
| Existing −/+ / slider / 适应 / 100% / F / 0 / double-click | Unchanged |

Clamp remains 12%–800%.

### Pan

| Input | Behavior |
|-------|----------|
| Middle-button drag | Always pan |
| Space + drag | Pan; Space tap without movement still toggles play/pause |
| Primary drag on empty stage | Pan |
| Transform tab | Start frame-transform only when pointer hits the sprite; empty canvas pans |
| Box / attachment hit | Keep edit priority over pan |

### Resize

When `stageViewMode === "custom"`, preserve pan/zoom across canvas resize. Fit / actual modes still recompute.

### Discoverability

Shortcut guide adds: wheel zoom, middle-drag pan, Space-drag pan, Ctrl/Cmd +/- zoom.

## Implementation notes

- Primary modules: `app_events_stage_pointer.js`, `app_stage_view.js`, `app_events.js`, `app_keyboard.js`, `app.js` (remove duplicate binds)
- Mirror cutout patterns for middle / Space pan where practical
- Tests: unit for zoom/pan hit rules and Space tap-vs-drag; e2e or pointer simulation for duplicate-wheel regression and transform empty-canvas pan

## Acceptance

1. One wheel notch changes zoom once (not twice)
2. On Transform tab, empty-canvas drag pans; sprite drag still moves the character
3. Middle-drag pans in every tool tab
4. Space-drag pans; Space tap still plays/pauses
5. Ctrl/Cmd +/- zooms; pinch zooms toward pointer
6. Custom view survives window resize
