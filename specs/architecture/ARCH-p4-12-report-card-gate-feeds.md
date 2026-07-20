# Architecture: Report Card UI + gate feeds (#P4-12, issue #44)

> **Date:** 2026-07-20
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Standalone brief — `specs/issues/P4-12-report-card-ui-gate-feeds.md` (issue #44, filed 2026-07). Binding constraints: `specs/gates.md` (gate definitions, evidence shape, Report Card scoring — warn counts half-weight in denominator, letter/fraction not a percentage); `specs/claude-lens-pages.md` §4 row 8 (Report Card on Session Detail — `T+fs` — 🟢 — "Specs in `gates.md`"), §2 row 5 (Sessions — "gate-score column stubs until #P4-12"), §3 (Dashboard rows — "Anomaly & gate-failure feed may stub until #P4-12"), §8 (Trends — "Gate pass-rate trend per week… stubs until #P4-12"), §6 (Projects — efficiency table gate pass-rate cell "stubs until #P4-12"); `claude-lens-architecture.md` §7 (WS invalidation bus), §8 (metrics engine `metrics(query) → Series[]`), §9 (route table); plans-decisions log 2026-07-06 (gates evidence `turnN` optional — E1/E2 session-scoped).
> **Type:** feature (brownfield — heavily UI-driven; pre-prepared seams in #P4-11/#43 make the gate engine + `/api/sessions/:id/gates` route and all reserved client/server fields already exist; #44 de-stubs them across five page surfaces).

## Architecture Summary

The `/api/sessions/:id/gates` route (shipped in #43/#P4-11) returns the full `GateReport`. Five UI surfaces consume that data — a new lazy-mounted `ReportCard` section on Session Detail, gate-failure items populating `AnomalyFeed`'s reserved `gateFailure` kind, a gate pass-rate trend panel replacing the existing `GatePassRateStub` on Trends, a gate-status filter + `gateScore` column lighting up on Sessions, and a live `gatePassRate` cell replacing the `null` stub in Projects' EfficiencyTable. A single new client component (`GateStatusBadge`) carries the status → color mapping across all five. The Sessions-page row hydration and Dashboard feed iteration need per-session gate summaries to avoid O(N) engine calls per page render, so one new server module — `server/cache/gates-cache.ts`, mirroring `server/cache/analysis.ts` — caches `GateReportSummary` per session with WS-debounced invalidation. The `MetricsQuery.gatePassRate` measure (today a deliberate `null` seam) is finally de-nulled using the same cache batch helper — `mean(score)` per bucket. No new HTTP routes, no new dependencies, no entitlements changes.

## Inferred Requirements

This work has no REQ document (it's a plan-task; `gates.md` + the pages spec are the binding requirements). Inferred items beyond the literal acceptance criteria:

| ID  | Inferred Requirement                                                                                                  | Source                                                                                   |
|-----|-----------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------|
| IR1 | E1/E2 evidence has no `turnN` (gates.md §1) — its drill target is the session itself, not the Turn Inspector          | `shared/gates-contract.ts:32-39` (GateEvidence `turnN?`, `filePath?`); decisions log 2026-07-06 |
| IR2 | Per-turn evidence (V1/V2/P3/C3/K2) deep-links to `/session/:id/turn/:n` (Turn Inspector's existing route)             | `client/src/routes.ts` (turn-inspector route); `gates.md` §"evidence" preamble            |
| IR3 | Gate-failure feed is a *session*-level summary in Dashboard, not per-evidence-per-row (one session = one row)        | `pages.md` §3 "Anomaly & gate-failure feed" — bounded list (top 5, mirrors anomalies)   |
| IR4 | Score-letter color palette already in use (`#E05252`/`#E8A33D`/`#8A96A5`) — reuse, do not invent                      | `client/src/pages/dashboard/AnomalyFeed.tsx:112-116` `SEVERITY_CLASS`                    |
| IR5 | Cold-cache first load runs the engine once per session; lazy-memoize so subsequent loads hit the cache                | Architecture §5 (in-memory columnar store, no fetch-cost recovery model)                 |
| IR6 | Live data flows must respect WS invalidation — when a session transcript changes, its gate score must recompute      | Architecture §7 (WS invalidation bus, per-session debounce)                              |
| IR7 | Report Card is per-session, not a fleet-level deep-link target — no letter score in URL, no global filter-bar entry | `gates.md` §"Report Card scoring"; `pages.md` §4 row 8 (per-session)                     |
| IR8 | The `MetricsQuery.gatePassRate` measure returning `null` today is an intentional "arrives with #P4-12" seam          | `server/metrics/measures.ts:204`; `client/src/pages/trends/GatePassRateStub.tsx:6-8`     |
| IR9 | Existing reserved client types `SessionListItem.gateStatus/gateScore` (`shared/sessions-contract.ts:200-201`) and `SessionListParams.gateStatus[]` (line 83) are the routing contract; no shape changes              | Pre-shipping seams in #P4-4/#P4-6 work                                                       |

## High-Level Structure

```
                    ┌──── server/gates/engine.ts (#43, unchanged) ────┐
                    │  evaluateSessionGates() → GateReport              │
                    └──────────────┬─────────────────────────────────────┘
                                   │ GateReport
                                   ▼
            /api/sessions/:id/gates (#43, unchanged)
                                   │
            ┌──────────────────────┼──────────────────────────────────────┐
            │                      │                                      │
            ▼                      ▼                                      ▼
  SessionDetail.ReportCard   Dashboard.AnomalyFeed             Sessions-page row
  (lazy mount, useQuery      (parallel listSessions             (gateStatus filter +
   against /api/sessions/     query, top-5 by ascending          gateScore sortable
   :id/gates) — evidence     gateScore, merged into             column wired through
   drills: turnN → TI;       detectedItems discriminated        reserves in state.ts +
   filePath → inline         union — gateFailure kind          api/sessions.ts)
   expand                    populated, captureGap stays
                             reserved for #P4-13)
            │                      │                                      │
            └──────────┬───────────┘                                      │
                       │                                                  │
                       ▼                                                  │
            ┌──── server/cache/gates-cache.ts (NEW) ────┐                  │
            │  Map<sessionId, GateReportSummary>         │◀─────────────────┘
            │  - lazy on first getSummary()              │
            │  - WS-debounced invalidation hook          │
            │  - getSummariesBatch(ids) for fleet ops    │
            └───────────────┬────────────────────────────┘
                            │ consumed by
                            ▼
                  server/metrics/measures.ts:204
                  case "gatePassRate" → mean(score)
                  over getSummariesBatch(scope.sessionIds)
                            │
                            ▼
                  server/routes/sessions.ts
                  rows enriched with gateStatus/gateScore
                            │
                            ▼
                  client/src/pages/projects/EfficiencyTable.tsx
                  (the gatePassRate cell that was `null`)

  client/src/pages/trends/GatePassRateStub.tsx ──▶ GatePassRatePanel.tsx (NEW)
                                                          │
                                                          ▼
                                                  ECharts wrapper,
                                                  weekly grain, mirrors
                                                  RollingEfficiencyPanel
```

**Five UI surfaces — all consume a single shared component:**

| Surface | Existing seam | What flips |
|---|---|---|
| Session Detail — Report Card | (new section) | New `ReportCard.tsx` mounted before `WorkflowFunnel` |
| Dashboard — AnomalyFeed | `AnomalyFeedItem.kind` already has `"gateFailure"` reserved | Live branch wiring |
| Trends — gate pass-rate | `GatePassRateStub` placeholder | Replaced by `GatePassRatePanel` |
| Sessions — gate filter + column | `SessionListParams.gateStatus[]`, `SessionPageItem.gateScore/Status` | Filter + column rendered live |
| Projects — efficiency table | `EfficiencyTable.gatePassRate: null` | Cell flips to live aggregate |

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|---|---|---|---|
| Per-session gate cache | New `server/cache/gates-cache.ts` mirroring `server/cache/analysis.ts` (lazy, WS-invalidated) | Generic per-request memo inside routes; no cache (lazy only) | `analysis.ts` already establishes the per-session, WS-debounced, lazy-on-first-access pattern the project uses for expensive per-session derivations |
| `MetricsQuery.gatePassRate` measure | Session-rolled `mean(score)` per bucket via cache batch (`getSummariesBatch`) | Per-call iteration (over `scope.calls`); new `rollups/` precompute | Gate status is a session-level verdict (gates.md §"Report Card scoring") — iterating over calls re-projects a session-status onto each call, which is the wrong shape; a denormalized column is heavier than a batch lookup |
| Report Card mount | `useInView` (IntersectionObserver) with `rootMargin: 200px` | `<details>` requiring click; fetch-on-mount | Lazy mount keeps the E1/E2 filesystem check off the first Session Detail paint; IntersectionObserver is the established pattern (`useStableNow`, `LiveWindowCards`) |
| Gate-failure feed source | Reuse `listSessions({sort: "gateScore", order: "asc", limit: 5, …})` (sort key already in `state.ts:124`) | New `/api/dashboard/gate-failures` endpoint; per-evidence rows | `SessionListItem.gateScore` already typed; one fewer route; matches Cache Lab/Models' sort conventions |
| E1/E2 evidence drilling | Inline expand below the row, no new fetch | New `/api/files?path=…` route with file preview; external `file://` URI | Evidence is already in the `/api/sessions/:id/gates` payload; richer preview is a follow-up, not in this PR's scope (#P4-12) |
| Status color tokens | New `GateStatusBadge.tsx` reusing `Badge.tsx`/`TierBadge.tsx` conventions | Inline styles per surface | One source of truth across five surfaces; project's established components-for-status-shapes pattern |
| No new HTTP routes | All consumers read existing `/api/sessions/:id/gates` or the existing `/api/sessions?...` route | Per-feature new endpoints | Spec already covers all reads; new routes = duplication. CLAUDE.md architecture rule §3 (one HTTP layer, three strict TS roots) |
| No new dependencies | Use existing TanStack Query, wouter, ECharts wrapper, Tailwind, Biome | Anything new | All requirements satisfied by pinned Phase 0–3 deps |

## Patterns & Conventions

- **Pure presentational composition** — every new page-section component splits fetching (Query) from rendering (presentational): `ReportCard.tsx` (data) + `ReportCardView.tsx` (presentation); `GatePassRatePanel.tsx` follows the `RollingEfficiencyPanel` precedent.
- **Per-section owning its own query** — every page section owns its `useQuery`/`useStableNow`; the page shell (Dashboard/SessionDetail/Trends) composes without fetching.
- **Files mirror directory layout** — `pages/session-detail/ReportCard.tsx`, `pages/trends/GatePassRatePanel.tsx`, shared components under `client/src/components/`. Enforced project-wide.
- **WS invalidation hook** — `server/store/invalidation.ts` per-session debounce (200–500ms); the gates cache evicts on the same hook. Lazy re-eval on next read.
- **"Unavailable seam" pattern (A11)** — replaced stub copy ("Gate data not available yet") reverses to the active state ("No gate failures detected"); no fake loading shimmer.
- **Storybook-required UX surface** — five stories per new component (`loading`, `passing`, `warn`, `failing`, `error`); same per the existing test/stories split (e.g. `AnomalyFeed.stories.tsx`).
- **Test seam via `items?: AnomalyFeedItem[]`** — already exercised in `AnomalyFeed.stories.tsx:64-110` for `gateFailure`/`captureGap`; the new live branch reuses the same shape (no new seam).
- **Tailwind tokens only** — `#E05252` (red), `#E8A33D` (amber), `#8A96A5` (neutral), already in use across `AnomalyFeed.SEVERITY_CLASS`. No new palette additions.
- **Turn Inspector deep-link** — turns use the existing `/session/:id/turn/:n` route (convention established by #P4-6/#38).

**Intentionally NOT applied:**
- No global-filter-bar gate status entry (Sessions page filter is enough).
- No letter score in URL (Report Card is per-session, not a deep-link target).
- No fleet-level letter trend (Trends has one weekly series, not multiple lines per letter — simple single-axis chart matches `pages.md` §8 row 4).
- No prefetching of gate data on Dashboard mount (lazy).
- No premium-only gate tile (gates.md confirms all are 🟢).
- No E1/E2 evidence file preview (no `/api/files` route; deferred).

## Data Models

### `GateReport` (existing — `shared/gates-contract.ts:80`)

**Purpose:** Top-level engine output for one session; emitted verbatim by `/api/sessions/:id/gates`.

**Key fields:**
| Field | Type | Notes |
|---|---|---|
| `sessionId` | `string` | The session's id |
| `gates` | `GateResult[7]` | Exactly 7 entries in gates.md order (V1, V2, P3, C3, K2, E1, E2) |
| `score` | `number` | `passes / (passes + 0.5·warns + fails)` across six checks; 0 when no checks fired |
| `scoreLetter` | `A \| B \| C \| D \| F` | Bucketed at 0.9/0.75/0.5/0.25 |
| `evaluatedAt` | `string` (ISO) | Stamped by route layer (engine is deterministic, ARCH A12) |
| `thresholdsUsed` | `GateThresholds` | Echoes resolved threshold values |

**Relationships:**
- `GateResult.gateId` ↔ `GATE_IDS` (the seven gate IDs).
- `GateEvidence.turnN?` ↔ `Turn` (1-indexed main-chain turn, set by V1/V2/P3/C3/K2, never by E1/E2).
- `GateEvidence.callId?` ↔ `ApiCall` (set with `turnN` for the same five turn-keyed gates).
- `GateEvidence.filePath?` ↔ filesystem (`P3` and `E1/E2`; E1/E2 also sets `detail`).

**Lifecycle:**
- Created by `evaluateSessionGates()` on cache miss; cached in `gates-cache` indefinitely until invalidation; refreshed on next miss.

### `GateReportSummary` (NEW — `shared/gates-cache-contract.ts`)

**Purpose:** Cache-internal compact projection; what consumers that don't need evidence see.

**Key fields:**
| Field | Type | Notes |
|---|---|---|
| `sessionId` | `string` | |
| `score` | `number` | `GateReport.score` |
| `scoreLetter` | `ScoreLetter` | `GateReport.scoreLetter` |
| `status` | `GateStatus` | Rollup of six checks: any fail → fail, else any warn → warn, else pass |
| `passCount`, `warnCount`, `failCount` | `number` | Tally across six checks |
| `evaluatedAt` | `string` | Mirror of `GateReport.evaluatedAt` |

**Relationships:**
- One-to-one with `GateReport` (derived via `toSummary(gateReport)` helper).
- Keyed by `sessionId` in the in-memory `Map`.

**Lifecycle:**
- Created from `GateReport` after engine evaluation.
- Evicted on the WS invalidation hook for the same `sessionId`.
- Process-lifetime only (in-memory; no disk persistence; no restart-pickup required because the engine is reproducible from the session's transcript on first miss).

### `AnomalyFeedItem` (existing — `client/src/pages/dashboard/AnomalyFeed.tsx:29`, discriminated union extension)

**Purpose:** Stable shape across three item kinds. Live `anomaly` kind stays as-is; `gateFailure` variant populated in this PR; `captureGap` stays reserved.

**Key fields (gateFailure variant, additive):**
| Field | Type | Notes |
|---|---|---|
| `kind` | `"gateFailure"` | (existing literal) |
| `sessionId` | `string` | (existing) |
| `scoreLetter` | `ScoreLetter` | New — surfaces severity color |
| `score` | `number` | New — the actual score |
| `summary` | `string` | E.g. "Session ABC… scored D (0.42) — K2 fail" |
| `drill` | `string` | `/sessions/${sessionId}#report-card` (fragment target the new Report Card observes) |

### `GateStatusBadge` props (NEW — `client/src/components/GateStatusBadge.tsx`)

```ts
type GateStatusBadgeProps = {
  status: GateStatus;          // for compact per-row render
} | {
  letter: ScoreLetter;         // for score-cell render (Sessions column, Projects cell)
};
```

**Purpose:** Single source of color truth for `pass/warn/fail` and `A/B/C/D/F` across all five surfaces.

### `SessionListItem.gateStatus / gateScore` and `SessionPageItem.gateStatus / gateScore` (existing — `shared/sessions-contract.ts:200-201`)

Already typed as `string?` / `number?`. Validation in `client/src/api/sessions.ts:206-210` accepts them when present, treats them as undefined when absent. **No contract change.** This PR populates them from `gatesCache`.

## API Contracts / Interfaces

### `GET /api/sessions/:id/gates` (existing — `server/routes/gates.ts`)

**Boundary:** HTTP API (Fastify route).
**Auth:** none (local single-user app).
**Response (200):** `GateReport` verbatim.
**Errors:**
- 404 if the session is unknown
- 500 with `{error, cause, sessionId}` on engine / IO / store failure (defense-in-depth — engine never throws per gates.md)

### `GET /api/sessions` (existing — `server/routes/sessions.ts`, row hydration enriched in this PR)

**Boundary:** HTTP API.
**New:** for each row, populate `gateStatus` and `gateScore` from `gatesCache.getSummary(sessionId)`. Cache miss → evaluate (lazy), then populate. No shape change; just two new fields possibly present.
**Errors:** existing route error shape unchanged.

### `POST /api/metrics` (existing — `server/routes/metrics.ts`)

**Boundary:** HTTP API.
**New:** `gatePassRate` measure no longer returns `null`; returns `mean(score)` over `getSummariesBatch(scope.sessionIds)`. Per-bucket `null` when no summaries resolved.
**Errors:** existing route error shape unchanged.

### Internal: `gates-cache` module API (`server/cache/gates-cache.ts`)

**Boundary:** internal module API.

| Method | Signature | Purpose |
|---|---|---|
| `getSummary(sessionId, deps?)` | `Promise<GateReportSummary \| null>` | Lazy fetch + memoize; returns `null` if session unknown |
| `getSummariesBatch(ids)` | `Promise<Map<string, GateReportSummary>>` | Used by the metrics engine and Sessions route; concurrent-safe, single-flight per id |
| `invalidate(sessionId)` | `void` | Called by `server/store/invalidation.ts` WS hook |
| `clear()` | `void` | For tests only |

**Auth:** none (in-process).

### Internal: `useGateReport(id)` hook (NEW — `client/src/api/gates.ts`)

**Boundary:** client internal.

```ts
function fetchGateReport(id: string, signal?: AbortSignal): Promise<GateReport>
```

Query key: `qk.gates(id)`. Pulled from `client/src/api/queryKeys.ts`.

### Internal: `fetchWorstGateFailures(params)` (NEW — `client/src/api/gate-failures.ts`)

**Boundary:** client internal. Reuses `listSessions` with `{sort: "gateScore", order: "asc", limit: 5}`.

Query key: `qk.gateFailures(params)`.

## Module Boundaries

| Module / Package | Responsibility | Allowed Dependencies |
|---|---|---|
| `server/cache/gates-cache.ts` (new) | Per-session memo of `GateReportSummary`; WS invalidation hook; thresholds resolution | `server/gates/engine.js`, `server/gates/thresholds.js`, `server/settings.js`, `server/store/invalidation.js`, `shared/gates-contract.js`, `shared/gates-cache-contract.js` |
| `server/metrics/measures.ts` | Aggregations | New: `getSummariesBatch` via injected seam (the existing pricing injection pattern); **never** imports cache modules directly at top |
| `server/routes/sessions.ts` | List/row projection | `gatesCache.getSummary` per row inside projector |
| `server/routes/gates.ts` (existing) | Session gate report route | Unchanged |
| `client/src/components/GateStatusBadge.tsx` (new) | Status/letter → color rendering | Only React + `shared/gates-contract.js` types |
| `client/src/api/gates.ts` (new) | Single `fetchGateReport` helper | `shared/gates-contract.js` |
| `client/src/api/gate-failures.ts` (new) | Single `fetchWorstGateFailures` helper | Re-exports `listSessions` — no new fetch logic |
| `client/src/api/queryKeys.ts` (tiny add) | Two new key helpers | Existing key factory |
| `client/src/pages/session-detail/ReportCard.tsx` (new) | Lazy mount, fetch, evidence list, two drill kinds | TanStack Query; `useInView` (IntersectionObserver); `wouter` Link |
| `client/src/pages/session-detail/ReportCardView.tsx` (new) | Pure presentation of `GateReport` | Only React + types |
| `client/src/pages/trends/GatePassRatePanel.tsx` (new) | Fetch + render weekly gate pass-rate trend | `client/src/api/metrics` (existing); existing ECharts wrapper |

**The HTTP layer never imports the engine directly** for fleet metrics — it goes through `gatesCache.getSummariesBatch` to avoid N+1.

## Change Footprint

_The concrete answer to "where does this land in the codebase?"_

### New files / modules

| Path | Purpose | Pattern reference |
|---|---|---|
| `server/cache/gates-cache.ts` | Per-session `GateReportSummary` memo; WS invalidation; `getSummary` + `getSummariesBatch` | `server/cache/analysis.ts` |
| `server/cache/gates-cache.test.ts` | Hot/cold/invalidated/concurrent-coalesce/empty-cache tests | `server/cache/analysis.test.ts` |
| `shared/gates-cache-contract.ts` | `GateReportSummary` type + `getSummariesBatch` signature | `shared/cache-lab-contract.ts` |
| `client/src/components/GateStatusBadge.tsx` | Status → color mapping; one source for five surfaces | `client/src/components/TierBadge.tsx` |
| `client/src/components/GateStatusBadge.stories.tsx` | Six stories (`pass`/`warn`/`fail` × compact/full) | existing stories |
| `client/src/api/gates.ts` | `fetchGateReport(id, signal?)` only | `client/src/api/session-detail.ts` |
| `client/src/api/gate-failures.ts` | `fetchWorstGateFailures(params, signal?)` (wraps `listSessions`) | `client/src/api/sessions.ts` |
| `client/src/pages/session-detail/ReportCard.tsx` | Lazy-mount fetch + evidence list | `client/src/pages/session-detail/Header.tsx` |
| `client/src/pages/session-detail/ReportCardView.tsx` | Pure presentation | `client/src/pages/session-detail/SessionDetailView.tsx` |
| `client/src/pages/session-detail/ReportCard.stories.tsx` | `loading`/`passing`/`warn`/`failing`/`error`/`no-data` stories | existing stories |
| `client/src/pages/session-detail/ReportCard.test.tsx` | Render assertions for each evidence drill kind | existing test pattern |
| `client/src/pages/trends/GatePassRatePanel.tsx` | Weekly trend fetch + ECharts wrapper render | `client/src/pages/trends/RollingEfficiencyPanel.tsx` |
| `client/src/pages/trends/GatePassRatePanel.stories.tsx` | Loading/empty/series/error stories | existing stories |
| `client/src/pages/trends/GatePassRatePanel.test.tsx` | Render assertions + measure-presence test | existing test pattern |

### Modified files / modules

| Path | What changes here |
|---|---|
| `shared/gates-contract.ts` | Add `GateReportSummary` (additive — same file is the natural home; `gates-cache-contract.ts` re-exports it if cross-package reach is cleaner) and `gateStatusFromChecks()` rollup helper |
| `server/metrics/measures.ts:204` | `case "gatePassRate": return null;` → `mean(score over getSummariesBatch(scope.sessionIds))`; per-bucket `null` when no summaries |
| `server/routes/sessions.ts` | Row projector populates `gateStatus`/`gateScore` on `SessionListItem` and `SessionPageItem` via `gatesCache.getSummary(sessionId)` |
| `server/store/invalidation.ts` | Register `gatesCache.invalidate(sessionId)` callback on per-session invalidation |
| `client/src/pages/session-detail/SessionDetailView.tsx` | One new line: `<ReportCard sessionId={data.header.sessionId} />` placed before `<WorkflowFunnel />` |
| `client/src/pages/dashboard/AnomalyFeed.tsx` | Parallel `gateFailuresQuery` against `fetchWorstGateFailures`; merged into `detectedItems`; the "Gate failure and capture-gap data not available yet" stub notice (line 245) inverts |
| `client/src/pages/dashboard/AnomalyFeed.stories.tsx` | One new story: live-data branch (gate-failure items without the `items` injection) |
| `client/src/pages/trends/Trends.tsx` | Swap `GatePassRateStub` import for `GatePassRatePanel` |
| `client/src/pages/sessions/SessionsFilters.tsx` | Replace hint copy (lines 35-38) with a real `GateStatusControl` (mirror of `EntrypointControl`) — pass/warn/fail toggle buttons |
| `client/src/pages/sessions/SessionBrowser.tsx` | Render `gateScore` column (sort key already declared in `state.ts:124`) with `GateStatusBadge` |
| `client/src/pages/sessions/state.ts` | Nothing — sort key already declared, filter already reserved |
| `client/src/pages/projects/EfficiencyTable.tsx` | Replace `gatePassRate: null` row default (line 133) with live aggregate via `gatesCache.getSummariesBatch` |
| `client/src/api/queryKeys.ts` | Add `qk.gates(id)`, `qk.gateFailures(params)` |

### Deleted / replaced

| Path | Reason |
|---|---|
| `client/src/pages/trends/GatePassRateStub.tsx` | Fully replaced by `GatePassRatePanel.tsx` |
| `client/src/pages/trends/GatePassRateStub.test.tsx` | Replaced (above) |
| `client/src/pages/trends/GatePassRateStub.stories.tsx` | Replaced (above) |

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|---|---|
| `client/src/pages/dashboard/AnomalyFeed.test.tsx:76` | Asserts the stub notice `"Gate failure and capture-gap data not available yet"` — inverts to a new "No gate failures detected" notice |
| `client/src/pages/dashboard/AnomalyFeed.test.tsx:144` | `queryByText("not available yet")` negation — needs the same inversion |
| `client/src/pages/dashboard/Dashboard.test.tsx:102` | `Anomaly & gate-failure feed` rendering branch — adds one assertion for the gate-failure-specific row |
| `server/metrics/measures.test.ts:667` | Asserts `gatePassRate` returns `null` — flips to a real-result assertion with seeded gate summaries |
| `server/metrics/engine.test.ts:434` | `gateStatus dimension` test — unaffected (the dimension reads `Turn.gateStatus` from seeded data, untouched by this PR) |
| `client/src/api/sessions.ts:430` | Param validation enumerates `gateStatus` — already accepts it; this PR exercises it from the page |
| `server/routes/sessions.ts:280-281` | Already accepts `gateStatus` filter — this PR wires the page-to-route call |
| `server/routes/sessions.ts:712` | `gateStatus: undefined` no-op flips to populated; snapshot tests may need regen |
| `shared/sessions-contract.test.ts:174` | Already includes `"gateStatus": ["pass"]` — valid path unchanged |
| `server/session-detail/projector.ts:446` | Already copies `sourceTurn.gateStatus` — verified; no new projector code |
| `client/src/api/session-detail.ts:77,136` | `gateStatus` valid string-or-undefined — verified; flows through |
| `client/src/pages/sessions/state.ts:124` | `"gateScore"` already in `ALLOWED_PAGE_SORT` — verified; this PR renders the column it sorts |
| `client/src/pages/dashboard/AnomalyFeed.stories.tsx:64-110` | Already exercises `gateFailure`/`captureGap` items via `items` injection seam — verifies the existing branch stays intact when the live branch is added |
| `client/src/pages/projects/EfficiencyTable.tsx:42,133,169,207,263` | All gated on the `gatePassRate: number \| null` row default — confirmed column definition is the only thing touching the stub |

## Areas of Impact

_Broader-than-files impact — modules, services, teams, contracts, cross-cutting effects._

| Area | Impact | Risk (L/M/H) | Why |
|---|---|---|---|
| Gates engine cache (NEW) + WS invalidation hook | First per-session cache to register on the existing debounced invalidation bus | **M** | Hot/cold/invalidated all need tests; getting eviction wrong means stale scores surfaced everywhere |
| Sessions-page row hydration | Adds `gateStatus`/`gateScore` population per row; cold-cache first load = O(N) engine calls | **M** | Lazy + memoized cache mitigates steady state; pathological 10M-session fleets still cold-load all rows. Documented follow-up |
| Metrics engine `gatePassRate` measure de-null | Trends + Explore + any future consumer that asks for the measure sees a real number | **M** | TanStack Query cache keys must remain stable so cached `null` results don't pin the wrong answer for `staleTime` durations |
| `AnomalyFeed` live `gateFailure` branch | New parallel query; merge logic into the existing `detectedItems` discriminated union | **L** | Branch already exists in the `items` seam; stories/tests already exercise it |
| Session Detail UI | One new section in established ordering (before `WorkflowFunnel`) | **L** | Lazy-mounted via `useInView`; section order matches the `specs/pages/session-detail.html` mockup |
| Trends page stub swap | Drop the stub file; mount `GatePassRatePanel` | **L** | All callers of the stub file are within this PR's footprint |
| Sessions filters + browser | Real `GateStatusControl` + `gateScore` column | **L** | Reserved filter + sort already wired through `state.ts:124`, `api/sessions.ts:430`, `sessions-contract.ts:83,200-201` |
| Projects efficiency table | `null` → live aggregate | **L** | Stub cell already typed `number \| null`; flip is one assignment per row |
| Shared status/letter color tokens | `GateStatusBadge` centralizes the map | **L** | Inherits the existing tokens (`#E05252`/`#E8A33D`/`#8A96A5`); no new palette additions |
| Routing | (none) | **none** | No new routes added or modified |
| Build pipeline / CI | (none) | **none** | No new dependencies; existing tests/coverage continue to gate |
| Telemetry / observability | One debug-level log line per cache miss (mirrors `analysis.ts`) | **L** | No new app metrics emitted |
| Entitlements / auth | (none) | **none** | Local-only app, no third-party data exposure |

**Contract changes:**
- `shared/sessions-contract.ts` — **no shape change**; two previously-optional fields (`gateStatus`, `gateScore` on both `SessionListItem` and `SessionPageItem`) become *possibly-populated* instead of *always-absent*. Consumers handle absence today (`if (item.gateStatus) …`), so the wire-level change is **additive** and **forward-compatible**.
- `shared/gates-contract.ts` — adds `GateReportSummary`; existing `GateReport` is unmodified.
- `client/src/pages/dashboard/AnomalyFeed.tsx` — `AnomalyFeedItem` discriminated union gets a `gateFailure` variant per row; existing variants unchanged.

**Cross-cutting ripples:**
- WS invalidation bus: register one new eviction callback (invalidation.ts is already the per-session debounced hook).
- Settings → Gate thresholds (#P4-15 territory): `gatesCache` resolves thresholds through `getGateThresholds(await readConfig())` exactly the same way the route does, so an edit reflects on next cache miss. No new code path.

## Cross-Cutting Concerns

- **Errors:** `/api/sessions/:id/gates` already surfaces 500 with `{error, cause, sessionId}`. Engine never throws on E1/E2 IO (`evaluateE1E2` classifies fs failures as `fail`/`warn` per gates.md). Cache miss after eviction → re-run, no error path. Report Card client error path: inline `EmptyState`-style error with retry (mirrors `BurnRateCard.tsx`), surrounding `SessionDetailView` keeps rendering (lazy mount).
- **Logging & metrics:** Debug-level log on cache miss + engine eval per `sessionId` (mirrors `analysis.ts`). One log line on batch lookup for the metrics engine. **No new app metrics emitted** — the gate-pass-rate chart itself is the metric, not a producer.
- **Auth / authz:** None. Local single-user app; no entitlements changes. E1/E2 already follows `@import` one level and is anchored to `os.homedir()`.
- **Performance:** Cache is `Map<sessionId, GateReportSummary>`, lazy-memoized, evicted per WS-debounced invalidation. First-load Sessions page = N×engine eval (mitigated by memoization on second load). Steady state = O(1) per row. Lazy `ReportCard` mount avoids the round-trip on first Session Detail paint. Trends `gatePassRate` uses `getSummariesBatch` (one call per bucket boundary) — no N+1. Documented follow-up for fleets > 10M sessions: per-request cold-eval budget with a `"—"` fallback (see Open Questions).
- **Security:** No new fs-read surfaces; no third-party data exposure. E1/E2 evidence exposes a `filePath` of `~/.claude/CLAUDE.md` paths or paths the user themselves wrote. E1/E2's `@import` traversal is bounded to one level per gates.md.
- **Migrations / rollout:** No data migration. No config changes (existing `gateThresholds` block in Settings is consumed via `getGateThresholds`; this PR does not extend it). No feature flag — all five surfaces flip to live on merge. Behind backwards-compatible seams (existing `null`-returning `gatePassRate`, the "Gate failure and capture-gap data not available yet" copy, the hint text in `SessionsFilters`) so partial rollback = `git revert` to the commit that retains the stubs. Single-risk: the cache layer. Disabling just that — leaving gates route + measure returning `null` + surfaces returning their stub states — is a one-line `app.unregister` call, restoring prior behavior.

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies REQs |
|---|---|---|---|---|
| A1 | E1/E2 evidence deep-links to a same-page inline expand (no `/api/files` route) | External `file://` URI; full file content preview via new route | Evidence is already in the report payload; rich preview is its own follow-up, not in #P4-12's scope. Same-page UX keeps scroll state | Issue §"Acceptance" (turn-keyed vs session-keyed), IR1, IR2 |
| A2 | Dashboard gate-failure feed surfaces top-N (≤5) sessions by ascending `gateScore` | Recency-first; per-evidence drill | Top-N mirrors `AnomalyFeed`'s `MAX_ANOMALY_ITEMS`; deterministic across reloads; user's worst offenders always visible | Issue §"Scope" line 1, IR3 |
| A3 | Lazy-mount `ReportCard` via `useInView` (200px rootMargin), not on Session Detail paint | `<details>` click-to-expand; fetch-on-mount | Keeps the E1/E2 filesystem check off first Session Detail paint; turns the score letter visible without an extra click | IR3, IR7 |
| A4 | Pre-compute-and-cache `GateReportSummary` per session, WS-invalidated (mirrors `server/cache/analysis.ts`) | Per-request memo only; no cache (lazy only) | Steady-state O(1) per row; mirrors existing pattern; follows the project's "in-memory store + WS invalidation bus" architecture | IR5, IR6 |
| A5 | `MetricsQuery.gatePassRate` measure = `mean(score)` per bucket via `getSummariesBatch` | Per-call iteration; new `rollups/` precompute column | Gate status is a session-level verdict (gates.md), not a per-call signal; batch lookup reuses the existing cache — no new infrastructure | IR8, issue §"gate pass-rate trend on Trends" |
| A6 | New `GateStatusBadge` component for status/letter → color, one source of truth | Inline styles per surface | Five surfaces with the same status domain; project centralizes this via `Badge.tsx`/`Chip.tsx`/`TierBadge.tsx` already | Issue §"Scope" (five surfaces), IR4 |
| A7 | No new HTTP routes; reuse `/api/sessions/:id/gates` and `GET /api/sessions` | New `/api/dashboard/gate-failures`; new `/api/files` for E1/E2 preview | All reads covered by existing routes; the project's "one HTTP layer" architecture rule (§3) discourages unnecessary endpoint proliferation | Architecture §3, IR9 |
| A8 | `getSummariesBatch(ids)` injected into `measures.ts` via the existing `pricing`-style injection seam; measures.ts does **not** import cache modules directly | Top-level cache import; precomputed rollup column | Same testability seam the rest of `measures.ts` uses; no leaked top-level coupling to `gates-cache` from a metrics-aggregation layer | Architecture §8, IR5 |
| A9 | `ReportReportSummary` placed in `shared/gates-cache-contract.ts` (new) — re-export from `shared/gates-contract.ts` for backward call sites | Single file (`gates-contract.ts`) | The cache is its own concern; the gates wire contract stays focused on the engine's public output. Re-export keeps existing call sites unchanged | Architecture §3 (three strict TS roots, narrow contracts) |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|---|---|
| Engine dependencies "down" for 30 s (filesystem stuck on E1/E2 `~/.claude/CLAUDE.md`) | Engine never throws; classifies fs failures as `fail` (gates.md). Cache entry populates with `score=0/letter=F/status=fail`. UI surfaces this as a normal Report Card with a fail E1 row, no error banner. **OK** |
| Two callers race to evaluate the same new session | Single-threaded JS — second caller's `getSummary` awaits the first's in-flight promise and returns the same cached value. Test: two concurrent `getSummary(sameId)` → engine hit exactly once. **OK** |
| Fleet grows 10K → 10M sessions | Cache stays bounded to actively-inspected sessions (lazy). Cold Sessions list = O(N×engine) on first load — **GAP, documented as Open Question**. Steady state is O(1) per row. |
| Rollback path (ship a bug, revert) | All five surfaces flip individually; the stub files (`GatePassRateStub.*`, the hint copy in `SessionsFilters`) are removed in this PR but exist in the previous commit; `git revert` restores them. The cache is the single riskiest point; `app.unregister` for the cache eviction callback restores prior behavior without affecting the gates route or measure. **OK** |
| Cache evicted while a Report Card render is mid-fetch | Fetch already issued its own request via `/api/sessions/:id/gates`; the page renders normally. Cache miss on next refresh, re-populates. **OK** |
| Engine returns N/A (no checks fired) | `score = 0 / letter = F / status = fail` per `denominator > 0 ? passes/denominator : 0`. Trends `gatePassRate` averages zeros into the bucket; UI surfaces the letter "F" with no evidence rows. Acceptable per gates.md §"Report Card scoring". **OK — see Open Question OQ3 for an "empty session" sentinel** |
| Cold start with empty user data (new install) | All five surfaces render empty states: "No gate failures detected" (Dashboard feed), empty-state chart (Trends), empty Sessions filter output, "No gate score" cell (Projects). Mirrors existing empty-state conventions. **OK** |
| Trends range with no analyzed sessions | `gatePassRate` returns `null` per bucket; `GatePassRatePanel` renders empty-state mirroring `ParetoPanel` / `CalendarHeatmapPanel`. **OK** |
| `Turn.gateStatus` projection drift between session-detail projector and gates engine | Both compute from the same `sourceTurn.gateStatus` field (`server/session-detail/projector.ts:446`); engine reads from the in-memory store's parsed turns. If the gate engine's source moves (it stays in #43), the same projector line propagates. **OK** |

### Backward — regression risk per touched area (brownfield)

| Touched area | What could regress | How we'd know / mitigation |
|---|---|---|
| `AnomalyFeed.test.tsx:76` (stub notice assertion) | Test re-runs fail with new copy | Intentional flip; update assertion to "No gate failures detected" |
| `AnomalyFeed.test.tsx:144` (stub notice negation) | Same as above | Intentional flip; invert the `queryByText` to "No gate failures detected" |
| `measures.test.ts:667` (`gatePassRate === null`) | Test re-runs fail | Intentional; assert non-null when seeded summaries present |
| `engine.test.ts:434` (gateStatus dimension test) | Could regress if dimension reading path changes | Unaffected — dimension reads `Turn.gateStatus` from seeded fake turns; this PR does not touch `Turn.gateStatus` |
| `routes/sessions.ts:280-281` (`gateStatus` filter acceptance) | Page filter wires through; validation unchanged | E2E smoke (Cypress under #P4-18) picks a known-failing session and asserts the filter narrows the list |
| `routes/sessions.ts:712` (per-row `gateStatus: undefined` no-op) | Row shape now possibly carries the field | Snapshot tests regenerate; row-rendering tests assert the new column |
| `shared/session-detail-contract.ts` `gateStatus?` on `Turn` and `SessionDetailResponse` | Already populated by projector (line 446) | Verified — no new projector code |
| `client/src/api/sessions.ts:430` (`gateStatus` in param validation) | Validation already accepts it | Verified — flip is in the page, not the API |
| `Dashboard.test.tsx:102` (Anomaly & gate-failure feed assertion) | Test re-runs succeed for the existing branch; new assertion for the live branch | Add the assertion; fixture unchanged |
| `SessionDetail.test.tsx` snapshot | Lazy mount → no new initial-render assertion needed; existing snapshot passes | Verified — but add a "scrolls into view, ReportCard renders" assertion for completeness |
| `EfficiencyTable.test.tsx` (`gatePassRate: null` row default) | Flips; fixture data changes | Update fixture; assertion follows the live value |
| `GatePassRateStub.test.tsx` / `stories.tsx` deletion | Any test/stories still importing the deleted file fail | CI catches |
| `state.ts:124` (`"gateScore"` in `ALLOWED_PAGE_SORT`) | Sort path now exercised | Verified — sort + column already declared |
| `client/src/api/session-detail.ts:77,136` (`gateStatus` valid string-or-undefined) | Validation already accepts the field | Verified — flows through unchanged |

## Open Questions

- **OQ1. Cold-cache cost cap for the 10M-row case.**
  - **Impact if unresolved:** First-load of a Sessions page on a 10M-session fleet would issue O(N) engine evaluations; each is fast but the cumulative round-trip blocks the page for seconds.
  - **Suggested default:** Documented as a follow-up; this PR keeps the naive lazy path and adds a per-request budget with `"—"` fallback if an eval exceeds a soft budget. Promote a true background warm-up strategy in a separate enhancement.

- **OQ2. Trends panel x-axis grain.**
  - **Impact if unresolved:** Defaults to `week`; matches `pages.md` §8 row 4 ("per week"). Selecting other grains (day/month) would require `metrics.ts` to enumerate weekly buckets correctly.
  - **Suggested default:** `week` grain only (matches the spec wording). Skip day/month for now.

- **OQ3. Empty-session rendering on the Report Card.**
  - **Impact if unresolved:** A session with zero calls computes `score = 0 / letter = F`, which the user would read as a failing session when in fact there are no habits to score.
  - **Suggested default:** When `gateReport.gates.every(g => g.status === "pass" && g.evidence.length === 0)` AND `score === 0`, render a sentinel headline ("No practice data — session had no API calls") instead of the F score letter. Add a one-line test for the empty-session rendering path.

- **OQ4. `GateReportSummary` file placement.**
  - **Impact if unresolved:** Two files (`shared/gates-contract.ts` and `shared/gates-cache-contract.ts`) or one. Both are valid; second-file keeps the cache layer separate from the engine's wire contract.
  - **Suggested default:** Split into `shared/gates-cache-contract.ts`; re-export `GateReportSummary` from `gates-contract.ts` for ergonomic single-import callsites. (A9 in the decisions log.)

## Out of Scope

- **No file content preview for E1/E2 evidence** (reason: requires new fs-route + entitlements; deferred to a follow-up; gates.md does not require it).
- **No global FilterBar gate-status entry** (reason: Sessions page filter is enough; doesn't flood the global bar; gates are session-scoped by design).
- **No letter score in URL** (reason: Report Card is per-session, not a fleet-level deep-link target).
- **No fleet-level letter trend** (reason: matches `pages.md` §8 — single-axis weekly series, not multi-line per letter).
- **No warm-up / background prefetch of gate data** (reason: same fleet-scale path as Open Question OQ1 — follow-up enhancement; lazy lazy lazy).
- **No premium-tier gate tile** (reason: gates.md confirms all seven are 🟢 tier, transcript-only; no C/B/L feature flags surface in the UI).
- **No E1/E2 evidence file preview** (reason: see first bullet).

---

# Tasks

_This section is populated by the **generate-tasks** skill (Phase 3)._
_Run: `/generate-tasks from: specs/architecture/ARCH-p4-12-report-card-gate-feeds.md`_
