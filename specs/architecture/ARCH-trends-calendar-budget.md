# Architecture: Trends, Calendar & Budget page (#P4-10 / issue #42)

> **Date:** 2026-07-19
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** `specs/claude-lens-plan.md` #P4-10 · `specs/claude-lens-pages.md` §8 · `specs/context/42.md` · issue #42
> **Type:** feature (brownfield — new page composed almost entirely from existing engine/chart-layer capabilities)

## Architecture Summary

Trends, Calendar & Budget is built as seven independently-queried section components composed into one page shell (`Trends.tsx`), mirroring the Dashboard's T7-T13 pattern exactly. Five of the seven sections need **zero** metrics-engine changes — they're existing `MetricsQuery` shapes (multi-dimension series, `mode: "distribution"` for Pareto) the engine already serves. The two genuinely new capabilities are: (1) two ECharts chart families never used before in this repo — calendar heatmap and hour×weekday cartesian heatmap, both registered additively in the existing `Chart.tsx` wrapper; and (2) a minimal, intentionally-narrow local config store (`~/.claude-lens/config.json`, budget field only) with a `GET/PUT /api/config` route, which #P4-15 later extends to the full Settings surface. The Budget and Forecast spec rows collapse into one combined panel (matching the mockup's single chart) rather than two overlapping projections. The one cross-task write is threading the new config-sourced budget value into `BurnRateCard`'s existing (currently always-undefined) `budget` prop on the Dashboard — that prop's over-budget red state already *is* the "threshold alert," so no new alert-item type is introduced.

## High-Level Structure

```
Trends.tsx (page shell — composes 7 sections, no data fetching of its own)
├── CalendarHeatmapPanel      → POST /api/metrics  (dims:[time], grain:day)      → charts/calendar.ts
├── HourWeekdayHeatmapPanel   → POST /api/metrics  (dims:[time], grain:hour)     → pages/trends/hourWeekdayBuckets.ts → charts/heatmap.ts
├── StackedWeeklyBarsPanel    → POST /api/metrics  (dims:[time,project|model])   → charts/timeseries.ts (+stacked)
├── ParetoPanel               → POST /api/metrics  (mode:distribution, turn)    → charts/pareto.ts (+ DataTable for table view)
├── BudgetForecastPanel       → POST /api/metrics  (dims:[time], grain:day, MTD) → pages/trends/forecast.ts → charts/forecast.ts
│                              → GET/PUT /api/config (budget)
├── RollingEfficiencyPanel    → POST /api/metrics  (3 measures, one query)      → charts/timeseries.ts (line family, reused)
└── GatePassRateStub          → static "arrives with #P4-12" notice (no fetch — gatePassRate measure is a confirmed always-null stub server-side today)

Dashboard.tsx (modified)
└── BurnRateCard now receives budget={config?.budget ?? undefined} from a new GET /api/config read
```

No new server aggregation logic: every metrics-backed section is a plain `MetricsQuery` dispatched through the existing `metrics()` engine. The only new server surface is the config route, which is a flat file read/write, not a Store query.

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|---|---|---|---|
| Chart families for calendar/hour×weekday | Add `CalendarChart`... actually `HeatmapChart` + `CalendarComponent` + `VisualMapComponent` from `echarts/{charts,components}`, registered in existing `Chart.tsx` | Hand-rolled SVG grids (mockup uses raw SVG) | ECharts already the project's one chart engine (ARCH §11); adding registrations is additive and keeps one lifecycle/rendering path for every chart family |
| Hour×weekday aggregation | Client-side pure bucketing over an hour-grain `Series` | New `Dimension` values (`hourOfDay`, `weekday`) added to the engine | Pages spec explicitly calls this "pure timestamp math" — no filtering/grouping semantics the engine needs to own; keeps `Dimension` union closed (adding literals there ripples into `dimensions.ts`, `engine.ts`'s `sessionValueForDim`, and every exhaustive switch) |
| Tokens-per-$ deflator | Client-side ratio over two measures from one query response | New `Measure` (`tokensPerDollar`) in the engine | A derived ratio of two existing measures needs no new aggregation semantics; adding a `Measure` literal touches `MEASURES` exhaustive-array, `measures.ts`, and every consumer that switches on `Measure` |
| Budget/forecast combined panel | One panel, one chart (actual + dashed projection + band), toggle between linear/EWMA method | Two separate panels (Budget progress + Forecast chart) per the spec table's two rows | Mockup renders exactly one combined visualization; building two overlapping projection UIs is duplicated surface for the same "will I go over budget" question |
| EWMA/linear/band math | New pure module, `client/src/pages/trends/forecast.ts` | Reuse/extend `server/metrics/distributions.ts`'s `movingAverage7` | No existing EWMA anywhere in the repo (confirmed via search); this is page-specific derived display math over already-fetched series, same "pure function over `Series[]`" pattern as `bucketRows`/`chartTrendSummary` in `ChartCard.tsx` — doesn't belong in the server engine (a rendering-layer projection, not an aggregation) |
| Budget config storage | New `~/.claude-lens/config.json` via `server/settings.ts`, typed loosely (only `budget` is a named field; unknown keys pass through unchanged) | Wait for #P4-15 to build the whole config store first | Issue #42 explicitly scopes "a minimal settings.ts + GET/PUT /api/config limited to the budget value" and forbids locking the full schema — #P4-15 depends on and extends this exact seam |
| Stacked bars | Add optional `stacked?: boolean` to `charts/timeseries.ts`'s `BuildTimeseriesOptions` | New `charts/stackedBars.ts` duplicating the bar-series loop | One-line additive change to an existing, already-tested builder beats a near-duplicate file (existing bar/line/ghost logic is ~40 lines, not worth forking) |
| Gate pass-rate section | Static stub component (`GatePassRateStub.tsx`), no query | Query `gatePassRate` measure and render whatever comes back | `measures.ts` confirmed: `gatePassRate` always returns `null` today — matches the issue's own "Gate pass-rate trend stubs until #P4-12" scope line; querying it would render a chart of all-null points, which is worse UX than an honest stub (same convention `AnomalyFeed` already uses for its `gateFailure`/`captureGap` stub state) |

## Patterns & Conventions

- **Section-owned queries** (Dashboard decision A5) — every Trends panel owns its own `useQuery`, loading/error state; `Trends.tsx` does no fetching itself. Followed for all 7 sections.
- **Chart-family builders live in `charts/`, pure `Series[] → EChartsOption`** (architecture §11) — `calendar.ts`, `heatmap.ts`, `pareto.ts`, `forecast.ts` all follow `timeseries.ts`'s exact shape: a `build*Option(series, opts)` pure function, never touching `api/`/`filters/` (module boundary rule).
- **One TanStack Query key factory** (`api/queryKeys.ts`) — new `qk.config()` key added there, not invented ad hoc.
- **`useStableNow`** — every MTD/date-boundary computation (Budget/Forecast panel) uses the existing `useStableNow` hook, exactly as `BurnRateCard` already does, to avoid the query-churn bug documented there.
- **"Never fabricate 0" nullability convention** (measures.ts / distributions.ts) — the forecast band and EWMA math return `null`/an explicit "not enough data" state rather than a fabricated projection when fewer than ~3 days of MTD data exist.
- **Not applied:** no new `Dimension` or `Measure` literal is added anywhere (see Tech Choices) — deliberately, to keep the exhaustive-array contracts (`MEASURES.length`, `DIMENSIONS.length` guards) untouched by this task.

## Data Models

### `AppConfig` (server, `shared/settings-contract.ts`)

**Purpose:** The on-disk shape of `~/.claude-lens/config.json`. Deliberately minimal today.

| Field | Type / Constraint | Notes |
|---|---|---|
| `budget` | `number \| null`, optional | `null`/absent = no budget set (BurnRateCard's existing "no budget set" state). A set value must be a finite number > 0 |
| *(future fields)* | — | #P4-15 adds pricing table, scan roots, thresholds, saved views, tags here — this task's read/write path must round-trip unknown keys unchanged so it never destroys fields it doesn't know about |

**Lifecycle:** Created on first `PUT /api/config` (file doesn't exist until then); read returns the default `{ budget: null }` when the file is absent — never throws.

### `MonthForecast` (client, `pages/trends/forecast.ts`, in-memory only)

**Purpose:** The Budget/Forecast panel's derived projection, computed from an already-fetched day-grain `costComputed` series for the current UTC month (same `utcMonthStart`/`daysInUtcMonth` helpers `BurnRateCard.tsx` already has — reused, not reimplemented).

| Field | Type / Constraint | Notes |
|---|---|---|
| `mtd` | `number` | Sum of the month-to-date series (same as `BurnRateCard`'s existing `mtd`) |
| `method` | `"linear" \| "ewma"` | User-toggled display method |
| `projectedEndOfMonth` | `number \| null` | `null` when fewer than 3 days of data (band would be meaningless) |
| `bandLow` / `bandHigh` | `number \| null` | `projectedEndOfMonth ∓` a spread derived from day-over-day variance in the MTD series; both null together with `projectedEndOfMonth` |
| `budget` | `number \| null` | From `GET /api/config`, threaded straight through — the cap line |
| `crossesBudgetAt` | `string \| null` (ISO date) | First projected date the band's lower edge exceeds `budget`, or `null` if it never does / no budget set — feeds the mockup's "⚠ upper band crosses cap around Jul 27" line |

## API Contracts / Interfaces

### `GET/PUT /api/config` (new — `server/routes/config.ts`)

**Boundary:** HTTP API, local-only (loopback, same as every other route — no auth beyond that).

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| `GET` | `/api/config` | Read current config | `200 AppConfig` (defaults to `{ budget: null }` if file absent) |
| `PUT` | `/api/config` | Update budget | Body `{ budget: number \| null }`. `200` updated `AppConfig` on success; `400 { error }` if `budget` is present but not `null`/a finite number `> 0` |

**Auth requirements:** None beyond the existing loopback-only server binding (`127.0.0.1`, per `cli.ts`).

### `server/settings.ts` (new — internal module, not HTTP-facing)

**Boundary:** internal module, mirrors `server/cache/analysis.ts` vs `routes/cache-lab.ts` separation (route validates + delegates; module does the actual work).

| Method/Op | Signature | Purpose | Errors / Returns |
|---|---|---|---|
| `readConfig` | `(): AppConfig` | Reads + JSON-parses `~/.claude-lens/config.json` | Returns `{ budget: null }` (plus any other keys already on disk) if file missing or unparseable — never throws |
| `writeConfig` | `(patch: Partial<AppConfig>): AppConfig` | Merges `patch` onto the existing on-disk object (preserving unknown keys) and persists | Returns the merged, persisted config |

## Module Boundaries

| Module / Package | Responsibility | Allowed Dependencies |
|---|---|---|
| `server/settings.ts` | Read/write `~/.claude-lens/config.json` | `node:fs`, `node:path`, `node:os` only — no Store, no routes |
| `server/routes/config.ts` | Validate HTTP body, delegate to `settings.ts` | `settings.ts`, `shared/settings-contract.ts` — same "validate, snapshot, delegate" shape as `routes/cache-lab.ts` |
| `client/src/pages/trends/*` | Page-specific pure derivation (bucketing, forecast math) + section components | `api/`, `charts/`, `components/`, `filters/` — never imported *by* `charts/` (one-way, same rule Dashboard's sections already follow) |
| `client/src/charts/{calendar,heatmap,pareto,forecast}.ts` | Pure `Series[]/Distribution → EChartsOption` builders | `shared/metrics-contract.ts`, `charts/units.ts` only — never `api/` or `filters/` (existing module-boundary rule, unchanged) |

## Change Footprint

### New files / modules

| Path | Purpose | Pattern reference |
|---|---|---|
| `shared/settings-contract.ts` (+`.test.ts`) | `AppConfig` wire type + validation helpers | `shared/cache-lab-contract.ts` |
| `server/settings.ts` (+`.test.ts`) | Read/write `~/.claude-lens/config.json` | `server/ingest/warm-cache.ts`'s `homedir()`-joined path convention |
| `server/routes/config.ts` (+`.test.ts`) | `GET/PUT /api/config`, validate + delegate | `server/routes/cache-lab.ts` |
| `client/src/api/config.ts` (+`.test.ts`) | `getConfig()` / `putConfig()` fetch wrappers | `client/src/api/cacheLab.ts` |
| `client/src/charts/calendar.ts` (+`.test.ts`) | Calendar-heatmap option builder | `client/src/charts/timeseries.ts` |
| `client/src/charts/heatmap.ts` (+`.test.ts`) | Hour×weekday cartesian-heatmap option builder | `client/src/charts/timeseries.ts` |
| `client/src/charts/pareto.ts` (+`.test.ts`) | Pareto curve option builder | `client/src/charts/scatterOption.ts` |
| `client/src/charts/forecast.ts` (+`.test.ts`) | Band-chart option builder (actual + dashed projection + shaded band) | `client/src/charts/timeseries.ts` |
| `client/src/pages/trends/hourWeekdayBuckets.ts` (+`.test.ts`) | Pure hour-series → 7×24 grid bucketing | `client/src/charts/ChartCard.tsx`'s `bucketRows` |
| `client/src/pages/trends/forecast.ts` (+`.test.ts`) | EWMA/linear projection + confidence band math | `client/src/pages/dashboard/BurnRateCard.tsx`'s existing linear-projection logic (reused, not duplicated) |
| `client/src/pages/trends/CalendarHeatmapPanel.tsx` (+`.stories.tsx`, `.test.tsx`) | Calendar heatmap section | `client/src/pages/dashboard/BurnRateCard.tsx` (section-owned query shape) |
| `client/src/pages/trends/HourWeekdayHeatmapPanel.tsx` (+`.stories.tsx`, `.test.tsx`) | Hour×weekday heatmap section | ″ |
| `client/src/pages/trends/StackedWeeklyBarsPanel.tsx` (+`.stories.tsx`, `.test.tsx`) | Stacked weekly bars (project/model toggle) — spec-vs-mockup gap fill | `client/src/charts/ChartCard.tsx`'s toggle-group pattern |
| `client/src/pages/trends/ParetoPanel.tsx` (+`.stories.tsx`, `.test.tsx`) | Pareto curve/table section | ″ |
| `client/src/pages/trends/BudgetForecastPanel.tsx` (+`.stories.tsx`, `.test.tsx`) | Combined budget cap + forecast band + inline budget-set control | `BurnRateCard.tsx` |
| `client/src/pages/trends/RollingEfficiencyPanel.tsx` (+`.stories.tsx`, `.test.tsx`) | 3-way toggle ($/day-MA, tokens-per-$, cache trend) | `client/src/charts/ChartCard.tsx`'s `ToggleGroup` |
| `client/src/pages/trends/GatePassRateStub.tsx` (+`.stories.tsx`, `.test.tsx`) | Static "arrives with #P4-12" notice | `AnomalyFeed.tsx`'s gate-stub paragraph |
| `cypress/e2e/trends.cy.ts` | Smoke spec: route renders all 7 sections from fixtures, one drill-link to Sessions | `cypress/e2e/cache-lab.cy.ts` |

### Modified files / modules

| Path | What changes here |
|---|---|
| `client/src/pages/Trends.tsx` | Stub → composed shell rendering the 7 panels in mockup order (calendar+hour×weekday row, stacked-bars row, pareto+budget/forecast row, rolling-efficiency+gate-stub row) |
| `client/src/charts/Chart.tsx` | Register `HeatmapChart`, `CalendarComponent`, `VisualMapComponent` from `echarts`; widen `ChartOption` union to include their option types |
| `client/src/charts/timeseries.ts` | Add optional `stacked?: boolean` to `BuildTimeseriesOptions`; when true, bar series get `stack: "total"` |
| `client/src/api/queryKeys.ts` | Add `qk.config: () => ["config"] as const` |
| `client/src/pages/Dashboard.tsx` | Add one `useQuery(qk.config(), () => getConfig())` call; pass `budget={config?.budget ?? undefined}` into `<BurnRateCard>` |
| `server/app.ts` | Register `registerConfigRoute(app)` alongside the other route registrations |

### Deleted / replaced

None.

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|---|---|
| `client/src/pages/dashboard/BurnRateCard.tsx` | Not modified, but its behavior activates for the first time in production once `Dashboard.tsx` passes a real `budget` — its existing "no budget set" / "over budget" branches and their stories/tests were written against the always-`undefined` case; confirm both branches still render correctly with a real numeric prop (they were already designed for this, per the component's own doc comment) |
| `client/src/charts/Chart.tsx`'s existing line/bar/scatter consumers (`ChartCard`, `EfficiencyScatterCard`, etc.) | Additive ECharts registrations only — verify no bundle-size/tree-shaking regression from pulling in `HeatmapChart`/`CalendarComponent` (low risk, additive imports don't change existing option shapes) |

## Areas of Impact

| Area | Impact | Risk (L/M/H) | Why |
|---|---|---|---|
| Dashboard page | Gains a live budget read + real `BurnRateCard` state | L | Additive query; `BurnRateCard`'s branches already exist and were designed for this |
| `#P4-15` (Settings page + full config store) | Depends on and extends `server/settings.ts` / `shared/settings-contract.ts` | L | This task's contract is explicitly designed to be extended, not replaced — unknown-key passthrough is the seam |
| Chart bundle size | Two new ECharts chart types + one new component registered | L | Additive tree-shaken imports; ECharts modules are already code-split per family |
| `#P4-12` (gates engine) | Will later replace `GatePassRateStub.tsx` with a real query once `gatePassRate` stops returning `null` | L | Explicitly called out in the issue scope; the stub component is intentionally swappable |

**Contract changes:** None to existing public types. `shared/settings-contract.ts` is wholly new; no existing API response shape changes.

**Cross-cutting ripples:** None to auth, telemetry, migrations, or the build pipeline. `~/.claude-lens/` already exists as a directory concept (the warm-start cache lives there); this adds a sibling file, no new directory-creation path beyond what `server/settings.ts` needs (create-if-missing on first `PUT`).

## Cross-Cutting Concerns

- **Errors:** `readConfig`/`writeConfig` never throw (missing/corrupt file → default); `routes/config.ts` returns `400 { error }` for a malformed `PUT` body, matching `parseCacheLabQuery`'s convention exactly. Every panel follows the existing `isPending`/`isError` branch pattern (`ChartCard`, `BurnRateCard`).
- **Logging & metrics:** No new logging — config read/write is a synchronous, infrequent local file operation; failures surface as the route's `400`/`500` through Fastify's existing logger, same as every other route.
- **Auth / authz:** None beyond the existing loopback-only binding; no new auth surface introduced.
- **Performance:** Hour×weekday bucketing runs client-side over one already-bounded (filter-range-scoped) hour-grain series — same cost class as `bucketRows`'s existing per-render pivot. Config read is a single small JSON file, negligible cost, not cached (correctness > micro-optimization for a rarely-hit route).
- **Security:** `PUT /api/config`'s only writable field is `budget`, strictly validated as `null` or a finite positive number — no arbitrary key injection into the config file from the HTTP boundary (the passthrough-unknown-keys behavior only preserves what's *already* on disk, it never accepts new arbitrary keys from a request body in this task).
- **Migrations / rollout:** No migration needed — `config.json` is created lazily on first `PUT`. Fully backward compatible: an install with no config file behaves exactly as today (`BurnRateCard` shows "no budget set").

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies |
|---|---|---|---|---|
| A1 | No new `Dimension`/`Measure` literals; hour×weekday and tokens-per-$ computed client-side from existing measures | Extend the engine's exhaustive unions | Keeps `MEASURES`/`DIMENSIONS` contracts (and every exhaustive switch depending on them) untouched; both derivations are pure display math, not new aggregation semantics | Pages spec §8 "pure timestamp math" note |
| A2 | Budget + Forecast collapse into one combined panel | Two separate panels per the two spec-table rows | Mockup shows exactly one chart; avoids building two overlapping "will I exceed budget" visualizations | Pages spec §8 Budget + Forecast rows |
| A3 | Gate pass-rate section ships as a static stub, no query | Query `gatePassRate` and render null-valued chart | `measures.ts` confirms this measure is unconditionally `null` today; issue #42 itself scopes this as a stub pending #P4-12 | Issue #42 scope note; `AnomalyFeed`'s existing stub precedent |
| A4 | New chart families (calendar, hour×weekday, pareto, forecast) as separate pure builders in `charts/`, registered additively in `Chart.tsx` | Fold into `timeseries.ts` | Architecture §11 explicitly names these as distinct chart families; `timeseries.ts` only gets the one small additive `stacked?` flag it can cleanly absorb | Architecture §11 |
| A5 | Budget config: minimal `server/settings.ts` + `shared/settings-contract.ts`, unknown-key passthrough | Wait for #P4-15 / build the full config schema now | Issue explicitly forbids locking the full schema; #P4-15 depends on this exact narrow seam | Issue #42 scope; unblocks #P4-15 |
| A6 | Dashboard threshold alert = wire real `budget` into existing `BurnRateCard` prop | New `AnomalyFeedItem` kind (`"budgetAlert"`) | `BurnRateCard`'s over-budget red state already exists and was built for exactly this, per its own doc comment ("no Settings-backed budget config exists yet (#P4-10)") | Issue #42 dependency note (#P4-2/#34 cross-task write) |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|---|---|
| `~/.claude-lens/config.json` doesn't exist yet (fresh install) | `readConfig()` returns `{ budget: null }`; every panel renders its existing "no budget set" state, same as today |
| Two rapid `PUT /api/config` calls (user double-clicks Save) | Last-write-wins on the single local file — acceptable for a single-user local app (no lock needed, consistent with how `local.json`/`config.json` are described in architecture §10) |
| Fewer than 3 days of MTD data (start of month) | `forecast.ts`'s `computeForecast` returns `projectedEndOfMonth: null` / null band rather than fabricating a wild single-day extrapolation — panel shows "not enough data yet" |
| Hour-grain query returns zero calls for the filtered range | `hourWeekdayBuckets.ts` returns an all-zero 7×24 grid (heatmap renders, just uniformly empty) — never throws on an empty `Series[]`, matching `bucketRows`'s existing empty-input contract |
| Config file manually edited to invalid JSON | `readConfig()` catches the parse error and falls back to the default, same as a missing file — never crashes the server |

### Backward — regression risk per touched area

| Touched area | What could regress | How we'd know / mitigation |
|---|---|---|
| `BurnRateCard.tsx` (unchanged code, newly-real prop) | Its "over budget" red styling or progress-bar math was never exercised against a real, changing `budget` value in production before | Existing unit tests already cover both branches with an injected `budget` prop; Cypress `trends.cy.ts` + a Dashboard smoke assertion confirm the wired value renders correctly end-to-end |
| `Chart.tsx` (additive ECharts registrations) | Bundle size growth, or a name collision between newly-registered `HeatmapChart`/`CalendarComponent` and any existing series/component names | `npm run build` bundle output + existing `Chart.test.tsx` continuing to pass confirms no regression; ECharts component/series names are namespaced by the library, collision risk is effectively nil |

## Open Questions

- Exact shape of the forecast confidence band (day-over-day variance vs. a fixed percentage band) isn't pinned down precisely.
  - **Impact if unresolved:** Cosmetic only — affects how tight/loose the shaded band looks, not the linear/EWMA point projection itself.
  - **Suggested default:** ± 1 standard deviation of daily spend deltas over the MTD window, floor at ±5% of the projected value so a near-zero-variance start-of-month doesn't render an invisible band.
- Whether the Rolling Efficiency panel's "cache trend" sub-view needs its own unit toggle or always displays as `%`.
  - **Impact if unresolved:** Minor UX detail.
  - **Suggested default:** Always `%` (cache-hit rate is inherently a percentage; no unit-toggle needed for that sub-view, matching the mockup's plain percentage-style line).

## Out of Scope

- Full Settings page config editor (pricing table, scan roots, gate/anomaly thresholds, saved views, tags) — owned entirely by #P4-15, which extends this task's config seam.
- Real gate pass-rate data — owned by #P4-12 (gates engine); this task ships an honest stub only.
- A dedicated new `AnomalyFeedItem` kind for budget alerts — deliberately rejected in favor of reusing `BurnRateCard`'s existing over-budget state (A6).
- Hostname/multi-host labeling for the heatmap's host dimension (⚑N item, deferred per pages-spec legend) — not touched by this task.

---

# Tasks

_This section is populated by the **generate-tasks** skill (Phase 3)._
_Run: `/generate-tasks from: specs/architecture/ARCH-trends-calendar-budget.md`_
