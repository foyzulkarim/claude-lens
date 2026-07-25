# Architecture: Reconcile Dashboard Token Visualizations

> **Date:** 2026-07-25
> **Issue:** #122
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Standalone brief — see Inferred Requirements (`specs/context/122.md`)
> **Type:** fix

## Architecture Summary

This is a client-side presentation correction over the existing metrics API and four existing token
measures. The shared client unit mapping will define `tokens` as input, output, cache creation, and
cache reads; Dashboard token charts will render those series as a stack, while the Total-tokens tile
will explain the dominant cache-read share. The same semantic correction will flow into the Trends
calendar, whose chart projection will sum all returned token series per day. No server, shared
contract, persistence, dependency, authentication, or migration change is required.

## Inferred Requirements (if Mode B / no REQ)

| ID | Inferred Requirement | Source |
|---|---|---|
| R1 | Every UI labeled “tokens” represents input, output, cache-creation, and cache-read tokens unless it explicitly names a narrower measure. | Issue #122 Expected vs actual and approved fix 1 |
| R2 | The Dashboard tokens-mode chart must make token composition legible and its stacked top edge must reconcile with the Total-tokens tile for the same range and filters. | Issue #122 Symptom and Expected vs actual |
| R3 | The Total-tokens tile must explain cache-read dominance without redefining the existing Cache-hit-% metric. | Issue #122 approved fix 4 |
| R4 | Chart and tile accessibility representations must expose the same measure identity and explanatory text as the visual UI. | Issue #122 root cause and approved fixes 3–4 |
| R5 | Trends calendar tokens mode must show total token volume per day rather than only the first returned measure. | Issue #122 latent issue (b) and approved fix 5 |
| R6 | Existing metrics measures and API contracts must be reused without expanding `shared/metrics-contract.ts`. | Issue #122 approved fix 6 |

## High-Level Structure

```text
Dashboard ChartCard
  tokens toggle
    -> client/src/charts/units.ts: UNIT_MEASURES.tokens
    -> POST /api/metrics with four ordered measures
    -> existing Series[] response
       -> client/src/charts/timeseries.ts
          -> canonical measure-aware series names
          -> stacked area/bar ECharts option
       -> client/src/charts/ChartCard.tsx
          -> canonical measure-aware bucket keys
          -> visible, keyboard-operable DataTable columns

Dashboard StatCardsRow
  existing four-measure POST /api/metrics
    -> existing all-token combined total
    -> cache-read total / all-token total
    -> Total tokens value + guarded “NN% cache reads” sub-line

Trends CalendarHeatmapPanel
  UNIT_MEASURES.tokens
    -> POST /api/metrics with the same four measures
    -> client/src/charts/calendar.ts
       -> sum all finite series values by day
       -> one total-tokens heatmap value per day
```

All aggregation of raw transcript records remains in `server/metrics/engine.ts`. The client only
projects already-aggregated `Series[]` into display semantics.

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|---|---|---|---|
| Computation boundary | Correct token semantics in existing client projections | Add a server-side `totalTokens` measure; add a dedicated endpoint | The four measures already exist, are already aggregatable, and composition is required; a composite server measure would expand the public contract and hide composition. |
| Chart rendering | Reuse ECharts stack support through `buildTimeseriesOption` | Build a custom chart; pre-sum into one series | Existing rendering already supports stack groups and legends; preserving four series makes cache dominance legible. |
| Data fetching/state | Keep TanStack Query and existing query-key construction | Add local fetch orchestration or cached derived state | Existing query keys, cancellation, pending/error handling, and WebSocket invalidation already cover these requests. |
| Display aggregation | Use pure client projections over `Series[]` | Mutate API responses; add server transforms | Matches existing `timeseries.ts`, `calendar.ts`, and `series-math.ts` conventions and keeps rendering math deterministic. |
| Dependencies | Add none | Introduce a chart-data transformation library | The operations are bounded four-series sums and naming; another dependency adds no useful capability. |
| Storage | Add none | Persist a derived token total or cache share | Both values are range/filter-dependent and already available from metrics responses. |

## Patterns & Conventions

- **Single source of unit semantics** — `UNIT_MEASURES` remains the authoritative mapping used by
  shared chart consumers; page-specific exceptions must continue to opt out explicitly.
- **Smart container, pure projection** — React components own control/query state; chart modules
  receive `Series[]` and return ECharts options without fetching or navigation side effects.
- **Canonical display identity** — the same `seriesName` function names ECharts series and
  non-canvas table columns, preventing visual/accessibility drift.
- **Accessible twin** — ChartCard’s DataTable remains the keyboard-operable equivalent of canvas
  buckets, and DrillStatCard’s wrapping link includes descendant explanatory text in its explicit
  accessible name.
- **Guarded derived ratios** — cache-read share is emitted only for a positive all-token denominator;
  the existing Cache-hit-% formula remains separate because it answers a different question.
- **Strict TypeScript and ESM** — changes follow repository conventions, remain in `client/`, and do
  not introduce a second chart or formatting abstraction.

## Data Models

No persistent model or shared public type is added. The design uses the existing `Series` response
and `BucketRow` client projection.

### Metrics Series

**Purpose:** Represents one aggregated measure/group combination returned by `/api/metrics`.

**Key fields:**

| Field | Type / Constraint | Notes |
|---|---|---|
| `measure` | existing `Measure`, required | Identifies input, output, cache-create, or cache-read semantics. |
| `dimensionKey` | string, required | Identifies the time/group dimension; it is not a measure display label. |
| `label` | string, required | Group label such as `All`; may collide across measures. |
| `points` | ordered `SeriesPoint[]`, required | Server-produced buckets for the selected range/grain. |
| `compareGhost` | `SeriesPoint[]`, optional | Previous-period absolute values; excluded from stacked rendering. |

**Relationships:**
- One metrics query returns one series per requested measure and group.
- The engine emits measure groups in `query.measures` order and aligns bucket positions within a
  query.

**Lifecycle:**
- Produced by the existing metrics engine → cached by TanStack Query → projected into chart/table
  options → replaced when the query key changes.

### Chart Bucket Projection

**Purpose:** Provides one non-canvas row per timestamp for summaries and the ChartCard data table.

**Key fields:**

| Field | Type / Constraint | Notes |
|---|---|---|
| `t` | ISO timestamp string, required | Stable row/drill identity. |
| `values` | record of display name to number/null/undefined | Keys use canonical measure-aware `seriesName`, not the colliding group label. |

**Relationships:**
- Many `Series.points` entries at the same timestamp fold into one `BucketRow`.

**Lifecycle:**
- Derived in memory from the current `Series[]`; never persisted or sent across a boundary.

### Token Display Composition

**Purpose:** Defines the semantic content and order of the client `tokens` unit without introducing a
new runtime entity.

**Key fields:**

| Field | Type / Constraint | Notes |
|---|---|---|
| measures | ordered existing `Measure[]` | Input, output, cache-create, cache-read. |
| stacked | tokens-mode ChartCard only | Applies to area and bar families; never plain lines. |
| cache-read share | optional derived percentage | `cacheRead / (input + output + cacheCreate + cacheRead)`; absent for zero total. |

**Relationships:**
- The same ordered measure mapping feeds Dashboard ChartCard and Trends CalendarHeatmapPanel.
- StatCardsRow independently requests the same four measures and remains the tile’s source.

**Lifecycle:**
- Derived for the active range/filter response and discarded when that response changes.

## API Contracts / Interfaces

### Metrics HTTP API

**Boundary:** Existing HTTP API; unchanged.

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| POST | `/api/metrics` with existing `SeriesMetricsQuery` | Aggregate selected measures by time/range/filter | Existing validation/error responses; success remains `Series[]`. |

**Auth requirements:** Unchanged; no new authorization decision is introduced.

### Unit Mapping

**Boundary:** Internal client module.

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| lookup | `UNIT_MEASURES[unit]` | Select existing measures for a display unit | Returns the ordered measure array; no runtime error path. |

**Auth requirements:** Not applicable.

### Timeseries Projection

**Boundary:** Internal pure library API.

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| name | `seriesName(series: Series, distinctMeasureCount: number): string` | Produce one canonical group/measure display name | Returns group label for a single measure; includes measure label for multi-measure data. |
| project | `buildTimeseriesOption(series: Series[], options: BuildTimeseriesOptions): TimeseriesOption` | Build area, bar, or line options with optional stacking | Returns a valid empty option for empty input; preserves null chart gaps. |

**Auth requirements:** Not applicable.

`BuildTimeseriesOptions.stacked` defaults to false. When true it assigns the shared `total` stack to
bar and filled-area primary series, never to plain lines, and prevents compare-ghost overlays.

### ChartCard Bucket Projection

**Boundary:** Internal client component helper.

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| pivot | `bucketRows(data: Series[] | undefined): BucketRow[]` | Create timestamp rows for summaries and the accessible table | Empty/undefined data returns an empty array; sparse series remain explicit. |

**Auth requirements:** Not applicable.

### Calendar Projection

**Boundary:** Internal pure library API.

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| project | `buildCalendarHeatmapOption(series: Series[], options: BuildCalendarHeatmapOptions): CalendarHeatmapOption` | Produce one calendar value per day by summing all returned measures | Empty input returns a valid empty-data option; non-finite/absent values follow the existing zero-for-display aggregation convention. |

**Auth requirements:** Not applicable.

### DrillStatCard

**Boundary:** Private Dashboard component interface.

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| render | `DrillStatCardProps` with optional `sub` | Pass explanatory secondary text into `StatCard` and the wrapping Link accessible name | Omitted `sub` preserves current rendering and accessible-name shape. |

**Auth requirements:** Not applicable.

## Module Boundaries

| Module / Package | Responsibility | Allowed Dependencies |
|---|---|---|
| `client/src/charts/units.ts` | Display-unit semantics, measure labels, value formatting | Shared metrics types only. |
| `client/src/charts/timeseries.ts` | Pure `Series[]` to ECharts timeseries projection and canonical series naming | ECharts types, shared metrics types, chart unit helpers. |
| `client/src/charts/ChartCard.tsx` | Chart controls, query orchestration, summaries, navigation, accessible table | Existing client API/query/filter/chart/component modules; no server internals. |
| `client/src/charts/calendar.ts` | Pure all-series daily calendar projection | ECharts types, shared metrics types, existing series math/unit helpers. |
| `client/src/pages/dashboard/StatCardsRow.tsx` | Dashboard tile queries and page-specific derived values/links | Existing API/query/filter/stat-card modules; no chart rendering internals. |
| `server/metrics/engine.ts` | Raw-scope aggregation, bucket alignment, requested-measure ordering | Remains unchanged and unaware of client display units. |
| `shared/metrics-contract.ts` | Public query/response measure contract | Remains unchanged; client display concepts do not cross this boundary. |

## Change Footprint

_The concrete answer to “where does this land in the codebase?” — produced during the Phase D2 walk._

### New files / modules

| Path | Purpose | Pattern reference |
|---|---|---|
| `client/src/pages/dashboard/StatCardsRow.test.tsx` | Focused component coverage for the Total-tokens explanatory sub-line and zero-total guard. | Existing Dashboard React Testing Library tests and `StatCardsRow.stories.tsx` fetch fixtures. |

### Modified files / modules

| Path | What changes here |
|---|---|
| `client/src/charts/units.ts` | Expand `UNIT_MEASURES.tokens` to the four ordered token measures and remove obsolete input/output-only rationale. |
| `client/src/charts/timeseries.ts` | Export canonical `seriesName`, extend stacking to filled areas, keep lines unstacked, and omit compare ghosts while stacked. |
| `client/src/charts/ChartCard.tsx` | Enable stacking only for tokens mode and use canonical series names in bucket pivots and column identity. |
| `client/src/pages/dashboard/StatCardsRow.tsx` | Pass optional `sub` through DrillStatCard, include it in the explicit link accessible name, and render guarded cache-read share on Total tokens. |
| `client/src/charts/calendar.ts` | Replace first-series-only projection with all-series daily summation and update option naming/documentation. |
| `client/src/charts/timeseries.test.ts` | Update the token-unit contract and shared rendering-invariant coverage. |
| `client/src/charts/ChartCard.test.tsx` | Update four-measure query expectations and cover tokens stacking plus measure-aware data-table identity. |
| `client/src/charts/calendar.test.ts` | Cover the all-series daily aggregation contract. |
| `client/src/pages/trends/CalendarHeatmapPanel.test.tsx` | Update the tokens-mode query contract to four measures. |

### Deleted / replaced

| Path | Reason |
|---|---|
| None | The correction extends existing client projections; no module or compatibility shim is replaced. |

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|---|---|
| `shared/metrics-contract.ts` | Already declares all four measures and the `Series[]` contract; expanding it would violate R6. |
| `server/metrics/engine.ts` | Its requested-measure order and aligned time buckets determine stack order and daily reconciliation. |
| `client/src/components/StatCard.tsx` | Already owns visible `sub` rendering; only the private wrapper must pass it through. |
| `client/src/pages/trends/CalendarHeatmapPanel.tsx` | Uses `UNIT_MEASURES`, so its tokens query changes without a production edit. |
| `client/src/pages/models/ModelMixOverTime.tsx` | Explicitly requests only `outputTokens` in tokens mode and must retain that page-specific model-mix meaning. |
| `client/src/pages/cache-lab/HitRatePanel.tsx` | Calls `bucketRows`; its single-measure names must remain unchanged after canonical naming is shared. |
| `client/src/pages/explore/PivotResult.tsx` | Calls the shared timeseries builder without stacking; area/line/bar behavior must remain unchanged. |
| `client/src/pages/sessions/CostDistributionCard.tsx` | Calls the shared timeseries builder without stacking; its bars must remain unstacked. |
| `client/src/pages/trends/GatePassRatePanel.tsx` | Calls the shared timeseries builder without stacking; its area chart must remain unchanged. |
| `client/src/pages/trends/RollingEfficiencyPanel.tsx` | Calls the shared timeseries builder for currency and token line/area displays; default behavior must remain unchanged. |
| `client/src/pages/trends/StackedWeeklyBarsPanel.tsx` | The sole existing `stacked: true` caller must retain stacked bars and currently requests no comparison ghost. |
| `client/src/charts/ChartCard.stories.tsx` | Story fetch fixtures exercise ChartCard query/render states and may reveal an accidental request-shape assumption. |
| `client/src/pages/dashboard/StatCardsRow.stories.tsx` | Existing four-measure fixtures must continue rendering all five cards after the sub-line addition. |
| `client/src/pages/trends/CalendarHeatmapPanel.stories.tsx` | Calendar stories must remain valid when tokens mode requests four series. |
| `cypress/e2e/dashboard.cy.ts` | Dashboard user journey covers the affected chart and stat-row surface. |
| `cypress/e2e/trends.cy.ts` | Trends user journey covers the affected calendar surface. |

## Areas of Impact

_Broader-than-files impact — modules, services, teams, contracts, cross-cutting effects._

| Area | Impact | Risk (L/M/H) | Why |
|---|---|---|---|
| Client token-unit semantics | Shared token mapping changes Dashboard ChartCard and Trends calendar requests from two measures to four. | H | This is the intentional semantic correction and affects every consumer that does not explicitly override the mapping. |
| Shared timeseries rendering | `stacked` gains area semantics and compare-ghost suppression. | M | The builder has several page consumers, but default-false and family-specific rules contain the ripple. |
| ChartCard non-canvas representation | Multi-measure rows/columns use canonical group-plus-measure names. | M | Fixes a silent last-write-wins collision; single-measure consumers must preserve current names. |
| Dashboard Total-tokens tile | Adds one derived explanatory sub-line and accessible-name segment. | L | Uses already-fetched values and does not alter the tile total, link, or delta. |
| Trends calendar | Tokens intensity becomes all-token volume instead of input-only volume. | M | Correct visible values change materially; currency remains a one-series equivalent. |
| Metrics server and shared API | No implementation or contract change. | L | Regression is limited to violating existing ordering/alignment assumptions, not a deployed interface migration. |
| Accessibility | Table headers and token-card accessible name gain missing semantic detail. | M | Explicit anchor labels override descendant text, so pass-through must remain synchronized. |

**Contract changes:** No external HTTP response, event payload, storage schema, or exported shared type
changes. The internal client display contract for `Unit = "tokens"` changes from two measures to four,
and `BuildTimeseriesOptions.stacked` broadens from bars-only to bars-and-area semantics. Existing
client consumers are mapped in the footprint above.

**Cross-cutting ripples:** Accessibility output changes intentionally. Authentication, telemetry,
feature flags, ingest, persistence, build tooling, and deployment shape do not change. Token-mode
requests carry two additional existing series.

## Cross-Cutting Concerns

- **Errors:** Existing TanStack Query pending/error propagation remains authoritative. Pure chart
  projections continue returning valid options for empty input; no catch, retry, fallback request, or
  partial-total path is added.
- **Logging & metrics:** No logging or operational metric is added because no new runtime boundary or
  failure mode is introduced.
- **Auth / authz:** Unchanged; the existing metrics route receives only predeclared measures through
  the same validated query contract.
- **Performance:** Token responses grow from two to four bounded bucket series. Client projection is
  O(4 × bucket count), while raw transcript growth remains server-side behind range/grain aggregation.
- **Security:** No new input surface, secret, persistence, or data classification. Existing metrics
  query validation remains the trust boundary.
- **Migrations / rollout:** Ship as one client-bundle cutover. There is no migration, compatibility
  window, or feature flag; rollback is a code revert and redeploy.

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies REQs |
|---|---|---|---|---|
| A1 | Correct token semantics in client projections while retaining the existing metrics API. | Add `totalTokens`; add a dedicated endpoint. | Existing measures already provide exact data, and preserving them exposes composition without contract expansion. | R1, R2, R6 |
| A2 | Define tokens as ordered input, output, cache-create, cache-read measures. | Keep input/output and relabel; pre-sum one series. | The four measures reconcile with the tile, while order produces a legible stack with dominant cache reads on top. | R1, R2, R5 |
| A3 | Stack token areas and bars; never stack lines; omit compare ghosts while stacked. | Keep series unstacked; stack or overlay previous-period values. | A cumulative top edge communicates the total; absolute ghosts over cumulative bands have incompatible magnitude semantics. | R2 |
| A4 | Reuse exported `seriesName` for both ECharts and ChartCard bucket/column identity. | Key by group label; key by dimension key. | Group labels collide across measures and dimension keys do not identify the measure. | R2, R4 |
| A5 | Derive and display whole-percent cache-read share over all four token measures, omitted at zero total. | Reuse Cache-hit-%; show no explanation. | This denominator explains the Total-tokens composition directly and avoids invalid zero-range output. | R3, R4 |
| A6 | Sum all returned calendar series per date using existing display-aggregation semantics. | Read `series[0]`; add a backend composite. | It makes tokens mode correct under A2 without creating a new API concept. | R1, R5, R6 |
| A7 | Add no dependencies, storage, auth, telemetry, migration, or feature flag. | Introduce new infrastructure or a staged rollout. | The change is deterministic client projection over existing bounded responses and is directly reversible. | R6 |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|---|---|
| Metrics API is unavailable for 30 seconds. | Existing pending/error UI remains authoritative. No derived sub-line or fabricated partial total is emitted without a successful response. |
| A user toggles unit/family/compare controls rapidly. | Existing TanStack query keys isolate measure sets and cancellation; stacking is derived from the active unit, and no resource-creation race exists in this read-only flow. |
| A bucket contains null, absent, or non-finite values. | Timeseries preserves null chart gaps; calendar uses the established zero-for-display summation convention; zero all-token total omits the percentage sub-line. |
| Raw transcript history grows from 10K to 10M records. | Server-side range/grain aggregation still bounds the response; the client processes at most four token series per group and does not scan raw records. |
| Cache reads dominate by roughly 95%. | The cache-read series remains the top stack band, the cumulative edge still equals the all-token total, and the tile sub-line states the share explicitly. |
| The release must be rolled back. | Revert and redeploy the client bundle; no data, schema, API, or compatibility cleanup is required. |

### Backward — regression risk per touched area (brownfield only)

| Touched area (from Change Footprint) | What could regress | How we'd know / mitigation |
|---|---|---|
| `client/src/charts/units.ts` consumers | An output-only page could accidentally begin requesting all token measures. | `ModelMixOverTime.tsx` retains its explicit output-only branch; mapped consumers are limited to ChartCard and CalendarHeatmapPanel. |
| `client/src/charts/timeseries.ts` consumers | Non-token areas/bars could become stacked, lines could gain stack metadata, or existing weekly bars could lose stacking. | `stacked` remains default-false, lines explicitly ignore it, and the existing weekly caller continues opting in. |
| `client/src/charts/ChartCard.tsx` | Single-measure labels or table drill behavior could change while fixing multi-measure collisions. | Canonical naming returns the original label when distinct-measure count is one; row timestamp and drill mapping are untouched. |
| `client/src/pages/dashboard/StatCardsRow.tsx` | Cache-hit percentage could be conflated with cache-read share, or the explicit link name could omit visible text. | The two formulas remain separate; `sub` is passed to both StatCard and Link naming from one derived string. |
| `client/src/charts/calendar.ts` | Currency mode could change or sparse input could throw. | One-series summation is equivalent to the old currency path; empty input still returns a valid option. |
| `shared/metrics-contract.ts` / `server/metrics/engine.ts` | An accidental contract edit or changed series order could break reconciliation/stack order. | Both files are explicitly no-change hotspots; the client requests only existing measures in the confirmed order. |
| Stories and Dashboard/Trends Cypress journeys | Fixture assumptions could mask missing series or visual drift. | Existing stories/journeys remain regression surfaces; changed observable contracts are covered in the colocated chart/component test modules listed above. |

## Open Questions

- None.

## Out of Scope

- Adding a server-side `totalTokens` measure or changing the metrics response contract (reason: all
  required measures and bucket aggregation already exist).
- Unifying cache-read share with Cache-hit-% (reason: their denominators and user questions are
  intentionally different).
- Changing Models page output-token mix semantics (reason: it is an explicit page-specific override,
  not a generic tokens total).
- Reworking ingest, deduplication, or token arithmetic (reason: the issue investigation verified the
  existing data bucket-for-bucket).
- Designing a cumulative previous-period comparison for stacked token composition (reason: current
  approved behavior suppresses the misleading absolute ghost rather than inventing a new comparison
  visualization).

---

# Tasks

_Generated 2026-07-25 from this document's Change Footprint and Areas of Impact._

**Task order and dependencies:** T1 → T2 (hard: T2 consumes the `seriesName` export T1
introduces). T3 and T4 are independent of every other task.

**Green-tree note:** T1 changes `UNIT_MEASURES.tokens`, which immediately breaks the
existing two-measure expectations in `ChartCard.test.tsx` and `CalendarHeatmapPanel.test.tsx`.
Those two fixture-line updates belong to **T1** so `npm run verify` passes on every commit;
T2 and T3 add their new behavioral cases to the same files afterwards.

## Task T1: Define the tokens unit as four measures and stack filled areas

> **Status:** done
> **Verification:** tdd
> **Effort:** m
> **Priority:** critical
> **Depends on:** None
> **Satisfies REQs:** R1, R2, R6
> **Footprint slice:** Modified: `client/src/charts/units.ts` (four ordered token measures), `client/src/charts/timeseries.ts` (export `seriesName`, area stacking, lines never stack, ghost suppression), `client/src/charts/timeseries.test.ts`; plus the two-measure expectation lines in `client/src/charts/ChartCard.test.tsx` and `client/src/pages/trends/CalendarHeatmapPanel.test.tsx`
> **High-risk areas touched:** Client token-unit semantics (H), Shared timeseries rendering (M)

### Description

Redefines the client's `tokens` display unit from `inputTokens + outputTokens` to all four
token measures, in the order that makes the dominant cache-read band render on top of the
stack. Extends the shared timeseries builder so a filled-area chart can stack (previously
bars-only), never stacks plain lines, and suppresses the absolute previous-period ghost while
stacked — a cumulative top edge and an absolute overlay have incompatible magnitude semantics.
This is the semantic pivot the other three tasks build on; the rendering contract lands here so
`ChartCard` (T2) has something correct to call.

### Test Plan

#### Test File(s)
- `client/src/charts/timeseries.test.ts` (extend — new stacking/ghost/naming cases)
- `client/src/charts/ChartCard.test.tsx` (fixture-line update only: the tokens-mode measures expectation at "unit toggle requeries with the mapped measure(s)")
- `client/src/pages/trends/CalendarHeatmapPanel.test.tsx` (fixture-line update only: the tokens-mode `measures` expectation)

#### Test Scenarios

##### Token unit mapping

- **tokens maps to all four token measures in stack order** — GIVEN the `UNIT_MEASURES` table WHEN `tokens` is read THEN it equals `["inputTokens", "outputTokens", "cacheCreateTokens", "cacheReadTokens"]` in exactly that order _(verifies R1; order is stack order per A2 — the engine emits series in `query.measures` order)_
- **`$` and `calls` mappings are untouched** — GIVEN the `UNIT_MEASURES` table WHEN `$` and `calls` are read THEN they remain `["costComputed"]` and `["apiCalls"]` _(verifies R6 — no measure is added or removed outside `tokens`)_

##### Canonical series naming

- **`seriesName` is exported for cross-module reuse** — GIVEN `timeseries.ts` WHEN the module is imported THEN `seriesName` is a public export callable with `(series, distinctMeasureCount)` _(verifies R4; required by T2 and decision A4)_
- **single-measure naming returns the bare group label** — GIVEN one series labeled `All` and a distinct-measure count of 1 WHEN named THEN the result is exactly `All`, with no measure suffix _(verifies R2; guards ARCH backward-regression risk for `client/src/pages/cache-lab/HitRatePanel.tsx`)_
- **multi-measure naming folds in the measure label** — GIVEN four token series that all share the group label `All` WHEN named with a distinct-measure count of 4 THEN each name is the distinct measure label _(verifies R2, R4)_

##### Stacking by family

- **stacked area keeps its fill and joins one shared stack** — GIVEN four token series WHEN built with `family: "area", stacked: true` THEN every primary series carries `stack: "total"` **and** retains `areaStyle` _(verifies R2, A3)_
- **lines never stack** — GIVEN the same series WHEN built with `family: "lines", stacked: true` THEN no emitted series carries a `stack` property _(verifies A3)_
- **bars still stack** — GIVEN two series WHEN built with `family: "bars", stacked: true` THEN both carry `stack: "total"` _(guards ARCH backward-regression risk for `client/src/pages/trends/StackedWeeklyBarsPanel.tsx`, the sole existing opt-in caller)_
- **`stacked` defaults to false across all three families** — GIVEN any series WHEN built with no `stacked` option THEN no series in any family carries a `stack` property _(guards ARCH backward-regression risk for `client/src/pages/explore/PivotResult.tsx`, `client/src/pages/sessions/CostDistributionCard.tsx`, `client/src/pages/trends/GatePassRatePanel.tsx`, `client/src/pages/trends/RollingEfficiencyPanel.tsx`)_

##### Compare ghost under stacking

- **ghost overlay is omitted while stacked** — GIVEN a series carrying a `compareGhost` WHEN built with `stacked: true` THEN no `(previous period)` series is emitted _(verifies R2, A3)_
- **ghost overlay survives when unstacked** — GIVEN the same series WHEN built with `stacked` absent or false THEN the dashed `(previous period)` series is emitted exactly as today _(guards ARCH backward-regression risk for every existing compare-enabled caller)_

##### Edge and null handling

- **null points remain gaps under stacking** — GIVEN a series with a null point WHEN built stacked THEN that point is still `null`, never coerced to 0 _(verifies REQ edge case; matches the engine's never-fabricate-0 convention)_
- **empty input still returns a renderable option while stacked** — GIVEN `series: []` WHEN built with `stacked: true` THEN a valid option with an empty `series` array is returned and nothing throws _(verifies REQ edge case)_

### Implementation Notes

- **Module(s):** `client/src/charts/units.ts`, `client/src/charts/timeseries.ts` (Module Boundaries table).
- **Pattern reference:** `timeseries.ts`'s existing `stacked` handling for the bars family — extend the same `...(stacked ? { stack: "total" } : {})` spread to the area branch rather than introducing a second mechanism. Existing `seriesName` is already written; this task only promotes it to an export and adds the area/ghost rules around it.
- **Key decisions:** A1 (client-side correction only), A2 (four ordered measures), A3 (stack areas and bars, never lines; omit ghosts while stacked), A4 (one canonical naming function for both ECharts and table identity).
- **Libraries:** none added (A7). ECharts types already imported in-module; no `echarts-for-react`.
- **High-risk callouts:**
  - *Client token-unit semantics (H)* — `UNIT_MEASURES` is shared, so this edit silently changes every non-overriding consumer. Only `ChartCard` and `CalendarHeatmapPanel` read it for tokens; `ModelMixOverTime.tsx` keeps its explicit output-only branch and must not be edited. The two fixture-line updates in this task's file list are exactly the mapped consumers surfacing.
  - *Shared timeseries rendering (M)* — the builder has six-plus call sites. `stacked` staying default-false plus the explicit bars/lines/default guards above is what contains the ripple; do not make stacking implicit for the area family.
- Update the now-obsolete `UNIT_MEASURES.tokens` comment (which cites an archived "ARCH Open Questions, resolved default" for input+output-only) and the `BuildTimeseriesOptions.stacked` doc comment (currently says bars-only, ignored for area) so neither documents the old contract.

### Scope Boundaries

- Do NOT add a server-side `totalTokens` measure or otherwise edit `shared/metrics-contract.ts` (ARCH Out of Scope; R6 — `MEASURES` is pinned to 19 in its own test).
- Do NOT change `ModelMixOverTime.tsx`'s output-token mix semantics (ARCH Out of Scope — it is an explicit page-specific override).
- Do NOT design a cumulative previous-period comparison for stacked composition (ARCH Out of Scope — the approved behavior is suppression, not a new comparison visualization).
- Do NOT touch `ChartCard.tsx`, `calendar.ts`, or `StatCardsRow.tsx` — those are T2, T3, and T4.
- Only implement the unit mapping and the builder's stacking/naming/ghost rules; consumer wiring is downstream.

### Files Expected

**New files:** _(from ARCH "New files / modules")_
- None.

**Modified files:** _(from ARCH "Modified files / modules")_
- `client/src/charts/units.ts` (expand `UNIT_MEASURES.tokens` to the four ordered token measures; remove the obsolete input/output-only rationale)
- `client/src/charts/timeseries.ts` (export canonical `seriesName`, extend stacking to filled areas, keep lines unstacked, omit compare ghosts while stacked)
- `client/src/charts/timeseries.test.ts` (update the token-unit contract and shared rendering-invariant coverage)
- `client/src/charts/ChartCard.test.tsx` (fixture line only — the tokens-mode measures expectation; behavioral cases belong to T2)
- `client/src/pages/trends/CalendarHeatmapPanel.test.tsx` (fixture line only — the tokens-mode `measures` expectation; T3 owns the projection behavior)

**Must NOT modify:** _(from ARCH "Touched but not changed", plus task-scoped boundaries)_
- `shared/metrics-contract.ts` (silent-regression hotspot — R6; already declares all four measures)
- `server/metrics/engine.ts` (silent-regression hotspot — its requested-measure order is what makes the stack order correct)
- `client/src/pages/models/ModelMixOverTime.tsx` (must retain its explicit output-only tokens branch)
- `client/src/pages/trends/StackedWeeklyBarsPanel.tsx` (covered by the bars-still-stack guard above)
- `client/src/pages/explore/PivotResult.tsx`, `client/src/pages/sessions/CostDistributionCard.tsx`, `client/src/pages/trends/GatePassRatePanel.tsx`, `client/src/pages/trends/RollingEfficiencyPanel.tsx` (unstacked callers — covered by the default-false guard above)

### TDD Sequence

1. `UNIT_MEASURES.tokens` mapping (the pivot — expect the two downstream fixture lines to go red here; fix them in the same commit).
2. `seriesName` export + single/multi-measure naming.
3. Area stacking, then the lines-never-stack and bars-still-stack guards, then default-false.
4. Ghost suppression under stacking, then the unstacked-ghost regression guard.
5. Null/empty edge cases last.

---

## Task T2: Stack the Dashboard tokens chart and fix its data-table column collision

> **Status:** done
> **Verification:** tdd
> **Effort:** s
> **Priority:** critical
> **Depends on:** T1
> **Satisfies REQs:** R1, R2, R4
> **Footprint slice:** Modified: `client/src/charts/ChartCard.tsx` (stack in tokens mode; canonical measure-aware bucket/column identity), `client/src/charts/ChartCard.test.tsx` (four-measure query, tokens stacking, measure-aware table identity)
> **High-risk areas touched:** ChartCard non-canvas representation (M), Client token-unit semantics (H)

### Description

Wires the Dashboard chart card to T1's contract: tokens mode opts into stacking (so the
cumulative top edge reconciles with the Total-tokens tile), while the single-measure `$` and
`calls` modes stay unstacked. Also fixes the latent last-write-wins bug where `bucketRows` keys
each bucket's values by the *group* label — with four token series all labeled `All`, the
accessible data table collapsed them into one column showing only the last-written measure.
Re-keying on T1's canonical `seriesName` gives the table one honest column per measure.

### Test Plan

#### Test File(s)
- `client/src/charts/ChartCard.test.tsx` (extend — new stacking and table-identity cases)

#### Test Scenarios

##### Tokens-mode query contract

- **tokens toggle requests all four measures in mapping order** — GIVEN a rendered ChartCard WHEN the `tokens` unit toggle is clicked THEN the last `postMetrics` call's `measures` equals `UNIT_MEASURES.tokens`, in order _(verifies R1)_
- **`$` and `calls` toggles keep their single measure** — GIVEN a rendered ChartCard WHEN `$` then `calls` is selected THEN each query carries exactly one measure _(guards ARCH backward-regression risk for the unit toggle's existing behavior)_

##### Tokens-mode stacking

- **tokens mode builds a stacked chart** — GIVEN a four-measure tokens response WHEN the chart option is built THEN the primary series carry a shared stack _(verifies R2)_
- **`$` mode builds an unstacked chart** — GIVEN a single-measure `$` response WHEN the chart option is built THEN no series carries a stack _(verifies R2; stacking is derived from the active unit, not latched)_
- **family toggle does not change stacking within tokens mode** — GIVEN tokens mode WHEN the family is toggled from area to bars THEN both families are stacked and no refetch occurs _(guards the existing display-only family contract)_

##### Non-canvas representation

- **four token series produce four distinct table columns** — GIVEN four series that all share the group label `All` WHEN `bucketRows` pivots them THEN each bucket row holds four separately-keyed values, none overwritten _(verifies R2, R4; fixes the issue's latent bug (a))_
- **column headers name the measure, not the repeated group label** — GIVEN the same four-measure response WHEN the data table is opened THEN four column headers are rendered with the distinct measure names _(verifies R4)_
- **single-measure column keeps its original header text** — GIVEN a one-measure response labeled `All` WHEN the data table is opened THEN the column header is still exactly `All` _(guards ARCH backward-regression risk for `client/src/pages/cache-lab/HitRatePanel.tsx`, which calls `bucketRows` with single-measure data)_
- **a series absent from a bucket stays explicitly absent** — GIVEN a sparse four-measure response WHEN pivoted THEN the missing cell renders the em-dash placeholder rather than a fabricated 0 _(verifies REQ edge case)_

##### Regression guard

- **row identity and drill URL are unchanged after re-keying** — GIVEN a data-table row WHEN its row action is activated THEN it navigates to the same filtered Sessions URL as the matching canvas click _(guards ARCH backward-regression risk for `client/src/charts/ChartCard.tsx`'s drill mapping)_
- **chart aria-label total reflects every fetched series** — GIVEN a four-measure tokens response WHEN the summary is derived THEN the announced total sums all four series _(verifies R4)_
- **stable filters and controls still do not requery on an unrelated re-render** — GIVEN a mounted ChartCard WHEN it re-renders with unchanged filters/controls THEN no additional `postMetrics` call is made _(guards the existing memoized query-identity contract)_

### Implementation Notes

- **Module(s):** `client/src/charts/ChartCard.tsx` (Module Boundaries table — chart controls, query orchestration, summaries, navigation, accessible table).
- **Pattern reference:** the existing `bucketRows` / `seriesLabelsKey` / `buildBucketColumns` trio in `ChartCard.tsx`. `bucketRows` currently writes `row.values[series.label]`; the fix is to key on T1's `seriesName` with the same distinct-measure count the builder computes, and to derive `seriesLabelsKey` from those same canonical names so the memoized column set still rebuilds only when the *name set* changes (not on every refetch — review finding R1's original reason for the joined string key).
- **Key decisions:** A2 (four ordered measures), A3 (stack tokens), A4 (one canonical naming function shared by ECharts and the table).
- **Libraries:** none added. Existing TanStack Query/Table wiring stays as-is (Tech Choices — data fetching/state).
- **High-risk callouts:**
  - *ChartCard non-canvas representation (M)* — canonical naming must return the original label for single-measure data or Cache Lab's hit-rate table silently renames its column; the single-measure header guard above is the specific check.
  - *Client token-unit semantics (H)* — `stacked` must be derived from the active `unit` inside the render path (`unit === "tokens"`), not stored in state, so a rapid unit/family toggle sequence can never leave a `$` chart stacked (ARCH forward stress-test: rapid control toggling).

### Scope Boundaries

- Do NOT re-implement `seriesName` locally — import the export T1 adds (A4; two copies is exactly the drift this decision exists to prevent).
- Do NOT change the drill-down URL mapping, grain/compare/smoothing controls, or the query-key factory.
- Do NOT move chart controls into URL state (they are per-widget display prefs by existing decision A4 of the chart-layer ARCH).
- Do NOT edit `units.ts` or `timeseries.ts` — T1 owns both.
- Only implement the stacking opt-in and the bucket/column identity fix.

### Files Expected

**New files:** _(from ARCH "New files / modules")_
- None.

**Modified files:** _(from ARCH "Modified files / modules")_
- `client/src/charts/ChartCard.tsx` (enable stacking only for tokens mode; use canonical series names in bucket pivots and column identity)
- `client/src/charts/ChartCard.test.tsx` (cover tokens stacking and measure-aware data-table identity; the four-measure fixture line already landed in T1)

**Must NOT modify:** _(from ARCH "Touched but not changed", plus task-scoped boundaries)_
- `client/src/pages/cache-lab/HitRatePanel.tsx` (silent-regression hotspot — single-measure `bucketRows` consumer, covered by the header guard above)
- `client/src/charts/ChartCard.stories.tsx` (story fixtures are a regression surface; they must keep rendering unchanged)
- `client/src/charts/timeseries.ts`, `client/src/charts/units.ts` (T1)
- `shared/metrics-contract.ts`, `server/metrics/engine.ts` (silent-regression hotspots)

### TDD Sequence

1. Tokens-mode four-measure query expectation (already green after T1 — confirm, don't rewrite).
2. `bucketRows` canonical keying + the single-measure header regression guard, before touching column building.
3. `seriesLabelsKey` / column identity, then the no-spurious-requery guard.
4. Stacking opt-in per unit, then the family-toggle and `$`-unstacked guards.

---

## Task T3: Sum every returned series per day in the Trends calendar

> **Status:** done
> **Verification:** tdd
> **Effort:** xs
> **Priority:** high
> **Depends on:** None
> **Satisfies REQs:** R1, R5, R6
> **Footprint slice:** Modified: `client/src/charts/calendar.ts` (all-series daily summation replacing the first-series-only projection), `client/src/charts/calendar.test.ts`
> **High-risk areas touched:** Trends calendar (M)

### Description

`buildCalendarHeatmapOption` currently reads only `series[0]`, which was correct while every
caller requested exactly one measure. Once tokens means four measures, that silently plots
`inputTokens` alone — the same class of bug as the Dashboard chart, on a second surface. This
task sums aligned points across all returned series per day so tokens mode shows real daily
token volume, and leaves currency mode (a single series) value-identical.

### Test Plan

#### Test File(s)
- `client/src/charts/calendar.test.ts` (extend — all-series aggregation cases)

#### Test Scenarios

##### All-series daily aggregation

- **multiple series fold into one value per day** — GIVEN four series with aligned timestamps on the same day WHEN the option is built THEN that day's cell value is the sum of all four points _(verifies R5, A6)_
- **series covering different days each contribute their own cell** — GIVEN two series whose points fall on different dates WHEN the option is built THEN both dates appear with their own summed values and neither is dropped _(verifies R5)_
- **`visualMap.max` derives from summed daily values** — GIVEN multi-series input WHEN the option is built THEN the colour scale's max reflects the largest *summed* day, not the largest single-series point _(verifies R5; a first-series max would wash out the whole calendar)_

##### Regression guard

- **single-series input is value-identical to today's output** — GIVEN one `costComputed` series WHEN the option is built THEN the `[date, value]` pairs match the pre-change projection exactly _(guards ARCH backward-regression risk for `client/src/charts/calendar.ts` currency mode)_
- **calendar range still comes from the requested query range, not the data** — GIVEN a sparse series WHEN the option is built THEN the calendar's range is the caller's explicit `from`/`to` _(guards the existing full-grid contract — a day with no activity is a real 0 cell)_

##### Edge handling

- **null and non-finite points contribute 0 rather than dropping the day** — GIVEN a day whose series points are null WHEN the option is built THEN the day renders an explicit 0 cell _(verifies REQ edge case; follows the existing `pointValue` display-aggregation convention)_
- **empty input returns a valid option without throwing** — GIVEN `series: []` WHEN the option is built THEN an empty-data option with a usable non-inverted `visualMap` range is returned _(verifies REQ edge case)_
- **heatmap series name no longer implies one measure's label** — GIVEN multi-series input WHEN the option is built THEN the series name describes the aggregated unit rather than only the first series' label _(verifies R4)_

### Implementation Notes

- **Module(s):** `client/src/charts/calendar.ts` (Module Boundaries table — pure all-series daily calendar projection).
- **Pattern reference:** `client/src/charts/series-math.ts`'s `pointValue` (already imported here) for the non-finite guard; `StatCardsRow.tsx`'s `combinedSparkline` for the "sum aligned points across a batched-measure response" shape. Buckets align within one query (decision A5), so summation is by date key, not by index gymnastics.
- **Key decisions:** A6 (sum all returned series per date using existing display-aggregation semantics), A1/R6 (no backend composite measure).
- **Libraries:** none added.
- **High-risk callouts:** *Trends calendar (M)* — visible values change materially and intentionally for tokens; the single-series regression guard is what proves currency mode did not move. Update the module doc comment, which currently states the projection reads only the first series.
- The panel itself (`CalendarHeatmapPanel.tsx`) needs no production edit — it reads `UNIT_MEASURES`, so T1 already changed its request shape.

### Scope Boundaries

- Do NOT add a backend composite calendar measure or a new endpoint (ARCH Out of Scope).
- Do NOT change the calendar's range/grid contract, colour ramp, cell size, or drill-through behavior.
- Do NOT edit `CalendarHeatmapPanel.tsx` — the mapping change alone is what redirects its query.
- Only implement the aggregation change and its option naming/documentation.

### Files Expected

**New files:** _(from ARCH "New files / modules")_
- None.

**Modified files:** _(from ARCH "Modified files / modules")_
- `client/src/charts/calendar.ts` (replace first-series-only projection with all-series daily summation; update option naming/documentation)
- `client/src/charts/calendar.test.ts` (cover the all-series daily aggregation contract)

**Must NOT modify:** _(from ARCH "Touched but not changed", plus task-scoped boundaries)_
- `client/src/pages/trends/CalendarHeatmapPanel.tsx` (silent-regression hotspot — changes behavior through `UNIT_MEASURES` with no production edit)
- `client/src/pages/trends/CalendarHeatmapPanel.stories.tsx` (stories must stay valid under four-series tokens mode)
- `shared/metrics-contract.ts`, `server/metrics/engine.ts` (silent-regression hotspots)

---

## Task T4: Explain cache-read dominance on the Total-tokens tile

> **Status:** done
> **Verification:** tdd
> **Effort:** s
> **Priority:** high
> **Depends on:** None
> **Satisfies REQs:** R3, R4
> **Footprint slice:** New: `client/src/pages/dashboard/StatCardsRow.test.tsx`; Modified: `client/src/pages/dashboard/StatCardsRow.tsx` (`sub` pass-through on `DrillStatCard`, guarded cache-read share, accessible-name composition)
> **High-risk areas touched:** Dashboard Total-tokens tile (L), Accessibility (M)

### Description

The Total-tokens tile is numerically correct but unexplained — a reader has no way to know its
millions are ~95% cache reads. This adds a guarded `"NN% cache reads"` sub-line using the
already-fetched four-measure response, threads `StatCard`'s existing `sub` prop through the
private `DrillStatCard` wrapper, and folds that text into the wrapping link's explicit
`aria-label` (an explicit anchor label overrides descendant text, so a visible-only sub-line
would be invisible to screen readers).

### Test Plan

#### Test File(s)
- `client/src/pages/dashboard/StatCardsRow.test.tsx` (new)

#### Test Scenarios

##### Cache-read share sub-line

- **renders the whole-percent cache-read share** — GIVEN a four-measure response whose cache-read volume dominates WHEN the stat row renders THEN the Total-tokens tile shows a `"NN% cache reads"` sub-line computed as `cacheRead / (input + output + cacheCreate + cacheRead)` _(verifies R3, A5)_
- **rounds to a whole percent** — GIVEN a share that is not a whole number WHEN rendered THEN the sub-line carries no decimal places _(verifies R3)_
- **omitted entirely for a zero-token range** — GIVEN a response whose four token series are all zero WHEN the stat row renders THEN no sub-line is rendered at all — no `NaN%`, no `0%` _(verifies REQ edge case, A5's positive-denominator guard)_

##### Accessibility

- **the sub-line is part of the tile's accessible name** — GIVEN a rendered Total-tokens tile with a sub-line WHEN its link's accessible name is read THEN it contains the label, the value, the cache-read share, and the drill target _(verifies R4)_
- **a tile without a sub-line keeps its current accessible-name shape** — GIVEN any of the other four tiles WHEN their link accessible names are read THEN they match today's `"<label>: <value> — view in <target>"` form with no stray separator _(guards ARCH backward-regression risk for `client/src/pages/dashboard/StatCardsRow.tsx`'s link naming)_

##### Regression guard

- **Cache hit % keeps its own separate denominator and value** — GIVEN a response where the two formulas diverge WHEN both tiles render THEN the Cache-hit-% tile's percentage differs from the Total-tokens sub-line and is computed from `cacheRead / (input + cacheRead + cacheCreate)` _(guards ARCH backward-regression risk — the two must not be conflated or "unified")_
- **the tile's total, delta, sparkline, and drill href are unchanged** — GIVEN a four-measure response with a previous period WHEN the Total-tokens tile renders THEN its value, percentage delta, and `/models` link are exactly as before the sub-line was added _(guards the existing tile contract)_
- **all five cards still render** — GIVEN the standard fixture response WHEN the stat row renders THEN five stat cards are present _(guards ARCH backward-regression risk for `client/src/pages/dashboard/StatCardsRow.stories.tsx`)_

### Implementation Notes

- **Module(s):** `client/src/pages/dashboard/StatCardsRow.tsx` (Module Boundaries table — Dashboard tile queries and page-specific derived values/links).
- **Pattern reference:** the existing `safeDivide` helper in this same file for the positive-denominator guard, and `DrillStatCard`'s existing `ariaLabel` template string for the accessible-name composition. `StatCard` already renders `sub` (`client/src/components/StatCard.tsx`), so only the private wrapper needs the pass-through. For test setup, follow `StatCardsRow.stories.tsx`'s `postMetrics` fetch fixtures and the existing Dashboard React Testing Library tests.
- **Key decisions:** A5 (whole-percent cache-read share over all four token measures, omitted at zero total; deliberately a different denominator from Cache-hit-%).
- **Libraries:** none added. Existing TanStack Query batching stays — the four-measure `tokensQuery` already in this file is the sole data source; do not add a third query.
- **High-risk callouts:** *Accessibility (M)* — derive the visible sub text and the `aria-label` segment from one string so they can never drift; the accessible-name test above is the check. *Dashboard Total-tokens tile (L)* — the tile total itself must not change; only an explanatory line is added.

### Scope Boundaries

- Do NOT unify the cache-read share with the Cache-hit-% metric or change the latter's formula (ARCH Out of Scope — different denominators answer different questions).
- Do NOT modify `client/src/components/StatCard.tsx`; it already supports `sub`.
- Do NOT add a third `/api/metrics` call — both values come from the existing four-measure query.
- Do NOT add sub-lines to the other four tiles (gold-plating boundary — the issue's approved fix covers Total tokens only).
- Only implement the `sub` pass-through, the guarded derived share, and the accessible-name composition.

### Files Expected

**New files:** _(from ARCH "New files / modules")_
- `client/src/pages/dashboard/StatCardsRow.test.tsx` (focused component coverage for the sub-line and the zero-total guard; follows existing Dashboard RTL tests and `StatCardsRow.stories.tsx` fetch fixtures)

**Modified files:** _(from ARCH "Modified files / modules")_
- `client/src/pages/dashboard/StatCardsRow.tsx` (pass optional `sub` through `DrillStatCard`, include it in the explicit link accessible name, render the guarded cache-read share on Total tokens)

**Must NOT modify:** _(from ARCH "Touched but not changed", plus task-scoped boundaries)_
- `client/src/components/StatCard.tsx` (silent-regression hotspot — already owns visible `sub` rendering)
- `client/src/pages/dashboard/StatCardsRow.stories.tsx` (existing four-measure fixtures are a regression surface; all five cards must keep rendering)
- `shared/metrics-contract.ts`, `server/metrics/engine.ts` (silent-regression hotspots)

---

## Footprint coverage check

Every Change Footprint row is claimed: `units.ts`/`timeseries.ts`/`timeseries.test.ts` → T1;
`ChartCard.tsx`/`ChartCard.test.tsx` → T2 (its measures fixture line → T1);
`calendar.ts`/`calendar.test.ts` → T3; `CalendarHeatmapPanel.test.tsx` → T1;
`StatCardsRow.tsx` + new `StatCardsRow.test.tsx` → T4. The "Deleted / replaced" section is
empty by design. Every "Touched but not changed" entry appears in at least one task's **Must NOT
modify** list and is covered by a named regression-guard scenario, except the two Cypress
journeys (`cypress/e2e/dashboard.cy.ts`, `cypress/e2e/trends.cy.ts`) and the three story files,
which remain untouched regression surfaces run by `npm run test:e2e` and Storybook rather than
by a task-owned unit test.
