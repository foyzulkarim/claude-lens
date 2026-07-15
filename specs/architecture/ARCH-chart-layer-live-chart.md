# Architecture: Chart layer + one live chart (#P3-4)

> **Date:** 2026-07-15
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Standalone brief — plan task #P3-4 (issue #31), requirements settled in `specs/claude-lens-plan.md`, `specs/claude-lens-architecture.md` §11, and `specs/claude-lens-pages.md` §1 Dashboard (binding over the mockup). See Inferred Requirements below for gaps this session resolved.
> **Type:** feature (brownfield — new module against an already-scaffolded app)

## Architecture Summary

Add a new `client/src/charts/` layer: a dumb, ~50-line ECharts wrapper (`Chart.tsx`) that
only mounts/updates/resizes/disposes a chart instance from an `EChartsOption`; a pure
timeseries option builder (`timeseries.ts`) that turns `Series[]` (the shared metrics
contract) into that option, including the compare-ghost dashed line and null-as-gap
handling; a small unit↔measure mapping module (`units.ts`); and a smart container
(`ChartCard.tsx`) that owns the per-chart controls (unit, area/bars, grain, compare,
smoothing), derives a `SeriesMetricsQuery` from those controls plus the existing global
URL filters, fetches via the existing `postMetrics`/`qk.metrics`/TanStack Query wiring, and
renders the toolbar + chart. `Dashboard.tsx` mounts one `ChartCard` (cost-over-time),
replacing its current text-only stub. No server or contract changes: the metrics engine
already computes everything the controls need (ghost series, MA7 smoothing, grain
bucketing), and the WS invalidation bus already targets the `metrics` query-key prefix, so
wiring a real `ChartCard` into the existing Dashboard query proves the full
ingest → WS → refetch → re-render loop live, per the issue's go/no-go acceptance criterion.

## Inferred Requirements

The issue and architecture §11 state the control set ("unit switcher, compare ghost,
smoothing, granularity, click-to-drill implemented in this layer") but don't specify how
much of it this first chart must exercise vs. defer. Resolved with the developer this
session:

| ID | Inferred Requirement | Source |
|----|----|----|
| R1 | Build the full control set now (unit, area/bars family, grain, compare, smoothing) — all four are query-param toggles the server/contract already support, and proving the layer's API now avoids reshaping it under ~10 Phase 4 pages later. | Developer decision, this session |
| R2 | Click-to-drill is built as real navigation wiring (`/sessions?from&to`) even though the Sessions page is still a stub — the mechanism is cheap and worth locking now; the visible payoff lands with #P4-4. | Developer decision, this session |
| R3 | The ECharts wrapper and the control/query/fetch logic are split into two components (dumb `Chart` + smart `ChartCard`) so the wrapper stays genuinely ~50 lines and reusable across future chart families. | Developer decision, this session |

## High-Level Structure

```
Dashboard.tsx
  └─ ChartCard (smart)
       ├─ useFilters()            [existing] global URL filters
       ├─ local control state      unit | family | grain | compare | smoothing
       ├─ derives SeriesMetricsQuery = filtersToQuery(filters, now) + controls
       ├─ useQuery(qk.metrics(query), () => postMetrics(query))   [existing wiring]
       ├─ buildTimeseriesOption(series, {family, unit})  (timeseries.ts, pure)
       └─ <Chart option={...} onPointClick={...} />  (Chart.tsx, dumb wrapper)
                └─ echarts/core: init → setOption → ResizeObserver → dispose

WS invalidation (existing, unchanged):
  server session-added/updated → ws.ts invalidateForMessage()
    → queryClient.invalidateQueries(qk.prefixes.metrics)
    → ChartCard's useQuery refetches → new Series[] → new option → Chart re-renders
```

Nothing here changes the ingest pipeline, metrics engine, or WS bus — this task is purely
the client-side charts layer plus its Dashboard mount point.

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|----|----|----|----|
| Charting library | `echarts` via `echarts/core` + explicit renderer/component registration | `echarts-for-react` (explicitly rejected by the issue); full `echarts` barrel import | `echarts/core` tree-shaking keeps bundle small (aligns with #P5-2 cold-start goal); already a devDependency, no new install |
| Data fetching | Reuse existing TanStack Query + `qk.metrics` + `postMetrics` | A chart-specific fetch path | Already built, tested, and wired to WS invalidation in `Dashboard.tsx`/`ws.ts` — reinventing it would duplicate the exact refetch-loop pitfall already solved there |
| Control state | Local `useState` in `ChartCard`, not the URL | Push unit/family/grain/compare/smoothing into the URL alongside global filters | These are per-chart display preferences, not shareable filter state; the URL already carries global filters (architecture §11) — overloading it with per-widget toggles would break permalink cleanliness once multiple charts exist (Phase 4) |
| Component split | Dumb `Chart` + smart `ChartCard` | Single combined component | Keeps the ECharts wrapper genuinely ~50 lines and reusable for non-timeseries chart families the plan lists (heatmap, scatter, etc.) in later phases |

## Patterns & Conventions

- **Pure builder / DOM wrapper split** — mirrors the existing `filters/state.ts` (pure) vs
  `filters/useFilters.ts` (stateful hook) split; keeps the option-building logic unit-testable
  without a DOM.
- **Query key factory** — `ChartCard` uses `qk.metrics(query)` from `api/queryKeys.ts`,
  never a hand-rolled key, per architecture §11 ("keys from one factory").
- **Memoize on serialized identity, not fresh objects** — `ChartCard` must memoize its
  derived `SeriesMetricsQuery` on `serializeFilters(filters)` + primitive control values, not
  on `new Date()` per render, exactly as `Dashboard.tsx`'s existing comment already documents
  as a known pitfall (ARCH-react-shell.md open question).
- **Null-safe measures** — `timeseries.ts` must render `SeriesPoint.value: null` as a gap,
  matching the engine's "never fabricate 0" convention (`server/metrics/measures.ts`).

## Data Models

No new data models — this task consumes the existing `shared/metrics-contract.ts` types
(`Series`, `SeriesPoint`, `SeriesMetricsQuery`, `Measure`, `Grain`) unchanged.

### `Unit` (new, client-only type in `charts/units.ts`)

**Purpose:** the Dashboard's $/tokens/calls toggle, mapped to one or more `Measure`s.

| Field | Type / Constraint | Notes |
|----|----|----|
| `Unit` | `"$" \| "tokens" \| "calls"` | Not part of the shared contract — purely a client display concept |

**Mapping:** `$ → costComputed`, `tokens → inputTokens + outputTokens` (summed), `calls → apiCalls`.

## API Contracts / Interfaces

No new HTTP endpoints. This task adds client-internal module boundaries only.

### `charts/Chart.tsx`

**Boundary:** internal React component (dumb wrapper)

| Prop | Signature | Purpose |
|----|----|----|
| `option` | `EChartsOption` | Full chart option; re-applied via `setOption(option, { notMerge: true })` whenever it changes |
| `onPointClick` | `(params: ECElementEvent) => void \| undefined` | Wired to ECharts' native `click` event |
| `className` | `string \| undefined` | Sizing/layout hook for the host card |

### `charts/timeseries.ts`

**Boundary:** pure internal module

| Op | Signature | Purpose | Errors / Returns |
|----|----|----|----|
| `buildTimeseriesOption` | `(series: Series[], opts: { family: "area" \| "bars"; unit: Unit }) => EChartsOption` | Builds the ECharts option for a timeseries chart, incl. compare-ghost dashed series and null-as-gap points | Never throws; empty `series` → an empty-but-valid option (renders an empty chart, not a crash) |

### `charts/ChartCard.tsx`

**Boundary:** internal React component (smart container)

| Prop | Signature | Purpose |
|----|----|----|
| `title` | `string` | Card heading (e.g. "Cost over time") |
| `defaultUnit` | `Unit` | Initial unit toggle state |

**Auth requirements:** none — client-side only, same-origin `/api/metrics` already unauthenticated per existing app.

## Module Boundaries

| Module / Package | Responsibility | Allowed Dependencies |
|----|----|----|
| `client/src/charts/Chart.tsx` | ECharts instance lifecycle only — no data fetching, no business logic | `echarts/core` + registered renderer/components; React |
| `client/src/charts/timeseries.ts` | Pure `Series[]` → `EChartsOption` mapping | `shared/metrics-contract.ts` types; `charts/units.ts` |
| `client/src/charts/units.ts` | Unit↔measure map, value formatting | `shared/metrics-contract.ts` types only |
| `client/src/charts/ChartCard.tsx` | Control state, query derivation, fetch, navigation-on-click | `charts/Chart.tsx`, `charts/timeseries.ts`, `charts/units.ts`, `api/metrics.ts`, `api/queryKeys.ts`, `filters/useFilters.ts`, `filters/state.ts`, wouter |
| `client/src/pages/Dashboard.tsx` | Page shell + mounting `ChartCard` | `charts/ChartCard.tsx`, `pages/PageStub.tsx` |

Rule: `Chart.tsx` never imports anything from `api/` or `filters/` — it must stay
data-agnostic so later chart families (heatmap, scatter, …) can reuse it unchanged.

## Change Footprint

### New files / modules

| Path | Purpose | Pattern reference |
|----|----|----|
| `client/src/charts/Chart.tsx` | Dumb ECharts mount/update/resize/dispose wrapper | New pattern; follows the "structural interface, no library" style of `client/src/ws.ts`'s `WsLike` |
| `client/src/charts/timeseries.ts` | Pure `Series[]` → `EChartsOption` builder | Pure-module style of `client/src/filters/state.ts` |
| `client/src/charts/timeseries.test.ts` | Unit tests for the builder (null gaps, ghost line, area/bars, unit formatting) | Test style of `client/src/filters/state.test.ts` |
| `client/src/charts/units.ts` | `Unit` type, unit→measure(s) map, value formatters | Small pure module, same folder |
| `client/src/charts/ChartCard.tsx` | Smart container: controls + query derivation + fetch + render | Query/memo pattern currently in `client/src/pages/Dashboard.tsx` |
| `client/src/charts/ChartCard.stories.tsx` | Storybook states: area, bars, ghost, empty, loading, error | Decorator pattern of `client/src/filters/FilterBar.stories.tsx` (QueryClientProvider + wouter `memoryLocation`) |

### Modified files / modules

| Path | What changes here |
|----|----|
| `client/src/pages/Dashboard.tsx` | Text-stub query block (lines ~10–45) replaced with `<ChartCard title="Cost over time" defaultUnit="$" />`; the `useMemo`/`useFilters`/`useQuery` logic currently inline here moves into `ChartCard` |
| `package.json` | No dependency change expected — `echarts` stays a devDependency; flag only if `echarts/core` subpath imports need a type-resolution tweak in `client/tsconfig.json` |

### Deleted / replaced

None. `Dashboard.tsx`'s current inline query logic is *moved*, not deleted independently —
tracked as a modification above.

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|----|----|
| `client/src/api/queryKeys.ts` | `ChartCard` becomes the second real consumer of `qk.metrics` (after the Dashboard stub) — confirms the key factory generalizes; no change expected, but any per-chart-instance key collision would surface here |
| `client/src/ws.ts` / `ws.test.ts` | Already invalidates `qk.prefixes.metrics`; this task is the first thing that visibly proves that invalidation drives a real re-render — no code change, but this is the acceptance-criterion's dependency |
| `client/src/filters/state.ts` / `useFilters.ts` | `ChartCard` is a new consumer of `filtersToQuery`/`resolveRange`/`useFilters` — no change, but any assumption baked into their existing tests (e.g. default range, empty-chip omission) now also has to hold for chart queries |

## Areas of Impact

| Area | Impact | Risk (L/M/H) | Why |
|----|----|----|----|
| Dashboard page | Text stub replaced with a real, interactive chart | L | Additive; existing loading/error paths already proven by the stub |
| `charts/` module (new) | Becomes the foundation every Phase 4 page's charts build on | M | Getting the `Chart`/`ChartCard` boundary wrong here means reshaping it under ~10 pages later — highest-leverage code in this task |
| Sessions page (stub) | Receives `from`/`to` query params from click-to-drill navigation but doesn't render them yet | L | Navigation-only; Sessions ignores unknown params today (renders its stub regardless), so no crash risk, just an inert URL until #P4-4 |
| Bundle size | New `echarts/core` + registered components added to the client bundle | L | Already a devDependency; tree-shaken subset import keeps this bounded, consistent with #P5-2's cold-start goal |

**Contract changes:** none — `shared/metrics-contract.ts` is unchanged; this task is a pure client of it.

**Cross-cutting ripples:** none in build/deploy/auth/telemetry. The only ripple is bundle
size (see above), which is a #P5-2 concern to watch, not solve here.

## Cross-Cutting Concerns

- **Errors:** `ChartCard`'s `useQuery` reuses `postMetrics`'s existing throw-on-non-2xx
  behavior; `isError`/`error.message` render inline in the card (same pattern as the current
  Dashboard stub), not a global error boundary.
- **Logging & metrics:** none added — this is client-rendering only, no new telemetry.
- **Auth / authz:** none — unchanged, same-origin unauthenticated `/api/metrics`.
- **Performance:** `Chart.tsx`'s `ResizeObserver` must not fire `setOption` (only `resize()`)
  to avoid redundant re-renders; `ChartCard`'s query memoization (see Patterns) is the primary
  guard against refetch loops. Subset `echarts/core` imports bound bundle growth.
- **Security:** none — no user input reaches the server beyond existing filter/measure enums,
  which the server already validates against `MEASURES`/`DIMENSIONS`/`GRAINS`.
- **Migrations / rollout:** none — no persisted state, no schema, no feature flag; ships as
  a normal PR behind the existing CI gate (`npm run verify`).

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies REQs |
|----|----|----|----|----|
| A1 | Build the full §11 control set (unit, family, grain, compare, smoothing) in this task | Minimal: static chart only, defer controls to Phase 4 | Controls are query-param toggles the server already supports; proves the layer API before ~10 pages depend on it | R1 |
| A2 | Click-to-drill ships as real navigation wiring now, destination stub until #P4-4 | Skip click-to-drill entirely until Sessions exists | Mechanism is cheap (reuses `filters/state.ts` URL contract); locks the `onPointClick` contract early | R2 |
| A3 | Split into dumb `Chart` + smart `ChartCard` | Single combined component | Keeps the ECharts wrapper ~50 lines and reusable across future non-timeseries chart families | R3 |
| A4 | Chart-local controls live in component `useState`, not the URL | Push all controls into URL query params alongside global filters | Per-widget display prefs shouldn't dilute the global-filter permalink contract; multiple charts per page (Phase 4) would collide on control param names | R1 |
| A5 | Import `echarts/core` + explicit component registration, not the full `echarts` package | Import the `echarts` barrel | Smaller bundle; consistent with issue's explicit "no `echarts-for-react`" and #P5-2's cold-start goal | — |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|----|----|
| `/api/metrics` unreachable / server restarting mid-session | `useQuery`'s existing `isError`/`error` surfaces inline in `ChartCard`, same as the current Dashboard stub; TanStack Query's default retry/backoff applies |
| WS disconnects and reconnects while the chart is mounted | Unchanged existing behavior: `ws.ts` invalidates everything on reconnect, so `ChartCard`'s query refetches — no new failure mode introduced |
| Rapid control toggling (unit + grain + compare flipped quickly) | Each toggle changes the memoized query key; TanStack Query dedupes/cancels stale in-flight requests by key change, same guarantee already relied on elsewhere |
| Empty `Series[]` (no sessions in range) | `buildTimeseriesOption` returns a valid empty-chart option rather than throwing; `Chart` renders an empty canvas, not a crash |
| Window resize / container resize (sidebar toggle, mobile) | `ResizeObserver` in `Chart.tsx` calls `chart.resize()`, standard ECharts pattern |

### Backward — regression risk per touched area

| Touched area | What could regress | How we'd know / mitigation |
|----|----|----|
| `client/src/pages/Dashboard.tsx` | The existing memoization-on-`filtersKey` guard against refetch loops could be dropped/weakened when the logic moves into `ChartCard` | `timeseries.test.ts` doesn't cover this (needs a render test); mitigate by keeping the exact same memo pattern verbatim when moving it, and manually verifying no refetch loop in dev tools' network tab during verification step 3 |
| `client/src/ws.ts` invalidation → refetch chain | None expected — `ChartCard` is just a second consumer of the same `qk.metrics` prefix | Existing `ws.test.ts` already covers `invalidateForMessage`; no new test needed, but the live-update manual check (verification step 3) is the real proof |
| `client/src/api/queryKeys.ts` | None — `ChartCard` doesn't add new key shapes | N/A |

## Open Questions

- Exact `tokens` unit definition — sum of `inputTokens + outputTokens`, or also include
  `cacheReadTokens`/`cacheCreateTokens`?
  - **Impact if unresolved:** the $/tokens/calls toggle could show a number that doesn't
    match users' mental model of "tokens used."
  - **Suggested default:** `inputTokens + outputTokens` only (excludes cache tokens, which
    have their own dedicated cache-hit-rate treatment elsewhere per the pages spec) — confirm
    during implementation, adjust `units.ts` if wrong; low cost to change later.
- Should `ChartCard`'s control state (unit/family/grain/compare/smoothing) persist across a
  page navigation-and-back, or always reset to `defaultUnit`/defaults?
  - **Impact if unresolved:** minor UX inconsistency (chart "forgets" the user's last toggle
    choice on revisit).
  - **Suggested default:** reset to defaults each mount (simplest, matches "controls are
    local `useState`" decision A4); revisit only if user feedback in Phase 4 wants persistence.

## Out of Scope

- Any new npm dependency (reason: `echarts` is already installed).
- Server or `shared/metrics-contract.ts` changes (reason: the engine already computes
  everything the controls need).
- Other chart families — heatmap, calendar, scatter, pareto, funnel, distribution (reason:
  this task is timeseries-only per the issue scope; later Phase 4 pages add these against the
  same `Chart` wrapper).
- Sessions page rendering the drilled `from`/`to` filter (reason: that's #P4-4).
- Automated visual regression testing (reason: consciously skipped project-wide per
  architecture §13 decisions log; Storybook + manual mockup comparison is the check here too).

---

# Tasks

## Task T1: Timeseries option builder (pure)

> **Status:** not started
> **Verification:** tdd
> **Effort:** s
> **Priority:** high
> **Depends on:** None
> **Satisfies REQs:** R1
> **Footprint slice:** New: `charts/timeseries.ts`, `charts/units.ts`, `charts/timeseries.test.ts`
> **High-risk areas touched:** None

### Description

Build the pure `Series[] → EChartsOption` mapping that every other task in this
ARCH depends on: `buildTimeseriesOption(series, { family, unit })` in
`timeseries.ts`, plus the `Unit` type and unit→measure mapping in `units.ts`.
No DOM, no React, no fetching — a deterministic function a developer unfamiliar
with the codebase can unit-test in isolation before either UI task exists.

### Test Plan

#### Test File(s)
- `client/src/charts/timeseries.test.ts`

#### Test Scenarios

##### Family rendering

- **builds an area-family option** — GIVEN a `Series` with points WHEN called with `family: "area"` THEN the resulting option's series entry uses area styling _(verifies R1)_
- **builds a bars-family option** — GIVEN the same input WHEN called with `family: "bars"` THEN the series entry is bar-type _(verifies R1)_

##### Null and empty handling

- **renders a null point as a gap, not zero** — GIVEN a `SeriesPoint` with `value: null` WHEN the option is built THEN the corresponding data entry stays `null` (never coerced to `0`), matching the engine's "never fabricate 0" convention _(verifies ARCH forward stress-test: null/empty values)_
- **handles an empty `series: []` input** — GIVEN no series WHEN the option is built THEN a valid, non-throwing option is returned _(verifies ARCH forward stress-test: "empty Series[] (no sessions in range)")_

##### Compare ghost

- **renders `compareGhost` as a distinct dashed series** — GIVEN a `Series` with `compareGhost` populated WHEN the option is built THEN a second series entry is added with dashed/muted styling, distinguishable from the primary series _(verifies R1)_

##### Unit formatting

- **formats `$` as currency** — GIVEN `unit: "$"` WHEN axis/tooltip values are formatted THEN they render as currency _(verifies R1; resolves Open Question default)_
- **formats `tokens` as compact counts** — GIVEN `unit: "tokens"` THEN values render as compact numbers _(verifies R1)_
- **formats `calls` as plain integers** — GIVEN `unit: "calls"` THEN values render as plain integers _(verifies R1)_
- **maps units to measures correctly** — `$ → costComputed`, `tokens → inputTokens + outputTokens` (summed), `calls → apiCalls` _(verifies R1; resolves Open Question: tokens definition excludes cache tokens)_

##### Multiple series

- **preserves label/dimensionKey per series** — GIVEN 2+ `Series` entries WHEN the option is built THEN each renders as its own labeled series entry, none merged or dropped

### Implementation Notes

- **Module(s):** `charts/timeseries.ts`, `charts/units.ts` (Module Boundaries: pure, depends only on `shared/metrics-contract.ts` types)
- **Pattern reference:** `client/src/filters/state.ts` — pure, side-effect-free module; `client/src/filters/state.test.ts` for test style/structure
- **Key decisions:** A1 (full control set — family/unit/compare are all exercised here), A5 (n/a — no echarts import in this task, stays DOM-free)
- **Libraries:** none new; type against `echarts/core`'s `EChartsOption`/`ComposeOption` if needed for typing only (no runtime echarts import)
- **High-risk callouts:** None — this task carries no M/H Area of Impact.

### Scope Boundaries

- Do NOT import `echarts/core` or any DOM API here — that's T2's `Chart.tsx`.
- Do NOT add chart families beyond timeseries (heatmap, scatter, etc. are Out of Scope per ARCH).
- Only implement the mapping and formatting needed for the cost-over-time chart's controls (family, unit, compare); do not add grain/smoothing logic here — those are query-shaping concerns owned by T3's `ChartCard`, not the option builder.

### Files Expected

**New files:**
- `client/src/charts/timeseries.ts` — pure `Series[]` → `EChartsOption` builder
- `client/src/charts/units.ts` — `Unit` type, unit→measure(s) map, value formatters
- `client/src/charts/timeseries.test.ts` — unit tests for both modules

**Modified files:** None.

**Must NOT modify:** None (no existing file touched by this task).

---

## Task T2: ECharts wrapper (dumb component)

> **Status:** not started
> **Verification:** ui
> **Effort:** s
> **Priority:** high
> **Depends on:** None
> **Satisfies REQs:** R3
> **Footprint slice:** New: `charts/Chart.tsx` (+ `charts/Chart.stories.tsx`)
> **High-risk areas touched:** Bundle size (L risk) — see Implementation Notes

### Description

Build the ~50-line dumb ECharts wrapper: mounts an ECharts instance on a div
ref, applies `option` via `setOption`, resizes on container resize, disposes
on unmount, and forwards point clicks. Contains no data-fetching or business
logic — a pure lifecycle shell any future chart family (not just timeseries)
can reuse unchanged, per decision A3.

### Verification Checklist

#### Testable Seams
- render (mounts an ECharts instance on the container element)
- conditional re-render (option prop changes vs. unrelated re-render)
- handlers (`onPointClick` wiring)
- lifecycle (resize, dispose) — not a11y-relevant (canvas-based chart, no interactive DOM controls in this component)

#### Component Tests (`client/src/charts/Chart.test.tsx`, mocking `echarts/core`)

- **calls `echarts.init` once on mount** — expected: `init` invoked exactly once against the container element, not re-invoked on subsequent re-renders
- **applies the option via `setOption`** — expected: `setOption(option, { notMerge: true })` called on initial render and again whenever the `option` prop changes, without a second `init` call
- **wires the click handler when provided** — expected: `chart.on("click", onPointClick)` called when `onPointClick` is passed; not called when omitted
- **resizes on container resize** — expected: mocking `ResizeObserver` and invoking its callback results in `chart.resize()` being called
- **disposes on unmount** — expected: `chart.dispose()` called and the resize observer disconnected when the component unmounts

#### Human-Verified (Storybook, `Chart.stories.tsx`, real ECharts — no mocks)

- **static area chart** — expected: renders correctly at default card size
- **static bar chart** — expected: renders correctly
- **container resize** — expected: resizing the Storybook viewport/container visually rescales the chart without distortion or stale layout
- **click interaction** — expected: clicking a data point fires the Storybook Actions panel entry with the click payload
- **bundle hygiene** — expected: `Chart.tsx` imports from `echarts/core` and registers only `LineChart`, `BarChart`, `GridComponent`, `TooltipComponent`, `CanvasRenderer` (not the full `echarts` barrel) — verified by reading the import statements

### Implementation Notes

- **Module(s):** `charts/Chart.tsx` (Module Boundaries: DOM lifecycle only; never imports `api/` or `filters/`)
- **Pattern reference:** `client/src/ws.ts`'s `WsLike` — structural-interface style (depend on the shape, not the concrete library, so the module stays testable without a real transport/DOM)
- **Key decisions:** A3 (dumb/smart split — this is the "dumb" half), A5 (`echarts/core` + explicit component registration, not the `echarts` barrel)
- **Libraries:** `echarts` (already a devDependency) via `echarts/core` subpath
- **High-risk callouts:** Bundle size (L risk, Areas of Impact) — mitigated by the subset-import requirement verified in the bundle-hygiene checklist item above; if `client/tsconfig.json` needs a subpath-import type tweak for `echarts/core`, that's expected and in-scope for this task.

### Scope Boundaries

- Do NOT add data fetching, control state, or business logic — that's T3.
- Do NOT implement chart families beyond what `option` already encodes — this component is family-agnostic by construction (it just renders whatever `EChartsOption` it's given).
- Do NOT use `echarts-for-react` (explicitly excluded by the originating issue).

### Files Expected

**New files:**
- `client/src/charts/Chart.tsx` — dumb ECharts mount/update/resize/dispose wrapper
- `client/src/charts/Chart.test.tsx` — component tests (mocked `echarts/core`)
- `client/src/charts/Chart.stories.tsx` — Storybook states for human verification

**Modified files:** None.

**Must NOT modify:** None.

---

## Task T3: ChartCard + Dashboard mount

> **Status:** not started
> **Verification:** ui
> **Effort:** m
> **Priority:** critical
> **Depends on:** T1, T2
> **Satisfies REQs:** R1, R2
> **Footprint slice:** New: `charts/ChartCard.tsx`, `charts/ChartCard.stories.tsx`; Modified: `client/src/pages/Dashboard.tsx`
> **High-risk areas touched:** `charts/` module foundation (M risk — this is the task that proves the layer's API before Phase 4 depends on it)

### Description

Build the smart container that owns per-chart control state (unit, family,
grain, compare, smoothing), derives a `SeriesMetricsQuery` from those controls
plus the existing global URL filters, fetches via the already-built
`postMetrics`/`qk.metrics`/TanStack Query wiring, renders the control toolbar
and `<Chart>`, and handles click-to-drill navigation. Mount one instance
("Cost over time") on `Dashboard.tsx`, replacing its current text-only stub.
This task carries the issue's go/no-go acceptance criterion: with a real
Claude Code session running, the chart must update within a few seconds
without a page reload.

### Verification Checklist

#### Testable Seams
- render (loading / error / loaded states)
- conditional states (each control's effect on the derived query vs. render-only)
- handlers (control toggles, point-click navigation)
- a11y basics (toolbar controls are keyboard-operable buttons/selects, not divs with onClick)

#### Component Tests (`client/src/charts/ChartCard.test.tsx`, `QueryClientProvider` + mocked `postMetrics`, `wouter` `memoryLocation` per the `FilterBar.stories.tsx` decorator pattern)

- **renders loading state** — expected: a loading indicator shows before `postMetrics` resolves
- **renders error state** — expected: given `postMetrics` rejects, the error message renders inline (same pattern as the current Dashboard stub)
- **renders the chart once data resolves** — expected: `<Chart>` receives an option built from the resolved `Series[]`
- **unit toggle requeries with the mapped measure(s)** — GIVEN the unit control is switched WHEN the query is next derived THEN `measures` reflects the T1 unit→measure mapping _(verifies R1)_
- **family toggle re-renders without a new fetch** — GIVEN the area/bars control is switched WHEN re-rendered THEN the option changes but `postMetrics` is NOT called again _(distinguishes render-only vs. query-affecting controls)_
- **grain toggle requeries with the updated grain** — expected: `query.grain` reflects the new selection and triggers a refetch _(verifies R1)_
- **compare toggle adds/removes `compare: "previous-period"`** — expected: toggling on sets it, toggling off removes it from the query _(verifies R1)_
- **smoothing toggle adds/removes `smoothing: "ma7"`** — expected: same on/off behavior _(verifies R1)_
- **click-to-drill navigates with the clicked bucket's range** — GIVEN a chart point is clicked WHEN the handler fires THEN `navigate` is called with `/sessions?from=<t>&to=<t+grain>` _(verifies R2)_

##### Regression Guard

- **stable filters+controls do not requery** — GIVEN unchanged `filters` and control state WHEN the component re-renders THEN the derived query is referentially/deep-equal stable and `postMetrics` is not called again _(guards backward-regression risk for `client/src/pages/Dashboard.tsx`'s existing memo-on-`filtersKey` pattern — the exact refetch-loop pitfall its code comments already warn about)_
- **query key matches the shared factory exactly** — expected: the `useQuery` key deep-equals `qk.metrics(query)` from `api/queryKeys.ts`, not a hand-rolled key _(guards backward-regression risk for `client/src/api/queryKeys.ts` / `client/src/ws.ts` — WS invalidation only reaches this query if the key shape matches exactly)_
- **range/filters fragment matches the shared resolver** — expected: `query.range`/`query.filters` equal `filtersToQuery(filters, now)`'s output, not a reimplementation _(guards backward-regression risk for `client/src/filters/state.ts`)_

#### Human-Verified (Storybook + manual dev-server check)

- **Storybook states** (`ChartCard.stories.tsx`) — expected: area, bars, with-ghost, empty, loading, and error states all render correctly
- **Live-update acceptance (go/no-go)** — expected: `npm run dev`, open the Dashboard, run a real Claude Code session in a watched root; the cost-over-time chart updates within a few seconds **without a page reload**
- **Manual control sweep** — expected: toggling each control (unit, family, grain, compare, smoothing) produces the correct visual/query change
- **Click-to-drill URL check** — expected: clicking a chart point navigates the browser URL to `/sessions?from=…&to=…` (Sessions renders its stub regardless — destination is inert until #P4-4, but the URL must be correct)
- **Dashboard mount** — expected: `Dashboard.tsx` renders `<ChartCard title="Cost over time" defaultUnit="$" />` inside its existing `PageStub` shell; the old inline query/memo logic is removed, not duplicated

### Implementation Notes

- **Module(s):** `charts/ChartCard.tsx` (Module Boundaries: may import `charts/Chart.tsx`, `charts/timeseries.ts`, `charts/units.ts`, `api/metrics.ts`, `api/queryKeys.ts`, `filters/useFilters.ts`, `filters/state.ts`, wouter)
- **Pattern reference:** the query/memo logic currently inline in `client/src/pages/Dashboard.tsx` — move it here verbatim rather than re-deriving it, to avoid dropping the `filtersKey`-not-`new Date()` memoization guard it already documents; `client/src/filters/FilterBar.stories.tsx` for the Storybook decorator pattern (`QueryClientProvider` + `wouter` `memoryLocation`)
- **Key decisions:** A1 (build the full control set), A2 (click-to-drill as real navigation, destination stub until #P4-4), A3 (this is the "smart" half), A4 (control state is local `useState`, not pushed into the URL)
- **Libraries:** `@tanstack/react-query` (existing), `wouter` (existing) — no new libraries
- **High-risk callouts:** This is the M-risk "foundation" area from ARCH's Areas of Impact — getting `ChartCard`'s prop/state boundary wrong here reshapes it under ~10 Phase 4 pages later. The regression-guard tests above specifically target the two documented failure modes (refetch loops, query-key drift) rather than just happy-path behavior.

### Scope Boundaries

- Do NOT modify `shared/metrics-contract.ts` or any server code — the engine already computes everything needed (Out of Scope).
- Do NOT implement Sessions-page rendering of the `from`/`to` filter — that's #P4-4 (Out of Scope). This task only needs the URL to be correct.
- Do NOT push per-chart control state (unit/family/grain/compare/smoothing) into the URL alongside global filters — decision A4.
- Do NOT add chart families beyond timeseries.
- Only mount one `ChartCard` instance (cost-over-time) on the Dashboard — do not build additional Dashboard sections from `specs/claude-lens-pages.md` §1 (those are #P4-2).

### Files Expected

**New files:**
- `client/src/charts/ChartCard.tsx` — smart container: control state, query derivation, fetch, render, click-to-drill
- `client/src/charts/ChartCard.test.tsx` — component + regression-guard tests
- `client/src/charts/ChartCard.stories.tsx` — Storybook states

**Modified files:**
- `client/src/pages/Dashboard.tsx` — replace the inline text-stub query block with `<ChartCard title="Cost over time" defaultUnit="$" />`; remove the now-redundant inline `useMemo`/`useQuery` logic

**Must NOT modify:**
- `client/src/api/queryKeys.ts` (silent-regression hotspot — covered by the "query key matches the shared factory" regression-guard test above)
- `client/src/ws.ts` (silent-regression hotspot — invalidation behavior is exercised, not changed; covered by the live-update acceptance check)
- `client/src/filters/state.ts` / `client/src/filters/useFilters.ts` (silent-regression hotspot — covered by the "range/filters fragment matches" regression-guard test above)
- `shared/metrics-contract.ts` (out of scope per ARCH)

### TDD Sequence

Not applicable — `ui` mode. Suggested build order within the task: control
state + query derivation first (verifiable via the component tests above,
no `<Chart>` needed yet — stub it), then wire in the real `<Chart>` from T2,
then the click-to-drill handler, then the Dashboard mount last.
