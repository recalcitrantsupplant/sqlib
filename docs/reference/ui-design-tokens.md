# UI design tokens and the stylelint rules that enforce them

Every colour, size, radius and font size in the web package comes from a custom
property defined in `packages/web/src/assets/css/tokens.css`. That file is the
only stylesheet in the package allowed to hold literal values; stylelint rejects
hex colours, raw font sizes, raw radii and raw padding or margin lengths
everywhere else under `packages/web/src`.

Read `tokens.css` for the authoritative list. This page covers the groups, the
naming scheme, the density setting, each lint rule and its fix, and what the
design-system test enforces.

## Three layers

| Layer | Example | Use |
| --- | --- | --- |
| Primitive | `--gray-500`, `--blue-500` | Raw ramp values. Do not consume from a component. |
| Semantic | `--ink-muted`, `--surface-subtle` | Named by role. This is what components use. |
| Component | `--control-h`, `--focus-ring-width` | Only where a component needs its own knob. |

Dark mode is the `.dark` block at the end of `tokens.css`. It redefines only the
semantic layer — primitives stay fixed — so a component that consumes semantics
gets the dark theme with no rule of its own. `src/composables/useTheme.ts`
toggles `.dark` on `<html>` from the `theme` setting (`system`, `light`,
`dark`; default `system`), and `nuxt.config.ts` inlines a head script that
applies the same class before first paint to avoid a flash.

## Token groups

| Group | Tokens | For |
| --- | --- | --- |
| Primitives | `--gray-0…950`, `--blue-*`, `--green-*`, `--red-*`, `--amber-*`, `--violet-*`, `--cyan-*`, `--orange-500` | The ramps the semantic layer is built from |
| Surfaces | `--surface`, `--surface-subtle`, `--surface-sunken`, `--surface-raised`, `--surface-overlay` | Page, chrome, wells, chips, scrims |
| Ink | `--ink`, `--ink-secondary`, `--ink-muted`, `--ink-disabled`, `--ink-inverse` | Text |
| Borders | `--border-subtle`, `--border-default`, `--border-strong`, `--border-hover` | Rules and outlines |
| Intents | `--action-*`, `--success-*`, `--danger-*`, `--warning-*`, `--info-*` | Interactive and status colour |
| Focus | `--focus-ring`, `--focus-ring-width` (2px) | `outline` on `:focus-visible` |
| Domain | `--rdf-*`, `--syntax-*`, `--code-*`, `--graph-*`, `--kind-*`, `--state-*` | RDF terms, editors, canvas, result kinds, execution state |
| Categorical | `--stratum-1…8` + `--stratum-none`, `--series-1…6` + `--series-unknown`, `--tag-1…8` + `--tag-none` | Palettes assigned by index, not by meaning |
| Family | `--family-definition`, `--family-input`, `--family-evidence`, each with a `-surface` | What a rail section holds — what the library defines, takes in, or is judged by. Named after what they mark, unlike the categorical palettes above |
| Named chrome | `--segment-selected(-ink)`, `--tooltip-surface`/`--tooltip-ink`, `--draft-surface`, `--brand-mark(-ink)`, `--brand-1…3` | Intents that would otherwise be spelled `var(--ink)` and read as a bug |
| Density | `--grid-unit`, `--grid-gap`, `--grid-1…8`, `--control-h-sm`/`--control-h`/`--control-h-lg`, `--space-1…9` | Control heights, aligned widths, spacing |
| Radius | `--radius-sm`, `--radius`, `--radius-panel`, `--radius-lg`, `--radius-xl`, `--radius-full` | Corners |
| Type | `--text-micro…--text-hero-lg`, `--text-code`, `--text-hero-fluid`, `--weight-*`, `--leading-*`, `--font-sans`, `--font-mono` | Font size, weight, line height, family |
| Elevation | `--shadow-sm/md/lg`, `--z-panel/sticky/dropdown/dialog/toast` | Shadows and stacking order |
| Motion | `--duration-fast` (0.12s), `--duration` (0.2s) | Transitions |

Each intent family follows the same scheme, though not every family defines
every member: a base (`--danger`), `-hover`, sometimes `-active`, `-fg` for text
on the filled colour, and the quiet triple `-surface` / `-border` / `-ink` for a
tinted pill or banner. `--info` defines only base, surface, border and ink.

`--state-valid`, `--state-invalid`, `--state-stale`, `--state-running` and
`--state-idle` alias the intents under the application's own words; `StatusBadge`
maps its `status` prop onto them.

## Sizing: the 28/6 grid

| Token | Value | Use |
| --- | --- | --- |
| `--grid-unit` | 28px | Base control height |
| `--grid-gap` | 6px | Gap between adjacent controls |
| `--grid-1…8` | 28, 62, 96, 130, 164, 198, 232, 266px | Aligned widths: `(28 × N) + (6 × (N-1))` |
| `--control-h-sm` | 22px | Inline and in-table controls |
| `--control-h` | 28px | Default for every interactive control |
| `--control-h-lg` | 34px | Primary page actions only |

Apply a `--grid-N` step as `min-width`, never `width`. The step is an alignment
floor, not a cap: a hard width squashes a button's icon when the label needs
more room than the step allows. `src/assets/css/compact-buttons.css` provides
`.w-grid-1…8` and `.min-w-grid-1…8`; prefer the `min-w-` half.

The Tailwind theme in `src/assets/css/tailwind.css` re-exports part of the set
as utilities, so templates can use the same system as stylesheets:
`bg-surface-subtle`, `text-ink-muted`, `border-border-default`, `text-body`,
`h-control`, `h-control-sm`, `h-control-lg`. `components/ui/button/index.ts`
uses those height utilities, which is why `<Button>` and `.btn-compact` are the
same object at every size.

## Spacing

| Token | Value | Token | Value |
| --- | --- | --- | --- |
| `--space-1` | 2px | `--space-6` | 16px |
| `--space-2` | 4px | `--space-7` | 24px |
| `--space-3` | 6px | `--space-8` | 32px |
| `--space-4` | 8px | `--space-9` | 48px |
| `--space-5` | 12px | | |

The intended defaults are `--space-5` for outer panel padding, `--space-4` for
inner element gaps and `--space-3` for tight control groups (equal to the grid
gap). `--space-9` is the generous step for empty states and hero blocks.

## Type

| Token | Value | Use |
| --- | --- | --- |
| `--text-micro` | 10px | Badges, counts |
| `--text-label` | 11px | Uppercase section labels |
| `--text-body` | 12px | Default: controls, tables |
| `--text-body-lg` | 13px | Emphasis within dense chrome |
| `--text-code` | 13px | CodeMirror editors |
| `--text-content` | 14px | Dialog and prose body |
| `--text-title` | 16px | Panel and page titles |
| `--text-heading` | 18px | Section headings |
| `--text-display` / `--text-display-lg` | 24 / 32px | Empty states |
| `--text-hero` / `--text-hero-lg` | 48 / 64px | Splash and example pages |
| `--text-hero-fluid` | `clamp(1.75rem, 4vw, 2.5rem)` | Responsive page hero |

Weights are `--weight-normal` (400), `--weight-medium` (500) and
`--weight-semibold` (600); line heights are `--leading-tight` (1.25) and
`--leading-normal` (1.5).

## Radius

`--radius-sm` 3px (chips, inline code, tags), `--radius` 4px (buttons, inputs),
`--radius-panel` 6px (cards and grouped containers), `--radius-lg` 8px (dialogs,
popovers), `--radius-xl` 12px (large modals), `--radius-full` 9999px (pills,
avatars).

## Density

Density is a user setting for how much each row in an entity list carries, not a
global scale factor: control heights and the spacing scale do not change with
it. `EntityListDensity` is `'compact' | 'comfortable'`, it lives in
`src/composables/useSettings.ts` as `entityListDensity`, it defaults to
`compact`, and it persists to `localStorage` under the key
`sparql-query-lib-settings`.

`components/shared/DensityToggle.vue` is the two-button control that sets it. It
takes `modelValue` and emits `update:modelValue`; it stores nothing itself.

To respect the setting, a list component does three things:

1. Read the value: `const { settings, setEntityListDensity } = useSettings()`,
   then `const density = computed(() => settings.value.entityListDensity)`.
2. Render `<DensityToggle :model-value="density" @update:model-value="setEntityListDensity" />`
   in its header, so the control is where the rows are.
3. Draw the second line only in `comfortable` — `v-if="density === 'comfortable'"`
   on the description element — and put the extra row height behind a
   `density-comfortable` class rather than in the base rule.

`EntityListSidebar.vue` and `library-notebook/NotebookContents.vue` are the two
implementations to copy from. Comfortable buys the description line and nothing
else: the row goes from a fixed 26px to `min-height: 33px`.

## Stylelint rules

Configuration: `packages/web/.stylelintrc.json`. It runs over
`src/**/*.{vue,css}` with `postcss-html` for `.vue` files and ignores
`tokens.css` itself, `dist/`, `.output/`, `.nuxt/`, `node_modules/`, `coverage/`,
`playwright-report/` and `test-results/`.

Run it with `pnpm --filter @sparql-query-lib/web lint` (also `lint:css`, and
`lint:css:fix` for the autofixable subset).

| Rule | Rejects | Write instead |
| --- | --- | --- |
| `color-no-hex` | Any hex literal, in any property | A colour token: `var(--ink-muted)`, `var(--danger-surface)`. If no token fits the role, add one to `tokens.css` rather than inlining the hex. |
| `color-named` | Colour keywords such as `white`, `black`, `red` | The token for the role. `color: white` is not a hex, and is equally broken in dark mode; `var(--ink-inverse)` or `var(--action-fg)` is usually what was meant. |
| `declaration-property-unit-allowed-list` | Any unit on `font-size` except `vw` | A `--text-*` token. `vw` is permitted so a `clamp()` display size can be expressed; the responsive hero already exists as `--text-hero-fluid`. |
| `declaration-property-value-disallowed-list` | A `border-radius` value beginning with an integer length in `px`, `rem` or `em` | A `--radius*` token. `0`, `50%` and `100%` are allowed. |
| `declaration-property-unit-disallowed-list` | `px` or `rem` on any `padding-*` or `margin-*` | A `--space-*` token. `0` is allowed, and so is any length relative to something other than the scale: `vh`, `vw`, `em`, `%`, or `calc()` over another token. A fixed offset that aligns with chrome rather than the scale belongs in a named custom property, not inline. |

Two limits worth knowing. The rules match literal syntax, so `rgba(…)` colours
and a fractional radius such as `0.5rem` are not caught by the pattern above
even though they break the same way; treat them as the same defect. And the
lint says nothing about *which* token you picked — a semantically wrong token
passes.

## What the test enforces

`packages/web/test/components/designSystem.test.ts` is a Vitest suite that
checks the parts of the system a linter cannot see. Run it with:

```sh
pnpm --filter @sparql-query-lib/web test designSystem
```

It asserts, among other things:

- **Token layer.** `tokens.css` defines the semantic tokens components rely on
  (`--surface*`, `--ink*`, `--border-*`, the five intents, `--control-h`,
  `--grid-unit`, `--grid-gap`, `--radius`, `--text-body`); the `.dark` block
  redefines the semantic layer and overrides no `--gray-*` primitive; and every
  `--grid-N` still equals `(28 × N) + (6 × (N-1))`.
- **Primitive adoption.** No component but `SectionLabel` writes a rule for
  `.section-label`, and the same for `EmptyState`, `InlineNote`, `StatusBadge`
  and `PanelHeader`. A hand-drawn copy of a shared primitive fails the suite.
- **Residue lists.** Hand-written uppercase labels, empty states, muted notes
  and state pills must either use the primitive or appear in a named exception
  list inside the test with a reason. Adding a new hand-written one fails.
- **The disabled ink.** No rule may paint text with `--ink-disabled` outside a
  disabled state; the nine remaining sites (idle icon buttons, decorative
  glyphs) are listed with their justification.
- **Canvas archetype.** Only `CanvasSurface` imports the Vue Flow stylesheets or
  themes Vue Flow's controls; every component that draws a flow is an instance
  of `CanvasShell` or `CanvasSurface`.
- **Scoped CSS.** No component keeps a scoped rule that nothing it renders can
  match.
- **Stratum palette.** `useStratumPalette` returns `var(--stratum-N)`
  references rather than literals, and wraps around the eight values.

If a change trips one of these, the fix is normally to use the primitive rather
than to extend the exception list; the lists exist to record what has been
examined and deliberately left alone.
