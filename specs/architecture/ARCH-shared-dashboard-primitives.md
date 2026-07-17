# Architecture: Shared Dashboard Primitives (#P4-1 / issue #33)

> **Date:** 2026-07-17
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Plan task #P4-1 (`specs/claude-lens-plan.md`) + issue #33 acceptance criteria + `specs/claude-lens-architecture.md` §2/§3/§11 + `specs/claude-lens-pages.md` §0 legend & global layer + mockup shared elements (`specs/pages/_chrome.css`, `dashboard.html`, `sessions.html`, `models.html`, `cache-lab.html`). No REQ doc — plan-task mode; the settled specs are the requirements. R-IDs below transcribe them for traceability.
> **Type:** feature (brownfield foundation components)

## Architecture Summary

Six hand-built, presentational React components land in a new `client/src/components/` directory (already named in architecture §3): `StatCard` (with delta, inline-SVG sparkline, and a `StatRow` grid wrapper), `DataTable` (TanStack Table headless, opt-in virtualization), `Badge` + `TierBadge`, `LockedCard`, `EmptyState`, and `Chip`. They are pure props-in/JSX-out — no data fetching, no query keys, no URL state — because pages own queries (that is what keeps Phase 4 pages "cheap" per §8/§11). Styling is Tailwind utility classes with the repo's established dark-token convention (exact `_chrome.css` hex values behind `dark:`, slate-* for light). Each component ships with a Storybook story file covering the acceptance-named states; the stories are the component-state coverage of record (no unit tests — developer decision). The only removal is `client/src/example/` (ExampleStat), whose own banner declares it replaced by this task.

## Requirements (plan-task mode — transcribed from settled specs)

| ID  | Requirement                                                                 | Source                                                        |
|-----|-----------------------------------------------------------------------------|---------------------------------------------------------------|
| R1  | Six primitives: stat-card, data-table, tier-badge, locked-card, empty-state, chip, in `components/` | plan #P4-1 scope; architecture §3 tree (`client/src/components/`) |
| R2  | Stat-card carries period-over-period delta (▲▼) and an inline sparkline     | plan #P4-1; pages §0 "deltas on every stat", "sparkline inside every stat card" |
| R3  | Data-table is TanStack Table headless, virtualized where rows can reach thousands | architecture §11 "Tables"; §2 pins `@tanstack/react-table` + `@tanstack/react-virtual` |
| R4  | Tier awareness: 🟢/🟡/🔴 states from tier flags; locked-card shows "Set up cost capture" CTA for 🔴 | architecture §11 "Tier awareness"; pages §0 tier legend        |
| R5  | Tailwind, no component library, hand-built                                  | plan #P4-1; architecture §2 (`tailwindcss`, `clsx`, "No component library") |
| R6  | Stories cover the named states: stat-card delta up/down/flat + sparkline; tier-badge 🟢/🟡/🔴; locked-card CTA; empty-state; chip active/inactive/removable; table loading/virtualized rows | issue #33 acceptance criteria                                  |
| R7  | Empty/partial-range state: "no data for filter" with reset action           | pages §0 global layer row                                      |
| R8  | Visual check against the mockups' shared elements (`.stat`, `.delta`, `.badge`, `.mchip`, `.locked`/`.veil`, `.statrow`) | issue #33 acceptance; plan Phase 4 preamble (mockups are the visual reference) |
| R9  | Built stories-first in Storybook                                            | plan #P4-1 scope                                               |

## High-Level Structure

```
client/src/
├── components/            ← NEW (this task) — presentational primitives only
│   ├── StatCard.tsx       (exports StatCard, StatRow; private Sparkline SVG)
│   ├── DataTable.tsx      (generic <T>; TanStack Table + optional react-virtual)
│   ├── Badge.tsx          (exports Badge; visual variants from mockup .badge)
│   ├── TierBadge.tsx      (exports TierBadge, costTierLevel(TierFlags) helper)
│   ├── LockedCard.tsx     (panel + veil + CTA link)
│   ├── EmptyState.tsx     (message + optional reset action)
│   ├── Chip.tsx           (mono pill; active/removable)
│   └── *.stories.tsx      (one per component, titled "Components/<Name>")
├── charts/                ← untouched (Chart/ChartCard; #P4-19 extends this next)
├── filters/               ← untouched (FilterBar keeps its own ChipDropdown)
├── example/               ← DELETED (ExampleStat superseded by StatCard)
└── pages/                 ← untouched stubs; compose primitives in #34–#49
```

Data flow: pages fetch via TanStack Query (existing `api/` + `qk` factory) and pass plain props down. Primitives never import the data layer. Drill navigation stays page-owned: `DataTable`/`StatCard` expose click callbacks; the page decides the destination (same division as `ChartCard.handlePointClick`).

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|---|---|---|---|
| Table engine | `@tanstack/react-table` v8 (headless) | hand-rolled `<table>` logic | Spec-mandated (§11, §2 pins it); headless keeps the mockup's exact markup/classes |
| Virtualization | `@tanstack/react-virtual`, opt-in via prop | react-window; always-on | §2 pins it; §11 says "where rows can reach thousands" — a per-page judgment, so explicit opt-in (A5) |
| Sparkline | Hand-rolled inline SVG `<polyline>` (~20 lines, private to StatCard) | Reusing the ECharts `Chart` wrapper | Mockup renders literal `<svg><polyline>` (R8); zero canvas/ResizeObserver per card (5+ per row); the SVG stays `aria-hidden`, while either the adjacent `delta` or the required `sparklineLabel` supplies the equivalent trend text; keeps stat cards out of #P4-19's chart-boundary rework. **Recorded as agent suggestion, developer-delegated (A2)** |
| Styling | Tailwind utilities + `clsx`, dark tokens as `dark:[#hex]` | CSS modules; extracting a theme file | Existing convention (ChartCard/ExampleStat/toggleStyles); no component library (R5) |
| New dependencies | **None** | — | Everything needed is already pinned in §2 / package.json |

## Patterns & Conventions

- **Presentational purity** — primitives take data via props; `@tanstack/react-query`, `api/`, `filters/` imports are forbidden inside `components/` (A1, A8); affects every primitive.
- **Existing component idiom** — exported `<Name>Props` types, function components, PascalCase filenames matching the default export (`ChartCard.tsx` precedent). Discriminated unions use `type` aliases when accessibility or runtime invariants must be enforced at compile time.
- **Dark/light token mapping** — dark theme uses `_chrome.css` hex values (`#151A21` panel, `#232B36` line, `#E8EDF2` text, `#5A6675` decorative muted, `#8A96A5` accessible muted text, `#E8A33D` money, `#4FC3D9` cache); light theme maps to AA-compliant slate/semantic shades. Mockups are dark-only, so light variants follow the established mapping while all text maintains at least 4.5:1 contrast.
- **Story idiom** — `Meta`/`StoryObj` from `@storybook/react-vite`, title `Components/<Name>`, one named export per acceptance state. Primitives are presentational, so no fetch-stub/provider decorators needed (unlike `ChartCard.stories.tsx`); `LockedCard` needs the wouter memory-router decorator for its `Link` (same pattern as `FilterBar.stories.tsx`).
- **A11y baseline** — delta arrows get `sr-only` direction text; a sparkline without an adjacent delta requires `sparklineLabel`; sortable headers are `<button>`s with `aria-sort` on the `<th>`; row actions use a separately named `<button>` without replacing `<tr>` semantics; virtualized tables expose logical row metadata plus a focusable control that renders every row; Chip's remove button gets `aria-label="Remove <label>"`; loading/status text uses `role="status"` without replacing native table roles. Full chart a11y is #P4-19's scope, not this task's.

## Data Models

No persistence entities — the "models" are the exported prop/type contracts other Phase 4 issues compile against.

### StatDelta

**Purpose:** period-over-period delta with direction decoupled from sentiment (mockup evidence: `.delta.up` is red, `.delta.upgood` is green — spend-up is bad, cache-hit-up is good).

| Field | Type / Constraint | Notes |
|---|---|---|
| `text` | `string`, required | Pre-formatted, e.g. `"189%"` — formatting stays caller-side |
| `direction` | `"up" \| "down" \| "flat"`, required | Picks the glyph ▲ / ▼ / — |
| `sentiment` | `"good" \| "bad" \| "neutral"`, required | Picks the color (green / red / muted), independent of direction |

### TierLevel

**Purpose:** presentational tier state for `TierBadge` (R4).

| Field | Type / Constraint | Notes |
|---|---|---|
| `level` | `"exact" \| "estimated" \| "locked"` | 🟢 / 🟡 / 🔴 respectively |

**Relationships:** `costTierLevel(flags: TierFlags): "exact" | "estimated"` maps the shared contract (`shared/types.ts`): `costBasis === "observed"` → `exact`, else `estimated`. `locked` is never derivable from `TierFlags` — it's a page-side statement that a premium-only section has no data source (pages legend 🔴).

**Lifecycle:** N/A (stateless render input).

### Badge variant

`"neutral" | "pass" | "warn" | "fail" | "computed" | "premium"` — the mockup's `.badge` class set verbatim (`_chrome.css:37–42`). `TierBadge` maps `exact`→`premium` (cyan), `estimated`→`computed` (orange), `locked`→`fail` (red), prefixing the 🟢/🟡/🔴 dot.

## API Contracts / Interfaces

**Boundary:** internal module — `client/src/components/` public exports. **Auth requirements:** N/A (local SPA).

| Component | Signature (props) | Purpose / behavior | Edge returns |
|---|---|---|---|
| `StatCard` | `{ label: string; value: string; accent?: "money" \| "cache"; sub?: string } & ({ delta?: StatDelta; sparkline?: undefined; sparklineLabel?: never } \| { delta: StatDelta; sparkline: number[]; sparklineLabel?: never } \| { delta?: undefined; sparkline: number[]; sparklineLabel: string })` | Mockup `.stat`: uppercase label, mono value (accent-colored), delta glyph+text, 22px-high full-width sparkline, optional `.sub` caption; a sparkline without a delta requires equivalent trend text at the type level | `sparkline` absent, empty, or length 1 → no SVG rendered; non-finite values dropped before scaling |
| `StatRow` | `{ children: ReactNode; columns?: number }` (default 4) | Mockup `.statrow`: grid with 1px line-colored gaps; remains one column through 980px and expands at 981px | — |
| `DataTable<T>` | `{ data: T[]; columns: ColumnDef<T, any>[]; isLoading?: boolean; empty?: ReactNode; initialSorting?: SortingState; getRowId?: (row: T) => string; label?: string } & ({ onRowClick?: undefined; getRowActionLabel?: never } \| { onRowClick: (row: T) => void; getRowActionLabel: (row: T) => string }) & ({ virtualized: true; height: number } \| { virtualized?: false; height?: never })` | Headless TanStack table rendered as mockup-style `<table>`; client-side sorting toggled from header buttons; column `meta: { align?: "right"; mono?: boolean }` drives `.r`/`.num` styling; `label` sets the `<table>`'s `aria-label` for screen-reader table navigation | `isLoading` → skeleton rows (fixed count) with an `sr-only` `role="status"`; `data.length === 0` → renders `empty` (defaults to `<EmptyState message="No data" />`); `columns` uses the heterogeneous TanStack `ColumnDef<T, any>[]` contract; `virtualized: true` requires `height`. Row accessibility: each `<tr>` keeps native row semantics; setting `onRowClick` also requires `getRowActionLabel`, and the first cell receives a separate named action button alongside—never around—consumer content. Mouse row delegation ignores interactive descendants. Virtualized tables carry `aria-rowcount`/`aria-rowindex`, mark padding `<tr>` elements `aria-hidden`, and provide a focusable “Show all rows” control so keyboard and assistive-technology users can mount every logical row. |
| `Badge` | `{ variant?: BadgeVariant; children: ReactNode }` (default `"neutral"`) | Mono 10px bordered pill per `.badge` variants | — |
| `TierBadge` | `{ level: "exact" \| "estimated" \| "locked"; children?: ReactNode }` + exported `costTierLevel(flags: TierFlags)` | 🟢/🟡/🔴 dot + optional label (e.g. "$ computed") in Badge chrome | — |
| `LockedCard` | `{ title: string; message: string; ctaLabel?: string; ctaHref?: string; children?: ReactNode }` (defaults: `"Set up cost capture →"`, `"/settings"`) | Mockup `.locked` panel: visible title, blurred veil overlay with message + wouter `Link` CTA; optional ghost children behind the veil | Veil light-theme variant defined here (dark rgba is mockup-only) |
| `EmptyState` | `{ message: string; action?: { label: string; onClick: () => void } }` | Centered muted message + optional action button (R7's "reset filters" slot) | — |
| `Chip` | `{ label: string; active?: boolean; onClick?: () => void; onRemove?: () => void }` | Mono pill per `.mchip`; `active` uses the `toggleStyles` active treatment; `onRemove` appends an × button | Renders as `<button>` when `onClick` set, `<span>` otherwise; remove button is its own sibling `<button>` (never nested) |

## Module Boundaries

| Module / Package | Responsibility | Allowed Dependencies |
|---|---|---|
| `client/src/components/` | The six primitives + their stories; visual DNA of the dashboard | `react`, `clsx`, `@tanstack/react-table`, `@tanstack/react-virtual`, `wouter` (Link, LockedCard only), `shared/types.js` (types only), `../ui/toggleStyles.js` |
| — forbidden inside `components/` | — | `@tanstack/react-query`, `client/src/api/`, `client/src/filters/`, `client/src/charts/`, `client/src/pages/`, `echarts` |
| `client/src/pages/`, `client/src/charts/` | May import `components/` (pages compose in #34–#49; charts may reuse Badge/EmptyState later) | unchanged |
| `client/src/filters/` | FilterBar keeps its own `ChipDropdown` — no refactor here (A10) | unchanged |

## Change Footprint

_The concrete answer to "where does this land in the codebase?"_

### New files / modules

| Path | Purpose | Pattern reference |
|---|---|---|
| `client/src/components/StatCard.tsx` | StatCard + StatRow + private Sparkline SVG | `ExampleStat.tsx` (visual), `dashboard.html:37–47` (markup) |
| `client/src/components/StatCard.stories.tsx` | delta up/down/flat, sentiment split, sparkline, accents, sub, StatRow grid | `ChartCard.stories.tsx` |
| `client/src/components/DataTable.tsx` | generic headless table + sorting + loading + empty + virtualization | `sessions.html:52–60` (markup); TanStack docs idiom |
| `client/src/components/DataTable.stories.tsx` | plain, sorted, loading, empty, virtualized (1k rows), row-click | — |
| `client/src/components/Badge.tsx` | visual badge, six variants | `_chrome.css:37–42` |
| `client/src/components/Badge.stories.tsx` | all variants | — |
| `client/src/components/TierBadge.tsx` | tier semantics over Badge + `costTierLevel` | `shared/types.ts` TierFlags |
| `client/src/components/TierBadge.stories.tsx` | 🟢/🟡/🔴 states | — |
| `client/src/components/LockedCard.tsx` | locked panel + veil + CTA | `models.html:93–96`, `_chrome.css:57–60` |
| `client/src/components/LockedCard.stories.tsx` | CTA default, custom message, ghost children | `FilterBar.stories.tsx` (router decorator) |
| `client/src/components/EmptyState.tsx` | empty/partial-range message + action | pages §0 row |
| `client/src/components/EmptyState.stories.tsx` | message-only, with action | — |
| `client/src/components/Chip.tsx` | mono pill, active/removable | `_chrome.css:49` `.mchip`, `toggleStyles.ts` |
| `client/src/components/Chip.stories.tsx` | active, inactive, removable, clickable | — |

### Modified files / modules

| Path | What changes here |
|---|---|
| _none_ | No existing file is edited — the task is purely additive plus one directory deletion |

### Deleted / replaced

| Path | Reason |
|---|---|
| `client/src/example/ExampleStat.tsx` | Its own banner: "Replaced by the real stat-card primitive (#P4-1)"; grep confirms only its story imports it |
| `client/src/example/ExampleStat.stories.tsx` | Story of the deleted component |

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|---|---|
| `client/.storybook/main.ts` | Glob `../src/**/*.stories.@(ts|tsx)` auto-discovers the new stories and silently loses the ExampleStat one — expected, but confirms Storybook boots with zero config edits |
| `client/src/ui/toggleStyles.ts` | Chip's active state reuses these constants; changing their look later restyles chips too |
| `client/src/charts/Chart.tsx` / `ChartCard.tsx` | Deliberately untouched; #P4-19 rebuilds this boundary right after — sparkline decision (A2) keeps StatCard out of that blast radius |
| `client/src/filters/FilterBar.tsx` | Keeps its private chip look; possible future alignment onto `Chip` is out of scope (A10) |
| `client/src/pages/*.tsx` stubs | Compose these primitives in #34–#49; nothing imports `components/` until then |
| `specs/pages/_chrome.css` | Read-only token source for the hex values — never imported |

## Areas of Impact

| Area | Impact | Risk (L/M/H) | Why |
|---|---|---|---|
| Page tasks #34–#49 | All compose these contracts; prop-shape churn after merge multiplies across lanes | **M** | Mitigated by mockup-derived contracts + this doc as the reference; additive-only evolution after merge |
| #P4-19 / #84 (accessible charts) | Next spine task builds on `charts/` — untouched here; SVG sparkline keeps StatCard outside chart-boundary scope | L | Zero shared files between the two diffs |
| #P4-12 (gates UI) | `Badge` pass/warn/fail variants ready to import instead of re-deriving | L | Additive convenience (user decision A3) |
| #P4-13 (premium tier) | `TierBadge`/`LockedCard` are the upgrade-path visuals | L | Presentational; tier data plumbing stays #P4-13's |
| Client bundle | First real imports of `@tanstack/react-table` (+`react-virtual`) enter the bundle (~17 KB gz combined) | L | Already pinned deps; size is budgeted by §2's choice |
| Storybook workbench | Six new story groups under `Components/` | L | Glob-discovered; build not in CI gate by design (#P1-3) |

**Contract changes:** none external — no HTTP/WS/shared-types changes. New internal component API surface is additive.

**Cross-cutting ripples:** none into auth/telemetry/migrations/build. `npm run verify` (typecheck/lint/format/test) is the only gate touched, and only by new files.

## Cross-Cutting Concerns

- **Errors:** primitives never fetch, so no error propagation; they must be total over their inputs — empty arrays, non-finite sparkline values, and zero-row tables render defined fallbacks instead of throwing. Query errors remain page/ChartCard concerns.
- **Logging & metrics:** none — presentational.
- **Auth / authz:** N/A (local single-user SPA).
- **Performance:** virtualization opt-in for thousand-row tables (fixed row-height estimate); sparkline is O(points) SVG with no observers; TanStack row model memoization is internal; no `React.memo` needed until a page proves otherwise.
- **Security:** all text through React escaping; no `dangerouslySetInnerHTML`; `ctaHref` defaults to an internal route and is rendered via wouter `Link`.
- **Migrations / rollout:** single additive PR on `feat/33/shared-dashboard-primitives` closing #33; no server/data changes; revert is a clean directory delete plus ExampleStat restore.

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies REQs |
|---|---|---|---|---|
| A1 | Primitives are presentational-only; pages own queries and navigation | Smart components with embedded `useQuery` | §11's "pages are cheap" model; keeps primitives testable in Storybook without fetch stubs | R1, R5, R9 |
| A2 | Sparkline is a private inline-SVG polyline inside StatCard — **agent suggestion, developer-delegated ("suggest me")** | ECharts `Chart` instance per card | Mockup-literal markup (R8); no per-card canvas/observer; keeps StatCard out of #P4-19's chart-boundary rework; one-file swap if vetoed | R2, R8 |
| A3 | Generic `Badge` (all five mockup variants) + `TierBadge` semantic wrapper — **developer decision** | TierBadge only (strict scope) | Variants are one class map; #P4-12/#P4-13 import instead of re-deriving the visual | R4, R6 |
| A4 | Stories only; no unit tests — **developer decision** | Stories + vitest for DataTable sort/virtualization and tier mapping | Acceptance mandates exactly stories; page tasks and #P4-18 E2E cover behavior downstream | R6, R9 |
| A5 | `DataTable` virtualization is an explicit `virtualized` prop (+ required `height`) | Auto-enable over a row-count threshold | §11's "where rows can reach thousands" is per-page knowledge; explicit beats magic at a foundation layer | R3 |
| A6 | Delta API separates `direction` from `sentiment` | Single signed value with inferred color | Mockup evidence: `.delta.up` red vs `.delta.upgood` green — cost dashboards invert "up is good" per metric | R2, R8 |
| A7 | Delete `client/src/example/` in this task | Leave until a later cleanup | Its banner names #P4-1 as the replacement; only self-imports exist | R1 |
| A8 | `components/` may not import query/api/filters/charts/pages | Unrestricted imports | Enforces A1 at the module boundary; mirrors §3's route-handlers-import-only-store rule on the client | R1, R5 |
| A9 | `TierBadge` takes a presentational `level`; `costTierLevel(TierFlags)` helper maps the shared contract; `locked` is page-declared | TierBadge consumes raw `TierFlags` | `TierFlags` can't express "this section is premium-only" (🔴) — that's page knowledge; helper still kills mapping duplication | R4 |
| A10 | `Chip` is new and standalone; FilterBar's `ChipDropdown` untouched | Refactor FilterBar onto Chip now | Scope containment — FilterBar is #P3-3's shipped surface; alignment is a later cleanup if ever | R1 |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|---|---|
| Sessions page mounts DataTable with 10K rows | `virtualized` + `height` renders only visible rows via `useVirtualizer`; TanStack client-side sort on 10K rows is in-memory and sub-frame; without `virtualized` the page made the wrong call — contract documents the expectation |
| Metrics gap: delta undefined, sparkline `[]` or `[x]`, all-zero series | `delta` omitted → no glyph; sparkline needs ≥2 finite points else renders nothing; flat series scales to a flat line — no NaN ever printed |
| Long project/model names in StatCard label or Chip | `truncate` + `title` attribute on the text nodes; StatRow grid cells clip instead of overflowing |
| Dark/light theme contrast on the locked veil | Mockup's `rgba(14,17,22,.72)` veil is dark-only; light theme gets an explicit `bg-white/75` equivalent — both defined in LockedCard, checked in its story under the theme toggle |
| Storybook boots with a story importing a deleted module | ExampleStat and its story are deleted in the same commit; glob discovery means no dangling registration |

### Backward — regression risk per touched area

| Touched area | What could regress | How we'd know / mitigation |
|---|---|---|
| `client/src/example/` deletion | A hidden importer breaks the client build | grep shows only self-imports; `tsc --noEmit` + vite build in `verify`/CI fail loudly if wrong |
| `.storybook` discovery | Storybook fails to boot on the new tree | `npm run storybook` manual check is part of the stories-first workflow (R9); build smoke is non-blocking by design |
| `toggleStyles.ts` reuse in Chip | None today — new consumer only | Future restyles now affect chips; noted in footprint |
| Everything else | Nothing — zero modified files | `npm run verify` green pre-push (hook-enforced) |

## Open Questions

- Virtualized row-height strategy: fixed `estimateSize` (36px, from mockup row density) vs measured rows.
  - **Impact if unresolved:** slight scrollbar jitter on variable-height rows.
  - **Suggested default:** fixed estimate now; revisit at #P4-4 (Sessions) with real rows.
- `StatRow` responsive collapse: mockup collapses to one column below 980px.
  - **Impact if unresolved:** cramped mobile layout only.
  - **Suggested default:** `grid-cols-1 md:grid-cols-{columns}`.
- A2 (SVG sparkline) is recorded as an agent suggestion the developer delegated — veto swaps one private component with no contract change.

## Out of Scope

- Cypress smoke spec (not a page task — standing rule 1 scopes those to the 11 page issues; #P4-18 covers cross-page flows).
- Chart/ChartCard accessibility boundary (#P4-19 / #84 — next spine task).
- Page composition of any primitive (#34–#49), gate feeds/Report Card composites (#P4-12), premium tier plumbing (#P4-13), tags/saved-views managers (#P4-15), search mount (#P4-3).
- FilterBar `ChipDropdown` refactor onto `Chip` (A10).
- Unit tests for primitives (developer decision A4).

---

# Tasks

## Task T1: Badge + TierBadge

> **Status:** done
> **Verification:** ui
> **Effort:** s
> **Priority:** high
> **Depends on:** None
> **Satisfies REQs:** R4, R5, R6, R8, R9
> **Footprint slice:** New: `client/src/components/Badge.tsx`, `Badge.stories.tsx`, `TierBadge.tsx`, `TierBadge.stories.tsx`
> **High-risk areas touched:** None (all L risk in Areas of Impact)

### Description

The mono bordered-pill visual primitive (`Badge`, six variants from `_chrome.css:37–42`) and its tier-semantic wrapper (`TierBadge`, mapping `TierFlags`/a page-declared `locked` state to 🟢/🟡/🔴). `TierBadge` is the visual vocabulary #P4-12 (gates) and #P4-13 (premium tier) import instead of re-deriving.

### Verification Checklist

- **Badge renders all six variants** — `neutral`, `pass`, `warn`, `fail`, `computed`, `premium` each render with the border/text color mapped from `_chrome.css` `.badge.*` classes — expected: visual match in the story canvas, both dark and light theme (toggle in Storybook toolbar) _(verifies R5, R8)_
- **TierBadge exact** — `level="exact"` renders a 🟢 dot + `premium` (cyan) badge chrome — expected: dot + cyan border/text visible _(verifies R4, R6)_
- **TierBadge estimated** — `level="estimated"` renders a 🟡 dot + `computed` (orange) badge chrome — expected: dot + orange border/text visible _(verifies R4, R6)_
- **TierBadge locked** — `level="locked"` renders a 🔴 dot + `fail` (red) badge chrome — expected: dot + red border/text visible _(verifies R4, R6)_
- **TierBadge optional label** — `children` renders inline after the dot (e.g. "$ computed") — expected: label text visible next to dot in at least one story
- **costTierLevel mapping** — a story (or inline story-level assertion) exercises `costTierLevel({ costBasis: "observed", ... })` → `"exact"` and `costBasis: "computed"` → `"estimated"` — expected: both mappings shown/confirmed manually (no unit test — ARCH decision A4)
- **`npm run storybook`** boots with `Components/Badge` and `Components/TierBadge` groups discoverable — expected: no console errors, all named exports render

#### Testable Seams

None — ARCH decision A4: primitives are verified via Storybook stories + manual checklist only, no component tests.

### Implementation Notes

- **Module(s):** `client/src/components/` (Module Boundaries table — no query/api/filters/charts/pages imports)
- **Pattern reference:** `_chrome.css:37–42` (`.badge` variant classes) for Badge; `shared/types.ts` `TierFlags` for `costTierLevel`
- **Key decisions:** A3 (generic `Badge` with all five mockup variants, developer decision); A9 (`TierBadge` takes presentational `level`; `costTierLevel(TierFlags)` helper maps the shared contract; `locked` is page-declared, never derived)
- **Libraries:** `clsx` for variant class composition (existing convention — see `ExampleStat.tsx`, `ChartCard.tsx`)
- **High-risk callouts:** None

### Scope Boundaries

- Do NOT wire `TierBadge` to any real `TierFlags` data source — `costTierLevel` is a pure mapping function, data plumbing is #P4-13's scope
- Do NOT add variants beyond the five in `_chrome.css` (`pass`, `warn`, `fail`, `computed`, `premium`) plus `neutral`
- Only implement the Badge/TierBadge visual + mapping contract from the API Contracts table — no gate-logic (#P4-12) or premium-upgrade logic (#P4-13)

### Files Expected

**New files:**
- `client/src/components/Badge.tsx` — visual badge, six variants (pattern: `_chrome.css:37–42`)
- `client/src/components/Badge.stories.tsx` — all variants
- `client/src/components/TierBadge.tsx` — tier semantics over Badge + `costTierLevel` (pattern: `shared/types.ts` `TierFlags`)
- `client/src/components/TierBadge.stories.tsx` — 🟢/🟡/🔴 states

**Modified files:** None

**Must NOT modify:** None (no touched-but-not-changed files in this task's slice)

---

## Task T2: StatCard + StatRow

> **Status:** done
> **Verification:** ui
> **Effort:** s
> **Priority:** high
> **Depends on:** None
> **Satisfies REQs:** R1, R2, R5, R6, R8, R9
> **Footprint slice:** New: `client/src/components/StatCard.tsx` (exports `StatCard`, `StatRow`, private `Sparkline`), `StatCard.stories.tsx`
> **High-risk areas touched:** Page tasks #34–#49 (M risk) — this task defines the `StatCard`/`StatRow` prop contract every page composes against

### Description

The dashboard's core stat-card primitive: label, mono value, period-over-period delta glyph, and an inline-SVG sparkline, plus the `StatRow` grid wrapper mockups use to lay four stats side by side. This is the direct replacement for `client/src/example/ExampleStat.tsx` (deleted in T6).

### Verification Checklist

- **Delta direction × sentiment matrix** — `up`+`bad` (red ▲), `up`+`good` (green ▲), `down`+`good` (green ▼), `down`+`bad` (red ▼), `flat`+`neutral` (— muted) — expected: five stories or story controls covering each combination, colors match `.delta.up`/`.delta.upgood`/`.delta.down` from `_chrome.css` _(verifies R2, R8, ARCH decision A6)_
- **Sparkline rendering** — `sparkline` with ≥2 finite points renders an SVG polyline; `sparkline` omitted, `[]`, or a single-element array renders no SVG — expected: three stories (with-sparkline, empty-array, single-point) show the documented behavior _(verifies R2, ARCH forward stress-test: "delta undefined, sparkline `[]` or `[x]`")_
- **Non-finite values dropped** — a sparkline array containing `NaN`/`Infinity` never produces a broken/NaN path — expected: a story with a mixed-finite array renders a valid polyline with no console error
- **Accent colors** — `accent="money"` and `accent="cache"` render `#E8A33D`/`#4FC3D9` respectively on the value text — expected: visual match in story canvas (pattern: `ExampleStat.tsx` `ACCENT_CLASS`)
- **`sub` caption** — renders the optional caption text below the value — expected: one story with `sub` set
- **StatRow grid** — default 4-column grid with 1px line-colored gaps (mockup `.statrow`); remains one column through the inclusive 980px mockup breakpoint and expands at 981px — expected: a `StatRow` story with 4 `StatCard` children, check both 980px and 981px Storybook viewports _(verifies R2, Open Question "StatRow responsive collapse")_
- **Long label truncation** — a `StatCard` with an overly long `label` truncates with a `title` attribute rather than overflowing — expected: story with a long label string shows ellipsis truncation, hover shows native tooltip _(verifies ARCH forward stress-test: "Long project/model names")_
- **Delta a11y** — the ▲/▼ glyph has adjacent `sr-only` direction text (e.g. "increased"/"decreased") — expected: inspect rendered DOM in Storybook for the `sr-only` span _(verifies A11y baseline)_
- **Sparkline a11y** — the SVG is `aria-hidden`; when `delta` is absent, `sparklineLabel` is required and rendered as `sr-only` equivalent trend text — expected: the no-delta and non-finite stories compile only with a label and expose that label in the accessibility tree
- **Dark/light theme** — all stories checked under both themes via the Storybook toolbar toggle — expected: no unstyled/invisible elements in either theme

#### Testable Seams

None — ARCH decision A4: stories-only verification, no component tests.

### Implementation Notes

- **Module(s):** `client/src/components/`
- **Pattern reference:** `client/src/example/ExampleStat.tsx` (visual base — label/value/accent structure), `specs/pages/dashboard.html:37–47` (`.stat`/`.statrow` markup), `_chrome.css:65–72` (`.statrow`, `.stat`, `.stat .v`, `.stat .sub`)
- **Key decisions:** A2 (sparkline is a private inline-SVG polyline inside StatCard, agent suggestion/developer-delegated — swap-out point if vetoed later); A6 (delta API separates `direction` from `sentiment` — do not infer color from a signed number)
- **Libraries:** `clsx`; no chart library — sparkline is hand-rolled `<svg><polyline>`, not the `Chart`/ECharts wrapper
- **High-risk callouts:** M risk — page tasks #34–#49 all compose this contract; keep the prop shape exactly as specified in the ARCH API Contracts table (`StatCardProps`, `StatRowProps`) since post-merge changes ripple across parallel lanes

### Scope Boundaries

- Do NOT use the `Chart`/ECharts wrapper for the sparkline (A2) — keeps this task out of #P4-19's chart-boundary rework
- Do NOT add data-fetching, query keys, or URL state — pure props-in/JSX-out (A1, A8)
- Only implement the `StatCardProps`/`StatRowProps` contract from the ARCH API Contracts table

### Files Expected

**New files:**
- `client/src/components/StatCard.tsx` — StatCard + StatRow + private Sparkline SVG (pattern: `ExampleStat.tsx`, `dashboard.html:37–47`)
- `client/src/components/StatCard.stories.tsx` — delta up/down/flat, sentiment split, sparkline, accents, sub, StatRow grid (pattern: `ChartCard.stories.tsx`)

**Modified files:** None

**Must NOT modify:** None

---

## Task T3: DataTable

> **Status:** done
> **Verification:** ui
> **Effort:** m
> **Priority:** high
> **Depends on:** T5 (imports `EmptyState` as the default empty-state fallback)
> **Satisfies REQs:** R1, R3, R5, R6, R7, R9
> **Footprint slice:** New: `client/src/components/DataTable.tsx`, `DataTable.stories.tsx`
> **High-risk areas touched:** Page tasks #34–#49 (M risk) — Sessions/Projects/Models/Cache Lab all compose this contract; Client bundle (L risk) — first real import of `@tanstack/react-table`/`react-virtual`

### Description

The generic, headless table primitive every page with tabular data (Sessions, Projects, Models, Cache Lab, …) composes. Built on `@tanstack/react-table` for sorting/column model and an opt-in `@tanstack/react-virtual` path for thousand-row datasets, rendered with the mockup's exact `<table>` markup and classes.

### Verification Checklist

- **Plain render** — `data`/`columns` render rows matching the mockup table markup (`sessions.html:52–60`: `<table>`, `<th>`, `<td>`, `.num`/`.r` alignment classes) — expected: story with a small static dataset visually matches the mockup
- **Column meta styling** — a column with `meta: { align: "right" }` and/or `meta: { mono: true }` applies `.r`/`.num`-equivalent Tailwind classes — expected: story includes at least one right-aligned/mono column and shows correct alignment
- **Sorting** — clicking a sortable `<th><button>` toggles sort direction and updates `aria-sort` on the `<th>` — expected: story demonstrates ascending → descending → (optionally) unsorted cycle, `aria-sort` value inspected in DOM
- **Loading state** — `isLoading` renders a fixed count of skeleton rows with `role="status"` — expected: loading story shows skeleton rows, no real data rendered
- **Empty state** — `data.length === 0` renders the `empty` prop, or `<EmptyState message="No data" />` when `empty` is omitted — expected: two stories (custom empty node, default fallback) _(verifies R7)_
- **Virtualized rows** — `virtualized` + `height` with ~1000 rows renders only the viewport rows, adds logical `aria-rowcount`/`aria-rowindex`, hides spacer rows from accessibility APIs, and exposes a focusable “Show all rows” control that mounts every logical row — expected: inspect the virtualized story's DOM count and activate the control to confirm all 1000 rows become reachable _(verifies R3, ARCH forward stress-test: "Sessions page mounts DataTable with 10K rows")_
- **Row click** — `onRowClick` requires `getRowActionLabel`; clicking non-interactive row space delegates the action, while the separately rendered first-cell action button is named and keyboard operable without wrapping consumer content — expected: story exposes a visible arrow button with a row-specific accessible name and nested links/buttons retain their own behavior
- **`getRowId`/`initialSorting`** — both props are honored (stable row identity across re-sorts; table opens pre-sorted per `initialSorting`) — expected: one story sets `initialSorting` and confirms the initial sort order matches

#### Testable Seams

None — ARCH decision A4: stories-only verification, no component tests. (Note: ARCH's default `ui`-mode guidance suggests component tests for conditional states/handlers; A4 explicitly overrides this for all six primitives — sorting/virtualization behavior is instead covered downstream by the page tasks and #P4-18 cross-page E2E.)

### Implementation Notes

- **Module(s):** `client/src/components/`
- **Pattern reference:** `specs/pages/sessions.html:52–60` (table markup); TanStack Table v8 headless idiom (column defs + `useReactTable`); TanStack Virtual `useVirtualizer` docs pattern
- **Key decisions:** A5 (`virtualized` is an explicit prop + required `height` — no auto-enable threshold); A4 (no unit tests for sort/virtualization — page tasks and #P4-18 E2E cover behavior)
- **Libraries:** `@tanstack/react-table`, `@tanstack/react-virtual` (both already pinned in §2/package.json — first real import point per Areas of Impact)
- **High-risk callouts:** M risk — #34–#49 all compose `DataTable<T>`; keep the generic signature exactly as the ARCH API Contracts table specifies (`data`, `columns`, `isLoading`, `empty`, `virtualized`, `height`, `onRowClick` + `getRowActionLabel`, `initialSorting`, `getRowId`) since it's the widest-blast-radius contract in this task

### Scope Boundaries

- Do NOT auto-enable virtualization by row count — always an explicit `virtualized` prop (A5)
- Do NOT add server-side sorting/pagination — client-side only, per the ARCH API Contracts signature
- Do NOT add a Cypress smoke spec (Out of Scope — page issues own their own smoke coverage)
- Only implement the `DataTableProps<T>` contract from the ARCH API Contracts table

### Files Expected

**New files:**
- `client/src/components/DataTable.tsx` — generic headless table + sorting + loading + empty + virtualization (pattern: `sessions.html:52–60`, TanStack docs idiom)
- `client/src/components/DataTable.stories.tsx` — plain, sorted, loading, empty, virtualized (1k rows), row-click

**Modified files:** None

**Must NOT modify:**
- `client/.storybook/main.ts` (silent-regression hotspot — glob auto-discovers `DataTable.stories.tsx`; confirm Storybook boots with zero config edits rather than adding an explicit entry)

---

## Task T4: LockedCard

> **Status:** done
> **Verification:** ui
> **Effort:** s
> **Priority:** medium
> **Depends on:** None
> **Satisfies REQs:** R1, R4, R5, R6, R8, R9
> **Footprint slice:** New: `client/src/components/LockedCard.tsx`, `LockedCard.stories.tsx`
> **High-risk areas touched:** #P4-13 (premium tier) — L risk, `LockedCard` is the upgrade-path visual that task's data plumbing will drive

### Description

The 🔴-tier "premium feature, no data source" panel: visible title, a blurred veil overlay with a message and a "Set up cost capture" CTA linking to `/settings`, with an optional ghost-content slot behind the veil for partial previews.

### Verification Checklist

- **Default CTA** — no `ctaLabel`/`ctaHref` supplied renders "Set up cost capture →" linking to `/settings` via a wouter `Link` — expected: default story shows the exact CTA text and href _(verifies R4)_
- **Custom CTA/message/title** — all four text/href props overridden render the custom values — expected: one story with all props overridden
- **Ghost children** — optional `children` render behind the veil (visible but obscured) — expected: one story with placeholder child content showing through the blur
- **Dark veil** — mockup's `rgba(14,17,22,.72)` + `backdrop-filter: blur(2px)` veil renders in dark theme — expected: visual match to `_chrome.css:57–60` `.locked .veil` under the Storybook dark toggle
- **Light veil** — an explicit light-theme equivalent (e.g. `bg-white/75`) renders when the theme toggle is set to light — expected: veil is visibly distinct from the panel background, not the mockup's dark-only rgba value _(verifies Risk scenario "Dark/light theme contrast on the locked veil")_
- **Router decorator** — the story file wires the same `memoryLocation`/`Router`-based wouter decorator as `FilterBar.stories.tsx` (no query client needed — `Link` only) so the `Link` renders without a real router — expected: no console error about missing router context

#### Testable Seams

None — ARCH decision A4: stories-only verification, no component tests.

### Implementation Notes

- **Module(s):** `client/src/components/`
- **Pattern reference:** `specs/pages/models.html:93–96` (locked panel markup), `_chrome.css:57–60` (`.locked`, `.veil`), `client/src/filters/FilterBar.stories.tsx` (wouter router-decorator pattern for the `Link`)
- **Key decisions:** A1/A8 (presentational only — no tier-flag evaluation inside `LockedCard`, the page decides when to render it)
- **Libraries:** `wouter` (`Link` only — the one primitive allowed this import per Module Boundaries)
- **High-risk callouts:** L risk — #P4-13 depends on this visual; keep the CTA defaults (`"Set up cost capture →"`, `"/settings"`) exactly as specified so #P4-13 doesn't need a prop-shape change to adopt it

### Scope Boundaries

- Do NOT import `@tanstack/react-query`, `api/`, or `filters/` — `LockedCard` never checks tier flags itself (A1, A8)
- Do NOT build the premium-tier data plumbing — that's #P4-13's scope
- Only implement the `LockedCardProps` contract from the ARCH API Contracts table

### Files Expected

**New files:**
- `client/src/components/LockedCard.tsx` — panel + veil + CTA (pattern: `models.html:93–96`, `_chrome.css:57–60`)
- `client/src/components/LockedCard.stories.tsx` — CTA default, custom message, ghost children (pattern: `FilterBar.stories.tsx` router decorator)

**Modified files:** None

**Must NOT modify:** None

---

## Task T5: EmptyState + Chip

> **Status:** done
> **Verification:** ui
> **Effort:** s
> **Priority:** high
> **Depends on:** None
> **Satisfies REQs:** R1, R5, R6, R7, R9
> **Footprint slice:** New: `client/src/components/EmptyState.tsx`, `EmptyState.stories.tsx`, `Chip.tsx`, `Chip.stories.tsx`
> **High-risk areas touched:** T3 (DataTable) depends on `EmptyState` as its default empty-row fallback — land this task first or in the same pass as T3

### Description

Two small, independent primitives paired for a tight review cycle: `EmptyState` (centered muted message + optional reset/action button — the "no data for filter" global-layer state, and `DataTable`'s zero-row fallback), and `Chip` (mono pill for active/inactive/removable tag-like UI, reusing `toggleStyles.ts`'s active treatment).

### Verification Checklist

- **EmptyState message-only** — renders the centered message with no action — expected: default story shows message text, no button
- **EmptyState with action** — `action.label`/`action.onClick` renders a button that fires the callback on click — expected: story with an action wired to a visible log/counter _(verifies R7 "no data for filter" reset-action slot)_
- **Chip inactive** — default (no `active`) renders the `.mchip` mono-pill look with no active treatment — expected: default story
- **Chip active** — `active` applies the same active treatment as `TOGGLE_ACTIVE_CLASS` in `toggleStyles.ts` — expected: story visually matches the active toggle-button look
- **Chip clickable vs static** — `onClick` set renders a `<button>`; omitted renders a `<span>` — expected: two stories, inspect the rendered element tag in each
- **Chip removable** — `onRemove` set appends a separate sibling `×` button (never nested inside the main clickable element) with `aria-label="Remove <label>"` — expected: story with `onRemove` shows two distinct interactive elements (main chip + remove button), remove button click fires the callback independently of the main `onClick`

#### Testable Seams

None — ARCH decision A4: stories-only verification, no component tests.

### Implementation Notes

- **Module(s):** `client/src/components/`
- **Pattern reference:** pages §0 global-filter-layer row for `EmptyState`; `_chrome.css:49` `.mchip` and `client/src/ui/toggleStyles.ts` (`TOGGLE_CLASS`/`TOGGLE_ACTIVE_CLASS`) for `Chip`
- **Key decisions:** A10 (`Chip` is new and standalone — `FilterBar`'s own `ChipDropdown` is untouched, no refactor in this task)
- **Libraries:** `clsx`
- **High-risk callouts:** None directly, but sequence this task before or alongside T3 since `DataTable`'s default empty fallback imports `EmptyState`

### Scope Boundaries

- Do NOT refactor `FilterBar.tsx`'s `ChipDropdown` onto `Chip` (A10 — explicitly out of scope)
- Do NOT wire `Chip`'s remove/click behavior to any filter state — purely presentational callbacks
- Only implement the `EmptyStateProps`/`ChipProps` contracts from the ARCH API Contracts table

### Files Expected

**New files:**
- `client/src/components/EmptyState.tsx` — message + optional reset action (pattern: pages §0 row)
- `client/src/components/EmptyState.stories.tsx` — message-only, with action
- `client/src/components/Chip.tsx` — mono pill, active/removable (pattern: `_chrome.css:49` `.mchip`, `toggleStyles.ts`)
- `client/src/components/Chip.stories.tsx` — active, inactive, removable, clickable

**Modified files:** None

**Must NOT modify:**
- `client/src/ui/toggleStyles.ts` (silent-regression hotspot — Chip becomes a new consumer of `TOGGLE_ACTIVE_CLASS`; read-only reuse, do not edit the constants)
- `client/src/filters/FilterBar.tsx` (out of scope per A10 — keeps its own `ChipDropdown`)

---

## Task T6: Delete ExampleStat

> **Status:** done
> **Verification:** checklist
> **Effort:** xs
> **Priority:** low
> **Depends on:** T2 (StatCard is the named replacement — land it first so the workbench isn't without a smoke-test component)
> **Satisfies REQs:** R1
> **Footprint slice:** Deleted: `client/src/example/ExampleStat.tsx`, `client/src/example/ExampleStat.stories.tsx`
> **High-risk areas touched:** None (L risk — confirmed zero external importers)

### Description

Remove the Storybook workbench smoke-test component `ExampleStat`, whose own banner comment declares it "Replaced by the real stat-card primitive (#P4-1)". Grep confirms only its own story imports it. Last task in the sequence so `StatCard` (T2) exists before the workbench's smoke-test component disappears.

### Verification Checklist

- **No external importers** — `grep -rn "ExampleStat" client/src --include=*.tsx --include=*.ts` (excluding `client/src/example/`) returns zero matches — expected: empty grep result before deleting
- **`npm run verify`** passes after deletion (typecheck, lint, format, test) — expected: exit code 0, no dangling import errors
- **`npm run build`** (or at minimum `tsc --noEmit` + `vite build` for `client/`) succeeds — expected: build completes, no missing-module errors
- **Storybook boots clean** — `npm run storybook` shows no `Components/ExampleStat`/`Example/ExampleStat` group and no console error about a missing story module — expected: glob-based discovery silently drops the deleted story with zero config changes

### Implementation Notes

- **Module(s):** `client/src/example/` (deleted in full)
- **Pattern reference:** N/A — deletion only
- **Key decisions:** A7 (delete `client/src/example/` in this task rather than a later cleanup — its banner already names #P4-1 as the replacement)
- **Libraries:** N/A
- **High-risk callouts:** None

### Scope Boundaries

- Do NOT delete or modify anything outside `client/src/example/`
- Do NOT fold this into T2 — kept as its own tiny checklist task so the deletion's verification (grep + build) is independently auditable

### Files Expected

**New files:** None

**Modified files:** None

**Must NOT modify:** None

**Deleted files:**
- `client/src/example/ExampleStat.tsx` (banner declares replacement by #P4-1)
- `client/src/example/ExampleStat.stories.tsx` (story of the deleted component)
