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
| Sparkline | Hand-rolled inline SVG `<polyline>` (~20 lines, private to StatCard) | Reusing the ECharts `Chart` wrapper | Mockup renders literal `<svg><polyline>` (R8); zero canvas/ResizeObserver per card (5+ per row); decorative element whose value/delta text sits adjacent, so `aria-hidden` SVG is already the accessible shape; keeps stat cards out of #P4-19's chart-boundary rework. **Recorded as agent suggestion, developer-delegated (A2)** |
| Styling | Tailwind utilities + `clsx`, dark tokens as `dark:[#hex]` | CSS modules; extracting a theme file | Existing convention (ChartCard/ExampleStat/toggleStyles); no component library (R5) |
| New dependencies | **None** | — | Everything needed is already pinned in §2 / package.json |

## Patterns & Conventions

- **Presentational purity** — primitives take data via props; `@tanstack/react-query`, `api/`, `filters/` imports are forbidden inside `components/` (A1, A8); affects every primitive.
- **Existing component idiom** — exported `interface <Name>Props`, function components, PascalCase filenames matching the default export (`ChartCard.tsx` precedent).
- **Dark/light token mapping** — dark theme uses `_chrome.css` hex verbatim (`#151A21` panel, `#232B36` line, `#E8EDF2` text, `#5A6675`/`#8A96A5` muted, `#E8A33D` money, `#4FC3D9` cache); light theme maps to the slate-* scale as in `ChartCard.tsx`/`ExampleStat.tsx`. Mockups are dark-only, so light variants follow this established mapping.
- **Story idiom** — `Meta`/`StoryObj` from `@storybook/react-vite`, title `Components/<Name>`, one named export per acceptance state. Primitives are presentational, so no fetch-stub/provider decorators needed (unlike `ChartCard.stories.tsx`); `LockedCard` needs the wouter memory-router decorator for its `Link` (same pattern as `FilterBar.stories.tsx`).
- **A11y baseline** — delta arrows get `sr-only` direction text; sparkline SVG is `aria-hidden` (value is adjacent text); sortable headers are `<button>`s with `aria-sort` on the `<th>`; Chip's remove button gets `aria-label="Remove <label>"`; loading/status text uses `role="status"` (ChartCard precedent). Full chart a11y is #P4-19's scope, not this task's.

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
| `StatCard` | `{ label: string; value: string; accent?: "money" \| "cache"; delta?: StatDelta; sparkline?: number[]; sub?: string }` | Mockup `.stat`: uppercase label, mono value (accent-colored), delta glyph+text, 22px-high full-width sparkline, optional `.sub` caption | `sparkline` absent, empty, or length 1 → no SVG rendered; non-finite values dropped before scaling |
| `StatRow` | `{ children: ReactNode; columns?: number }` (default 4) | Mockup `.statrow`: grid with 1px line-colored gaps; collapses to one column below `md` | — |
| `DataTable<T>` | `{ data: T[]; columns: ColumnDef<T, unknown>[]; isLoading?: boolean; empty?: ReactNode; virtualized?: boolean; height?: number; onRowClick?: (row: T) => void; initialSorting?: SortingState; getRowId?: (row: T) => string }` | Headless TanStack table rendered as mockup-style `<table>`; client-side sorting toggled from header buttons; column `meta: { align?: "right"; mono?: boolean }` drives `.r`/`.num` styling | `isLoading` → skeleton rows (fixed count) with `role="status"`; `data.length === 0` → renders `empty` (defaults to `<EmptyState message="No data" />`); `virtualized` requires `height` (scroll container + `useVirtualizer`, fixed row-height estimate) |
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

_This section is populated by the **generate-tasks** skill (Phase 3)._
_Run: `/generate-tasks from: specs/architecture/ARCH-shared-dashboard-primitives.md`_
