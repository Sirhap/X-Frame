# XSXB Frame Tuner Design System

## Direction

Professional desktop creative tool: compact editing cockpit, dark canvas, cyan work-state accent, and restrained depth. The UI prioritizes canvas space, scanning speed, and predictable action placement.

## Tokens

- Spacing: `4 / 8 / 12 / 16 / 24px`.
- Radius: `6px` controls, `8–9px` panels, `10px` brand surfaces.
- Motion: `160ms` feedback, `220ms` layout transitions, `cubic-bezier(0.2, 0, 0, 1)`.
- Typography: macOS system UI stack; `SFMono-Regular` compatible stack for coordinates and data.
- Primary accent: cyan. Orange is reserved for warning and emphasis. Red is destructive only.
- Borders: one-pixel semantic dividers. Shadows communicate elevation, never decoration.

## Layout

- Persistent 64px tool rail.
- 320px contextual parameter sidebar, reduced to 288px near 1280px and collapsible to zero.
- Central work area owns remaining width.
- Immediate canvas controls live above the canvas; save/apply/export actions live in a bottom context bar.
- Frame timeline supports a stable single row and an optional multi-row overview.

## Components

- Buttons use four levels: primary, secondary, icon, destructive.
- Tool navigation uses one outline SVG family with short labels.
- Sidebar uses tabs plus collapsible sections; active state uses shape, border, and text in addition to color.
- Transform is the default sidebar tab because it is the highest-frequency editing context.
- Focus rings remain visible for keyboard users.
- Dialog and tool status updates use live regions without stealing focus.

## Themes

- `dark`: default professional editor theme.
- `light`: paired semantic-token theme; editing canvas stays independently configurable.
- `kunkun`: hidden easter egg unlocked by five Logo clicks.
- Legacy `home` values migrate to `dark`; unknown values fall back to `dark`.

## Accessibility and Responsive Rules

- Text contrast: WCAG AA, normal text at least 4.5:1.
- Interactive graphics and state boundaries: at least 3:1.
- Keyboard tab order follows visual order; tablists use roving tabindex.
- Motion must respect `prefers-reduced-motion`.
- Primary target: 1280–2560px desktop and MacBook displays.
