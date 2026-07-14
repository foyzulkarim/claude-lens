# Architecture: Metrics engine — measures, dimensions, grain

> **Date:** 2026-07-14
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Standalone brief, grounded in settled specs — see Inferred Requirements. No REQ doc; this is a plan task (#P2-8 / issue #25), whose requirements source is `specs/claude-lens-plan.md` + `specs/claude-lens-architecture.md` §8 + `specs/claude-lens-pages.md` (data source legend), per this repo's delivery pipeline (`CLAUDE.md`).
> **Type:** feature (brownfield — new module against already-settled shared contracts)

## Architecture Summary

`server/metrics/{engine,measures,dimensions,grain}.ts` implement the single `metrics(input, query) → Series[]` function that every chart in the app will eventually call. The engine is a pure function with zero I/O and zero dependency on the live `Store` class: it takes plain `ApiCall[]`/`Turn[]`/`Session[]` arrays (already parsed and derived by earlier phases) plus a pricing table, and a `MetricsQuery` (already fully typed in `shared/metrics-contract.ts`), and returns dense, grain-bucketed `Series[]`. Filtering and grouping operate primarily on `ApiCall[]` (the finest-grained record, carrying model/project/branch/version/entrypoint/tool/timestamp), with `Turn[]`/`Session[]` consulted for the handful of dimensions/measures that only exist at coarser grain. Of these, `wallMinutes` is computable today (`Turn.startedAt`/`endedAt` are always populated by the already-shipped `deriveTurns.ts`, a real 🟡 timestamp-estimate; upgrades to `Turn.wallMs` once #P4-11/#P4-13 populate it) — the rest (`gateStatus`, `costObserved`, `linesAdded/Removed`, `gateScore`, `apiMs`) are honestly `null` today since no shipped parser populates their backing fields yet. `distributions.ts` (percentiles/histogram/pareto/`ma7`/previous-period compare) and HTTP wiring are explicitly out of scope — #P2-9 and #P2-10 respectively.

## Inferred Requirements

| ID  | Inferred Requirement              | Source                              |
|-----|-----------------------------------|--------------------------------------|
| R1  | `metrics(input, query) → Series[]` computes every measure × any dimension × any grain, matching hand-computed fixture values. | Issue #25 acceptance criteria; architecture §8 |
| R2  | Unit switching ($ ↔ tokens ↔ calls ↔ turns) is a measure swap only — same query shape, no special-casing per unit. | Issue #25 acceptance criteria; architecture §8 |
| R3  | Costs carry a `computed`/`observed` basis label per the tier rules. | architecture §8, §4 |
| R4  | Ships a default pricing table (model → $/1M rates) that `costComputed` multiplies against; structured so real per-model rates can replace placeholders without a redesign. | plan.md #P2-8 scope; user decision this session (placeholder values now, real per-model structure) |
| R5  | Output is dense across the requested range/grain (every bucket present, including zero-activity ones) so charts render "no data for filter" / empty states without client-side gap-filling. | pages.md §0 global analytics layer ("Empty/partial-range states") |

## High-Level Structure

```
MetricsInput { calls: ApiCall[], turns: Turn[], sessions: Session[], pricing: PricingTable }
                                    │
                                    ▼
                          engine.ts: metrics(input, query)
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
  1. filter calls by       2. split query.dimensions      3. group by breakdown-dim
     range + filters          into "time" (bucketing         cartesian product
     (dimensions.ts)           toggle) vs. breakdown dims     (dimensions.ts)
                                                                    │
                                                                    ▼
                                                    4. bucket each group by grain
                                                       (grain.ts) if "time" requested,
                                                       else one whole-range bucket
                                                                    │
                                                                    ▼
                                                    5. aggregate per (measure × group ×
                                                       bucket) — measures.ts, consulting
                                                       turns/sessions for coarse-grain
                                                       measures
                                                                    │
                                                                    ▼
                                                              Series[] out
```

Two concrete page-spec examples pin the `dimensions` array's semantics (nothing in the specs stated this explicitly — inferred from usage):
- `dimensions: ["time", "project"]` → "Stacked-area composition: spend share by project over time" (Projects page) — one `Series` per project, points bucketed by grain.
- `dimensions: ["project"]` (no `"time"`) → "Per-project efficiency table" (Projects page) — one `Series` per project, single aggregate point over the whole range.

Nothing in the existing system is modified — this is new, unwired code. `routes/metrics.ts` (which will call `engine.metrics()` and assemble `MetricsInput` from a live `Store`) is #P2-10.

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|---|---|---|---|
| Date/grain bucketing | Native `Date` local-timezone getters + epoch ms; `Intl.DateTimeFormat` for point labels | A date library (date-fns/dayjs/luxon) | architecture §2 explicitly excludes date libraries ("bucket on epoch ms; `Intl` for labels") |
| Bucket timezone | Local system timezone (not UTC) | UTC | Single-user localhost tool (architecture §1) — "today"/"this week" should match the user's own calendar, not a server's UTC day. **Flagged to developer as a default, not a confirmed requirement — nothing in the specs pins this explicitly.** |
| Week start | Monday | Sunday | Common ISO-week convention; **same flagged-default status as timezone above.** |
| Engine input shape | Plain arrays (`ApiCall[]`/`Turn[]`/`Session[]`), no `Store` dependency | Engine takes a live `Store` instance and calls new `Store.listAllCalls()`/`listAllTurns()` itself | Matches the existing pure-function precedent (`derive-turns.ts`, `derive-session.ts`); keeps the engine testable against fixtures with zero `Store`/debounce/WS setup; matches the module-boundary wording that `routes/` (not `metrics/`) is what imports `store/`. Logged in `specs/claude-lens-plan.md` decisions log, 2026-07-14. Consequence (deferred to #P2-10, not this task): `Store` still needs a cross-session read method to actually feed the engine in production. |
| Pricing table shape | `Record<string, ModelRate>` (`ModelRate = { input, output, cacheRead, cacheCreate }`, $/1M tokens), keyed by exact `ApiCall.model` string | A single flat global rate (V1's approach) | Plan explicitly calls for a "default pricing table (model → per-1M rates)" — a real per-model structure, not a flat number, so #P4-15's editor and future real pricing can slot in per-model without a schema change. Default values are placeholders (V1's flat legacy rates, $5/$25/$0.50/$6.25 per 1M, applied identically to all four known model names for now) — explicit user decision this session: assume values now, structure is what matters, update numbers later. |
| Unpriced model behavior | `$0` contribution, never thrown/`NaN` | Throw / exclude the call from the query entirely | Matches `derive-session.ts`'s existing precedent ("a session with real usage and $0 cost is a visible, honest 'not priced yet' state, not silently wrong"). Coverage reporting on unpriced models is #P4-14's job. |
| `tool` dimension fan-out | A call using N tools is counted into all N tool buckets (full usage/cost duplicated per bucket, not divided) | Split each call's usage proportionally across its tools | There's no per-tool token/cost split in the source transcript data to divide by — inventing a ratio would fabricate precision that doesn't exist. Documented as a known characteristic, not a bug. |
| Coarse-grain measures (`wallMinutes`, `costObserved`, `linesAdded/Removed`, `gatePassRate`/`gateStatus`, `apiMs`) | Computed from `Turn[]`/`Session[]` directly, time-bucketed by the turn's/session's own start timestamp; call-level dimensions (model/project/etc.) crossed with these measures use the turn's/session's first call as representative | Proportionally apportion the aggregate across the session's/turn's individual calls | Simpler and more honest than inventing a per-call split ratio for a number that's only known at coarser grain; avoids fabricating precision. `wallMinutes` computes today from `Turn.startedAt`/`endedAt` (always populated). `costObserved`/`linesAdded`/`linesRemoved`/`gatePassRate`/`apiMs` return `null` today — their backing fields don't exist until #P4-11/#P4-13 land; no timestamp-delta proxy is invented for `apiMs` since nothing in `shared/types.ts` names one. |
| `mode`/`compare`/`smoothing` handling | `engine.ts` accepts the full `MetricsQuery` shape but only implements `mode: "series"` with no `compare`/`smoothing` (present-but-no-op) | Reject/throw if those fields are set | No UI exposes those toggles yet (#P3-4 is the first live chart) so no caller can hit this; #P2-9 is the explicit owner of `distributions.ts` + previous-period alignment + `ma7`, and architecture's own task split names it that way |

## Patterns & Conventions

- **Pure derivation function** — `metrics()` follows the same shape as `deriveTurns()`/`deriveSession()`: arrays in, structure out, no side effects, no class state. Consistent with the existing `store/` module's separation between stateful orchestration (`store.ts`) and pure transforms (`derive-*.ts`).
- **Honest-gap philosophy** — an activity measure with zero matching records returns `0` (a true fact); a measure whose source data doesn't exist yet returns `null` (an "unavailable" signal, matching the 🔴-tier locked-card treatment elsewhere in the app). Never conflate the two.
- **No new dependencies** — everything here is native JS/TS + `Intl`, per architecture §2's rejected-alternatives list.

## Data Models

### `MetricsInput` (new, `server/metrics/engine.ts`)

**Purpose:** the engine's sole input — a snapshot of already-derived data plus pricing, fully decoupled from `Store`.

| Field | Type / Constraint | Notes |
|---|---|---|
| `calls` | `ApiCall[]`, required | Primary substrate for time/project/model/branch/version/entrypoint/sidechain/tool dimensions |
| `turns` | `Turn[]`, required | Substrate for `gateStatus` dimension and turn-grain measures (`wallMinutes` — computable today from `startedAt`/`endedAt`; `apiMs` — `null` until #P4-13) |
| `sessions` | `Session[]`, required | Substrate for session-grain measures (`costObserved`, `linesAdded/Removed`, `gateScore`) and the `sessions` count measure |
| `pricing` | `PricingTable`, required | See below |

**Relationships:** `turns[].calls` and sessions are already linked to their calls upstream (derive-turns.ts/derive-session.ts); the engine does not re-derive these joins, it only reads them.

**Lifecycle:** constructed fresh per query call (by #P2-10's route, once it exists); never mutated, never persisted.

### `PricingTable` / `ModelRate` (new, `server/metrics/measures.ts`)

**Purpose:** the model → $/1M-token rate lookup that `costComputed` multiplies against.

| Field | Type / Constraint | Notes |
|---|---|---|
| `PricingTable` | `Record<string, ModelRate>` | Keyed by exact `ApiCall.model` string; a missing key means unpriced (→ $0, not thrown) |
| `ModelRate.input` | `number` | $ per 1,000,000 input tokens |
| `ModelRate.output` | `number` | $ per 1,000,000 output tokens |
| `ModelRate.cacheRead` | `number` | $ per 1,000,000 cache-read tokens |
| `ModelRate.cacheCreate` | `number` | $ per 1,000,000 cache-write tokens |

**Relationships:** none — a flat lookup table, no FK.

**Lifecycle:** a `DEFAULT_PRICING_TABLE` constant ships with this task (placeholder values); #P4-15's Settings pricing editor overrides it at runtime (out of scope here — the override plumbing is #P4-15's job, this task only defines the shape and default).

## API Contracts / Interfaces

### `server/metrics/engine.ts`

**Boundary:** internal module (no HTTP surface — that's #P2-10)

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| `metrics` | `(input: MetricsInput, query: MetricsQuery) => Series[]` | THE query function — computes every requested measure × dimension × grain combination | Never throws on bad/missing data (unpriced model, empty range, unmatched filters) — returns dense `Series[]` with `0`/`null` points as appropriate. Malformed `MetricsQuery` (e.g. unknown enum value) is a caller bug, not handled defensively here — `shared/metrics-contract.ts`'s types are the only contract. |

**Auth requirements:** none — pure function, no caller identity concept at this layer.

### `server/metrics/grain.ts`, `dimensions.ts`, `measures.ts`

**Boundary:** internal module, imported only by `engine.ts` (and directly by their own test files)

**Operations:** helper functions (`bucketStart`, `bucketLabel`, `enumerateBuckets`; dimension value-extractors + filter matching; per-measure aggregators) — no independent public contract beyond what `engine.ts` composes them into.

## Module Boundaries

| Module / Package | Responsibility | Allowed Dependencies |
|---|---|---|
| `server/metrics/engine.ts` | Orchestrates filter → group → bucket → aggregate; the only exported entry point | `shared/types.ts`, `shared/metrics-contract.ts`, sibling `metrics/` files |
| `server/metrics/measures.ts` | Per-measure aggregation + pricing table + default constant | `shared/types.ts`, `shared/metrics-contract.ts` (for the `Measure` type) |
| `server/metrics/dimensions.ts` | Per-dimension value extraction (call/turn/session-level) + filter matching | `shared/types.ts`, `shared/metrics-contract.ts` |
| `server/metrics/grain.ts` | Epoch-ms bucketing, dense bucket enumeration, `Intl` labels | none (pure, stdlib only) |

`metrics/` imports nothing from `store/` or `ingest/` — the module-boundary rule ("`store/` is the only module `routes/` may import for data") implies `routes/metrics.ts` (#P2-10) is what bridges `store/` and `metrics/`, not `metrics/` reaching into `store/` itself.

## Change Footprint

### New files / modules

| Path | Purpose | Pattern reference |
|---|---|---|
| `server/metrics/engine.ts` | `metrics(input, query) → Series[]` orchestrator | `server/store/store.ts`'s role as the thin orchestrator over pure derive functions |
| `server/metrics/measures.ts` | Per-measure aggregators + `PricingTable`/`ModelRate` types + `DEFAULT_PRICING_TABLE` | — |
| `server/metrics/dimensions.ts` | Per-dimension value extraction + filter matching | — |
| `server/metrics/grain.ts` | Epoch-ms bucketing + `Intl` labels | — |
| `server/metrics/engine.test.ts`, `measures.test.ts`, `dimensions.test.ts`, `grain.test.ts` | Fixture-driven unit tests, hand-computed expected values per acceptance criteria | `server/store/derive-session.test.ts`'s style (hand-built `ApiCall[]`/`Turn[]` literals, not full JSONL fixtures) |

### Modified files / modules

None. (`server/store/store.ts`'s pricer-injection seam and cross-session read gap are explicitly deferred to #P2-10 — see decisions log entry 2026-07-14.)

### Deleted / replaced

None.

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|---|---|
| `shared/types.ts` | Read-only import (`ApiCall`, `Turn`, `Session`, `TokenUsage`). Any future field rename here breaks this module silently until `tsc` catches it — no runtime risk since nothing depends on `metrics/` yet. |
| `shared/metrics-contract.ts` | Read-only import (`MetricsQuery`, `Series`, `SeriesPoint`, `Distribution`). Same as above. |

## Areas of Impact

| Area | Impact | Risk (L/M/H) | Why |
|---|---|---|---|
| `server/metrics/` (new) | Net-new module | L | Nothing imports it yet — zero blast radius until #P2-10 wires a route to it |
| `server/store/store.ts` | No code change in this task, but the plan-doc decisions log now records that #P2-10 must add a cross-session read method | L | Purely a forward-looking note; store.ts itself is untouched here |
| `test/` | New unit test files; possibly new hand-built fixture literals inside those test files (not new JSONL fixtures) | L | Additive only, doesn't touch `test/fixtures/README.md`'s existing tree |

**Contract changes:** none — `MetricsQuery`/`Series` are consumed as-is, not modified.

**Cross-cutting ripples:** none. No auth, no telemetry, no migration, no feature flag, no build-pipeline change — this task ships inert code with no caller.

## Cross-Cutting Concerns

- **Errors:** unknown/missing dimension values (e.g. an empty `model` string, which shouldn't occur post-parse but isn't structurally impossible) bucket under an explicit `"unknown"` key rather than being silently dropped, so per-bucket totals still reconcile against the unfiltered total. The engine never throws on data-shape edge cases (empty input, unmatched filters, unpriced model) — only a malformed `MetricsQuery` itself (a caller/type-level bug) is out of its defensive scope.
- **Logging & metrics:** none — pure in-memory function, no I/O to log.
- **Auth / authz:** not applicable at this layer (no HTTP surface).
- **Performance:** O(calls × breakdown-groups) per query, single-pass filtering plus one grouping pass. At the scale already validated in #P2-7 (low hundreds of MB, ~26 calls/session average), this is comfortably synchronous — no async/streaming needed.
- **Security:** no filesystem or network access; operates entirely on already-in-memory, already-validated data.
- **Migrations / rollout:** none — additive, unwired module; no deployment or backward-compatibility concern.

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies REQs |
|---|---|---|---|---|
| A1 | Engine takes plain `MetricsInput` arrays, no `Store` dependency | Engine takes a live `Store` and reads it directly | Matches existing pure-function precedent (`derive-*.ts`); testable without `Store` machinery; matches module-boundary wording | R1 |
| A2 | `"time"` presence/absence in `query.dimensions` toggles line-chart-dense-buckets vs. bar-chart-single-bucket | A separate explicit flag for chart shape | Directly inferred from two concrete page-spec examples (stacked-area-over-time vs. efficiency table) with no contradicting evidence elsewhere | R1, R5 |
| A3 | `PricingTable` is `Record<model, ModelRate>` with placeholder default values | Flat single global rate (V1's approach) | Plan requires a real per-model table; explicit user decision to seed with placeholders now and correct numbers later | R4 |
| A4 | Unpriced model → `$0`, never thrown | Throw / exclude call from results | Matches `derive-session.ts`'s existing "$0, not fabricated" precedent | R3, R4 |
| A5 | Coarse-grain measures (`wallMinutes`, `costObserved`, `linesAdded/Removed`, `gatePassRate`, `apiMs`) read from `Turn[]`/`Session[]`, bucketed by the turn's/session's own start time, not apportioned across calls | Proportionally split the aggregate across a session's/turn's individual calls | Avoids fabricating a per-call split ratio for data that's only known at coarser grain. `wallMinutes` is real today (`startedAt`/`endedAt` always populated); the rest are `null` until #P4-11/#P4-13 populate their backing fields | R1 |
| A6 | `mode`/`compare`/`smoothing` accepted in the type but no-op'd this task | Throw if set | No caller can set them yet (no UI exists); #P2-9 owns their real implementation per the plan's own task split | R1 |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|---|---|
| Query range/filters match zero calls | Returns dense `Series[]` with `0`/`null` points per enumerated bucket, not an empty array or throw — satisfies the "no data for filter" empty-state requirement |
| A call's `model` isn't in the pricing table | Contributes `$0` to `costComputed`, never `NaN`/throw |
| A call uses multiple tools, queried with `dimensions: ["tool"]` | Full call usage/cost counted into every tool bucket it touches (documented double-count, not divided — no data exists to divide by correctly) |
| A "day" grain bucket crosses a DST transition | Resolves correctly since bucketing uses local-`Date` boundaries (variable-length local days), not fixed 86400000ms windows. Exact previous-period alignment across DST is explicitly #P2-9's acceptance criterion, not this task's |
| `dimensions` requests a coarse-grain measure (`gateStatus`) crossed with a fine-grain one in the same query (e.g. `measures: ["costComputed", "gatePassRate"]`) | Each measure resolves independently against its own appropriate substrate (`calls` vs. `turns`) within the same group/bucket keys — no cross-substrate join needed since grouping/bucketing keys are computed once and each measure aggregator picks its own source array |

### Backward — regression risk per touched area

Not applicable — no existing code is modified in this task (see Change Footprint: Modified files/modules is empty). `store.ts` is referenced only in the decisions log as a forward-looking note for #P2-10, not touched here.

## Open Questions

- Local-timezone bucketing and Monday-start weeks — reasonable defaults, not confirmed requirements from any spec.
  - **Impact if unresolved:** wrong week/day boundaries in charts if the developer actually wanted UTC/Sunday-start.
  - **Suggested default:** proceed with local-tz/Monday-start as designed; cheap to change in `grain.ts` alone if wrong, isolated to one file.
- Whether grain-bucketing/dimension-breakdown tests need new JSONL fixtures under `test/fixtures/` or can use hand-built `ApiCall[]`/`Turn[]`/`Session[]` literals directly in the test files.
  - **Impact if unresolved:** none blocking — this is a test-authoring choice for `/generate-tasks` and `/implement`, not an engine-behavior question.
  - **Suggested default:** hand-built literals in test files, per `derive-session.test.ts`'s existing style — cheaper, and `test/fixtures/README.md`'s tree is scoped to parser/tailer-level concerns, not engine math.

## Out of Scope

- `distributions.ts` (percentiles, histograms, pareto, `mode: "distribution"`) — #P2-9.
- `ma7` smoothing and `compare: "previous-period"` alignment (incl. DST/month-boundary correctness) — #P2-9.
- `POST /api/metrics` route, and the `Store` cross-session read method (`listAllCalls()`/`listAllTurns()` or equivalent) needed to feed it in production — #P2-10.
- Real per-model pricing values (current defaults are explicit placeholders) — a follow-up commit or #P4-15's pricing editor.
- Host/machine dimension's real data source (labeled scan roots) — #P4-15.
- `gateStatus`/`gatePassRate` real data (`Turn.gateStatus` population) — #P4-11.
- `costObserved`/`linesAdded`/`linesRemoved`/`apiMs` real data (premium C/B/L parsing) — #P4-13.

---

# Tasks

## Task T1: Grain bucketing (`grain.ts`)

> **Status:** done
> **Verification:** tdd
> **Effort:** s
> **Priority:** high
> **Depends on:** None
> **Satisfies REQs:** R1, R5
> **Footprint slice:** New: `server/metrics/grain.ts`
> **High-risk areas touched:** None

### Description

Epoch-ms bucketing for the metrics engine's time axis: truncate an instant to the start of its containing hour/day/week/month bucket (local timezone), produce a human-readable `Intl`-formatted label for a bucket, and enumerate every bucket in a range so output is dense (every bucket present, including zero-activity ones) rather than gapped. Zero dependencies on the rest of `metrics/` — this is the foundation `dimensions.ts`/`measures.ts`/`engine.ts` build on.

### Test Plan

#### Test File(s)
- `server/metrics/grain.test.ts`

#### Test Scenarios

##### Bucket truncation

- **truncates to start of local hour** — GIVEN an epoch ms mid-hour WHEN `bucketStart(ms, "hour")` THEN the result is that hour's `:00:00.000` in local time _(verifies R1)_
- **truncates to local midnight** — GIVEN an epoch ms mid-day WHEN `bucketStart(ms, "day")` THEN the result is local midnight of that day _(verifies R1)_
- **truncates to most-recent local Monday midnight** — GIVEN an epoch ms mid-week WHEN `bucketStart(ms, "week")` THEN the result is the local midnight of the Monday on/before that instant _(verifies R1)_
- **truncates to first of local month** — GIVEN an epoch ms mid-month WHEN `bucketStart(ms, "month")` THEN the result is local midnight on the 1st of that month _(verifies R1)_

##### Bucket labels

- **formats a label per grain** — GIVEN a bucket-start epoch ms and each of the four grains WHEN `bucketLabel(ms, grain)` THEN each produces a distinct, human-readable `Intl`-formatted string appropriate to that grain (hour shows time-of-day, day shows a date, week shows a date, month shows month+year) _(verifies R1)_

##### Bucket enumeration (dense output)

- **enumerates every bucket in range with no gaps or duplicates** — GIVEN a `range.from`/`range.to` spanning several buckets at a given grain WHEN `enumerateBuckets(range, grain)` THEN the result is every bucket start in ascending order, one entry per bucket, none skipped or repeated _(verifies R1, R5)_
- **single-instant range produces exactly one bucket** — GIVEN `range.from === range.to` WHEN `enumerateBuckets` THEN the result has exactly one entry _(edge case)_
- **range ending exactly on a bucket boundary** — GIVEN `range.to` equal to the start of the bucket after the last one containing activity WHEN `enumerateBuckets` THEN there is no off-by-one duplicate or missing final bucket _(edge case)_
- **month grain across a variable-length month boundary** — GIVEN a range crossing January 31 into February WHEN `enumerateBuckets(range, "month")` THEN the next bucket starts correctly at March 1 / February's actual length is not assumed fixed _(edge case)_

##### Resilience

- **day bucket resolves correctly across a DST transition** — GIVEN a known DST spring-forward instant (e.g. `America/New_York`, 2026-03-08) with `TZ` pinned for this test only WHEN `bucketStart`/`enumerateBuckets` run across that day THEN the 23-hour local day still buckets as a single day, not two or a fractional one _(verifies ARCH forward-stress: "DST-crossing day bucket")_

### Implementation Notes

- **Module(s):** `server/metrics/grain.ts` per ARCH Module Boundaries — no dependencies on `store/`, `ingest/`, or sibling `metrics/` files (pure stdlib + `Intl`).
- **Pattern reference:** none directly (first pure-math file in `metrics/`); follows the same "no side effects, arrays/primitives in and out" shape as `server/store/derive-turns.ts`.
- **Key decisions:** architecture §2 explicitly excludes date libraries — bucket on epoch ms, label via `Intl` (ARCH Tech Choices). Local system timezone and Monday-start weeks are flagged defaults in ARCH's Open Questions, not confirmed requirements — implement as designed, isolated to this one file if they need correcting later.
- **Libraries:** none new — native `Date` + `Intl.DateTimeFormat` only.
- **High-risk callouts:** None.

### Scope Boundaries

- Do NOT implement `ma7` smoothing or previous-period alignment — that's #P2-9's `distributions.ts` (ARCH Out of Scope).
- Do NOT add a date library dependency.
- Only implement bucket truncation, labeling, and enumeration — no filtering, grouping, or aggregation (that's `dimensions.ts`/`measures.ts`/`engine.ts`).

### Files Expected

**New files:**
- `server/metrics/grain.ts` — `bucketStart`, `bucketLabel`, `enumerateBuckets`
- `server/metrics/grain.test.ts`

**Modified files:** None.

**Must NOT modify:** None (no touched-but-not-changed entries for this task).

---

## Task T2: Dimension extraction (`dimensions.ts`)

> **Status:** done
> **Verification:** tdd
> **Effort:** s
> **Priority:** high
> **Depends on:** None
> **Satisfies REQs:** R1
> **Footprint slice:** New: `server/metrics/dimensions.ts`
> **High-risk areas touched:** None

### Description

Per-dimension value extraction and filter matching: given an `ApiCall` (or, for `gateStatus`, a `Turn`), return its value(s) for any of the ten `Dimension`s, and a predicate to test those values against a query's `filters`. Handles the two dimensions that don't map to a single scalar field on `ApiCall` — `tool` (multi-valued, fans out) and `gateStatus` (lives on `Turn`, not `ApiCall`) — plus `host`, which has no real data source yet and returns a constant.

### Test Plan

#### Test File(s)
- `server/metrics/dimensions.test.ts`

#### Test Scenarios

##### Call-level scalar dimensions

- **extracts project from cwd** — GIVEN an `ApiCall` WHEN `callDimensionValue(call, "project")` THEN returns `call.cwd` _(verifies R1)_
- **extracts model, gitBranch, version, entrypoint** — GIVEN an `ApiCall` WHEN `callDimensionValue` for each of these THEN returns the matching field directly _(verifies R1)_
- **extracts sidechain as main/sidechain label** — GIVEN `call.isSidechain` true/false WHEN `callDimensionValue(call, "sidechain")` THEN returns `"sidechain"`/`"main"` respectively _(verifies R1)_
- **host always returns the constant default** — GIVEN any `ApiCall` WHEN `callDimensionValue(call, "host")` THEN returns `"default"` (no real data source yet, per ARCH) _(verifies R1)_

##### Multi-valued tool dimension

- **returns distinct tool names used in the call** — GIVEN a call with `tools: [{name: "Read"}, {name: "Bash"}]` WHEN `callDimensionValue(call, "tool")` THEN returns `["Read", "Bash"]` _(verifies R1)_
- **a call using the same tool twice dedupes to one bucket** — GIVEN `tools` containing two `{name: "Read"}` entries WHEN `callDimensionValue(call, "tool")` THEN returns `["Read"]`, not `["Read", "Read"]` _(edge case)_
- **a call with no tool_use blocks contributes to no tool bucket** — GIVEN `tools: []` WHEN `callDimensionValue(call, "tool")` THEN returns `[]` (not `["unknown"]` — "used no tools" is a real fact, distinct from a missing scalar field) _(edge case)_
- **a call with 2 distinct tools yields both as independent group keys** — GIVEN a call using `Read` and `Bash` WHEN grouped downstream THEN both names are available as separate keys _(seeds ARCH forward-stress: "multi-tool call double-counts across tool buckets" — the fan-out itself, not the double-counting, is this task's concern)_

##### Turn-level gateStatus dimension

- **extracts gateStatus when set** — GIVEN a `Turn` with `gateStatus: "pass"` WHEN `turnDimensionValue(turn, "gateStatus")` THEN returns `"pass"` _(verifies R1)_
- **returns unknown when gateStatus is absent** — GIVEN a `Turn` with no `gateStatus` (today's reality — nothing populates it yet) WHEN `turnDimensionValue(turn, "gateStatus")` THEN returns `"unknown"` _(edge case)_

##### Missing/malformed scalar values

- **empty-string field buckets as unknown** — GIVEN `call.gitBranch === ""` WHEN `callDimensionValue(call, "gitBranch")` THEN returns `"unknown"` _(edge case)_

##### Filter matching

- **single-value match and no-match** — GIVEN a scalar dimension value and an allowed-values list WHEN `matchesFilter` THEN returns true iff the value is in the list _(verifies R1)_
- **multi-value (tool) matches on any intersection** — GIVEN `callDimensionValue` returning `["Read", "Bash"]` and an allowed list containing `"Bash"` WHEN `matchesFilter` THEN returns true _(verifies R1)_
- **no filter configured for a dimension passes through** — GIVEN `filters` has no entry for a dimension WHEN `matchesFilter` THEN always returns true for that dimension _(edge case)_

### Implementation Notes

- **Module(s):** `server/metrics/dimensions.ts`, depends only on `shared/types.ts` and `shared/metrics-contract.ts` per ARCH Module Boundaries.
- **Pattern reference:** none directly; the "unknown" bucketing rule for missing values is this task's own convention (ARCH Cross-Cutting Concerns: Errors).
- **Key decisions:** tool dimension fan-out is intentional and undivided (ARCH decision, Tech Choices) — do not attempt to split a call's usage/cost across tools here or anywhere else; this task only provides the extraction, `engine.ts` (T4) does the actual grouping/double-count.
- **Libraries:** none new.
- **High-risk callouts:** None.

### Scope Boundaries

- Do NOT resolve `costObserved`/`linesAdded`/`linesRemoved`/`gatePassRate` here — those are measures (`measures.ts`, T3), not dimensions.
- Do NOT implement the actual grouping/bucketing pipeline — that's `engine.ts` (T4).
- Do NOT add a real `host` data source (labeled scan roots) — that's #P4-15 (ARCH Out of Scope).

### Files Expected

**New files:**
- `server/metrics/dimensions.ts` — `callDimensionValue`, `turnDimensionValue`, `matchesFilter`
- `server/metrics/dimensions.test.ts`

**Modified files:** None.

**Must NOT modify:** None.

---

## Task T3: Measure aggregation + pricing table (`measures.ts`)

> **Status:** done
> **Verification:** tdd
> **Effort:** m
> **Priority:** high
> **Depends on:** None
> **Satisfies REQs:** R1, R2, R3, R4
> **Footprint slice:** New: `server/metrics/measures.ts`
> **High-risk areas touched:** None

### Description

Per-measure aggregation over an already-scoped group of calls/turns/sessions, plus the `PricingTable`/`ModelRate` types and the `DEFAULT_PRICING_TABLE` default constant that `costComputed` multiplies against. Covers all 16 measures in `shared/metrics-contract.ts`'s `Measure` union; each either computes a real number today or returns `null` where its backing data doesn't exist yet, per the corrected null-vs-real classification agreed this session (`wallMinutes` is real today; `costObserved`/`linesAdded`/`linesRemoved`/`gatePassRate`/`apiMs` stay `null` until #P4-11/#P4-13).

### Test Plan

#### Test File(s)
- `server/metrics/measures.test.ts`

#### Test Scenarios

##### Token and count measures

- **sums input/output/cache-read/cache-write tokens across scope** — GIVEN a scope of calls with known `usage` values WHEN `computeMeasure` for each token measure THEN returns the summed field _(verifies R1)_
- **counts calls, turns, sessions in scope** — GIVEN a scope WHEN `computeMeasure("apiCalls"/"turns"/"sessions", scope, ...)` THEN returns the count of the matching array _(verifies R1)_
- **counts total tool invocations, not distinct tools** — GIVEN calls whose `tools[]` total 5 entries across the scope (including repeats) WHEN `computeMeasure("toolCalls", ...)` THEN returns `5` _(verifies R1)_
- **computes cache hit percentage** — GIVEN known input/cacheRead/cacheCreate totals WHEN `computeMeasure("cacheHitPct", ...)` THEN returns `cacheReadTokens / (input+cacheRead+cacheCreate)`, matching `derive-session.ts`'s existing formula _(verifies R1)_
- **cacheHitPct is 0 when no cache-eligible tokens exist** — GIVEN a scope with all-zero token usage WHEN `computeMeasure("cacheHitPct", ...)` THEN returns `0`, not `NaN`/`null` _(edge case)_

##### Cost measures

- **costComputed sums usage × pricing table rates** — GIVEN calls with known models/usage and a pricing table WHEN `computeMeasure("costComputed", ...)` THEN the result matches a hand-computed dollar figure _(verifies R1, R2)_
- **unpriced model contributes $0** — GIVEN a call whose `model` has no entry in the pricing table WHEN `computeMeasure("costComputed", ...)` THEN that call contributes `$0`, not `NaN`/throw _(verifies ARCH forward-stress: "unpriced model")_
- **DEFAULT_PRICING_TABLE covers the four known models** — GIVEN the shipped default table WHEN inspected THEN it has entries for `claude-sonnet-5`, `claude-fable-5`, `claude-opus-4-8`, `claude-haiku-4-5` with the placeholder legacy rates ($5/$25/$0.50/$6.25 per 1M) _(verifies R4)_

##### Turn-grain measure (real today)

- **wallMinutes sums (endedAt − startedAt) across scope turns** — GIVEN turns with known `startedAt`/`endedAt` WHEN `computeMeasure("wallMinutes", ...)` THEN returns the summed duration in minutes, a real number never `null` _(verifies R1 — corrected classification this session)_

##### Premium-gated measures (null today)

- **costObserved, linesAdded, linesRemoved, gatePassRate, apiMs all return null** — GIVEN any scope (even one with populated sessions/turns) WHEN `computeMeasure` for each of these THEN returns `null`, since no shipped parser populates their backing fields yet _(verifies R1)_

##### Empty scope

- **empty scope: activity measures are 0, premium measures are null** — GIVEN a scope with no calls/turns/sessions WHEN `computeMeasure` for every measure THEN activity measures (`apiCalls`, `tokens*`, `costComputed`, `toolCalls`, `turns`, `sessions`, `cacheHitPct`, `wallMinutes`) return `0` and premium measures return `null` — never `undefined`/`NaN` _(edge case)_

### Implementation Notes

- **Module(s):** `server/metrics/measures.ts`, depends only on `shared/types.ts` per ARCH Module Boundaries.
- **Pattern reference:** `cacheHitPct` formula and the "$0, not fabricated" unpriced/unpriced-basis precedent both come directly from `server/store/derive-session.ts` — reuse the same math, don't reinvent it.
- **Key decisions:** ARCH Tech Choices/A3/A4 — pricing table is `Record<string, ModelRate>`, not a flat rate; placeholder default values now, real numbers later (explicit user decision, not this task's to fix). ARCH A5 (as corrected this session) — `wallMinutes` computes for real from `Turn.startedAt`/`endedAt`; the other coarse-grain measures stay `null`.
- **Libraries:** none new.
- **High-risk callouts:** None.

### Scope Boundaries

- Do NOT invent a timestamp-delta proxy for `apiMs` — explicit decision this session to keep it `null` until #P4-13 rather than fabricate a heuristic not named in `shared/types.ts`.
- Do NOT implement real per-model pricing values — placeholders only (ARCH Out of Scope: "Real per-model pricing values").
- Do NOT implement the `#P4-15` pricing-editor override mechanism — this task only defines the shape and default.
- Do NOT implement grouping/bucketing — `computeMeasure` operates on an already-scoped group; that scoping is `engine.ts`'s job (T4).

### Files Expected

**New files:**
- `server/metrics/measures.ts` — `computeMeasure`, `PricingTable`, `ModelRate`, `DEFAULT_PRICING_TABLE`
- `server/metrics/measures.test.ts`

**Modified files:** None.

**Must NOT modify:** None.

---

## Task T4: Engine orchestration (`engine.ts`)

> **Status:** done
> **Verification:** tdd
> **Effort:** m
> **Priority:** high
> **Depends on:** T1, T2, T3
> **Satisfies REQs:** R1, R2, R3, R5
> **Footprint slice:** New: `server/metrics/engine.ts`
> **High-risk areas touched:** None

### Description

The single `metrics(input: MetricsInput, query: MetricsQuery): Series[]` entry point — composes `grain.ts`, `dimensions.ts`, and `measures.ts` into the full filter → group → bucket → aggregate pipeline described in ARCH's High-Level Structure. This is where the issue's acceptance criterion ("hand-computed numbers from fixtures match engine output for every measure × dimension × grain") gets its end-to-end test coverage.

### Test Plan

#### Test File(s)
- `server/metrics/engine.test.ts`

#### Test Scenarios

##### End-to-end acceptance (hand-computed fixtures)

- **matches hand-computed values across a representative measure × dimension × grain sample** — GIVEN a hand-built `MetricsInput` spanning multiple days, projects, models, and branches WHEN `metrics(input, query)` runs for a representative sample of measure/dimension/grain combinations THEN each `Series[]` matches independently hand-computed expected values _(verifies R1 — the issue's core acceptance criterion)_
- **unit switching is a measure swap only** — GIVEN the same `dimensions`/`grain`/`range`/`filters` WHEN only `measures` changes (e.g. `costComputed` → `inputTokens` → `apiCalls`) THEN the query shape and grouping are unaffected — only the aggregated values differ _(verifies R2)_

##### Dimension array semantics

- **dimensions: ["time"] alone produces one dense series per measure** — GIVEN a query with only `"time"` in `dimensions` WHEN `metrics` runs THEN one `Series` per measure, points bucketed densely across the range _(verifies R1, R5)_
- **dimensions: ["time", "project"] produces one series per project, each time-bucketed** — GIVEN calls spanning 3 projects WHEN queried with `dimensions: ["time", "project"]` THEN 3 series result, each with dense grain-bucketed points _(verifies R1 — "stacked-area-over-time" page pattern)_
- **dimensions: ["project"] (no "time") produces one aggregate point per project** — GIVEN the same 3-project data WHEN queried with `dimensions: ["project"]` only THEN 3 series result, each with a single point aggregating the whole range _(verifies R1 — "efficiency-table" page pattern)_

##### Filtering

- **filters narrow which calls participate** — GIVEN a query with `filters: { model: ["claude-sonnet-5"] }` WHEN `metrics` runs THEN only matching calls contribute to any measure, dimension, or bucket _(verifies R1)_

##### Cost basis labeling

- **cost series carry a computed basis label** — GIVEN today's data (no session has `costBasis: "observed"` yet, per `derive-session.ts`) WHEN a cost measure is queried THEN every resulting `Series.basis` is `"computed"` _(verifies R3)_

##### Resilience

- **empty range / no matching filters still returns dense output** — GIVEN a query whose range or filters match zero calls WHEN `metrics` runs THEN the result is dense `Series[]` of `0`/`null` points per the measure's own null-vs-zero rule, not an empty array or throw _(verifies ARCH forward-stress)_
- **multi-tool call under dimensions: ["tool"] double-counts across tool buckets** — GIVEN a call using 2 distinct tools WHEN queried with `dimensions: ["tool"]` and a token/cost measure THEN that call's full usage appears in both tool buckets (documented, not divided) _(verifies ARCH forward-stress)_
- **mixed fine- and coarse-grain measures in one query resolve independently** — GIVEN `measures: ["costComputed", "wallMinutes"]` in the same query WHEN `metrics` runs THEN each measure aggregates from its own correct substrate (`calls` vs. `turns`) within the same group/bucket keys, with no cross-contamination _(verifies ARCH forward-stress)_
- **mode/compare/smoothing are silently no-op'd** — GIVEN a query with `compare: "previous-period"` and/or `smoothing: "ma7"` set WHEN `metrics` runs THEN it does not throw, and every `Series.compareGhost` stays `undefined` (#P2-9 implements these for real) _(verifies ARCH decision A6)_

### Implementation Notes

- **Module(s):** `server/metrics/engine.ts` — the only file in `metrics/` that imports the sibling `grain.ts`/`dimensions.ts`/`measures.ts` files, per ARCH Module Boundaries. Imports nothing from `store/`/`ingest/`/`routes/`.
- **Pattern reference:** `server/store/store.ts`'s role as a thin orchestrator over pure derive functions — `engine.ts` plays the same role over T1–T3's pure functions, but itself stays pure (no class, no state).
- **Key decisions:** ARCH A1 (array input, no `Store` dependency), A2 (`"time"` presence toggles dense-time-series vs. single-bucket shape), A6 (`mode`/`compare`/`smoothing` accepted in the type, no-op'd this task).
- **Libraries:** none new.
- **High-risk callouts:** None — ARCH's Areas of Impact rates this whole task Low risk (nothing imports `metrics/` yet).

### Scope Boundaries

- Do NOT implement `distributions.ts`, `mode: "distribution"`, `ma7` smoothing, or `compare: "previous-period"` alignment — #P2-9 (ARCH Out of Scope).
- Do NOT add a `POST /api/metrics` route or any `Store` cross-session read method — #P2-10 (ARCH Out of Scope).
- Do NOT import `Store` or anything from `server/store/`, `server/ingest/`, or `server/routes/`.

### Files Expected

**New files:**
- `server/metrics/engine.ts` — `metrics(input, query): Series[]`, `MetricsInput`
- `server/metrics/engine.test.ts`

**Modified files:** None.

**Must NOT modify:** None (no touched-but-not-changed entries per ARCH's Change Footprint).

### TDD Sequence

Implement against T1–T3's already-landed public APIs (`bucketStart`/`bucketLabel`/`enumerateBuckets`, `callDimensionValue`/`turnDimensionValue`/`matchesFilter`, `computeMeasure`). Suggested order: (1) filtering via `matchesFilter`, (2) grouping via dimension extractors, (3) bucketing via `grain.ts` when `"time"` is requested, (4) aggregation via `computeMeasure` per group×bucket, (5) the dense-output and no-op-flag edge cases last.
