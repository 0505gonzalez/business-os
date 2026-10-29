# Design system

The desktop UI is built from tokens, not ad-hoc values. `apps/desktop/src/tokens.css` is the only place that defines colors, type sizes, spacing, radii, shadows, motion, and layout dimensions. `apps/desktop/src/style.css` holds component styles and references tokens exclusively; adding a hex color, pixel size, or timing there is a smell.

The tokens are a port of Kiro Crew's light theme with its purple accent, so the two apps share a visual language: the same surface, text, border, accent, and status colors, the same 6/8/12/16px radii, the same soft shadows, and the same type and spacing scale. Token names follow Kiro Crew's (`--bg`, `--panel`, `--card`, `--text`, `--text-strong`, `--muted`, `--border`, `--accent`, `--accent-subtle`, `--ok`, `--warn`, `--danger`, …) so a Kiro Crew theme block can be dropped in to retheme.

## Layout

The window is a white `--bg` canvas that extends under the macOS title bar (`titleBarStyle: hiddenInset`). The top strip (`--titlebar-h`, 40px) is a drag region and holds the profile button on the right. Two bordered panels sit on the canvas with an 8px gutter, and the content between them sits directly on the white background, as in Kiro Crew:

- **Sidebar** (`.sidebar`): a `--panel` (#fafafa) bordered panel with the wordmark, workspace switcher, section nav with icons, Settings pinned at the bottom. The selected item tints with `--accent-subtle`.
- **Content** (`.content`): no panel chrome, just a header row (`.page-title`, `.page-subtitle`, `.page-actions`) under a hairline. Content is not boxed: lists are plain rows, master-detail splits on a hairline, and Team and Settings are hairline sections. The Workflows canvas is a dotted field on the panel whose edges fade out; only its nodes are cards.
- **Agent panel** (`.agent-panel`): a docked bordered panel when expanded; a floating bordered pill when collapsed that keeps showing the agent's status. Below 1280px the expanded panel floats over the content instead of taking a column.

Reserve `.card` for the shell panels, canvas nodes, modals, and small callouts such as an invitation code.

## Type

Space Grotesk (bundled, OFL) for everything; `--mono` for code. Body is 13px / 1.55 in `--text`; headings use `--text-strong`.

| Token         | Size   | Use                                                         |
| ------------- | ------ | ----------------------------------------------------------- |
| `--text-2xs`  | 10.5px | message role labels, node eyebrows                          |
| `--text-xs`   | 11px   | eyebrows (bold, uppercase, `--tracking-wider`), tags, chips |
| `--text-sm`   | 12px   | meta, descriptions, form labels, rows                       |
| `--text-ui`   | 12.5px | buttons, segmented controls                                 |
| `--text-base` | 13px   | body, nav, list titles, inputs                              |
| `--text-md`   | 14px   | section headings                                            |
| `--text-lg`   | 15px   | page titles                                                 |
| `--text-xl`   | 17px   | detail and modal titles                                     |
| `--text-2xl`  | 20px   | onboarding titles                                           |

Weights: 400 body, 500 for UI labels and list titles, 600 for headings, 700 for eyebrows and the wordmark.

## Spacing and controls

Four-pixel grid: `--space-0-5` (2) through `--space-16` (64); the common rhythm is 8px gaps, 12px padding, 16px between sections. Controls are 24px (`.sm`, chips), 28px (buttons, pills), 32px (inputs), 36px (the agent pill). Secondary buttons are white with a 1px `--border-strong` border; primary buttons are `--accent` with white text; ghost buttons are text-only with a `--bg-hover` hover. Focus is a `--ring` border plus a 3px `--accent-subtle` halo.

## Primitives

| Need                         | Use                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Surface                      | `.card`                                                                                                           |
| Buttons                      | `.btn`, `.btn.primary`, `.btn.ghost`, `.btn.danger`, `.btn.icon`, size `.sm`; `.chip` for small toggles           |
| Labels                       | `.tag` with `.outline`, `.success`, `.warning`, `.danger`, `.accent`, `.plain`                                    |
| Section labels               | `.eyebrow`                                                                                                        |
| Status                       | `.orb` (agent presence; `.working`, `.amber`, `.idle`), `.spinner`                                                |
| Lists                        | `.list` of `.record` rows; `.row-list` of `.row-item` rows                                                        |
| Forms                        | `label` wraps its control; `.form` stacks fields; `.form-row` lays them out side by side                          |
| Filters                      | `.segmented` group, `.search` input                                                                               |
| Empty, loading, error states | `EmptyState` from `shell.tsx`                                                                                     |
| Icons                        | `Icon` from `icons.tsx` (line icons, 24px grid, `currentColor`, 16px default)                                     |
| Workflow canvas              | `WorkflowGraph` from `workflow-graph.tsx`: pan by drag or scroll, zoom with ⌘ scroll or the controls, fit to view |

## Restyling new screens

When a new component arrives with its own colors (for example a React Flow node), map them to tokens instead of keeping the literals: white → `--card`, light gray fills → `--bg-accent` or `--bg-hover`, borders → `--border` / `--border-strong`, secondary text → `--muted`, highlights → `--accent-subtle` / `--accent-hover`, corners → `--radius-md` or `--radius-lg`, elevation → `--shadow-sm` / `--shadow-md`.
