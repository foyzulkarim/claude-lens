# Architecture: Per-query instrumentation for `/api/metrics`

> **Date:** 2026-07-24
> **Issue:** #119
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Standalone brief — `specs/context/119.md` (GitHub issue #119); motivating incident `specs/issues/bug-metrics-engine-wide-range-queries-block-event-loop.md`. See Inferred Requirements.
> **Type:** infrastructure (server-side observability, no product behavior change)

## Architecture Summary

Add three server-side observability signals to `/api/metrics`, none of which change the response body or any product behavior. (1) A **structured per-query log line** naming the query shape (measures, dimensions, grain, range span in days, mode, compare/smoothing) and a timing breakdown (`filterGroupMs`, `groupCount`, `bucketCount`, `computeMs`, total) — emitted at `info`, escalated to `warn` above a slow-query threshold. (2) A **`Server-Timing` response header** carrying the same breakdown so it's visible per chart in DevTools without log access. (3) An **event-loop lag monitor** (`perf_hooks.monitorEventLoopDelay`) that logs a `warn` when sustained p99 lag exceeds a threshold — the direct signal for "one synchronous query starved every other request."

The engine (`metrics()` / `metricsScatter()`) is a pure `Series[]`/`ScatterMetricsResult` function, so the internal timing/count breakdown escapes it via an **optional mutable probe parameter** the engine populates — leaving the return-type contract (and every existing caller and test) untouched. All thresholds, the probe type, the header/log formatters, and the event-loop monitor factory live in one new module, `server/observability.ts`.

## Inferred Requirements (Mode B / no REQ)

| ID | Inferred Requirement | Source |
|----|----------------------|--------|
| R1 | Every `/api/metrics` request logs one structured line with query shape + timing breakdown (`filterGroupMs`, `groupCount`, `bucketCount`, `computeMs`, total). | Issue #119 §1, Acceptance ¶1 |
| R2 | Requests over a slow-query threshold (~250ms) log at `warn` instead of `info`. | Issue #119 §1, Acceptance ¶1 |
| R3 | `/api/metrics` responses carry a `Server-Timing` header exposing the engine duration (and the sub-phase breakdown). | Issue #119 §2, Acceptance ¶2 |
| R4 | Sustained event-loop delay (p99 over ~200ms) produces a `warn` log with the measured lag. | Issue #119 §3, Acceptance ¶3 |
| R5 | Thresholds are constants in one place; no config plumbing required for MVP. | Issue #119 Acceptance ¶4 |
| R6 | Unit coverage pins the log-line shape and the `Server-Timing` header, including threshold (info↔warn) behavior. | Issue #119 Acceptance ¶5 |
| N1 | No change to any `/api/metrics` response body, status code, or product behavior. | Issue #119 "all server-side, no product behavior change" |
| N2 | No PII / transcript content in log lines — query *shape* only. | Derived from existing log discipline; safety constraint |

## High-Level Structure

```
                      POST /api/metrics
                             │
              ┌──────────────▼───────────────┐
              │ routes/metrics.ts (handler)  │
              │  parse → 400 on failure      │
              │  probe = newQueryProbe()     │
              │  t0 = performance.now()      │
              │  series = metrics(in,q,probe)│──────► metrics/engine.ts
              │  totalMs = now()-t0          │        · filterAndGroup() → probe.filterGroupMs, groupCount
              │  reply.header(Server-Timing) │        · compute loop     → probe.bucketCount, computeMs
              │  log.info|warn({shape,probe})│◄────── (populates probe in place; returns Series[])
              └──────────────┬───────────────┘
                             │ return series (body + status UNCHANGED)
                             ▼
                       client (no change)

  ── app lifecycle (server/app.ts) ─────────────────────────────
   buildApp({ …, enableEventLoopMonitor })
     if enabled: monitor = startEventLoopMonitor(app.log)   ── server/observability.ts
     app.addHook('onClose', () => monitor.stop())
   cli.ts passes enableEventLoopMonitor: true (prod); tests omit it (off)

  ── shared module (server/observability.ts) ──────────────────
   SLOW_QUERY_MS, EVENT_LOOP_P99_MS, EVENT_LOOP_SAMPLE_MS  (constants)
   QueryProbe, newQueryProbe()                              (breakdown carrier)
   queryShape(query)                                        (log-safe shape)
   serverTimingHeader(probe, totalMs)                       (header string)
   startEventLoopMonitor(log) → { stop() }                  (perf_hooks monitor)
```

**Added:** `server/observability.ts` (new). **Modified:** `metrics/engine.ts` (optional probe param, phase timing), `metrics/scatter.ts` (optional probe param, best-effort phases), `routes/metrics.ts` (probe wiring, header, log line), `app.ts` (start/stop monitor behind flag), `cli.ts` (pass flag). **Replaced/deleted:** none.

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|------|----------|-------------------------|-----------|
| Breakdown transport | Optional mutable **probe** param on `metrics()`/`metricsScatter()` | (a) return `{series, breakdown}`; (b) time only at route boundary | (a) ripples to every caller + all engine/scatter tests; (b) can't produce `filterGroupMs`/`groupCount`/`bucketCount` (they're engine-internal) → fails R1. Optional param = zero ripple, full breakdown. |
| High-res timing | `performance.now()` (`node:perf_hooks`) | `Date.now()` | Monotonic, sub-ms resolution; `Date.now()` is ms-granular and non-monotonic. |
| Event-loop lag | `perf_hooks.monitorEventLoopDelay({ resolution })` + `unref`'d `setInterval` sampling p99 | `blocked-at` / `event-loop-lag` npm deps; per-request `setImmediate` probe | Native (Node ≥ 26 confirmed), zero new deps; histogram gives true p99, not a spot sample. Matches CLAUDE.md §2 "deps are pinned — deviating requires editing the doc first." |
| Header format | W3C `Server-Timing` (`filter;dur=…, compute;dur=…, engine;dur=…`) | Custom `X-*` header | Standard; DevTools Network → Timing renders it natively (issue's stated goal). |
| Logging | Existing Fastify/pino `request.log` / `app.log` | New logger | Reuses the app's pino instance; structured fields are pino-native. |
| Monitor gating | `buildApp({ enableEventLoopMonitor })` flag, default via `cli.ts` | Always-on; cli-only | Always-on spins an interval in every test app; cli-only makes it un-inject-testable. Flag = testable + no timer leakage in the suite. |

## Patterns & Conventions

- **Pure engine, Store-independent** (architecture A1) — the engine takes plain arrays and returns values. The probe is a *write-only out-param*; the engine never reads it back, so purity of the return value is preserved.
- **`routes/` may import `metrics/` and (new) `observability.ts`** — both are computation/util, not data sources; consistent with the existing "route calls the engine directly" note atop `routes/metrics.ts`. `observability.ts` imports nothing from `ingest/`, `store/`, or the filesystem.
- **Thresholds as named constants in one module** (R5) — `server/observability.ts`, mirroring how the codebase keeps tunables like `SCATTER_VISUAL_CAP`/`SCATTER_COMPARE_ID_MAX` as module consts.
- **Optional-param back-compat** — same technique already used across the codebase (e.g. `MetricsInput.gateSummaries?`, `RegisterMetricsRouteOptions`): additive, defaulted, no caller churn.
- **`onClose` lifecycle hook** — Fastify-native cleanup, symmetric with the existing `app.close()` in `cli.ts` `shutdown()`.

## Data Models

### QueryProbe (in-memory, per-request; not persisted, not on the wire)

**Purpose:** write-only carrier the engine fills so the route can log/emit a timing breakdown.

**Key fields:**
| Field | Type / Constraint | Notes |
|-------|-------------------|-------|
| `filterGroupMs` | `number`, accumulates | Sum of `filterAndGroup()` durations (compare mode calls it twice → accumulates). |
| `groupCount` | `number` | Number of dimension groups produced (last/aggregate; groups are identical across compare runs). |
| `bucketCount` | `number`, accumulates | Total enumerated time buckets across the query (compare adds the previous-period buckets). Compute-op count = `measures × groupCount × bucketCount`. |
| `computeMs` | `number`, accumulates | Sum of the measure×group×bucket compute-loop durations. |

**Scatter best-effort mapping:** `filterGroupMs` ≈ `applyRange` + `indexSessionsByScope`; `computeMs` ≈ `buildScatterResult`; `groupCount` = matched scope count; `bucketCount` = 0 (scatter has no time buckets). Keeps one uniform log/header shape across all modes.

**Lifecycle:** created per request in the route (`newQueryProbe()`) → mutated in place by the engine → read once to format the log line + header → discarded (GC).

### Log line (structured, `info`|`warn`)

| Field | Type | Notes |
|-------|------|-------|
| `msg` | `"metrics query"` | Stable message key |
| `measures` | `string[]` | Query shape |
| `dimensions` | `string[]` | Query shape |
| `grain` | `string` | Query shape |
| `rangeDays` | `number` | `(to−from)/86.4e6`, rounded — the range-span signal |
| `mode` | `"series"\|"distribution"\|"scatter"` | Query shape |
| `compare` | `boolean` | series-only; omitted otherwise |
| `smoothing` | `"ma7"\|"none"` | series-only; omitted otherwise |
| `filterGroupMs`,`groupCount`,`bucketCount`,`computeMs`,`totalMs` | `number` | Timing breakdown (`totalMs` = route-measured wall time) |

No transcript content, no filter *values* beyond dimension keys where PII-adjacent — shape only (N2). (Filter dimension keys are safe; filter values are omitted from the log to stay shape-only.)

## API Contracts / Interfaces

### `server/observability.ts`

**Boundary:** internal module, imported by `routes/metrics.ts` and `app.ts`.

**Operations:**
| Op | Signature | Purpose | Returns |
|----|-----------|---------|---------|
| `newQueryProbe` | `() => QueryProbe` | Fresh zeroed probe | `QueryProbe` |
| `queryShape` | `(q: MetricsQuery) => Record<string,unknown>` | Log-safe shape fields | plain object |
| `serverTimingHeader` | `(probe: QueryProbe, totalMs: number) => string` | Format `Server-Timing` value | `"filter;dur=…, compute;dur=…, engine;dur=…"` |
| `isSlowQuery` | `(totalMs: number) => boolean` | `totalMs >= SLOW_QUERY_MS` | `boolean` (drives info↔warn) |
| `startEventLoopMonitor` | `(log: FastifyBaseLogger) => { stop(): void }` | Enable histogram + unref'd sampling interval; warn on p99 breach; `stop()` disables + clears | handle |

Constants: `SLOW_QUERY_MS = 250`, `EVENT_LOOP_P99_MS = 200`, `EVENT_LOOP_SAMPLE_MS` (sampling cadence, e.g. `1000`), `EVENT_LOOP_RESOLUTION_MS` (histogram resolution, e.g. `20`).

### `metrics/engine.ts` — `metrics()`

**Boundary:** internal module API (called by `routes/metrics.ts`).

| Op | Signature | Change |
|----|-----------|--------|
| `metrics` | `(input, query, probe?: QueryProbe) => Series[]` | Adds optional 3rd param; populates it during `filterAndGroup`/compute; return type unchanged. |

### `metrics/scatter.ts` — `metricsScatter()`

| Op | Signature | Change |
|----|-----------|--------|
| `metricsScatter` | `(input, query, probe?: QueryProbe) => ScatterMetricsResult` | Adds optional 3rd param; best-effort phase timing; return type unchanged. |

### `server/app.ts` — `buildApp()`

| Field | Type | Change |
|-------|------|--------|
| `BuildAppOptions.enableEventLoopMonitor` | `boolean` (optional, default off) | New. When true, `startEventLoopMonitor(app.log)` runs and is stopped via `app.addHook('onClose', …)`. |

**Auth requirements:** none — all changes are internal/observability; `/api/metrics` remains unauthenticated as today.

## Module Boundaries

| Module | Responsibility | Allowed Dependencies |
|--------|----------------|----------------------|
| `server/observability.ts` (new) | Thresholds, probe type/factory, log-shape + Server-Timing formatters, event-loop monitor | `node:perf_hooks`, `shared/metrics-contract` (types), Fastify logger type. **Not** `store/`, `ingest/`, fs. |
| `server/metrics/engine.ts` | Compute `Series[]`; populate probe as a write-only out-param | (existing) + `observability` **type-only** import (`QueryProbe`) |
| `server/metrics/scatter.ts` | Compute `ScatterMetricsResult`; populate probe best-effort | (existing) + `observability` type-only import |
| `server/routes/metrics.ts` | Create probe, time total, set header, emit log line | `metrics/`, `observability`, `store/` (existing) |
| `server/app.ts` | Own monitor lifecycle behind the flag | `observability` |
| `server/cli.ts` | Pass `enableEventLoopMonitor: true` in production | `app` |

## Change Footprint

### New files / modules

| Path | Purpose | Pattern reference |
|------|---------|-------------------|
| `server/observability.ts` | Thresholds, `QueryProbe`+factory, `queryShape`, `serverTimingHeader`, `isSlowQuery`, `startEventLoopMonitor` | Small pure util module like `server/util.ts`; consts like `scatter.ts`'s caps |
| `server/observability.test.ts` | Unit-pin: probe factory, `queryShape` fields, header formatting, `isSlowQuery` threshold, monitor start/stop + warn-on-breach (with a fake histogram/clock) | `server/metrics/*.test.ts` structure |

### Modified files / modules

| Path | What changes here |
|------|-------------------|
| `server/metrics/engine.ts` | Add optional `probe?: QueryProbe` to `metrics()`; thread into `computeSeriesForRange`/`computeDistributionSeries`; time `filterAndGroup()` → `probe.filterGroupMs`, record `groups.length` → `probe.groupCount`, `buckets.length` → `probe.bucketCount`, time compute loop → `probe.computeMs`. Accumulate across compare's two range runs. |
| `server/metrics/scatter.ts` | Add optional `probe?: QueryProbe` to `metricsScatter()`; best-effort phase timing (`applyRange`+index → `filterGroupMs`, `buildScatterResult` → `computeMs`, `scopes.size` → `groupCount`). |
| `server/routes/metrics.ts` | In the handler: `const probe = newQueryProbe()`; wrap `metrics(...)`/`metricsScatter(...)` in `performance.now()` for `totalMs`; `reply.header("Server-Timing", serverTimingHeader(probe, totalMs))`; `request.log[isSlowQuery(totalMs) ? "warn" : "info"]({ ...queryShape(parsed), ...probe, totalMs }, "metrics query")`. Both the series **and** scatter branches. Return value unchanged. |
| `server/app.ts` | Add `enableEventLoopMonitor?: boolean` to `BuildAppOptions`; when true, `const monitor = startEventLoopMonitor(app.log)` and `app.addHook("onClose", () => monitor.stop())`. |
| `server/cli.ts` | Pass `enableEventLoopMonitor: true` in the production `buildApp({...})` call. |

### Deleted / replaced

| Path | Reason |
|------|--------|
| — | Nothing removed. |

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|------|----------------|
| `server/routes/metrics.test.ts` | Existing assertions must still pass — response body/status unchanged. New tests (header + log shape) added here or in a sibling; log-shape test opts into a capturing pino stream via `buildApp({ logger })`. |
| `server/metrics/engine.test.ts` | All calls are 2-arg `metrics(input, query)`; optional param means these compile and pass unchanged — the back-compat guarantee. |
| `server/metrics/scatter.test.ts` | Same — 2-arg `metricsScatter` callers unaffected. |
| `server/app.test.ts` | Builds apps without the flag → monitor stays off; must remain green with no leaked interval. |
| `client/**` metrics consumers (Dashboard, ChartCard) | Depend on the `Series[]`/`ScatterMetricsResult` body; unchanged by design (N1). Silent-regression risk only if the route body accidentally shifts. |

## Areas of Impact

| Area | Impact | Risk (L/M/H) | Why |
|------|--------|--------------|-----|
| `metrics/engine.ts` (hot path) | Adds `performance.now()` bracketing + counter writes per request | **L** | Sub-µs per call; write-only object; no allocation in the inner loop. |
| `routes/metrics.ts` | Switches from `return metrics(...)` to `header + log + return` on both branches | **M** | Body/status must stay byte-identical; header must be absent on the 400 path (returns before `metrics()`). |
| `app.ts` / `cli.ts` lifecycle | New long-lived monitor started/stopped with the app | **M** | A missed `stop()`/leaked interval; mitigated by `onClose` + `unref` + off-by-default in tests. |
| Log volume | One extra structured line per `/api/metrics` request | **L** | Info-level, small; matches existing per-request logging expectations. |
| Client consumers | None (body unchanged) | **L** | Purely additive header + server logs. |

**Contract changes:** none to the JSON body or status codes. Additive only: a new `Server-Timing` **response header** (safe — clients ignore unknown headers) and new server log lines. No shared/`shared/*` type is placed on the wire (`QueryProbe` is server-internal).

**Cross-cutting ripples:** Telemetry/observability (the point of the change). No auth, no migrations, no feature flags, no build/deploy changes. New dependency count: **zero** (native `perf_hooks`).

## Cross-Cutting Concerns

- **Errors:** Instrumentation is best-effort and must never fail a request. Timing/logging wraps nothing that can throw meaningfully; if `startEventLoopMonitor` can't enable the histogram it logs once and no-ops (`stop()` idempotent). The existing `setErrorHandler` is untouched — a thrown engine error still surfaces as `{error,cause}` (the probe is simply never read on that path).
- **Logging & metrics:** `request.log` for the per-query line (info, or warn ≥ `SLOW_QUERY_MS`); `app.log.warn` for event-loop p99 breaches. Fields listed in Data Models. Shape-only, no PII (N2).
- **Auth / authz:** unchanged; no new surface.
- **Performance:** budget is "unmeasurable overhead." `performance.now()` ×2–4 per request + integer writes; monitor histogram is O(1) per tick on a 1s unref'd interval. No caching needed.
- **Security:** no secrets; log lines carry query *shape* (measure/dimension/grain/span), never filter values or transcript content. `Server-Timing` exposes only durations (no data).
- **Migrations / rollout:** none. Fully backward-compatible; ships behind no flag for the log/header (always on for `/api/metrics`), and the event-loop monitor behind `enableEventLoopMonitor` (on in prod via cli). Rollback = revert; no state to unwind.

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies |
|---|----------|--------------|----------------|-----------|
| A1 | Breakdown escapes the engine via an optional mutable `probe` out-param | return `{series,breakdown}`; route-boundary timing only | Preserves the pure `Series[]` contract; zero caller/test ripple; only path that yields the *internal* `filterGroupMs`/`groupCount`/`bucketCount` | R1, N1 |
| A2 | `bucketCount` = total enumerated time buckets (accumulated over compare); compute-ops = `measures×groupCount×bucketCount` | count actual `computeMeasure` calls directly | Buckets are the range-span×grain signal that produced the "13608" culprit; op-count is derivable, so no extra counter in the hot loop | R1 |
| A3 | One module `server/observability.ts` owns thresholds + formatters + monitor | scatter thresholds in `metrics/`, monitor in `app.ts` | R5 "constants in one place"; keeps the event-loop monitor (app-level, not metrics-specific) co-located with the query formatters that share its threshold discipline | R5 |
| A4 | Event-loop monitor via native `perf_hooks.monitorEventLoopDelay` + unref'd `setInterval`, gated by `enableEventLoopMonitor` | npm lag deps; always-on; cli-only | Native (Node ≥26), zero deps; flag keeps it testable via `inject()` yet absent from the `logger:false` test suite; `unref` can't hang a process | R4, R6 |
| A5 | `Server-Timing` with sub-phases `filter`/`compute`/`engine` | single `engine;dur` only | Same breakdown as the log, rendered natively in DevTools; still satisfies the issue's `engine;dur=…` example | R3 |
| A6 | Scatter populates the same probe best-effort (`bucketCount:0`) | separate scatter-only shape; no scatter instrumentation | One uniform log/header across all modes; scatter is also a wide-range cost path worth timing | R1, R3 |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|----------|---------------------------|
| Instrumentation adds latency to every request | `performance.now()`×2–4 + integer writes; sub-µs. No inner-loop allocation. Confirmed acceptable. |
| A 91s **synchronous** query starves the loop | Monitor's own `setInterval` is starved *during* the sync run, so the p99 warn is inherently **retrospective** — it fires on the next tick once the loop resumes. This is a property of sync starvation, not a fixable gap; the warn still names the sustained spike. Captured as a known limitation, not a design change. |
| Parse failure / 400 path | Handler returns before `metrics()` runs → no probe read, no `Server-Timing`, no query log line. Correct by construction; nothing to time. |
| Engine throws mid-compute | Probe never read on that path; existing `setErrorHandler` still returns `{error,cause}`. No instrumentation-induced masking. |
| Many app builds in the test suite | Monitor off by default (flag omitted) → no intervals created; `logger:false` suite unaffected. |
| App closed without `stop()` (e.g. abrupt exit) | Interval is `unref`'d → can't keep the process alive; `onClose` handles the graceful path. |
| Log line grows unbounded | Only fixed shape fields + short measure/dimension arrays; no per-call/per-bucket data. Bounded. |

### Backward — regression risk per touched area

| Touched area | What could regress | How we'd know / mitigation |
|--------------|--------------------|----------------------------|
| `routes/metrics.ts` (M) | Response body/status changes when switching to `reply.header(...)` + `return`; or the scatter branch is forgotten | Existing `metrics.test.ts` body/status assertions must stay green; add explicit header-present tests for **both** series and scatter, and a 400-path test asserting **no** `Server-Timing`. |
| `metrics/engine.ts` (L) | Optional-param change breaks a 2-arg caller | `tsc --strict` + unchanged `engine.test.ts` (all 2-arg) prove back-compat. |
| `metrics/scatter.ts` (L) | Same as engine | Unchanged `scatter.test.ts` (2-arg). |
| `app.ts` / `cli.ts` (M) | Leaked interval or monitor-on in tests | Flag defaults off; `app.test.ts` stays green with no timer; `onClose` cleanup verified in an observability/app test. |
| Client metrics consumers (L) | Accidental body shape drift | N1 guarantee; covered by the route body assertions above. |

## Open Questions

- **Exact `EVENT_LOOP_SAMPLE_MS` / histogram `resolution`.**
  - **Impact if unresolved:** too-frequent sampling adds trivial noise; too-coarse delays the warn.
  - **Suggested default:** `resolution: 20ms`, sample/reset every `1000ms`, warn when p99 (since last reset) ≥ `EVENT_LOOP_P99_MS`. Revisit only if warns are too chatty/laggy.
- **Should the per-query `warn` and event-loop `warn` be rate-limited?**
  - **Impact if unresolved:** a storm of slow queries floods logs.
  - **Suggested default:** no rate-limit for MVP (issue scopes thresholds only); revisit if noisy.
- **Does the log line include filter *dimension keys*?**
  - **Impact if unresolved:** slightly less shape detail vs. a marginal PII surface from values.
  - **Suggested default:** include filter *keys* (dimensions being filtered), exclude filter *values*. Stays shape-only (N2).

## Out of Scope

- Config-driven thresholds (issue: "config plumbing not required for MVP"). (reason: MVP scope; constants suffice.)
- Instrumenting routes other than `/api/metrics` (reason: issue is scoped to the metrics engine incident).
- Persisting/aggregating timings (dashboards, histograms over time) (reason: logs + header are the deliverable; downstream aggregation is a separate idea).
- Fixing the underlying wide-range engine cost (reason: issue #119 is the *instrumentation*; the engine fix is its independent sibling — this lands first so the fix is verifiable from logs).

---

# Tasks

_Generated 2026-07-24. Three tasks: T1 (foundation module) → T2 (query log + header) and T3 (event-loop monitor), which are independent of each other._

## Task T1: Observability module — probe, formatters, thresholds, event-loop monitor

> **Status:** not started
> **Verification:** tdd
> **Effort:** m
> **Priority:** high
> **Depends on:** None
> **Satisfies REQs:** R1, R2, R3, R4, R5, N2
> **Footprint slice:** New: `server/observability.ts`, `server/observability.test.ts`
> **High-risk areas touched:** None (new pure module; the M-risk consumers are T2/T3)

### Description

The single module that both other tasks build on: threshold constants (R5), the `QueryProbe` carrier + factory, the log-shape (`queryShape`) and `Server-Timing` (`serverTimingHeader`) formatters, the `isSlowQuery` predicate, and the `startEventLoopMonitor` factory. Pure and dependency-free (native `perf_hooks` only) so it can be unit-pinned in isolation before any wiring exists.

### Test Plan

#### Test File(s)
- `server/observability.test.ts` (new — mirrors `server/metrics/*.test.ts` structure)

#### Test Scenarios

##### Probe
- **newQueryProbe returns a zeroed probe** — GIVEN nothing WHEN `newQueryProbe()` THEN all four fields (`filterGroupMs`, `groupCount`, `bucketCount`, `computeMs`) are `0` _(verifies R1)_

##### Thresholds & slow-query predicate
- **isSlowQuery false below threshold** — GIVEN `totalMs = SLOW_QUERY_MS - 1` WHEN `isSlowQuery` THEN `false` _(verifies R2)_
- **isSlowQuery true at threshold boundary** — GIVEN `totalMs = SLOW_QUERY_MS` THEN `true`; and `SLOW_QUERY_MS + 100` THEN `true` _(verifies R2)_
- **thresholds are exported constants** — GIVEN the module WHEN imported THEN `SLOW_QUERY_MS === 250` and `EVENT_LOOP_P99_MS === 200` are named exports _(verifies R5)_

##### queryShape (log-safe shape)
- **series shape carries measures/dimensions/grain/rangeDays/mode** — GIVEN a series query over a 7-day range WHEN `queryShape` THEN it returns `{ measures, dimensions, grain, rangeDays: 7, mode: "series" }` _(verifies R1)_
- **compare/smoothing present for series, omitted otherwise** — GIVEN a series query with `compare` + `smoothing` THEN both appear; GIVEN a distribution query THEN neither key is present _(verifies R1)_
- **filter dimension keys included, values excluded** — GIVEN a query with `filters: { project: ["secret-x"] }` WHEN `queryShape` THEN the output references dimension key `project` but does NOT contain the value `"secret-x"` _(verifies N2)_

##### Server-Timing formatting
- **header lists filter/compute/engine durations** — GIVEN a probe `{filterGroupMs:3, computeMs:7,…}` and `totalMs = 11` WHEN `serverTimingHeader` THEN the string matches `filter;dur=3, compute;dur=7, engine;dur=11` (W3C Server-Timing syntax) _(verifies R3)_

##### Event-loop monitor (injected fake histogram + scheduler)
- **warns when p99 exceeds threshold** — GIVEN a fake histogram reporting p99 `= EVENT_LOOP_P99_MS + 50` WHEN a sample tick fires THEN `log.warn` is called once with the measured lag _(verifies R4)_
- **no warn when p99 under threshold** — GIVEN p99 below threshold WHEN a tick fires THEN `log.warn` is not called _(verifies R4)_
- **stop() disables the histogram and clears the interval; idempotent** — GIVEN a started monitor WHEN `stop()` is called twice THEN the histogram is disabled, the interval cleared, and no throw _(verifies ARCH forward stress-test: "app closed without stop()")_
- **enable failure no-ops rather than throwing** — GIVEN `monitorEventLoopDelay` unavailable/throwing WHEN `startEventLoopMonitor` runs THEN it logs once and returns a handle whose `stop()` is safe _(verifies ARCH Cross-Cutting: instrumentation never fails a request)_

### Implementation Notes

- **Module(s):** `server/observability.ts` (ARCH Module Boundaries — imports only `node:perf_hooks`, `shared/metrics-contract` types, Fastify logger type; never `store/`/`ingest/`/fs).
- **Pattern reference:** small pure util like `server/util.ts`; module constants like `SCATTER_VISUAL_CAP` in `server/metrics/scatter.ts`.
- **Test seam:** give `startEventLoopMonitor` optional injected deps (histogram factory + scheduler/`setInterval`) defaulting to the real `perf_hooks`/timers — an additive optional param consistent with the codebase's optional-param convention (`MetricsInput.gateSummaries?`). This is what makes the monitor tdd-able without real wall-clock waits; it does not change ARCH decision A4.
- **Key decisions:** A2 (`bucketCount` = enumerated buckets), A3 (one module owns thresholds), A4 (native `perf_hooks` + `unref`'d interval), A5 (`filter`/`compute`/`engine` sub-phases).
- **Libraries:** `node:perf_hooks` (`monitorEventLoopDelay`, `performance`). Zero new deps.

### Scope Boundaries

- Do NOT add config-driven thresholds — constants only (ARCH Out of Scope, R5).
- Do NOT wire this module into any route or app here — T2/T3 own the wiring.
- Only implement the exports named in ARCH's `server/observability.ts` interface table.

### Files Expected

**New files:**
- `server/observability.ts` (thresholds, `QueryProbe`+`newQueryProbe`, `queryShape`, `serverTimingHeader`, `isSlowQuery`, `startEventLoopMonitor`)
- `server/observability.test.ts`

**Must NOT modify:**
- `server/metrics/engine.ts`, `server/metrics/scatter.ts`, `server/routes/metrics.ts`, `server/app.ts`, `server/cli.ts` (owned by T2/T3)

### TDD Sequence (optional)

Build `newQueryProbe` + `isSlowQuery` + `queryShape` + `serverTimingHeader` (pure, trivial) first; then `startEventLoopMonitor` with its injected fake histogram.

---

## Task T2: Per-query log line + `Server-Timing` header on `/api/metrics`

> **Status:** not started
> **Verification:** test-after
> **Effort:** m
> **Priority:** high
> **Depends on:** T1
> **Satisfies REQs:** R1, R2, R3, R6, N1
> **Footprint slice:** Modified: `server/metrics/engine.ts`, `server/metrics/scatter.ts`, `server/routes/metrics.ts` (+ tests in `server/routes/metrics.test.ts`)
> **High-risk areas touched:** `routes/metrics.ts` (M — response body/status must stay byte-identical; header must be absent on 400)

### Description

Thread an optional `probe` through `metrics()`/`metricsScatter()`, populate it during filter/group and compute, and have the route time the total, set the `Server-Timing` header, and emit one structured log line (`info`, or `warn` above `SLOW_QUERY_MS`). Delivers R1/R2/R3 with no change to the response body (N1).

### Test Plan

#### Test File(s)
- `server/routes/metrics.test.ts` (modified — add describe blocks; existing assertions must stay green)
- Engine-level probe assertions may live in a new `describe` within `server/metrics/engine.test.ts` / `scatter.test.ts` (additive only)

#### Test Scenarios

##### Engine probe population (pre-done increment)
- **series probe carries group/bucket counts and phase timings** — GIVEN a series query with 2 dimension groups over N buckets WHEN `metrics(input, query, probe)` THEN `probe.groupCount === 2`, `probe.bucketCount === N`, and `filterGroupMs`/`computeMs` are finite `≥ 0` _(verifies R1)_
- **compare mode accumulates bucketCount across both ranges** — GIVEN a series query with `compare: "previous-period"` WHEN run with a probe THEN `probe.bucketCount` reflects current + previous buckets _(verifies R1, ARCH A2)_
- **scatter probe populated best-effort** — GIVEN a scatter query WHEN `metricsScatter(input, query, probe)` THEN `probe.groupCount === matched scope count` and `probe.bucketCount === 0` _(verifies R1, ARCH A6)_

##### Log line
- **fast query logs one info line with shape + breakdown** — GIVEN a valid series query under threshold and a capturing pino logger via `buildApp({ logger })` WHEN POSTed THEN exactly one log line at `info` with `msg:"metrics query"`, the query-shape fields, and `filterGroupMs/groupCount/bucketCount/computeMs/totalMs` _(verifies R1, R6)_
- **slow query escalates to warn** — GIVEN `performance.now` stubbed to report ≥ `SLOW_QUERY_MS` elapsed WHEN POSTed THEN the single line is emitted at `warn` _(verifies R2, R6)_

##### Server-Timing header
- **series response carries Server-Timing** — GIVEN a valid series query WHEN POSTed THEN `response.headers["server-timing"]` contains `engine;dur=` _(verifies R3, R6)_
- **scatter response carries Server-Timing** — GIVEN a valid scatter query WHEN POSTed THEN the header is present (uniform across modes) _(verifies R3, A6)_
- **400 path has no header and no query log line** — GIVEN a malformed body WHEN POSTed THEN status `400`, NO `server-timing` header, and no `"metrics query"` log line _(verifies ARCH forward stress-test: "parse failure / 400 path")_

##### Regression guard
- **response body/status unchanged (series + scatter)** — GIVEN identical valid queries WHEN POSTed before/after the change THEN body and status are byte-identical _(guards N1 / backward-regression for `client/**` metrics consumers)_
- **engine 2-arg callers unchanged** — GIVEN `metrics(input, query)` / `metricsScatter(input, query)` with no probe THEN returns identical output to today _(guards backward-regression for `engine.ts`/`scatter.ts` callers; existing `engine.test.ts`/`scatter.test.ts` stay green)_

### Implementation Notes

- **Module(s):** `metrics/engine.ts`, `metrics/scatter.ts` (probe as write-only out-param), `routes/metrics.ts` (create probe, time total, set header, log). Type-only import of `QueryProbe` from `observability`.
- **Pattern reference:** optional-param back-compat already used by `MetricsInput.gateSummaries?` and `RegisterMetricsRouteOptions`; route logging via `request.log`; header via `reply.header(...)` before returning (route currently `return metrics(...)` directly — switch to `reply.header(...); return series` on BOTH branches).
- **Key decisions:** A1 (probe out-param preserves `Series[]` contract), A2 (bucketCount semantics), A5 (Server-Timing sub-phases), A6 (scatter uniform probe).
- **High-risk callout — `routes/metrics.ts` (M):** the body and status must not shift; the "response body/status unchanged" guard tests pin this, and the "400 path" test pins that the header is absent when `metrics()` never runs. Set the header on both the scatter and series branches — the scatter branch is the easy one to forget.

### Scope Boundaries

- Do NOT instrument any route other than `/api/metrics` (ARCH Out of Scope).
- Do NOT persist/aggregate timings — logs + header only (ARCH Out of Scope).
- Do NOT log filter values — dimension keys only (N2, already enforced by T1's `queryShape`).
- Do NOT touch the event-loop monitor (T3).

### Files Expected

**Modified files:**
- `server/metrics/engine.ts` (add `probe?: QueryProbe`; time `filterAndGroup`, record group/bucket counts, time compute loop; accumulate across compare runs)
- `server/metrics/scatter.ts` (add `probe?: QueryProbe`; best-effort phase timing)
- `server/routes/metrics.ts` (probe + `performance.now()` total, `Server-Timing` header, structured `info`/`warn` log line — both branches)
- `server/routes/metrics.test.ts` (new describe blocks; existing tests unchanged)

**Must NOT modify:**
- Existing test bodies in `server/metrics/engine.test.ts` / `scatter.test.ts` (2-arg contract — guard by keeping them green; new tests are additive)
- `client/**` (body-unchanged is the guarantee, not a code change)
- `server/app.ts`, `server/cli.ts` (T3)

---

## Task T3: Event-loop lag monitor lifecycle in the app

> **Status:** not started
> **Verification:** test-after
> **Effort:** s
> **Priority:** medium
> **Depends on:** T1
> **Satisfies REQs:** R4, R6, N1
> **Footprint slice:** Modified: `server/app.ts` (flag + `onClose`), `server/cli.ts` (pass flag) (+ tests in `server/app.test.ts`)
> **High-risk areas touched:** `app.ts`/`cli.ts` lifecycle (M — a leaked/never-stopped interval)

### Description

Own the event-loop monitor's lifecycle: `buildApp` starts it only when `enableEventLoopMonitor` is set and stops it via an `onClose` hook; `cli.ts` passes the flag in production. Off by default so the test suite spins no timers.

### Test Plan

#### Test File(s)
- `server/app.test.ts` (modified — add a describe block; existing tests stay green)

#### Test Scenarios

##### Lifecycle
- **monitor starts when flag set** — GIVEN `startEventLoopMonitor` spied WHEN `buildApp({ store, enableEventLoopMonitor: true, logger: false })` THEN it is called once with the app logger _(verifies R4, R6)_
- **monitor off by default** — GIVEN `buildApp({ store })` with no flag THEN `startEventLoopMonitor` is not called _(verifies ARCH forward stress-test: "many app builds in the test suite"; guards no-timer-leak)_
- **onClose stops the monitor** — GIVEN an app built with the flag and a stubbed monitor WHEN `app.close()` THEN the monitor's `stop()` is called exactly once _(verifies ARCH forward stress-test: "app closed without stop()")_

##### Regression guard
- **no leaked timer after build+close** — GIVEN `buildApp` + `app.close()` in a test WHEN the test finishes THEN no pending timer keeps the process alive (interval is `unref`'d) _(guards backward-regression for `app.test.ts` — the suite must exit cleanly)_
- **cli wires the flag** — GIVEN `cli.ts`'s `buildApp({...})` call THEN it includes `enableEventLoopMonitor: true` _(verifies R4; assert via the app-flag behavior + code inspection — `cli.ts` has no unit harness)_

### Implementation Notes

- **Module(s):** `app.ts` (new `BuildAppOptions.enableEventLoopMonitor?`, start + `app.addHook("onClose", () => monitor.stop())`), `cli.ts` (pass `true`).
- **Pattern reference:** optional `BuildAppOptions` fields already threaded (`gatesCache?`, `pipeline?`); `onClose` mirrors the existing `app.close()` in `cli.ts` `shutdown()`.
- **Key decisions:** A3 (thresholds/monitor in `observability`), A4 (flag-gated, `unref`'d, off in tests).
- **High-risk callout — lifecycle (M):** the flag must default off so `app.test.ts` and the `logger:false` suite create no interval; `onClose` + `unref` are the leak guards, pinned by the "no leaked timer" and "off by default" tests.

### Scope Boundaries

- Do NOT start the monitor unconditionally (would leak intervals into every test app) — flag-gated only.
- Do NOT add config plumbing for the flag beyond the `BuildAppOptions` field (ARCH Out of Scope / R5).
- Do NOT touch `/api/metrics` request handling (T2).

### Files Expected

**Modified files:**
- `server/app.ts` (add `enableEventLoopMonitor?: boolean`; start monitor when set; `onClose` cleanup)
- `server/cli.ts` (pass `enableEventLoopMonitor: true` in the production `buildApp` call)
- `server/app.test.ts` (new describe block; existing tests unchanged)

**Must NOT modify:**
- `server/observability.ts` (T1 owns the monitor factory)
- `server/routes/metrics.ts` (T2)
