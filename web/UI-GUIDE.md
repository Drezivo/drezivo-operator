# Operator Web UI guide

`src/app/globals.css` is the design-token source of truth. Keep component styles on these shared
tokens; add a token there before introducing a repeated design value. This guide records their
intended use so new operator views stay readable and consistent.

## Type and spacing

| Token | Value | Use |
| --- | ---: | --- |
| `--text-xs` | 12px | Table values, compact controls, secondary labels |
| `--text-sm` | 13px | Navigation and body copy |
| `--text-md` | 14px | Standard body and card headings |
| `--text-lg` | 18px | Section emphasis |
| `--space-1` | 4px | Tight icon and label spacing |
| `--space-2` | 8px | Compact component gaps |
| `--space-3` | 12px | Control and table spacing |
| `--space-4` | 16px | Default card and page spacing |
| `--space-6` | 24px | Section spacing |
| `--space-8` | 32px | Large page insets |

Use the page title’s existing fluid 25–30px size for the main heading. Body copy, field labels,
status labels, table values, controls, and empty-state text use 12px or larger. Clearly secondary
metadata such as timestamps, request IDs, and environment labels may use 10–11px; avoid 9px text.

## Controls, surfaces, and status

- `--control-height: 44px` is the minimum target for buttons, navigation items, and primary inputs.
- `--radius-control: 7px` is for controls; `--radius-card: 9px` is for cards and table frames.
- The palette is the landing page's atelier system: ivory paper and espresso ink by day, espresso
  night and champagne by night. The legacy names stay for compatibility: `--blue` is the gold
  indicator, `--blue-dark` / `--navy` are the filled-control colour and `--blue-deep` its hover;
  text on those fills is always `--primary-ink` (paper by day, dark ink at night), never white.
- Type: Bodoni Moda (`--font-display`) for the page title, the brand and the sign-in headline only;
  Jost for everything else; numbers in tabular Jost. Uppercase labels use 0.3em tracking.
- Page headings sit on the themed banner art in `public/art` (one composition rendered for light and
  dark, swapped by CSS). Phones get a bottom tab bar (first four views plus Menu, which opens the
  same drawer as the hamburger). Unknown routes show the shared Drezivo 404 (`src/app/not-found.tsx`).
- Semantic status ink/surface/border tokens are success `#176b43` / `#eff9f3` / `#cdebd7`, warning
  `#805000` / `#fff7e8` / `#f1dfb8`, danger `#a12d27` / `#fff1ef` / `#f0d1cd`, and neutral
  `#586174` / `#f1f4f8` / `#dfe5ed`. They map to each `--*-ink`, `--*-surface`, and `--*-border`
  variable in that order. Unknown statuses must use the neutral tone.
- Status labels remain visible beside color indicators so color is never the only signal.

## Responsive layout

Breakpoints are viewport widths and live in the media queries in `src/app/globals.css`:

| Maximum width | Layout behavior |
| ---: | --- |
| 1023px | Sidebar narrows and dashboard metric cards use two columns |
| 767px | Sidebar becomes a drawer; content cards stack |
| 479px | Forms use one column and page gutters tighten |

Check layouts at 320px, 390px, 768px, 1024px, and 1440px. Tables keep their semantic table
structure and scroll horizontally within their own bounded container when their columns need more
width than the viewport. Cards and forms must shrink or stack without causing page-level horizontal
scroll.

## Navigation and data presentation

- The signed-in console keeps one persistent shell. Use `next/link` for in-console navigation and
  preserve the sidebar scroll position when switching views or opening a business.
- Navigation search filters view names only. Show an explicit no-match message and a clear action.
- Use `StatusBadge` for `status` and `state` values. Keep unknown values neutral and display the
  label alongside the badge.
- Render only fields returned by the existing Operator API projection. Do not infer additional
  business data or create controls that lack an approved API and permission contract.
- `Support activity` and `Audit log` remain explicit blocked states until their contracts are ready.
