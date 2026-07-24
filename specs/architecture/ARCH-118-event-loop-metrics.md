# Architecture: Wide-range series metrics — single-pass inversion

> **Date:** 2026-07-24
> **Issue:** #118
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Standalone brief — GitHub issue #118 (bug). See Inferred Requirements.
> **Type:** refactor (performance)

## Architecture Summary

Series-mode `/api/metrics` queries over wide date ranges take 15–90s of synchronous
event-loop time, freezing every concurrent request behind them. The cause is a
`measure × group × bucket` triple loop in `computeSeriesForRange`
(`server/metrics/engine.ts:317-329`) where each innermost cell calls `scopeFor`, which
re-filters `group.calls`, **all** turns, and **all** sessions and re-runs `Date.parse`
on the same timestamp strings — `O(measures × groups × buckets × (calls+turns+sessions))`,
doubled by `compare: "previous-period"`. The fix **inverts the loop into a single pass
over records**: each call/turn/session is parsed once and assigned to its `(group, bucket)`
cell, then measures aggregate per cell over a dense bucket axis. This collapses the cost
to `O(calls+turns+sessions)` bucketing + `O(cells × measures)` aggregation, hitting the
#P5-1 <100ms query target. The change is contained to `server/metrics/engine.ts` (no
shared-contract, parser, or store change), plus an extension to `server/ingest/benchmark.ts`
that exercises the pathological query shapes so this regresses loudly, and a new benchmark
row in `specs/claude-lens-plan.md`. This mirrors the analogous inversion already done for
distribution mode (the ARCH T1 session-scope index) and keeps the engine single-threaded
per architecture §5.7.

## Inferred Requirements

| ID  | Inferred Requirement | Source |
|-----|----------------------|--------|
| R1  | Any preset series-mode query over the full corpus (all measures × all dimensions × any grain, incl. `compare`/`smoothing`) answers well inside the #P5-1 100ms query target. | Issue "Expected vs actual" |
| R2  | A single slow/large metrics query never head-of-line-blocks other requests for a user-perceptible duration. | Issue "Symptom" |
| R3  | Series-mode output is **byte-for-byte identical** to the current engine for every query shape — same measures, groups, bucket timestamps, `compareGhost`, smoothing, `basis`, and dense/empty semantics. | Regression-safety (engine is the single source for every chart, §8) |
| R4  | The ingest/query benchmark exercises wide-range × hour-grain × breakdown × compare shapes and records a plan-log row, so a future regression to this path fails the benchmark instead of shipping silently. | Issue "Suspected area" final paragraph |

## High-Level Structure

Single-module refactor inside `server/metrics/engine.ts`. No new layers, routes, or
contracts. Data flow is unchanged end-to-end:

```
POST /api/metrics
  → routes/metrics.ts  (parse+validate query, resolve pricing/gateSummaries,
                        build MetricsInput = { calls, turns, sessions, pricing, gateSummaries })
  → engine.ts  metrics(input, query)
       ├── mode:"distribution" → computeDistributionSeries   (UNCHANGED — already inverted via ARCH T1)
       ├── mode:"scatter"      → throws → metricsScatter()    (UNCHANGED)
       └── mode:"series"       → computeSeriesForRange  ◄── THE CHANGE
                                   + compare/previous-period + ma7 smoothing (UNCHANGED wrappers)
  → Series[]
```

**Current series pipeline (replaced):**
```
filterAndGroup → for measure: for group: for bucket:
    scopeFor(group, bucket)   ← re-filters group.calls + ALL turns + ALL sessions,
                                 Date.parse per record per cell  ← O(M×G×B×(C+T+S))
    computeMeasure(measure, scope)
```

**New series pipeline (single pass):**
```
filterAndGroup (unchanged: parses+filters calls once, builds groups)
  → build per-group bucketed scopes in ONE pass over records:
      • group.calls already assigned by buildGroups → bucket each call once
      • turns  matched to groups (turnMatchesGroup) + bucketed once
      • sessions matched to groups (sessionMatchesGroup) + bucketed once
    yielding cellScopes: Map<group.dimensionKey, Map<bucketStartMs|null, MeasureScope>>
  → for measure: for group: for bucket (dense enumerateBuckets):
      computeMeasure(measure, cellScopes[group][bucket] ?? EMPTY_SCOPE)
```

Everything downstream of `computeSeriesForRange` — `mergeCompareGhost`,
`movingAverage7`, the `SeriesPoint.t` ISO-string derivation, `basis` tagging —
is untouched. `compare: "previous-period"` still calls the (now-fast)
`computeSeriesForRange` a second time on the shifted range.

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|------|----------|-------------------------|-----------|
| Algorithm | Invert `measure×group×bucket` re-filter into a single pass that assigns records to `(group,bucket)` cells | Keep triple loop but memoize `Date.parse`; keep loop but early-exit sorted buckets | Inversion removes the `B` (and re-scan) multiplier entirely, not just the parse cost — the parse was a symptom, the re-filter is the disease. Matches the already-shipped distribution-mode inversion (ARCH T1). |
| Timestamp parsing | Parse each record's timestamp **once per query**, engine-local | Store pre-parsed `timestampMs`/`startedAtMs`/`firstAtMs` in the columnar store at ingest (issue's second suggestion) | Inversion alone reduces parses to `O(C+T+S)` per query (~5.5k), already inside budget. Ingest-time fields only amortize across queries — marginal — while rippling through `shared/types.ts`, the parser, both derive steps, and every fixture/test. Respects engine decision A1 (plain arrays, Store-independent, fixture-testable). Deferred as a clean follow-up if a future benchmark ever proves per-query parsing dominates. |
| Concurrency | Stay single-threaded; no result cache, no worker thread | Result cache keyed by `(query, storeVersion)`; move engine to a worker | §5.7: "single-threaded until proven otherwise… measure, then decide." Once wide queries are <100ms the head-of-line block is gone at the source; a cache/worker guards a slow query that no longer exists. Filed as Out of Scope, reopen only if the extended benchmark still shows a problem. |
| Bucket assignment | Reuse existing `bucketStart(epochMs, grain)` + `enumerateBuckets` from `grain.ts` | New bucketing math | Correctness (DST, week/month boundaries, dense axis) already lives and is tested in `grain.ts`; the inversion must call the *same* `bucketStart` so results match bit-for-bit. |

## Patterns & Conventions

- **Engine takes plain arrays, never a live Store (decision A1, plan.md 2026-07-14)** — the refactor stays inside this boundary; `metrics(input, query)` signature and `MetricsInput` shape are unchanged.
- **Dense-by-construction output** — `enumerateBuckets` still drives the emitted point axis; empty cells resolve to an `EMPTY_SCOPE` and `computeMeasure` returns its established value (0 for activity measures, `null` for unavailable ones). No change to gap-filling semantics.
- **`UNKNOWN` bucketing, tool multi-value fan-out, host resolution** — the new pass reuses the *existing* `buildGroups` / `groupKeysForCall` / `turnMatchesGroup` / `sessionMatchesGroup` helpers verbatim so the documented tool double-count and every dimension edge behave identically.
- **Per-case switch exhaustiveness (grain.ts / measures.ts convention)** — no new switch surface introduced; existing exhaustive switches untouched.
- **Comment-density match** — `engine.ts` is heavily commented with the *why* of each subtle decision; new helpers follow that density, especially the invariant "results must match the pre-inversion engine."

## Data Models

No persisted or shared data-model change. One **engine-internal** intermediate structure is
introduced (not exported, not serialized):

### CellScopes (internal to engine.ts)

**Purpose:** the materialized `(group, bucket) → MeasureScope` map that replaces per-cell
`scopeFor` calls.

**Key fields:**
| Field | Type / Constraint | Notes |
|-------|-------------------|-------|
| keyed by | `group.dimensionKey` (string) then `bucketStartMs` (`number \| null`) | `null` bucket = the no-`time`-dimension case (single bucket per group), preserving today's `buckets = [null]` path. |
| value | `MeasureScope` = `{ calls: ApiCall[]; turns: Turn[]; sessions: Session[] }` | Exact same shape `computeMeasure` already consumes — zero change to `measures.ts`. |

**Lifecycle:** built once per `computeSeriesForRange` invocation from the already
range-filtered/grouped records; read during the dense aggregation loop; discarded when
the call returns. `compare` builds a second, independent instance for the shifted range.

## API Contracts / Interfaces

### `computeSeriesForRange` (internal module function — signature UNCHANGED)

**Boundary:** internal module function within `server/metrics/engine.ts`.

**Operations:**

| Op | Signature | Purpose | Returns |
|----|-----------|---------|---------|
| `computeSeriesForRange` | `(input: MetricsInput, query: SeriesMetricsQuery \| DistributionMetricsQuery, range: {from,to}) → Series[]` | Series-mode aggregation for one range (also serves compare's shifted range) | `Series[]` — **identical output to today, faster** |

New **private** helpers expected (names indicative, generate-tasks/implement finalize):
- `buildCellScopes(groups, buckets, grain, input, rangeFromMs, rangeToMs, hostBySessionId) → Map<string, Map<number|null, MeasureScope>>` — the single-pass assignment.
- an `EMPTY_SCOPE` constant (frozen `{calls:[],turns:[],sessions:[]}`) for dense empty cells.

**No change** to the exported `metrics()` signature, `MetricsInput`, `MeasureScope`,
`Series`, or any `shared/*` contract.

### `POST /api/metrics` (HTTP — UNCHANGED)

Request/response shape, validation, error codes, and `basis` labelling are all unchanged.
This is a pure latency improvement behind a stable contract.

## Module Boundaries

| Module / Package | Responsibility | Allowed Dependencies |
|------------------|----------------|----------------------|
| `server/metrics/engine.ts` | Compose grain/dimensions/measures/distributions into `Series[]`; owns the new single-pass bucketing | `grain.ts`, `dimensions.ts`, `measures.ts`, `distributions.ts`, `session-population.ts`, `logical-turns.ts`, shared contracts — unchanged import set |
| `server/metrics/grain.ts` | `bucketStart` / `enumerateBuckets` / labels | none new — reused as-is |
| `server/metrics/measures.ts` | `computeMeasure(measure, scope, …)` | unchanged; consumes the same `MeasureScope` |
| `server/ingest/benchmark.ts` | Boot + (new) query-latency benchmark harness | may now import `metrics` from `server/metrics/engine.ts` and build a `MetricsInput` from the store — new but same-layer dependency |
| `server/routes/metrics.ts` | Build `MetricsInput`, call `metrics()` | unchanged |

## Change Footprint

_Brownfield refactor — the center of gravity. Real paths, read back below._

### New files / modules

| Path | Purpose | Pattern reference |
|------|---------|-------------------|
| _(none)_ | All new code is private helpers inside existing `engine.ts` and `benchmark.ts` | — |

### Modified files / modules

| Path | What changes here |
|------|-------------------|
| `server/metrics/engine.ts` | Replace the `measure×group×bucket` `scopeFor` loop (`:317-329`) with a single-pass `buildCellScopes` + dense aggregation over `enumerateBuckets`; parse each call/turn/session timestamp once. `scopeFor` (`:241`) is retained **only** for its `bucketStartMs === null` callers in the distribution/non-time path, or removed if all callers migrate — confirm during implement. |
| `server/ingest/benchmark.ts` | Add a query-latency phase: after ingest settles, build `MetricsInput` from the store (`listCalls`/`listTurns`/`listSessions`, default pricing, empty `gateSummaries`) and time `metrics()` over the pathological shapes from the issue repro (all-time day+compare+ma7 multi-measure/multi-dim; all-time hour × model breakdown). Print + plan-log a row. |
| `server/metrics/engine.test.ts` | Add cases pinning the wide-range/hour-grain/breakdown/compare output so the inversion is proven equivalent (see Risk §). |
| `specs/claude-lens-plan.md` | New benchmark-log row recording query latencies (before/after) for the pathological shapes, under the #P5-1 table (or a #118 sibling row). |
| `package.json` | Possibly a `bench:query` script (or fold query timing into `bench:ingest`) — decide in implement; low-risk. |

### Deleted / replaced

| Path | Reason |
|------|--------|
| `server/metrics/engine.ts` — the per-bucket `scopeFor` re-filter inside the series loop | Superseded by `buildCellScopes`. `scopeFor` itself may survive for the distribution `null`-bucket path; the *series triple-loop invocation* of it is what's removed. |

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|------|----------------|
| `server/metrics/measures.ts` (`computeMeasure`, `EMPTY_SCOPE` semantics) | Receives cell scopes from the new path; the empty-cell case must produce the *same* value as today's empty `scopeFor` result (0 vs `null` per measure). Any drift in how empty cells reach it silently changes chart values. |
| `server/metrics/grain.ts` (`bucketStart`, `enumerateBuckets`) | The new pass must bucket with the identical `bucketStart(Date.parse(ts), grain)` call today's `scopeFor` uses — same local-timezone Date math — or bucket boundaries shift. |
| `server/metrics/dimensions.ts` + `turnMatchesGroup`/`sessionMatchesGroup`/`groupKeysForCall` in engine.ts | Group membership logic is reused, not rewritten; if the pass re-derives membership differently (esp. turn representative-call and tool multi-value fan-out) counts diverge. |
| `server/routes/metrics.ts` | Unchanged, but it's the sole production caller — its `MetricsInput` assembly is what the benchmark must faithfully replicate (pricing + gateSummaries defaults) for the numbers to be meaningful. |
| `server/metrics/scatter.ts`, `computeDistributionSeries` | Share `filterAndGroup` and (distribution) `scopeFor`. If `scopeFor`/`filterAndGroup` signatures shift, these must still compile and behave identically. |
| `client/**` `ChartCard` / TanStack Query consumers | Depend on byte-identical `Series` output (ISO `t`, `compareGhost`, dense points). No client change intended; a values/timestamp regression would surface here as wrong charts. |

## Areas of Impact

| Area | Impact | Risk (L/M/H) | Why |
|------|--------|--------------|-----|
| `server/metrics/engine.ts` series path | Rewritten hot loop | **M** | Core correctness surface for every chart; mitigated by equivalence tests + existing 43 engine tests. |
| All curated pages + Explore (Dashboard, Trends, Models, Sessions…) | Faster, identical data | **L** | One engine serves every chart (§8); latency-only improvement behind stable output. |
| Distribution / scatter modes | Must keep compiling/behaving if shared helpers change | **L** | Already inverted (ARCH T1); only touched if `scopeFor`/`filterAndGroup` signatures move. |
| Benchmark + plan log | New query-latency coverage | **L** | Additive; guards the regression going forward. |
| Event loop / concurrency | HoL blocking eliminated for wide queries | **L→positive** | Root cause removed; no threading change (§5.7 honored). |

**Contract changes:** none. No shared type, HTTP response shape, WS message, or public
signature changes. `metrics()`, `MetricsInput`, `MeasureScope`, `Series` all stable.

**Cross-cutting ripples:** none for auth, telemetry, migrations, feature flags, or WS. Build
pipeline unaffected (no new deps; `bench:query`/`bench:ingest` are dev scripts). The only
"rollout" surface is the plan.md benchmark log.

## Cross-Cutting Concerns

- **Errors:** unchanged. Malformed/unparseable timestamps (`toStr()`-coerced `""` → `NaN`) are still excluded in `filterAndGroup` (`Number.isFinite` guard, review finding H2) and skipped during the single pass exactly as `scopeFor` skips them today; `wallMinutes`'s per-turn `NaN` guard (H1) is in `measures.ts`, untouched.
- **Logging & metrics:** no new runtime logs. The benchmark prints a markdown row (existing convention). Server `responseTime` (already logged) is the field that should drop from 91502ms to <100ms — the observable success signal.
- **Auth / authz:** n/a — no auth surface touched.
- **Performance:** target is #P5-1's <100ms query budget for the issue's two repro shapes over the 130MB/5541-call corpus (currently 28.8s and 91.5s). Budget verified by the extended benchmark, not just unit tests. Memory: `buildCellScopes` holds record references (not copies) keyed by cell — bounded by `groups × buckets`, same reference set already flowing through the old path, no material RSS change.
- **Security:** n/a — no new input parsing, no new external surface; query validation stays in `routes/metrics.ts`'s `parseMetricsQuery`.
- **Migrations / rollout:** none. Pure in-process behavior change; no persisted state, no cache to invalidate, no client coordination. Ships in one PR; instantly revertible.

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies |
|---|----------|--------------|----------------|-----------|
| A1 | Invert the series `measure×group×bucket` re-filter into a single pass building `(group,bucket)→MeasureScope` cells | Memoize `Date.parse` only; sorted-bucket early-exit | Removes the `B`+re-scan multiplier, not just the parse cost; mirrors the shipped distribution inversion (ARCH T1) | R1, R2 |
| A2 | Parse timestamps once per query, engine-local | Store `timestampMs`/`startedAtMs`/`firstAtMs` at ingest | Inversion already drops parses to `O(C+T+S)`/query; ingest fields ripple through contract/parser/derive/fixtures for marginal cross-query gain; keeps engine decision A1 (plain arrays) | R1 |
| A3 | Reuse `bucketStart`/`enumerateBuckets`/`buildGroups`/`*MatchesGroup` verbatim; assert output equivalence | Rewrite bucketing/grouping alongside the loop | Equivalence is the top requirement; reusing tested helpers is the only way to guarantee bit-identical results | R3 |
| A4 | Extend `benchmark.ts` with query-latency cases for the pathological shapes + plan-log row | Rely on unit tests only | #P5-1 passed because it never ran these shapes; a benchmark is what makes a future regression fail loudly | R4 |
| A5 | Defer result cache and off-event-loop worker | Add cache keyed by `(query,storeVersion)`; move engine to worker thread | §5.7 single-threaded-until-proven; sub-100ms queries eliminate HoL at the source, making cache/worker complexity that guards a non-problem | R2 (Out of Scope) |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|----------|---------------------------|
| All-time × hour grain (~13,600 buckets) × model breakdown (the 91.5s repro) | Single pass = `O(C+T+S)` bucketing + dense `cells×measures` aggregation over already-materialized cells; no per-bucket re-scan. Verified by the new benchmark. |
| `compare: "previous-period"` (doubles work) | Two independent fast `computeSeriesForRange` runs; each is now fast, so the double is trivial. |
| Concurrent 2.2s `gatePassRate` query arriving during a wide query | Wide query no longer occupies the loop for tens of seconds; the concurrent query's ~29s queue delay disappears (R2). |
| Empty range / empty filter / no matching calls | Dense axis still enumerated; empty cells resolve to `EMPTY_SCOPE` → `computeMeasure` returns established 0/`null` — same as today's empty `scopeFor`. |
| Unparseable timestamps (`""` → `NaN`) | Excluded in `filterAndGroup` before the pass; never assigned to a bucket — identical to current exclusion. |
| Corpus grows 5.5k → 550k calls | Cost stays linear in records + `cells×measures`; buckets are range/grain-bounded, independent of call count. Degrades gracefully; the deferred worker/cache (A5) is the escape hatch if a future benchmark proves it needed. |
| Tool dimension (multi-valued, documented double-count) | Reuses `groupKeysForCall` fan-out unchanged → same (double-)counts as today; equivalence preserved, not "fixed" (out of scope). |

### Backward — regression risk per touched area

| Touched area | What could regress | How we'd know / mitigation |
|--------------|--------------------|----------------------------|
| `engine.ts` series loop | Bucket boundaries, group membership, or empty-cell values drift from the old path | Equivalence tests in `engine.test.ts` covering hour/day/week/month × breakdown × compare × ma7; run old-vs-new on fixtures. The 43 existing engine tests are the first gate. |
| `computeMeasure` empty-cell contract | Empty cell yields `0` where old path yielded `null` (or vice versa) — silently wrong chart values | Explicit test: dense query with sparse data asserts the exact 0/`null` pattern per measure; `EMPTY_SCOPE` must reach `computeMeasure` identically to today's empty `scopeFor`. |
| `grain.ts` reuse | Off-by-one bucket via a different `bucketStart` call site | Assert the pass calls `bucketStart(Date.parse(ts), grain)` — same expression as `scopeFor:254`; covered by boundary tests (DST, week start, month end). |
| Shared `scopeFor`/`filterAndGroup` with distribution/scatter | Signature change breaks or subtly alters distribution/scatter output | Keep `filterAndGroup` signature stable; if `scopeFor` is retained for distribution's `null` path, leave that path byte-identical; distribution + scatter test suites must stay green. |
| Client `ChartCard` consumers | Wrong `t` (ISO) / `compareGhost` / point order | `computeSeriesForRange`'s point-emission (ISO `t`, order, `basis`) and the `mergeCompareGhost`/`ma7` wrappers are untouched; only the scope-building changes. |

## Open Questions

- **Does `scopeFor` survive for the distribution `null`-bucket path, or is it fully replaced?**
  - **Impact if unresolved:** minor — affects whether the diff also touches `computeDistributionSeries`'s non-session branch.
  - **Suggested default:** retain `scopeFor` for the distribution `bucketStartMs === null` caller (that path isn't the pathological one and already has the ARCH T1 session index for its hot case); only the series triple-loop invocation is removed. Revisit if implement finds it cleaner to unify.
- **Fold query timing into `bench:ingest` or add a separate `bench:query` script?**
  - **Impact if unresolved:** cosmetic — one script vs two.
  - **Suggested default:** extend `bench:ingest` (it already boots a real store and prints a plan-log row); add a query phase after warm boot rather than a second script.

## Out of Scope

- **Result cache keyed by `(query, storeVersion)`** (reason: sub-100ms queries remove the need; adds invalidation surface — reopen only if the extended benchmark still shows a problem, A5).
- **Moving the metrics engine off the event loop (worker thread)** (reason: §5.7 single-threaded-until-proven; not justified once wide queries are fast, A5).
- **Storing pre-parsed epoch-ms in the columnar store at ingest** (reason: marginal cross-query gain vs. contract/parser/fixture ripple; A2 — clean follow-up if ever proven necessary).
- **Fixing the documented tool-dimension double-count** (reason: pre-existing, semantics-preserving refactor must not change it; separate concern).
- **Distribution/scatter mode performance** (reason: already inverted via ARCH T1; not the reported pathology).

---

# Tasks

_This section is populated by the **generate-tasks** skill (Phase 3)._
_Run: `/generate-tasks from: specs/architecture/ARCH-118-event-loop-metrics.md`_
