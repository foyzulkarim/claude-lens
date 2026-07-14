# Architecture: Distributions + smoothing + compare

> **Date:** 2026-07-14
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Standalone brief, grounded in settled specs — see Inferred Requirements. No REQ doc; this is a plan task (#P2-9 / issue #26), whose requirements source is `specs/claude-lens-plan.md` + `specs/claude-lens-architecture.md` §8 + `specs/claude-lens-pages.md` §8 (Pareto panel), per this repo's delivery pipeline (`CLAUDE.md`).
> **Type:** feature (brownfield — new module against the #P2-8 metrics engine's already-settled contracts)

## Architecture Summary

`server/metrics/distributions.ts` implements the three capabilities #P2-8 deliberately left as no-ops in `engine.ts`: `mode: "distribution"` (percentiles, histogram, pareto), `smoothing: "ma7"`, and `compare: "previous-period"`. It is a pure math module — percentile/histogram/pareto functions take a plain `number[]`; smoothing and compare-alignment take `SeriesPoint[]` — with no knowledge of `Group`, `MeasureScope`, or pricing. `engine.ts` is modified to become the real orchestrator: for distribution mode it reuses its own existing `scopeFor()` grouping to get the entity population (sessions, turns, or individual calls, per a new `distributionEntity` query field) and calls `computeMeasure` once per entity to build the value array `distributions.ts` needs; for compare it re-runs its own group→bucket→aggregate pipeline against a shifted previous-period range and hands both point arrays to `distributions.ts` for alignment; for smoothing it passes each series' points through `distributions.ts`'s moving-average function. `shared/metrics-contract.ts` gets two contract edits: `Distribution`'s percentile fields become nullable and its histogram bucket shape changes from a pre-formatted string to numeric bounds, and `MetricsQuery` becomes a discriminated union so `mode: "distribution"` requires a new `distributionEntity: "session" | "turn" | "call"` field. Nothing outside `server/metrics/` is affected — no route exists yet (#P2-10's job) so this contract edit is free.

## Inferred Requirements

| ID  | Inferred Requirement              | Source                              |
|-----|-----------------------------------|--------------------------------------|
| R1  | `mode: "distribution"` computes correct percentiles (p50/p90/p99) and histogram buckets, verified against hand-computed known inputs. | Issue #26 acceptance criteria |
| R2  | Pareto curve + top-decile share computed for `mode: "distribution"`, matching the "top 10% turns = X% of spend; cumulative curve" panel definition. | `claude-lens-pages.md` §8 |
| R3  | `compare: "previous-period"` produces a ghost overlay aligned to the current series, correct across DST transitions and variable-length month boundaries at every grain (hour/day/week/month). | Issue #26 acceptance criteria |
| R4  | `smoothing: "ma7"` applies a 7-point moving average to series output. | `claude-lens-architecture.md` §8; `claude-lens-pages.md` §0 (global analytics layer: "Smoothing toggle") |
| R5  | Distribution mode works for any measure, not just cost — a session/turn/call population of any of the 16 `Measure` values. | `claude-lens-pages.md` §11 (Explore: "Percentile/distribution mode for any measure") |
| R6  | Output stays honest under missing/empty data — no fabricated percentiles/histogram/pareto values for an empty population, no fabricated averages across all-null premium-gated measures. | `claude-lens-architecture.md`'s "honest-gap philosophy" (carried over from #P2-8 ARCH decisions) |

## High-Level Structure

```
                        engine.ts: metrics(input, query)
                                    │
                query.mode === "distribution"?
                    │                           │
                   yes                          no (mode: "series", default)
                    │                           │
                    ▼                           ▼
   group by breakdown dims only        existing #P2-8 pipeline (group →
   (time dimension ignored — one       bucket by grain → aggregate),
   population per group across          unchanged
   the whole range)                            │
                    │                    query.smoothing === "ma7"?
                    ▼                           │  yes
   for each group: pick entity array            ▼
   from scopeFor()'s output per         distributions.ts: movingAverage(points)
   query.distributionEntity                     │
   ("session"→scope.sessions,           query.compare === "previous-period"?
    "turn"→scope.turns,                         │  yes
    "call"→scope.calls)                         ▼
                    │                    re-run group→bucket→aggregate against
                    ▼                    shifted range [from−duration, from);
   computeMeasure(measure, entityScope,  distributions.ts: alignPreviousPeriod(
     pricing) once per entity              current points, previous points)
   → number[] (nulls excluded)                  │
                    │                           ▼
                    ▼                    Series[] with compareGhost set
   distributions.ts: computeDistribution
     (values) → { p50,p90,p99,
     histogram, pareto }
                    │
                    ▼
   Series[] with distribution set, points: []
```

Two paths through the same `metrics()` entry point, selected once at the top by `query.mode`; nothing in `dimensions.ts`/`grain.ts`/`measures.ts` changes — both paths compose the same T1–T3 building blocks #P2-8 shipped.

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|---|---|---|---|
| File ownership | Percentiles/histogram/pareto, `ma7`, and previous-period alignment all live in `server/metrics/distributions.ts` | Split previous-period alignment into `grain.ts`, per that file's file-tree comment ("period-over-period") in `claude-lens-architecture.md` §3 | The issue's own Scope line (sourced from `plan.md`'s #P2-9 task, the more specific and more recently authored source) names `distributions.ts` for all three; the `grain.ts` comment is treated as a stale forward-reference, not a contradicting instruction. Confirmed with developer. |
| Distribution population selection | New required `distributionEntity: "session" \| "turn" \| "call"` field on `MetricsQuery`, discriminated on `mode` | Overload `dimensions` with pseudo-values `"session"`/`"turn"` | `dimensions` means "partition into N series" (fan-out); distribution population means "collapse into one array" — conflating them would require special-casing new pseudo-dimension values throughout `buildGroups`/`groupKeysForCall` and fights the existing fan-out semantics. A flat field also extends cleanly to a future call-level population (Models page's future p50/p90 latency-by-model, §6) without touching dimension logic. |
| Percentile method | Nearest-rank on the sorted value array (`index = ceil(p/100 × N)`, clamped `[1, N]`); `N = 0` → `p50`/`p90`/`p99` all `null` | Linear interpolation (numpy/Prometheus-style) | Simpler, fully deterministic against hand-computed known inputs (the acceptance criterion); avoids inventing fractional values between two real data points. |
| Histogram shape | 10 equal-width buckets spanning `[min, max]` of the actual entity population; `N ≤ 1` or all-identical values → a single bucket covering everything. Bucket shape is `{ rangeStart, rangeEnd, count }`, not a pre-formatted string. | Fixed bucket width anchored at 0; Sturges'/Freedman-Diaconis adaptive bucket count; pre-formatted `"$0–5"`-style label strings (the pre-existing `Distribution.histogram: {bucket: string}` shape from the #P1-2-era shared-contracts task) | Min/max anchoring uses full resolution where data actually clusters. A fixed count of 10 is simple and deterministic for known-input tests, unlike an adaptive rule. Numeric bounds (not pre-formatted strings) let the client format per-measure unit — a hardcoded `"$"` string would violate architecture §8's "unit switching is just a measure swap" rule the moment the same distribution mode targets `inputTokens` instead of `costComputed`. |
| Pareto shape | New optional `Distribution.pareto: { curve: {entityPct, cumulativeValuePct}[], topDecileValuePct: number }`, entities sorted descending by value; `undefined` when the population is empty | Client interpolates the top-decile share itself from a raw sorted array | Architecture §8: "Period-over-period deltas, moving averages, and percentiles are computed here, once. Pages and charts never aggregate raw data" — the same rule extends to pareto's headline stat. |
| `ma7` window behavior | Expanding window: point *i* averages `points[max(0, i-6)..i]`, skipping (not zeroing) any `null` values in that window; an all-null window stays `null` | Leave the first 6 points `null` until a full 7-point window exists | Avoids a dead first week on every smoothed chart; never coerces an unavailable premium measure's `null` into a fabricated `0`. |
| `compare` previous-range definition | `previous = [from − duration, from)` where `duration = to − from`; the previous range's own buckets are computed independently via the existing `enumerateBuckets`/`bucketStart` (`grain.ts`, unmodified); ghost points align to current points by **ordinal index**, truncated/padded with `null` if bucket counts differ | Calendar-aligned previous period (same day-of-month/week-of-month) | Reusing `grain.ts`'s already-DST-correct bucketing (confirmed via #P2-8's own DST test) means correctness is inherited, not reimplemented; index alignment has well-defined behavior even when adjacent months differ in length (a real case at `month` grain). |
| Entity-value extraction | Reuse `scopeFor()`'s existing per-group `{calls, turns, sessions}` output; for each entity, build a one-entity `MeasureScope` (e.g. one turn → `{calls: turn.calls, turns: [turn], sessions: []}`) and call the existing `computeMeasure` — no new aggregation logic | A parallel entity-enumeration function independent of `scopeFor` | Zero duplication of #P2-8's filtering/matching logic (`turnMatchesGroup`/`sessionMatchesGroup`); `computeMeasure`'s existing null-vs-zero contract cascades correctly — an entity where the measure is unavailable (e.g. `costObserved` today) is excluded from the value array, so an all-premium-gated measure naturally produces `N=0` → all-null `Distribution` with no extra code. |
| Distribution mode + `"time"` dimension | Distribution mode ignores `"time"` even if present in `query.dimensions` — always one population per breakdown-dim group across the whole queried range, never time-bucketed | Allow time-bucketed distributions (a distribution per hour/day/etc.) | No page-spec example needs it; per-bucket populations (e.g. sessions in a single day) would typically be too small to produce a meaningful histogram/pareto. |

## Patterns & Conventions

- **Pure math module** — `distributions.ts` follows `grain.ts`'s precedent: no side effects, arrays/primitives in and out, zero dependency on `Group`/`MeasureScope`/pricing types.
- **Honest-gap philosophy** (carried over from #P2-8) — an empty population or all-null measure produces `null`/`undefined` fields, never a fabricated `0` or interpolated value.
- **`engine.ts` remains the sole orchestrator** — it is still the only file in `metrics/` that composes the others (grain, dimensions, measures, and now distributions), per #P2-8's established module-boundary rule.
- **No new dependencies** — percentile/histogram/pareto/moving-average are all straightforward array math; no stats library needed.

## Data Models

### `Distribution` (modified, `shared/metrics-contract.ts`)

**Purpose:** the distribution-mode result attached to a `Series`.

| Field | Type / Constraint | Notes |
|---|---|---|
| `p50`, `p90`, `p99` | `number \| null` (was `number`) | `null` when the entity population is empty |
| `histogram` | `{ rangeStart: number; rangeEnd: number; count: number }[]` (was `{ bucket: string; count: number }[]`) | Numeric bounds; client formats per measure unit |
| `pareto` | `{ curve: { entityPct: number; cumulativeValuePct: number }[]; topDecileValuePct: number } \| undefined` (new) | `undefined` when population is empty |

**Relationships:** attached to `Series.distribution` (field already exists, unchanged).

**Lifecycle:** constructed fresh per distribution-mode query; never persisted.

### `MetricsQuery` (modified, `shared/metrics-contract.ts`)

**Purpose:** becomes a discriminated union so distribution queries can't omit the population selector.

| Variant | Fields |
|---|---|
| `mode?: "series"` (default) | unchanged from #P2-8 |
| `mode: "distribution"` | adds required `distributionEntity: "session" \| "turn" \| "call"` |

**Relationships:** none new.

**Lifecycle:** constructed per-call by whichever caller builds a query (test fixtures today; #P2-10's route in production).

## API Contracts / Interfaces

### `server/metrics/distributions.ts` (new)

**Boundary:** internal module, imported only by `engine.ts` and its own test file.

| Function | Signature | Purpose | Returns |
|---|---|---|---|
| `computeDistribution` | `(values: number[]) => Distribution` | Composes percentiles + histogram + pareto | `N=0` → `{p50:null,p90:null,p99:null,histogram:[],pareto:undefined}` |
| `movingAverage7` | `(points: SeriesPoint[]) => SeriesPoint[]` | Expanding-window `ma7`, null-skipping | Same length as input, values recomputed |
| `alignPreviousPeriod` | `(current: SeriesPoint[], previous: SeriesPoint[]) => SeriesPoint[]` | Ordinal-index alignment, truncate/pad with `null` | Length equals `current.length` |

### `server/metrics/engine.ts` (modified)

**Boundary:** internal module (unchanged — still no HTTP surface, that's #P2-10).

`metrics(input, query) => Series[]` signature is unchanged; its behavior on `mode: "distribution"`, `compare: "previous-period"`, and `smoothing: "ma7"` goes from no-op to real, per the High-Level Structure diagram above. Never throws on data-shape edge cases (empty population, all-null measure), matching #P2-8's existing contract — a malformed `MetricsQuery` itself stays a caller/type-level concern, not defended against here.

## Module Boundaries

| Module / Package | Responsibility | Allowed Dependencies |
|---|---|---|
| `server/metrics/distributions.ts` (new) | Percentile/histogram/pareto math; `ma7` smoothing; previous-period point alignment | `shared/metrics-contract.ts` (for `Distribution`/`SeriesPoint` types) only — no sibling `metrics/` imports |
| `server/metrics/engine.ts` (modified) | Orchestrates filter → group → bucket → aggregate (unchanged from #P2-8) plus the new distribution/compare/smoothing dispatch | `shared/types.ts`, `shared/metrics-contract.ts`, sibling `metrics/` files including the new `distributions.ts` |

No change to `measures.ts`, `dimensions.ts`, or `grain.ts`'s boundaries.

## Change Footprint

### New files / modules

| Path | Purpose | Pattern reference |
|---|---|---|
| `server/metrics/distributions.ts` | Percentiles, histogram, pareto, `ma7`, previous-period alignment | `server/metrics/grain.ts`'s pure-stdlib-only shape |
| `server/metrics/distributions.test.ts` | Hand-computed known-input tests | `server/metrics/grain.test.ts`/`measures.test.ts` style |

### Modified files / modules

| Path | What changes here |
|---|---|
| `shared/metrics-contract.ts` | `Distribution.p50/p90/p99` → `number \| null`; `histogram` entries → `{rangeStart, rangeEnd, count}`; add `Distribution.pareto`; `MetricsQuery` becomes a discriminated union adding `distributionEntity` for `mode: "distribution"` |
| `server/metrics/engine.ts` | Real dispatch on `query.mode`; distribution-mode grouping/entity-scoping/aggregation; compare re-run + alignment; smoothing pass; removes the now-stale "#P2-9 owns... never reads those three fields" comment |
| `server/metrics/engine.test.ts` | `"mode/compare/smoothing are silently no-op'd, never throw"` test rewritten to assert real output instead of `compareGhost` staying `undefined` |

### Deleted / replaced

None.

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|---|---|
| `server/metrics/measures.ts` (`computeMeasure`, `MeasureScope`) | Reused unchanged, now called once per distribution entity instead of once per group×bucket; its null-vs-zero contract is load-bearing for correct empty-population cascading |
| `server/metrics/dimensions.ts` (`turnMatchesGroup`, `sessionMatchesGroup`) | Unchanged; distribution-mode entity scoping depends on `scopeFor()`'s existing use of these matchers continuing to behave as today |

## Areas of Impact

| Area | Impact | Risk (L/M/H) | Why |
|---|---|---|---|
| `server/metrics/` | Extends the mode dispatch #P2-8 deliberately left as a no-op (decision A6, prior ARCH doc) | L | Nothing outside `metrics/` imports this module yet — zero external blast radius until #P2-10 wires a route |
| `shared/metrics-contract.ts` | Contract edit: nullable percentiles, histogram shape, new discriminated `distributionEntity` field | M | It's "the only vocabulary pages speak" (architecture §11) — correct to fix now while there are zero consumers; would be a breaking migration later once a client exists |
| `server/metrics/engine.test.ts` | One existing test's assertion flips from "no-op" to "real behavior" | L | Caught immediately by `npm run verify`, not a silent regression |

**Contract changes:** yes, to `Distribution`/`MetricsQuery` as detailed above. No external consumers exist yet (#P2-10, which wires the HTTP route, hasn't landed) — free today, would require a client migration later.

**Cross-cutting ripples:** none — no auth, telemetry, migration, feature flag, or build-pipeline change.

## Cross-Cutting Concerns

- **Errors:** distribution mode never throws on an empty population — `N=0` cascades to `null` percentiles, `histogram: []`, `pareto: undefined`. A caller requesting a semantically empty combination (e.g. `distributionEntity: "call"` with a turn-grain-only measure like `wallMinutes`) gets whatever `computeMeasure` returns for an empty-turns scope today (typically `0`) — not defended against, consistent with #P2-8's "malformed query is a caller/type bug" stance; not a goal of this task to add query-shape validation.
- **Logging & metrics:** none — pure in-memory function, no I/O to log.
- **Auth / authz:** not applicable at this layer (no HTTP surface).
- **Performance:** distribution mode is O(entities log entities) per group (the pareto/percentile sort) — same order of magnitude as #P2-8's existing O(calls) filtering pass. `compare` roughly doubles per-query engine work (two full group→bucket→aggregate runs). Both comfortably synchronous at the #P2-7-validated scale (~4K calls, low hundreds of MB).
- **Security:** no filesystem or network access; operates entirely on already-in-memory, already-validated data.
- **Migrations / rollout:** none — the contract edit lands before any consumer exists, so there is nothing to migrate.

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies REQs |
|---|---|---|---|---|
| A1 | New required `distributionEntity: "session" \| "turn" \| "call"` field on `MetricsQuery`, discriminated on `mode` | Overload `dimensions` with pseudo-values | Keeps fan-out (dimensions) and population-collapse (distribution entity) semantically separate; extends to future call-level distributions without new dimension special-casing | R1, R5 |
| A2 | Percentiles/histogram/pareto, `ma7`, and previous-period alignment all in `distributions.ts` | Split previous-period into `grain.ts` per its file-tree comment | Issue's own Scope line (from `plan.md`) is the more specific, authoritative source; confirmed with developer | R1, R2, R3, R4 |
| A3 | Nearest-rank percentile method; `N=0` → `null` | Linear interpolation | Simpler, deterministic against known-input tests; never fabricates a value between two real points | R1 |
| A4 | 10 equal-width histogram buckets over `[min, max]`; numeric `{rangeStart, rangeEnd}` bounds instead of pre-formatted strings | Fixed-width anchored at 0; adaptive bucket-count rule; string labels | Full resolution where data clusters; numeric bounds preserve "unit switching is a measure swap" (architecture §8) | R1 |
| A5 | Pareto: sorted-descending curve + `topDecileValuePct`, `undefined` when empty | Client-side interpolation of a raw sorted array | Architecture §8: percentiles/aggregation computed once, in the engine | R2 |
| A6 | `ma7` expanding window, null-skipping within the window | Leave first 6 points `null` | No dead first week; never coerces unavailable data into `0` | R4, R6 |
| A7 | `compare` previous range `[from−duration, from)`, buckets computed independently via existing `grain.ts`, ordinal-index ghost alignment with truncate/pad-null on mismatch | Calendar-aligned previous period | Inherits `grain.ts`'s already-DST-correct bucketing; well-defined under variable month lengths | R3 |
| A8 | Distribution-mode entity values reuse `scopeFor()`'s existing per-group output + `computeMeasure`, called once per entity | New parallel entity-enumeration logic | Zero duplication of #P2-8's grouping/matching; null-exclusion cascades empty-population behavior for free | R1, R5, R6 |
| A9 | Distribution mode ignores `"time"` in `dimensions` — always whole-range, never time-bucketed | Allow time-bucketed distributions | No page-spec example needs it; per-bucket populations would typically be too small to be meaningful | R1, R2 |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|---|---|
| Distribution query matches zero entities (filters exclude everything) | `values = []` → `p50/p90/p99: null`, `histogram: []`, `pareto: undefined` — no throw, no fabricated value |
| All entity values identical (e.g. every session cost exactly $0) | Histogram collapses to a single bucket spanning that one value, per the "N≤1 or all-identical" rule |
| `compare` requested on a zero-duration range (`from === to`) | Previous range is also zero-duration `[from, from)`; `enumerateBuckets` already handles single-instant ranges (existing #P2-8 coverage) → one ghost point, no divide-by-zero |
| `smoothing: "ma7"` on an all-null series (e.g. `costObserved` today, before #P4-13) | Expanding-window average over an all-null window stays `null` throughout — never coerces to `0` |
| Current and previous period disagree on bucket count at `month` grain (adjacent months of different lengths) | `alignPreviousPeriod` truncates/pads `compareGhost` to the current array's length with `null` |
| `distributionEntity: "call"` requested for a turn/session-grain-only measure (e.g. `wallMinutes`) | Not defended against — `computeMeasure` runs against an empty-turns per-call scope and returns its existing default (`0` for `wallMinutes`), same as any other caller-shape mismatch in the #P2-8 contract |

### Backward — regression risk per touched area

| Touched area (from Change Footprint) | What could regress | How we'd know / mitigation |
|---|---|---|
| `shared/metrics-contract.ts` (`Distribution`, `MetricsQuery` shape change) | Any code already built against the old `histogram: {bucket: string}` shape or non-nullable percentiles | `tsc` catches it immediately — no runtime consumer exists yet (confirmed: #P2-10 hasn't wired a route), so this is a compile-time-only risk, not a live regression |
| `server/metrics/engine.ts` (mode dispatch) | The existing `mode: "series"` path (all of #P2-8's shipped behavior) could regress if the new dispatch logic is wired incorrectly | #P2-8's full existing test suite (`engine.test.ts`'s other ~15 tests) stays in place unmodified and must keep passing — the only test edited is the one that directly asserted the old no-op behavior |
| `server/metrics/measures.ts`/`dimensions.ts` (reused, unmodified) | Distribution mode's new per-entity `computeMeasure` calls could reveal an edge case in `turnMatchesGroup`/`sessionMatchesGroup` that #P2-8's group-level (not entity-level) tests never exercised | New `distributions.test.ts` / `engine.test.ts` cases exercise per-entity scoping directly (one turn, one session at a time) rather than only group aggregates |

## Open Questions

None outstanding — all forks surfaced during this session were resolved with the developer (see Decisions Log A1–A9).

## Out of Scope

- `POST /api/metrics` route and wiring distribution/compare/smoothing queries to a live `Store` — #P2-10.
- Client-side rendering of histograms/pareto curves/ghost overlays (the `charts/` ECharts wrapper) — Phase 4/5 page work.
- Real per-model pricing, `costObserved`/`linesAdded`/`linesRemoved`/`apiMs`/`gatePassRate` becoming non-null — unchanged from #P2-8's existing Out of Scope (#P4-11/#P4-13/#P4-15).
- Query-shape validation for semantically nonsensical `distributionEntity`/measure combinations (e.g. call-entity + turn-grain measure) — not a goal per this doc's stress-test table; matches #P2-8's existing "malformed query is a caller/type bug" stance.

---

# Tasks

## Task T1: Distribution math — percentiles, histogram, pareto

> **Status:** done
> **Verification:** tdd
> **Effort:** m
> **Priority:** high
> **Depends on:** None
> **Satisfies REQs:** R1, R2, R6
> **Footprint slice:** New: `server/metrics/distributions.ts` (`computeDistribution` + internal percentile/histogram/pareto helpers), `server/metrics/distributions.test.ts`; Modified: `shared/metrics-contract.ts` (`Distribution` type only — nullable percentiles, numeric histogram bounds, new `pareto` field)
> **High-risk areas touched:** `shared/metrics-contract.ts` (Medium — see ARCH Areas of Impact; mitigated by zero live consumers today)

### Description

Implements `computeDistribution(values: number[]) => Distribution`, the pure math at the core of `mode: "distribution"`: nearest-rank percentiles (p50/p90/p99), a 10-bucket histogram over the population's `[min, max]`, and a sorted-descending pareto curve with a `topDecileValuePct` headline stat. Also lands the `Distribution` contract shape change this function's return type requires. This task has no awareness of the engine's grouping/scoping — it is handed a plain array of already-computed per-entity numbers and returns the full `Distribution` object.

### Test Plan

#### Test File(s)
- `server/metrics/distributions.test.ts`

#### Test Scenarios

##### Percentiles (nearest-rank)

- **computes p50/p90/p99 on a known 100-value array** — GIVEN `[1..100]` WHEN `computeDistribution` THEN `p50=50, p90=90, p99=99` (nearest-rank, `index = ceil(p/100 × N)`) _(verifies R1)_
- **computes correctly on a small known array** — GIVEN `[10, 20, 30]` WHEN `computeDistribution` THEN `p50=20, p90=30, p99=30` (hand-computed) _(verifies R1)_
- **sorts unsorted input before computing** — GIVEN the same values in random order WHEN `computeDistribution` THEN percentiles are identical to the sorted-input case _(edge case)_
- **single value** — GIVEN `[42]` WHEN `computeDistribution` THEN `p50=p90=p99=42` _(edge case)_

##### Histogram (10 equal-width buckets over `[min, max]`)

- **buckets a known spread correctly** — GIVEN a known array spanning a known range WHEN `computeDistribution` THEN `histogram` has 10 buckets with hand-computed `rangeStart`/`rangeEnd` boundaries, and bucket counts sum to `N` _(verifies R1)_
- **N≤1 collapses to zero/one bucket** — GIVEN `[]` or `[42]` WHEN `computeDistribution` THEN `histogram` is `[]` for the empty case, or one bucket covering `[42, 42]` for the single-value case _(edge case, decision A4)_
- **all-identical values collapse to one bucket** — GIVEN `[5, 5, 5, 5]` (`N>1`, `min === max`) WHEN `computeDistribution` THEN one bucket with `count: 4` — no divide-by-zero on bucket width _(edge case, decision A4)_

##### Pareto (sorted-descending curve + top-decile share)

- **computes curve and topDecileValuePct on a known skewed array** — GIVEN a known array where a clear top decile dominates the total WHEN `computeDistribution` THEN `pareto.curve` entries match hand-computed `entityPct`/`cumulativeValuePct` (sorted descending by value), and `pareto.topDecileValuePct` matches the value share of the top `ceil(N × 0.1)` entities (nearest-rank convention, consistent with percentiles) _(verifies R2)_
- **single entity: top decile is the whole population** — GIVEN `[10]` WHEN `computeDistribution` THEN `curve = [{entityPct:100, cumulativeValuePct:100}]`, `topDecileValuePct = 100` _(edge case)_

##### Empty population (honest-null)

- **empty array produces a fully honest-null Distribution** — GIVEN `[]` WHEN `computeDistribution` THEN `p50`/`p90`/`p99` are all `null`, `histogram` is `[]`, `pareto` is `undefined` — never a fabricated value _(verifies R6)_

### Implementation Notes

- **Module(s):** `server/metrics/distributions.ts`, depending only on `shared/metrics-contract.ts` (for the `Distribution` type) per ARCH Module Boundaries — no sibling `metrics/` imports.
- **Pattern reference:** `server/metrics/grain.ts`'s pure-stdlib-only shape — no side effects, arrays/primitives in and out.
- **Key decisions:** ARCH A3 (nearest-rank percentile method, `N=0` → `null`), A4 (10 equal-width histogram buckets over `[min,max]`, numeric `{rangeStart,rangeEnd}` bounds not strings, `N≤1`/all-identical → one bucket), A5 (pareto curve + `topDecileValuePct`, `undefined` when population is empty; top-decile count uses the `ceil(N×0.1)` nearest-rank convention, confirmed this session).
- **Libraries:** none new.
- **High-risk callouts:** `shared/metrics-contract.ts` is "the only vocabulary pages speak" (ARCH Areas of Impact, Medium risk) — safe to edit now since no route/client consumes it yet (#P2-10 hasn't landed). The type change itself is verified by `tsc`, not a dedicated runtime test.

### Scope Boundaries

- Do NOT implement `movingAverage7` or `alignPreviousPeriod` — T2.
- Do NOT touch `engine.ts` or the `MetricsQuery` discriminated-union edit (`distributionEntity`) — T3.
- Do NOT add query-shape validation — ARCH Out of Scope.
- Only implement `computeDistribution`'s math; percentile/histogram/pareto sub-logic may be internal helpers, not separately exported (ARCH's public API for this module is `computeDistribution`, `movingAverage7`, `alignPreviousPeriod` only).

### Files Expected

**New files:**
- `server/metrics/distributions.ts` — `computeDistribution(values: number[]): Distribution`
- `server/metrics/distributions.test.ts`

**Modified files:**
- `shared/metrics-contract.ts` (`Distribution` type: nullable `p50`/`p90`/`p99`, `histogram: {rangeStart,rangeEnd,count}[]`, new optional `pareto` field)

**Must NOT modify:** `server/metrics/engine.ts`, `server/metrics/engine.test.ts`, `server/metrics/measures.ts`, `server/metrics/dimensions.ts`, `server/metrics/grain.ts`, and the `MetricsQuery` portion of `shared/metrics-contract.ts` (T3's slice).

### TDD Sequence

Percentiles first (simplest, no bucketing math), then histogram, then pareto, then the empty-population composite test last (exercises all three paths at once).

---

## Task T2: Series post-processing — `ma7` smoothing + previous-period alignment

> **Status:** done
> **Verification:** tdd
> **Effort:** s
> **Priority:** high
> **Depends on:** T1 (extends the same new file; no functional dependency)
> **Satisfies REQs:** R3, R4, R6
> **Footprint slice:** New (extends T1's file): `server/metrics/distributions.ts` (`movingAverage7`, `alignPreviousPeriod`), `server/metrics/distributions.test.ts` (extends)
> **High-risk areas touched:** None

### Description

Implements the two pure `SeriesPoint[]` transforms `mode: "series"` output needs: `movingAverage7`, an expanding-window moving average with null-skipping, and `alignPreviousPeriod`, which reconciles two independently-bucketed point arrays (current and previous period) into a single ghost array aligned by ordinal index. Neither function knows about groups, ranges, or the engine's pipeline — both take already-computed `SeriesPoint[]` arrays in and return one out.

### Test Plan

#### Test File(s)
- `server/metrics/distributions.test.ts` (extends T1's file)

#### Test Scenarios

##### `movingAverage7`

- **expanding window for early points** — GIVEN a known points array WHEN `movingAverage7` THEN point `i` (for `i < 6`) equals the average of `points[0..i]` (hand-computed) _(verifies R4)_
- **full 7-point trailing window from index 6 onward** — GIVEN 10 known points WHEN `movingAverage7` THEN point `i` (for `i >= 6`) equals the average of `points[i-6..i]` (hand-computed) _(verifies R4)_
- **null-skipping within a partial-null window** — GIVEN a window containing some `null` values WHEN `movingAverage7` THEN the average uses only the non-null values in that window _(edge case, decision A6)_
- **all-null series stays entirely null** — GIVEN every point's value is `null` WHEN `movingAverage7` THEN every output point is `null`, never `0` _(verifies R6)_

##### `alignPreviousPeriod`

- **equal-length arrays align 1:1 by index** — GIVEN `current` and `previous` of the same length WHEN `alignPreviousPeriod` THEN `output[i] = previous[i]` for every `i` _(verifies R3)_
- **previous longer than current → truncated** — GIVEN `previous.length > current.length` WHEN `alignPreviousPeriod` THEN `output.length === current.length`, using only the first matching previous points _(edge case, decision A7)_
- **previous shorter than current → padded with null** — GIVEN `previous.length < current.length` WHEN `alignPreviousPeriod` THEN `output.length === current.length`, with `null` filling the missing tail _(edge case, decision A7)_

### Implementation Notes

- **Module(s):** `server/metrics/distributions.ts` (extends T1's file), same dependency rules as T1.
- **Pattern reference:** same as T1.
- **Key decisions:** ARCH A6 (`ma7` expanding window, null-skipping, never fabricates `0`), A7 (previous-period ordinal-index alignment, truncate/pad-`null` on length mismatch).
- **Libraries:** none new.
- **High-risk callouts:** None.

### Scope Boundaries

- Do NOT implement `computeDistribution`/percentiles/histogram/pareto — T1.
- Do NOT re-run the engine's group→bucket→aggregate pipeline to produce the "previous" array in the first place — that's T3's job; this task only aligns two already-computed arrays.
- Do NOT wire either function into `engine.ts` — T3.

### Files Expected

**New files:** none (extends T1's `server/metrics/distributions.ts` and `distributions.test.ts`).

**Modified files:** none beyond T1's new files.

**Must NOT modify:** `server/metrics/engine.ts`, `server/metrics/engine.test.ts`, `shared/metrics-contract.ts` (`SeriesPoint` is unchanged — no edit needed here).

### TDD Sequence

`movingAverage7` first (simpler, single-array), then `alignPreviousPeriod`.

---

## Task T3: Engine wiring — mode dispatch, entity scoping, compare, smoothing

> **Status:** not started
> **Verification:** test-after
> **Effort:** l
> **Priority:** high
> **Depends on:** T1, T2
> **Satisfies REQs:** R1, R2, R3, R4, R5, R6
> **Footprint slice:** Modified: `server/metrics/engine.ts` (mode dispatch; distribution-mode entity scoping; previous-period pipeline re-run; smoothing pass), `server/metrics/engine.test.ts` (rewrite the `mode`/`compare`/`smoothing` no-op test; new wiring tests), `shared/metrics-contract.ts` (`MetricsQuery` discriminated-union edit — adds `distributionEntity`, required when `mode: "distribution"`)
> **High-risk areas touched:** `shared/metrics-contract.ts` (Medium — the `MetricsQuery` half of the contract edit; mitigated by zero live consumers today); `server/metrics/engine.ts`'s core `mode: "series"` pipeline (regression risk — guarded below)

### Description

Wires T1's `computeDistribution` and T2's `movingAverage7`/`alignPreviousPeriod` into `engine.ts`, replacing the #P2-8-era no-op behavior with real dispatch on `query.mode`. Distribution mode reuses the engine's existing `scopeFor()` grouping to pick the right entity population (`session`/`turn`/`call`) per `distributionEntity` and calls `computeMeasure` once per entity to build the value array T1 consumes. `compare` re-runs the engine's own group→bucket→aggregate pipeline against a shifted previous-period range and hands both point arrays to T2's `alignPreviousPeriod`. `smoothing` passes each series' points through T2's `movingAverage7`. This is the task where all of #P2-9's design comes together into the shipped `metrics()` function.

### Test Plan

#### Test File(s)
- `server/metrics/engine.test.ts`

#### Test Scenarios

##### Distribution mode dispatch

- **distribution mode ignores "time", groups by breakdown dims only** — GIVEN a query with `dimensions: ["time", "project"]`, `mode: "distribution"`, `distributionEntity: "session"` spanning 2 projects WHEN `metrics()` runs THEN the result has one `Series` per project (not per time bucket), each with `points: []` and a populated `distribution` _(verifies R1)_

##### Distribution entity population selection

- **distributionEntity: "session" builds population from scope.sessions** — GIVEN a fixture with known session-level `costComputed` values WHEN queried with `distributionEntity: "session"`, measure `costComputed` THEN the resulting `Distribution`'s percentiles/histogram match hand-computed values over the session population _(verifies R5)_
- **distributionEntity: "turn" builds population from scope.turns** — GIVEN a fixture with known per-turn call costs WHEN queried with `distributionEntity: "turn"` THEN the `Distribution` matches hand-computed per-turn cost values _(verifies R5)_
- **distributionEntity: "call" builds population from scope.calls** — GIVEN a fixture with known per-call token usage WHEN queried with `distributionEntity: "call"`, measure `inputTokens` THEN the `Distribution` matches hand-computed per-call values _(verifies R5 — "any measure" generality)_
- **entities where the measure is null are excluded from the population** — GIVEN a fixture WHEN queried for a premium-gated measure (e.g. `costObserved`, always `null` today) in distribution mode THEN the population is empty and the result is T1's fully honest-null `Distribution` _(verifies R6)_

##### Compare (previous-period) wiring

- **compare produces a ghost aligned to a time-bucketed series** — GIVEN a fixture spanning two equal periods with known per-bucket aggregates WHEN queried with `compare: "previous-period"` and `dimensions: ["time"]` THEN `Series.compareGhost` matches the independently hand-computed previous-period aggregates, bucket-for-bucket _(verifies R3)_
- **compare produces one ghost point for a non-time-bucketed query** — GIVEN the same fixture WHEN queried with `compare: "previous-period"` and no `"time"` in `dimensions` THEN `compareGhost` has exactly one point matching the prior range's aggregate _(verifies R3 — stat-card delta case)_
- **month-grain bucket-count mismatch is truncated/padded, not misaligned** — GIVEN a range where the current and previous month-grain windows touch a different number of month buckets WHEN `metrics()` runs THEN `compareGhost.length === points.length`, with truncation or `null` padding as needed _(verifies ARCH forward-stress scenario, decision A7)_

##### Smoothing (ma7) wiring

- **smoothing applies the moving average to aggregated series points** — GIVEN a fixture with known per-bucket `costComputed` values across several buckets WHEN queried with `smoothing: "ma7"` THEN `Series.points` values match T2's `movingAverage7` applied to the raw aggregated values _(verifies R4)_

##### Regression guard

- **mode: "series" with no compare/smoothing/distribution is unaffected** — GIVEN the same fixture and query shapes as #P2-8's existing `engine.test.ts` cases WHEN `metrics()` runs with no `mode`/`compare`/`smoothing` set THEN output is identical to today's shipped behavior _(guards backward-regression risk for `engine.ts`'s core pipeline and its reuse of `measures.ts`/`dimensions.ts`)_
- **rewritten no-op test asserts real output, never throws** — GIVEN a `mode: "series"` query with `compare: "previous-period"` and `smoothing: "ma7"` set, and separately a `mode: "distribution"` query WHEN `metrics()` runs THEN neither throws, and `compareGhost` / smoothed `points` / `distribution` are real, non-`undefined` values — replacing the #P2-8-era assertion that they stayed `undefined` _(verifies R1, R3, R4 — supersedes the prior no-op test)_

### Implementation Notes

- **Module(s):** `server/metrics/engine.ts` — the sole orchestrator per ARCH Module Boundaries, now also importing `distributions.ts`.
- **Pattern reference:** engine.ts's existing `scopeFor()`/`buildGroups()` — reused, not duplicated, for both distribution-mode entity scoping and the compare pipeline's previous-range re-run.
- **Key decisions:** ARCH A1 (`distributionEntity` field, required for `mode: "distribution"`), A8 (entity values built from `scopeFor()`'s existing per-group `sessions`/`turns`/`calls` output plus `computeMeasure`, one call per entity), A9 (distribution mode ignores `"time"` in `dimensions`), A6/A7 (consumed via T2's functions, not reimplemented).
- **Suggested implementation order:** (1) distribution mode dispatch + entity scoping, (2) smoothing pass, (3) compare (most complex — requires the shifted-range pipeline re-run), (4) rewrite the no-op test last, once all three behaviors are real.
- **Libraries:** none new.
- **High-risk callouts:** the `MetricsQuery` discriminated-union edit (Medium risk, ARCH Areas of Impact) has no live consumer yet — mitigated by `tsc` plus the regression-guard test above, which pins down that #P2-8's existing `mode: "series"` behavior is untouched.

### Scope Boundaries

- Do NOT add a `POST /api/metrics` route or any `Store` wiring — #P2-10, ARCH Out of Scope.
- Do NOT add query-shape validation for nonsensical `distributionEntity`/measure combinations (e.g. `"call"` entity with a turn-grain-only measure) — ARCH Out of Scope, matches #P2-8's existing "malformed query is a caller/type bug" stance.
- Do NOT modify `measures.ts`, `dimensions.ts`, or `grain.ts` — reuse their existing exports only.

### Files Expected

**New files:** none.

**Modified files:**
- `server/metrics/engine.ts` (mode dispatch; distribution entity scoping; compare pipeline re-run + alignment; smoothing pass)
- `server/metrics/engine.test.ts` (rewritten no-op test; new wiring/regression-guard tests)
- `shared/metrics-contract.ts` (`MetricsQuery` discriminated union: adds `distributionEntity`)

**Must NOT modify:** `server/metrics/measures.ts`, `server/metrics/dimensions.ts`, `server/metrics/grain.ts` (touched-but-not-changed, regression-guarded above); `server/metrics/distributions.ts` (T1/T2's file — consumed, not edited); the `Distribution` portion of `shared/metrics-contract.ts` (T1's slice).
