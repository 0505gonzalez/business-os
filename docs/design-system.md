# Design system

The desktop UI is built from tokens, not ad-hoc values. `apps/desktop/src/tokens.css` is the only place that defines colors, type sizes, spacing, radii, shadows, motion, and layout dimensions. `apps/desktop/src/style.css` holds component styles and references tokens exclusively; adding a hex color, pixel size, or timing there is a smell.

## Layout

The window is a canvas (`--bg-canvas`) that extends under the macOS title bar (`titleBarStyle: hiddenInset`). The top strip (`--titlebar-h`) is a drag region and holds the profile button on the right. Three cards sit on the canvas:

- **Sidebar** (`.sidebar`): brand, workspace switcher, section nav with icons, Settings pinned at the bottom.
- **Content** (`.content`): the page itself, rendered directly on the canvas with a page header (`.page-title`, `.page-subtitle`, `.page-actions`). Content is not boxed: lists are plain rows (the selected one lifts), master-detail splits on a hairline, and Team and Settings are sections separated by hairlines. The Workflows canvas is a dotted field on the background whose edges fade out; only its nodes are cards. Reserve `.card` for the sidebar, the agent panel, modals, canvas nodes, and small callouts such as an invitation code.
- **Agent panel** (`.agent-panel`): a docked column when expanded; a floating pill when collapsed. The pill keeps showing the agent's status while it works. Below 1280px the expanded panel floats over the content instead of taking a column.

## Primitives

| Need | Use |
| --- | --- |
| Surface | `.card` (`.card.pad` adds padding), used sparingly per the layout rules above |
| Buttons | `.btn`, `.btn.primary`, `.btn.ghost`, `.btn.danger`, `.btn.icon`, size `.sm`; `.chip` for small toggles |
| Labels | `.tag` with `.outline`, `.success`, `.warning`, `.danger`, `.accent`, `.plain` |
| Section labels | `.eyebrow` |
| Status | `.orb` (agent presence; `.working`, `.amber`, `.idle`), `.spinner` |
| Lists | `.list` of `.record` buttons; `.row-list` of `.row-item` rows |
| Forms | `label` wraps its control; `.form` stacks fields; `.form-row` lays them out side by side |
| Filters | `.segmented` pill group, `.search` input |
| Empty, loading, error states | `EmptyState` from `shell.tsx` |
| Icons | `Icon` from `icons.tsx` (line icons, 24px grid, `currentColor`) |
| Workflow canvas | `WorkflowGraph` from `workflow-graph.tsx`: pan by drag or scroll, zoom with ⌘ scroll or the controls, fit to view |

## Type scale

`--text-xs` 11 · `--text-sm` 13 · `--text-base` 14 · `--text-md` 15 · `--text-lg` 17 · `--text-xl` 20 · `--text-2xl` 24 · `--text-3xl` 30 · `--text-4xl` 38. Headings use `--tracking-tight` or `--tracking-snug`; eyebrows use `--tracking-wide` uppercase. The bundled Inter Variable font (`fonts/InterVariable.woff2`, OFL) enables optical sizing automatically.

## Spacing

Four-pixel grid: `--space-1` (4) through `--space-16` (64). Card padding is `--space-6`; page gutters are `--space-8`; the shell gap between cards is `--shell-gap`.

## Restyling new screens

When a new component arrives with its own colors (for example a React Flow node), map them to tokens instead of keeping the literals: white → `--bg-surface`, light gray fills → `--bg-surface-2` or `--bg-sunken`, borders → `--border` / `--border-strong`, secondary text → `--fg-2` / `--fg-3`, highlights → `--accent-soft` / `--accent-fg`, card corners → `--radius-md` or `--radius-lg`, elevation → `--shadow-card` / `--shadow-raised`.
