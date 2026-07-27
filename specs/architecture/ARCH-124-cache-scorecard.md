# Architecture: Cache Scorecard — session hygiene grade + "Biggest Lever" dashboard card

> **Date:** 2026-07-27
> **Issue:** #124
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** specs/requirements/REQ-124-cache-scorecard.md
> **Type:** feature

## Architecture Summary

Add a per-session **cache scorecard** as a new pure engine (`server/scorecard/`) with a deliberate two-layer split. First, a **threshold-independent decomposition** walks every main-thread call and partitions positive cache creation into warmup / incremental / rewritten via an epoch high-water mark. Second, every call with rewritten tokens becomes a chronological **waste event** and is attributed by the existing K2 classifier (`server/cache/classifier.ts`) with a zero threshold; the configured K2 spike threshold continues to gate K2 alerts only. Each event carries both canonical fields (`baseCause` + `attribution`) so agreement with existing cache surfaces is literal field equality (R2). A numeric hygiene score grades **confirmed-fixable waste only** (prefix-change + duplicated-warmup); ttl-lapse and unattributed rewrites are excluded from both numerator and denominator, making them grade-neutral (R3). This deterministic, **config- and pricing-independent core** is cached on `SessionState` and recomputed inside the store's existing lazy `recompute()` so it stays current on live sessions (R9) without a full-fleet recompute per line (N2). A **separate pure fleet projector** (`server/scorecard/fleet.ts`, mirroring `fleet-baselines.ts`) consumes those cached cores at the serving layer to apply the letter grade, price dollars, and select the Biggest Lever under the dashboard's active range + global filters. Two thin routes read it: `GET /api/sessions/:id/scorecard` (R6) and `GET /api/dashboard/biggest-lever` (R7/R8). All values are transcript-only 🟢 (N1); dollars are never rendered as $0 when unavailable.

## High-Level Structure

```
transcript calls ──(existing ingest → derive)──► Store.SessionState
                                                       │  recompute()  [lazy, per dirty session; store.ts:775]
                                                       ├─ deriveSession()          (exists)
                                                       └─ computeScorecard()        ◄── NEW (cached CORE on SessionState)
                                                            partitionCacheStreams → main stream only
                                                            (1) decomposition: high-water mark over EVERY call
                                                                → chronological write ledger + aggregate totals
                                                            (2) events: every ledger entry with rewritten > 0
                                                                → classifyCacheWrite({ threshold: 0 }) + attributeCacheMiss
                                                            (3) score inputs: fixableWaste / scoreableCreation
                                                            deterministic; NO fleet input, NO pricing, NO Date.now()
                                                       │
                                          Store exposes CORE snapshots only (no range analytics, no calibration)
                                                       │
                                server/scorecard/fleet.ts  ◄── NEW pure fleet projector (serving layer)
                                   resolveBands(all-history gradeable scores) · applyGrade · price · select
        ┌──────────────────────────────────────────────────┴──────────────────────────────────┐
   GET /api/sessions/:id/scorecard                                    GET /api/dashboard/biggest-lever?from&to&<globalFilters>
   projector: core + current grade state                              projector: filter ledger by range + project/model/branch/host
   + stamp evaluatedAt                                                pick max by tokensRewritten; price (incremental loss)
        │                                                             + deep link; empty period → first-write share (R8)
   Session Detail: Scorecard.tsx section (R6)                         Dashboard: BiggestLeverCard.tsx (R7/R8)
        │  per-event deep link → Turn Inspector                            │  deep link → that session's scorecard section
        └──────────────── WS `session-updated` refetch by query-key prefix (R9) ───────────────┘
```

**Added:** `server/scorecard/` engine + band resolver, `shared/scorecard-contract.ts`, `server/routes/scorecard.ts`, two client surfaces. **Modified:** store (cache + fleet accessor), threshold config, route registration, two page containers, query-key/WS wiring, `specs/gates.md`. **Replaced/deleted:** nothing.

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|---|---|---|---|
| Token decomposition (R1) | Threshold-independent epoch high-water mark over every call. Within an epoch, `footprint = read+create`; `incremental = min(create, max(0, footprint − established))`; `rewritten = create − incremental`. Update `established = max(established, footprint)` after every call, including read-only calls. For a positive write, resolve the shared classifier verdict first: first-call/model-switch/compaction starts a new epoch and its creation is warmup; a zero-create model switch resets the epoch separately | Tie decomposition to the K2 spike threshold | The threshold gates alerts, not whether rewritten tokens exist; using the classifier verdict for resets guarantees a rewritten event cannot simultaneously carry an explained base cause |
| Cause classification (R2) | Every call with `rewritten > 0` is an event; reuse `classifyCacheWrite(..., { threshold: 0 })` + `attributeCacheMiss`; each event carries both `baseCause` + `attribution` | Spike-only events; projector's `classifyCacheCause`; collapsed cause field | R1/R6 require every waste event, while the configured K2 threshold remains exclusive to alerting |
| Hygiene score (R3/R5) | `1 − confirmedFixableWaste / scoreableCreation`, where `scoreableCreation = warmup + incremental + confirmedFixableWaste`; ttl-lapse **and** unattributed/unknown excluded from both terms | Grade all rewritten tokens; blended 0–100 (prototype) | Idle-only session scores 1.0 (R3); never pretends unknown behavior is fixable (REQ decision #8) |
| What the core caches | Config- & pricing-**independent** core on `SessionState`, computed in lazy `recompute()`: write ledger + aggregates + score inputs (no grade state or dollars) | Cache the letter/dollars too; on-request per route; separate memo module | Store already owns lazy per-session derive; pricing/config changes must not force a core recompute; the fleet card is what makes caching necessary |
| Fleet layer (R5/R7/R10) | **Separate pure projector** `server/scorecard/fleet.ts`: band calibration, `applyGrade`, dollar pricing, range+filter selection | Do fleet/range analytics inside the Store | Store stays a dumb per-session cache; fleet logic is unit-testable in isolation; mirrors `fleet-baselines.ts` |
| Grade calibration (R5) | Fixed integer-% bands below `scorecardCalibrationMin`; at/above it, nearest-rank all-history percentiles (p80/p60/p40/p20), with equal scores sharing a grade. The percentile result may improve the fixed grade by at most one letter and never lower it | Pure percentile; unbounded better-of-fixed-and-percentile; always-fixed | Preserves an absolute hygiene anchor while allowing personal calibration; an identical fixed-F fleet becomes D rather than all F or implausibly all A |
| Dollar consequence (R10) | Incremental loss vs. a hit: `rewrittenTokens × max(rate.cacheCreate − rate.cacheRead, 0) / 1_000_000`; `null` when `pricing[model]` is absent. Cost basis is always `"estimated"`/`"computed"`, never a session's `"observed"` basis | Full creation cost; substitute $0; inherit session cost basis | Pricing rates are per million tokens; the waste is the delta over a hit; a projected figure is not an observed one |
| Pricing liveness (R10, #2) | Scorecard routes read **current** pricing from the Store via a new `getPricing()`/`getPricer()` getter — the Store is already the live pricing source (`config.ts:119` calls `store.updatePricing` on every save). Client `PricingEditor` invalidates the scorecard query prefixes on save | Bind startup `metadata.pricing` into the route closure like `app.ts:228-244` does for metrics/sessions/cache-lab; re-read+merge config per request like gates thresholds | The startup closure goes stale after a pricing edit; the Store's pricer is already kept live, so reading it avoids both a stale closure and a redundant per-request config read/merge |
| Thresholds home | Add `AppConfig.scorecardThresholds` beside `gateThresholds`, with its resolver in `server/scorecard/thresholds.ts`; render both groups in the existing Settings panel | Add unrelated fields to `GateThresholds`; new settings page | Keeps gate reports domain-specific while satisfying "alongside existing gate thresholds" |
| Route shape | New `server/routes/scorecard.ts` holding both endpoints | Fold into `routes/session-detail.ts` and a dashboard route | Parallels `routes/gates.ts` |
| Dependencies | None added | — | Every primitive (classifier, pricing, store, WS bus, UI kit) already exists |

## Patterns & Conventions

- **Deterministic engine, serving-layer "as-of" + fleet + pricing** — from `server/gates/engine.ts`: the engine never calls `Date.now()`, never reads fleet state, and never prices. The core is config/pricing-independent so `updatePricing` never forces a scorecard recompute; the fleet projector injects fleet context, dollars, and the `evaluatedAt` stamp. Keeps fixture-regression friendliness (N3).
- **One chronological ledger** — the cached core stores one deterministic entry per positive write. Aggregate decomposition and the waste-event view derive from that ledger, avoiding duplicated cached arrays. Every entry with `rewritten > 0` is a waste event; classification uses the K2 primitive with threshold zero.
- **Main-stream-only scoring** — reuse `partitionCacheStreams` + `MAIN_STREAM_KEY`, **then explicitly drop any `call.isSidechain === true` before scoring**. `partitionCacheStreams` (`classifier.ts:29-35`) buckets a sidechain call whose `agentId` is missing into `main`, and transcript JSONL is untrusted, so the `MAIN_STREAM_KEY` bucket alone is not a sufficient guarantee — the engine belt-and-suspenders filters `!call.isSidechain`. Message-id dedupe is already done upstream (gates.md shared preprocessing). Regression-tested with a sidechain call that has no `agentId`.
- **Tier honesty** — tokens always show; the fleet projector prices the rewrite-vs-hit delta only when the model has a rate. Missing pricing stays `null`, never $0. The waste dollar is a **computed projection** (`rewrittenTokens × rate delta`), so its cost basis is **always `"estimated"`/`"computed"` — it never inherits a session's `"observed"` basis** (`derive-session.ts:132`), even when C/L capture files are present: an observed *session* cost does not make a *projected waste* figure observed.
- **Lazy per-session recompute + fleet-on-read** — from `store.ts`: derived data recomputes on read of a dirty session; fleet aggregates iterate those. The scorecard cache follows this exactly.
- **Invalidation bus is refetch-only** — WS carries `session-updated`; the client refetches mounted queries by key prefix (R9). No scorecard data ever travels over WS.
- **Contract in `shared/`** — the wire types live in `shared/scorecard-contract.ts`, imported by both server and client (architecture §3).

## Data Models

### CacheScorecardCore (per-session, cached, deterministic, config- & pricing-independent)

**Purpose:** the session-local core — everything computable without fleet context, pricing, or wall-clock. This is what the Store caches and hands out as a snapshot.

**Key fields:**
| Field | Type / Constraint | Notes |
|---|---|---|
| `sessionId` | string, required | key |
| `mainThreadCalls` | int ≥ 0 | drives the R4 grade floor check |
| `cacheReadTokens` | int ≥ 0 | R1 total reads |
| `writes` | `CacheCreationEntry[]`, chronological | One entry per positive write; source for period slicing, event rows, filters, and aggregate totals |
| `decomposition` | `{ warmup, incremental, rewritten }` (int ≥ 0 each) | Sum of `writes`; `warmup + incremental + rewritten = total creation` |
| `wasteRatio` | number ∈ [0,1] \| null | `rewritten / totalCreation`; `null` when totalCreation = 0 |
| `hitRatio` | number ∈ [0,1] | Existing app-wide cache-hit semantics: `reads / (input + reads + creation)`; **`0` when the denominator is zero**, matching the shipped `derive-session.ts:122` `cacheHitPct` exactly (not `null`) so the scorecard never introduces a second hit-rate definition. `wasteRatio` and `hygieneScore` keep their new `null`-on-empty semantics; `hitRatio` deliberately does not |
| `scoreInputs` | `{ confirmedFixableWaste, scoreableCreation }` (int ≥ 0) | raw inputs so the score is auditable and re-derivable; `scoreableCreation = warmup + incremental + confirmedFixableWaste` |
| `hygieneScore` | number ∈ [0,1] \| null | `1 − confirmedFixableWaste / scoreableCreation`; `null` when `scoreableCreation = 0` (→ ungraded); band-mapped at serving layer |

**Never stores gradeability, an ungraded reason, a letter grade, or dollars.** Those depend on current configuration, fleet state, pricing, or serving time and are applied by the fleet projector.

### CacheCreationEntry

Each entry carries stable call/message identity, `promptId`, one-based `turnNumber | null`, timestamp, model, project/branch filter dimensions, `warmupTokens`, `incrementalTokens`, `rewrittenTokens`, canonical `baseCause` + `attribution`, and `kind: WasteEventKind | null`. `kind` is `null` when `rewrittenTokens === 0`; otherwise it is assigned once by the engine (`prefix-bust`, `duplicated-warmup`, `idle-expiry`, or `unattributed`). Keeping the presentation-ready kind on the single ledger lets serving projectors filter/map waste events without rerunning the duplicated-warmup detector or caching a second event array. Ordering is timestamp, then stable message/call identity. A missing turn resolves to the session scorecard anchor rather than dropping the entry.

### ScorecardThresholds

`AppConfig.scorecardThresholds` is an optional partial object resolved against defaults: `floorCalls = 10`, `calibrationMinSessions = 20`, and fixed percentage cutoffs `A = 95`, `B = 85`, `C = 70`, `D = 50`. Counts are non-negative safe integers; bands are integer percentages in `[0,100]` with `A > B > C > D`. The HTTP validator rejects invalid combinations and the runtime resolver falls back defensively for hand-edited config.

### WasteEvent

**Key fields:**
| Field | Type / Constraint | Notes |
|---|---|---|
| `eventId` / `turnNumber` | stable call identity / one-based int or null | R6 deep-link target; null degrades to `/sessions/:id#cache-scorecard` (plural — `/session/:id/...` is Turn Inspector, `routes.ts:31`) |
| `timestamp` | ISO string | the event's own time — decides range membership (R7 boundary rule) |
| `kind` | `"prefix-bust"` \| `"duplicated-warmup"` \| `"idle-expiry"` \| `"unattributed"` | fixable kinds (prefix-bust, duplicated-warmup) grade; idle-expiry + unattributed are informational (R3) |
| `baseCause` | `"first-call"` \| `"model-switch"` \| `"compaction"` \| `"unexplained"` | **canonical K2 field, carried verbatim** — waste events are always `unexplained` base, but the field is present so R2 agreement is literal (#12) |
| `attribution` | `"prefix-change"` \| `"ttl-lapse"` \| `"unknown"` | **canonical K2 field, carried verbatim**; `unknown` renders as "unexplained" prominently (decision #8) |
| `tokensRewritten` | int ≥ 0 | always available (tier-honest ranking key, R7) — the event's slice of decomposition `rewritten` |
| `model` | string | for serving-layer pricing (not priced in the core) |

**Grade membership:** `kind ∈ {prefix-bust, duplicated-warmup}` ⇔ `attribution = prefix-change` (or the dup-warmup detector fired) → counts toward `confirmedFixableWaste`. `ttl-lapse` and `unknown` are grade-neutral.

**Lifecycle:** projected from `CacheCreationEntry` rows whose `rewrittenTokens > 0`; recomputed whenever the session is recomputed; never persisted beyond the in-memory store.

### BiggestLever (fleet, serving-layer projector output)

**Purpose:** the R7/R8 card payload, produced by `fleet.ts` — not cached. Either:
- **event variant:** the max in-range event by `tokensRewritten` after applying range + global project/model/branch/host filters, with `tokensRewritten`, `costEstimate = rewrittenTokens × max(rate.cacheCreate − rate.cacheRead, 0) / 1_000_000` (or `null`), `costBasis` (always `"estimated"`/`"computed"`, never `"observed"`), `sessionId`/`project`, `deepLink`, and a **presentation-ready `kind`** (`"prefix-bust"` | `"duplicated-warmup"` | `"idle-expiry"` | `"unattributed"`) alongside `baseCause`+`attribution`. The `kind` is required because the client holds **no** cause logic (Module Boundaries rule): waste events are almost always `baseCause: "unexplained"` and a duplicated-warmup cannot be reconstructed client-side from `attribution` alone, so the projector must supply the label the card renders; **or**
- **healthy variant** (R8): first-write share `(warmup + incremental) / totalCreation` over the period, with real numerator/denominator; or
- **no-cache-activity variant:** no creation occurred in range, so the share is `null` rather than a fabricated 100%. Both variants are structurally distinct from loading/error.

## API Contracts / Interfaces

### server/scorecard/engine.ts

**Boundary:** internal pure module. No pricing, no fleet, no clock.

| Op | Signature | Purpose | Returns |
|---|---|---|---|
| `computeScorecard` | `(calls: ApiCall[], turns: Turn[]) => CacheScorecardCore` | per-session write ledger, decomposition, canonical turn joins, and score inputs | `CacheScorecardCore`; never throws; deterministic |

### server/scorecard/fleet.ts

**Boundary:** internal pure module (serving layer). Consumes cached cores; applies fleet + pricing + range logic.

| Op | Signature | Purpose | Returns |
|---|---|---|---|
| `resolveBands` | `(gradeableScores: number[], thresholds) => Bands` | use every current Store core meeting the configured floor, including live sessions; fixed bands below the calibration minimum, otherwise fixed + nearest-rank percentile bands | `Bands` |
| `applyGrade` | `(core, bands, thresholds) => ScorecardGradeState` | derive gradeability/reason, then allow percentile calibration to improve the fixed result by at most one letter and never lower it | discriminated grade state |
| `selectBiggestLever` | `(cores, sessionMeta, range, filters, pricing) => BiggestLever` | classify full histories, then filter ledger rows, rank waste, price loss, or return healthy/no-activity summary | `BiggestLever` |

### server/routes/scorecard.ts

**Boundary:** HTTP (localhost).

| Method | Path | Purpose | Errors / Returns |
|---|---|---|---|
| GET | `/api/sessions/:id/scorecard` | core-derived view + current config-derived fleet grade state + priced events + `evaluatedAt` | 404 unknown session; 200 discriminated `graded` / `too-short` / `no-main-thread-calls` / `no-scoreable-creation` state. Events are an explicit **`WasteEventView[]`**: each core `WasteEvent` plus `kind`, `costEstimate` (or `null`), and `costBasis` (`"estimated"`/`"computed"`, never `"observed"`) — the client renders these directly, no cause/pricing logic |
| GET | `/api/dashboard/biggest-lever?from&to&<globalFilters>` | largest in-range event or healthy/no-cache-activity summary | 200 discriminated `event` / `healthy` / `no-cache-activity` variant; 400 on malformed or reversed range |

**Auth requirements:** none — localhost single-user app, consistent with every existing `/api/*` route.

### Store additions (dumb per-session cache — no range analytics)

| Op | Signature | Purpose |
|---|---|---|
| `getScorecardCore` | `(sessionId) => CacheScorecardCore \| undefined` | lazy-recompute the session, return its cached core snapshot |
| `listScorecardCores` | `() => Array<CacheScorecardCore & { sessionMeta }>` | iterate all sessions' cores (lazy per dirty session) so the fleet projector can filter/calibrate/select — Store performs **no** range or calibration logic itself |
| `getPricing` / `getPricer` | `() => PricingTable \| undefined` / `() => Pricer \| undefined` | expose the Store's **current** pricing (kept live by `updatePricing`) so the scorecard route prices with post-edit rates, not a startup closure (#2). Read-only accessors; no recompute |

## Module Boundaries

| Module | Responsibility | Allowed Dependencies |
|---|---|---|
| `server/scorecard/engine.ts` | per-session write ledger + aggregates + score inputs (deterministic, no pricing/fleet/config/clock) | `server/cache/classifier.ts`, canonical turn helper, `shared/*` |
| `server/scorecard/fleet.ts` | band calibration, letter mapping, dollar pricing, range+filter Biggest-Lever selection | `server/metrics/measures.ts` (pricing), `shared/*`, thresholds |
| `server/store/store.ts` | cache the config/pricing-independent **core** on `SessionState`; expose core snapshots only — **no** range/calibration logic | scorecard engine; must not import routes/client/fleet |
| `server/routes/scorecard.ts` | HTTP: read store cores + **live pricing** (`store.getPricing()`), call `fleet.ts`, stamp as-of | store, `scorecard/fleet.ts`, `shared/*` |
| `client/src/pages/**` | render; no cause/score logic | `client/src/api/scorecard.ts`, `shared/scorecard-contract.ts` |

Rules: (1) the HTTP layer reads the store's cached core and never re-runs `computeScorecard`; (2) fleet/pricing/calibration live only in `fleet.ts`, never in the engine or the store; (3) cause/attribution logic exists in exactly one place (`classifier.ts`).

## Change Footprint

### New files / modules

| Path | Purpose | Pattern reference |
|---|---|---|
| `shared/scorecard-contract.ts` | core/view types, `ScorecardThresholds`, discriminated grade/dashboard states, and canonical event fields | `shared/gates-contract.ts` |
| `server/scorecard/engine.ts` | `computeScorecard` — pure, main-stream only, threshold-independent decomposition + K2 events; no pricing | `server/gates/engine.ts` + `k2.ts` |
| `server/scorecard/fleet.ts` | fleet calibration, letter mapping, dollar pricing, range+filter Biggest-Lever selection (R5/R7/R8/R10) | `server/store/fleet-baselines.ts` |
| `server/scorecard/thresholds.ts` | defaults and defensive resolver for scorecard-only thresholds | `server/gates/thresholds.ts` |
| `server/routes/scorecard.ts` | the two endpoints | `server/routes/gates.ts` |
| `client/src/api/scorecard.ts` | query fns + keys | `client/src/api/gates.ts` |
| `client/src/pages/session-detail/Scorecard.tsx` (+ `.stories.tsx`, `.test.tsx`) | R6 section | `session-detail/ReportCard.tsx` |
| `client/src/pages/dashboard/BiggestLeverCard.tsx` (+ `.stories.tsx`, `.test.tsx`) | R7/R8 card | `dashboard/LeverageRatio.tsx`, `FailedWorkStat.tsx` |
| `test/fixtures/<synthetic scorecard sessions>` | **Minimum** JSONL for the single-session R1–R6 patterns that ingest/Cypress must actually load (bust, idle-only, below-floor, no-pricing). The **≥20-session calibration fleet (R5) is NOT a shared fixture** — it is built with typed `ApiCall`/`Turn`/core factories inside `fleet.test.ts` (in-memory, never on disk), because `scripts/e2e.ts:369` deep-copies the whole `test/fixtures/` tree into the packaged E2E dataset and `discovery.test.ts:79` hard-asserts `toHaveLength(12)`. Any JSONL that does enter the tree updates those fleet/discovery expectations deliberately | existing hand-authored fixtures; typed factories for the fleet |
| `server/scorecard/engine.test.ts`, `fleet.test.ts`, `server/routes/scorecard.test.ts`, `client/src/api/scorecard.test.ts` | engine/fleet unit coverage, `app.inject` routes, and client response guards | corresponding gates/cache-lab tests |

### Modified files / modules

| Path | What changes here |
|---|---|
| `server/store/store.ts` | add `scorecardCore` to `SessionState`; call `computeScorecard` in `recompute()`; add `getScorecardCore` / `listScorecardCores` (snapshots only — no range/calibration logic); add read-only `getPricing` / `getPricer` accessors exposing the live pricing already held for `updatePricing` (#2) |
| `shared/settings-contract.ts` + `server/routes/config.ts` | add and validate optional `scorecardThresholds`; bands are ordered integer percentages in `[0,100]` |
| `server/app.ts` | register `registerScorecardRoutes` |
| `client/src/pages/session-detail/SessionDetailView.tsx` | mount `Scorecard` section |
| `client/src/pages/dashboard/Dashboard.tsx` | mount `BiggestLeverCard` |
| `client/src/api/queryKeys.ts` | add session scorecard and fleet Biggest Lever keys under a scorecard prefix |
| `client/src/ws.ts` | invalidate the session scorecard and fleet Biggest Lever prefix on every relevant `session-updated` message |
| `client/src/pages/settings/ThresholdsPanel.tsx` | expose scorecard thresholds alongside gate thresholds; saving invalidates scorecard queries |
| `client/src/pages/settings/PricingEditor.tsx` | on save (`:71`), also invalidate the scorecard query prefixes — today it invalidates only `qk.prefixes.config`, so scorecard dollar projections would otherwise stay stale after a rate edit (#2) |
| `server/session-detail/projector.ts` | minimally replace CacheStrip's local cause heuristic with `classifyCacheWrite(...).baseCause` while preserving its existing base-cause-only wire shape; attribution remains exclusive to scorecard/Cache Lab |
| `specs/gates.md` | record scorecard algorithm, thresholds, evidence contract (in-scope deliverable, domain owner) |
| `specs/claude-lens-pages.md` | add the authoritative Session Detail scorecard section and Dashboard Biggest Lever card semantics |
| `test/fixtures/README.md` | document the new synthetic scorecard fixture chronology and intentional edge cases |
| `server/store/store.test.ts`, `server/session-detail/projector.test.ts`, `shared/settings-contract.test.ts`, `server/routes/config.test.ts` | regression coverage for cached cores, shared causes, and config validation/defaults |
| `client/src/api/queryKeys.test.ts`, `client/src/ws.test.ts`, `client/src/pages/settings/ThresholdsPanel.stories.tsx` | query scoping/invalidation and Settings states |
| `cypress/e2e/session-detail.cy.ts`, `cypress/e2e/dashboard.cy.ts` | packaged deep links, range selection, positive state, and live append → WS → refetch journey |

### Deleted / replaced

| Path | Reason |
|---|---|
| _None_ | Additive feature; existing cache, gate, and page surfaces remain supported |

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|---|---|
| `server/routes/gates.ts` + `session-detail/ReportCard.tsx` | shares the "letter grade on Session Detail" visual space; scorecard grade ≠ gate grade must be legible |
| `server/ingest/benchmark.ts` (`bench:ingest`) | classifier now runs on the recompute path; N2 guard |
| `server/cache/fixture-regression.test.ts` | pins classifier output; confirms scorecard reuse doesn't perturb it |
| `server/ingest/discovery.test.ts` (`toHaveLength(12)`, `:79`) + `scripts/e2e.ts` (`:369` tree copy) | any new JSONL under `test/fixtures/` changes the discovery count and the packaged E2E dataset; the ≥20 calibration fleet stays in-memory in `fleet.test.ts` to avoid touching either — if a fixture is added anyway, these expectations are updated deliberately, not incidentally |

## Areas of Impact

| Area | Impact | Risk | Why |
|---|---|---|---|
| Store recompute hot path | scorecard compute joins per-session lazy recompute | **M** | must stay **O(n log n)** in a session's own call count (the `partitionCacheStreams` sort, `classifier.ts:45`, dominates the linear decomposition walk) and lazy or N2 regresses (bench guard) |
| Fleet band calibration | new <20→≥20 transition logic | **M** | subtlest logic (R5: healthy long session must earn A; not all-F); pure + fixture-tested |
| Session Detail page | second letter grade appears | **L/M** | UX legibility vs the gate Report Card, not correctness |
| Dashboard | new fleet card wired to global range | **L** | reuses existing URL filter state + card kit |
| Threshold config | six scorecard-only values (floor, calibration minimum, A/B/C/D cutoffs) | **L/M** | validator must enforce safe integers, `[0,100]` bands, and `A > B > C > D`; hand-edited invalid values fall back to defaults |
| `specs/gates.md` | new algorithm section | **L** | doc-owner requirement, no runtime effect |

**Contract changes:** `AppConfig` gains optional `scorecardThresholds`; new `shared/scorecard-contract.ts` types are additive. Existing gate contracts and API response shapes do not change.

**Cross-cutting ripples:** telemetry/logging follows existing route logging (`app.log.error` on failure). No migration (in-memory only). No feature flag. Build/deploy unchanged (additive files under existing tsconfig projects). No auth surface.

## Cross-Cutting Concerns

- **Errors:** engine never throws (mirrors classifier/gates no-throw contract) — malformed/unparseable lines already skip upstream; missing evidence becomes canonical `unknown`. Routes return 404 for an unknown session, 400 for malformed/reversed ranges, and log unexpected failures. Biggest Lever returns a 200 discriminated variant for event, healthy, or no cache activity.
- **Logging & metrics:** reuse route-level error logging; no new metric emitters. `bench:ingest` covers the perf regression signal (N2).
- **Auth / authz:** none — localhost single-user, consistent with all `/api/*`.
- **Performance:** `computeScorecard` is **O(n log n)** in a session's own call count `n` — the linear high-water decomposition walk plus the one `partitionCacheStreams` sort (`classifier.ts:45`) — run only on lazy recompute of a dirty session. The core stores one compact write ledger rather than duplicate ledger/event arrays. **Fleet selection is a serving-layer scan of every session's cached ledger rows on each dashboard refetch** — bounded by total waste-writes across the fleet (a small fraction of all calls), not re-derived from raw calls; only dirty sessions recompute their core. The 10M-call scenario rests on this: lazy per-dirty-session recompute + a compact cached-ledger scan, **not** an O(total-calls) pass. If the fleet ledger scan ever dominates, the route-level mitigation is to memoize the selection per (range, filters, fleet revision); out of scope until `bench:ingest` shows it. Budget: no material `bench:ingest` regression (N2).
- **Configuration:** HTTP validation rejects malformed thresholds with 400; the resolver falls back field-by-field for hand-edited config. Threshold/pricing saves invalidate both scorecard query shapes without requiring core recomputation.
- **Security:** transcript-only; no secrets; fixtures synthetic, never copied from real `~/.claude` data (N1 + testing convention).
- **Migrations / rollout:** additive — new routes/sections, new optional threshold fields with defaults; fully backward-compatible; no persisted-state migration (store is in-memory).

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies REQs |
|---|---|---|---|---|
| A1 | Reuse K2 `classifyCacheWrite(..., { threshold: 0 })` + `attributeCacheMiss` as the sole cause source for every rewritten event; configured K2 threshold remains alert-only | spike-only events; projector classifier; prototype thresholds | one cause definition and a complete R1/R6 event list | R1, R2, R3, R6 |
| A2 | Threshold-independent high-water decomposition walks every main-thread call and stores one positive-write ledger. Positive-write epoch resets use the shared classifier's own first-call/model-switch/compaction verdict; zero-create model switches reset separately | walk writes only; re-derive compaction/reset logic; tie accounting to 10k | read-only calls can establish a larger prefix, and using one verdict preserves the invariant that waste events always have `baseCause = unexplained` | R1, R2 |
| A3 | Cache the config/pricing-**independent core** on `SessionState` in the lazy `recompute()`; Store exposes core snapshots only | on-request per route; cache letter/dollars too; range analytics in Store | fleet card needs all cores without a per-line/full recompute; pricing/config changes must not force recompute; Store stays a dumb cache | R7, R9, N2, N3 |
| A4 | Hygiene score `1 − confirmedFixableWaste / scoreableCreation`; ttl-lapse **and** unknown excluded from both terms; letter applied by fleet projector | grade all rewritten; blended 0–100; bake letter into cache | idle-only session scores 1.0; never grades unknown as fixable; keeps engine deterministic | R3, R5, N3 |
| A5 | Fixed bands A≥95/B≥85/C≥70/D≥50 below 20 gradeable sessions; at/above 20 use nearest-rank p80/p60/p40/p20, equal scores share a grade, and percentile calibration may lift the fixed result by at most one letter but never lower it; floor 10 calls | pure percentile; unbounded uplift; always-fixed; grade everything | predictable day one, bounded personal calibration, no all-F identical fleet, and no objectively poor A | R4, R5 |
| A6 | Idle-expiry (`ttl-lapse`) + unattributed (`unknown`) shown, grade-neutral | penalize TTL expiries (prototype); grade unknown | walking away isn't a prompting behavior; unknown behavior isn't provably fixable (decision #8) | R3 |
| A7 | Dollar consequence = **incremental loss** `rewrittenTokens × max(rate.cacheCreate − rate.cacheRead, 0) / 1_000_000`; `null` when the model is unpriced | full creation cost; substitute $0; reuse `priceUsage` | correct per-million units and tier-honest absence | R10, N1 |
| A8 | Two endpoints in new `routes/scorecard.ts`; both read store cores + call `fleet.ts` | fold into existing routes | parallels `routes/gates.ts`; single cause definition upheld | R6, R7 |
| A9 | Event timestamp (not session start) decides range membership; card also respects global project/model/branch/host filters, ranks by `tokensRewritten` | session-based bucketing; range-only | avoids boundary double-counting; consistent with the dashboard's global filter bar | R7 |
| A10 | Every event carries **both** `baseCause` + `attribution` verbatim from the classifier | single collapsed `cause` field | makes R2 agreement literal field-equality; future-proof | R2 |
| A11 | Before prefix-bust attribution, classify a rewritten entry as `duplicated-warmup` when it shares `promptId` and model with an earlier epoch warmup, has zero cache read, and rewrites that established warmup; otherwise retain canonical prefix/TTL/unknown attribution | reserve the kind with no detector; omit from REQ | deterministic minimum detector for the required counted-if-seen behavior | R1, R3 |
| A12 | Empty-waste period shows first-write share `(warmup + incremental) / totalCreation`; a period with zero creation returns a distinct no-cache-activity state with `null` share | hide card; fabricate 100%; next-best insight | distinguishes healthy, inactive, loading, and broken states | R8 |
| A13 | Record algorithm/thresholds/evidence in `specs/gates.md` | keep in ARCH only | gates.md is the Report-Card scoring domain owner | in-scope |
| A14 | Scorecard prices from **live Store pricing** (`getPricing()`), not the startup route closure; waste cost basis is always `"estimated"`/`"computed"`; `PricingEditor` invalidates scorecard prefixes on save | bind startup `metadata.pricing`; per-request config read like gates; inherit session cost basis | the closure goes stale after a rate edit and the Store's pricer is already kept live; a projected waste dollar is never an observed cost | R10, N1 |
| A15 | Engine drops `call.isSidechain === true` explicitly, not just via the `MAIN_STREAM_KEY` bucket | trust `partitionCacheStreams` bucketing alone | a sidechain call missing `agentId` falls into the `main` bucket (`classifier.ts:29-35`) and transcript JSONL is untrusted | R1 (main-thread only) |
| A16 | ≥20-session calibration fleet lives in-memory via typed factories in `fleet.test.ts`; only minimal single-session JSONL enters `test/fixtures/` | author the whole fleet as shared JSONL fixtures | `scripts/e2e.ts:369` copies the fixture tree into the packaged E2E dataset and `discovery.test.ts:79` pins `toHaveLength(12)` | R5, N2 |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|---|---|
| Session with zero main-thread calls (278/375 of real files) | serving projector returns `no-main-thread-calls`; invisible to Biggest Lever; renders N/A, never F/error |
| Below-floor session (< 10 calls) still holding one big bust | metrics + events shown; grade replaced by `too-short`; the event still surfaces to the fleet card |
| Fleet all-similar sessions at ≥ 20 | band resolver must not grade all F — calibration keeps a healthy long session at A/B (R5 test) |
| Largest in-range event is `unexplained` | card shows it labeled "unexplained" with full consequence + deep link (decision #8) |
| Model with no pricing in the top event | fleet projector returns `costEstimate: null` plus unavailable cost basis; rewritten tokens always show; never reuse a helper that maps unpriced to zero |
| Gradeable session whose only rewrites are TTL/unknown | warmup/incremental remain the scoreable denominator, so the session grades exactly like its no-rewrite counterpart; events remain visible |
| Main-thread session with no scoreable creation | core score is `null`; serving projector returns `no-scoreable-creation`; metrics remain visible, never F/0 |
| Live session appended mid-view introducing a bust | dirty → lazy recompute → WS `session-updated` → client refetch by prefix; scorecard updates without reload (R9) |
| 10K → 10M calls fleet growth | per-session compute stays O(n log n) in that session's calls + lazy; only dirty sessions recompute; fleet card scans every session's compact cached ledger rows per refetch, bounded by total waste-writes, not raw calls (N2) |
| Two rapid appends to the same session | existing 300ms debounce coalesces; recompute reflects last fully-derived state (store contract) |

### Backward — regression risk per touched area

| Touched area | What could regress | How we'd know / mitigation |
|---|---|---|
| `store.ts` `recompute()` | added compute slows recompute / bloats `SessionState` | `bench:ingest` (N2); scorecard is a compact struct; compute is O(n log n) in the session's own calls |
| `session-detail/projector.ts` classifier replacement | CacheStrip base-cause labels shift because K2's read-delta compaction evidence differs from the old explicit-marker heuristic | the display shift is intentional; preserve the existing base-cause-only contract and spike flag, source only `baseCause` from the shared classifier, and pin affected fixtures with same-call R2 regression tests |
| Settings/config validation | malformed bands or new optional fields break round-tripping | scorecard-specific validator + defensive resolver; existing gate thresholds remain untouched |
| `fixture-regression.test.ts` | scorecard reuse perturbs pinned classifier output | it doesn't call the classifier differently; regression test stays green as the guard |
| ReportCard visual space | two grades confuse | Storybook variants + component test for legibility |

## Open Questions

None. REQ questions are resolved by A5 (fixed defaults plus a one-letter percentile uplift cap) and A9 (rank by rewritten tokens). Biggest Lever ties resolve by tokens descending, timestamp descending, then session ID and stable call ID; engine arrays sort by timestamp then stable message/call identity. Percentiles use nearest rank. These rules keep N3 output deterministic.

## Out of Scope

- Repeat-offender / weekly-trend / fixable-vs-weather cards (reason: next REQ — decision #2).
- Parser capture of context events (permission grants, skill loads) and "what happened before this bust" annotations (reason: separate REQ; touches ingest hot path).
- Fleet-level scorecard measures in the metrics engine / Trends (reason: trend-card REQ).
- Premium (`*.cost.jsonl`) enrichment of scorecard values (reason: 🟢-only slice — decision #9).
- Recommendations / remediation advice, notifications, streaks, gamification (reason: unvalidated; alert-fatigue risk).
- A `duplicated-warmup` *penalty UX* or tuning beyond the minimal deterministic detector + grade participation (reason: zero occurrences in 97 real sessions; the detector exists so "counted if seen" holds — A11 — but earns no dedicated surface this slice).

---

# Tasks

> Generated 2026-07-28 from the corrected architecture above. 10 tasks. Server core (T1–T5) → shared-cause swap (T6) → client (T7–T10). Docs (`gates.md`, `pages.md`, fixtures `README`) fold into the tasks that own the algorithm/UI they describe.

## Task T1: Scorecard contract + thresholds + config validation

> **Status:** done
> **Verification:** tdd
> **Effort:** m
> **Priority:** critical
> **Depends on:** None
> **Satisfies REQs:** R4, R5, R10 (contract shapes for tier-honest cost)
> **Footprint slice:** New: `shared/scorecard-contract.ts` (types only), `server/scorecard/thresholds.ts`. Modified: `shared/settings-contract.ts` (add `scorecardThresholds` field + `isValidScorecardThresholds`), `server/routes/config.ts` (wire validator into `parseConfigPatch`).
> **High-risk areas touched:** Threshold config (L/M — validator must enforce safe integers, `[0,100]` bands, `A > B > C > D`).

### Description

The foundation every other task imports: the wire contract (`CacheScorecardCore`, `CacheCreationEntry`, `WasteEvent`, the priced `WasteEventView`, `BiggestLever` with a presentation-ready `kind` + `costBasis`, the discriminated grade/dashboard states, and `ScorecardThresholds`), plus the threshold defaults/defensive resolver and the HTTP validator. No runtime logic beyond thresholds — the contract file is pure types, covered by `typecheck` and downstream use.

### Test Plan

#### Test File(s)
- `server/scorecard/thresholds.test.ts` (new)
- `shared/settings-contract.test.ts` (add cases)
- `server/routes/config.test.ts` (add cases)

#### Test Scenarios

##### getScorecardThresholds resolver

- **returns documented defaults** — GIVEN a config with no `scorecardThresholds` WHEN resolved THEN `floorCalls=10, calibrationMinSessions=20, A=95, B=85, C=70, D=50` _(verifies R4, R5)_
- **overrides field-by-field** — GIVEN `{ floorCalls: 15 }` WHEN resolved THEN only `floorCalls` changes; all other fields keep defaults _(verifies R4)_

##### isValidScorecardThresholds validator

- **accepts valid, empty, and partial** — GIVEN a complete valid set / `{}` (reset) / a partial subset of valid fields WHEN validated THEN `true` for each _(verifies R4/R5 config surface)_

##### PUT /api/config wiring

- **persists and echoes a valid scorecard patch** — GIVEN a PUT body with `budget` + valid `scorecardThresholds` WHEN sent THEN 200 and the response round-trips the saved thresholds _(verifies R4/R5)_

##### Config edge cases

- **resolver falls back defensively per field** — GIVEN a hand-edited count that is negative / non-integer / `NaN` / `Infinity`, or a band outside `[0,100]` / non-integer WHEN resolved THEN that field falls back to its default (mirrors `clampThreshold`) _(REQ edge case: hand-edited config)_
- **resolver falls back to the full default band set on unrecoverable order** — GIVEN clamped bands that still violate `A > B > C > D` WHEN resolved THEN all four bands revert to `95/85/70/50` _(design decision: resolver recovery)_
- **validator rejects malformed input** (parametrized) — GIVEN an unknown field (`flrCalls`), non-integer band (`70.5`), out-of-range band (`150`, `-1`), non-safe-integer count (`2**60`), or `null`/array/non-object WHEN validated THEN `false` for each _(REQ edge case)_
- **validator enforces pairwise order among present bands** — GIVEN only `{ A: 80, B: 90 }` (both present, out of order) WHEN validated THEN `false`; GIVEN only `{ A: 95, C: 70 }` (present pair in order) THEN `true` _(design decision: pairwise ordering)_

##### Regression Guard

- **existing config fields untouched** — GIVEN a PUT with `budget` + `gateThresholds` and no `scorecardThresholds` WHEN sent THEN 200 and it round-trips exactly as before _(guards backward-regression risk for `shared/settings-contract.ts`, `server/routes/config.ts`)_
- **gate validation not loosened** — GIVEN a PUT with a malformed `gateThresholds` WHEN sent THEN still 400 _(guards backward-regression risk for `server/routes/config.ts`)_

### Implementation Notes

- **Module(s):** `shared/scorecard-contract.ts`, `server/scorecard/thresholds.ts` (Module Boundaries).
- **Pattern reference:** `shared/gates-contract.ts` (contract + `exhaustiveArray` for the `kind` literal set), `server/gates/thresholds.ts` (`clampThreshold` + defensive resolver + the runtime equality guard), `shared/settings-contract.ts` `isValidGateThresholds` (strict unknown-field rejection, `Number.isSafeInteger`), `server/routes/config.ts` `parseConfigPatch` (`"key" in b` per-field shape).
- **Key decisions:** ScorecardThresholds data-model (defaults + constraints); resolver falls back to full default band set on unrecoverable order and validator checks order pairwise among present bands (agreed design forks). `hitRatio` is `number` not `number | null` (data-model correction) — the type must not admit `null`.
- **High-risk callouts:** the validator is the only thing standing between a hand-edited config and the fleet projector — mirror `isValidGateThresholds` strictness exactly (reject unknown keys, reject non-safe-integers) and add the band-range + pairwise-order checks the gate validator doesn't have.

### Scope Boundaries

- Do NOT add grade state, letter, or dollars to the contract's core type — those are serving-layer only (Data Models: "Never stores gradeability… a letter grade, or dollars").
- Do NOT add premium/observed cost fields — 🟢-only slice (Out of Scope).
- Only implement types + thresholds + validation here; the engine that fills the core is T2.

### Files Expected

**New files:**
- `shared/scorecard-contract.ts` (pattern: `shared/gates-contract.ts`)
- `server/scorecard/thresholds.ts` (pattern: `server/gates/thresholds.ts`)
- `server/scorecard/thresholds.test.ts`

**Modified files:**
- `shared/settings-contract.ts` (add optional `scorecardThresholds` + `isValidScorecardThresholds`)
- `server/routes/config.ts` (validate `scorecardThresholds` in `parseConfigPatch`)
- `shared/settings-contract.test.ts`, `server/routes/config.test.ts` (add cases)

**Must NOT modify:**
- `server/gates/thresholds.ts` / `shared/gates-contract.ts` (gate config stays domain-specific — Tech Choices "Thresholds home")

---

## Task T2: Scorecard engine core (decomposition + K2 events + score)

> **Status:** done
> **Verification:** tdd
> **Effort:** l
> **Priority:** critical
> **Depends on:** T1
> **Satisfies REQs:** R1, R2, R3, R6 (event source), N3
> **Footprint slice:** New: `server/scorecard/engine.ts` (`computeScorecard`), minimal single-session JSONL under `test/fixtures/`, `test/fixtures/README.md` update. Reuses `server/cache/classifier.ts` + `partitionCacheStreams`/`MAIN_STREAM_KEY` unchanged. Folds the `specs/gates.md` scorecard algorithm section.
> **High-risk areas touched:** Store recompute hot path (M — engine must stay O(n log n) + lazy; the compute this task writes is what T3 runs).

### Description

The deterministic heart: one pass builds a chronological write ledger via an epoch high-water mark (warmup / incremental / rewritten), then every `rewritten > 0` entry becomes a waste event classified by the shared K2 primitive at threshold zero, carrying canonical `baseCause` + `attribution` and a presentation-ready `kind`. The engine stores that `kind` once on the ledger entry (`null` for non-waste writes), so later projectors do not rerun duplicated-warmup detection or cache a second event array. Produces the config/pricing/clock-independent `CacheScorecardCore` with auditable score inputs. No fleet, no pricing, no `Date.now()`.

### Test Plan

#### Test File(s)
- `server/scorecard/engine.test.ts` (new)

#### Test Scenarios

##### Decomposition & ledger (R1 "matches hand-calculated values exactly")

- **decomposition matches hand-calc** — GIVEN a synthetic session (warmup → incremental growth → one prefix bust) WHEN `computeScorecard` runs THEN `{warmup, incremental, rewritten}` and `totalCreation` equal hand-computed values AND `warmup + incremental + rewritten = totalCreation` _(verifies R1)_
- **read-only call raises the high-water mark** — GIVEN a read-only call (`create=0`, large read) after warmup WHEN computed THEN `established` reflects `footprint = read + create`, so a later create scores as `incremental`, not `rewritten` _(verifies R1 / A2)_
- **one ledger entry per positive write; events derive from it** — GIVEN the bust fixture WHEN computed THEN `writes` has one entry per positive write, every non-waste write has `kind: null`, and each `rewritten > 0` entry carries its final non-null `kind` and surfaces as a waste event with the correct `tokensRewritten` slice _(verifies R1)_
- **hitRatio is 0 (not null) on a zero denominator** — GIVEN a session with no cache-eligible tokens WHEN computed THEN `hitRatio === 0`, matching `derive-session.ts:122`; `wasteRatio`/`hygieneScore` are `null` when their denominators are 0 _(verifies R1 / data-model correction)_

##### Cause classification (R2)

- **events carry canonical baseCause + attribution verbatim** — GIVEN a rewritten entry WHEN computed THEN it carries `baseCause` (always `"unexplained"`, the A2 invariant) and `attribution` from `classifyCacheWrite(…, {threshold:0})` + `attributeCacheMiss` _(verifies R2, A10)_
- **`threshold:0` doesn't perturb the classifier verdict** — GIVEN a `>10k` write WHEN classified at threshold 0 vs the default THEN identical `baseCause`; only gating differs _(verifies R2 agreement — classifier reuse)_

##### Hygiene score (R3)

- **grades fixable only** — GIVEN a session whose only waste is `ttl-lapse`/`unknown` WHEN computed THEN `hygieneScore` equals its no-waste counterpart (idle-only ⇒ `1.0`); adding one prefix-bust lowers it _(verifies R3)_
- **score inputs are auditable** — THEN `scoreableCreation = warmup + incremental + confirmedFixableWaste` AND `hygieneScore = 1 − confirmedFixableWaste / scoreableCreation` _(verifies R3 / A4)_
- **duplicated-warmup detector** — GIVEN a rewritten entry sharing `promptId` + `model` with an earlier-epoch warmup, zero cache read, rewriting that warmup WHEN computed THEN `kind = "duplicated-warmup"`, counted in `confirmedFixableWaste` _(verifies R1/R3, A11)_

##### Turn join (R6 source)

- **turn join + missing-turn anchor** — THEN entries carry one-based `turnNumber`; a call with no resolvable turn keeps the entry with `turnNumber: null` (never dropped) _(verifies R6)_

##### Edge cases

- **explained resets are warmup, not waste** — GIVEN first-call / model-switch / compaction creation WHEN computed THEN warmup + new epoch, never a waste event _(REQ edge case)_
- **zero-create model switch resets the epoch separately** — resets `established` without emitting warmup tokens _(ARCH A2)_
- **no scoreable creation → null score** — GIVEN `scoreableCreation = 0` THEN `hygieneScore = null` (→ ungraded); metrics remain present _(REQ edge case)_

##### Main-thread-only enforcement (A15)

- **explicit `!isSidechain` filter — sidechain without agentId** — GIVEN a sidechain call with `isSidechain: true` and **no `agentId`** (which `partitionCacheStreams` would bucket into `main`) WHEN computed THEN it is excluded from decomposition and events _(verifies R1 main-thread-only; guards the `classifier.ts:29-35` bucketing gap)_

##### Resilience

- **deterministic** — GIVEN one fixture WHEN `computeScorecard` runs twice THEN deep-equal output _(verifies N3)_
- **never throws** — GIVEN empty session / single call / all-read session THEN a valid core, no throw _(mirrors classifier/gates no-throw contract)_

### Implementation Notes

- **Module(s):** `server/scorecard/engine.ts` (allowed deps: `classifier.ts`, canonical turn helper, `shared/*`).
- **Pattern reference:** `server/gates/engine.ts` (deterministic, no-clock, no-config), `server/gates/k2.ts` (walks `partitionCacheStreams` output), `server/cache/classifier.ts` (`classifyCacheWrite`/`attributeCacheMiss` signatures).
- **Key decisions:** A2 (high-water decomposition, classifier-verdict epoch resets), A11 (dup-warmup detector), A4 (score formula), A10 (both cause fields verbatim), A15 (explicit `!isSidechain`). Store the detector's final `WasteEventKind` on each ledger entry (`null` for non-waste writes) so serving projectors only filter/map the ledger and never re-detect kind. Ties/order per Open Questions: sort by timestamp then stable message/call identity.
- **Fixtures:** author only the **minimal** single-session JSONL that ingest/engine tests need on disk; if any file lands in `test/fixtures/`, update `server/ingest/discovery.test.ts:79` (`toHaveLength`) and document the chronology in `test/fixtures/README.md` deliberately (A16). Prefer typed in-memory `ApiCall`/`Turn` construction inside `engine.test.ts` where ingest isn't exercised.
- **High-risk callouts:** this is the code T3 runs on the recompute hot path — keep it a single linear walk plus the one existing `partitionCacheStreams` sort (O(n log n)); no nested scans, no second sort.

### Scope Boundaries

- Do NOT price, grade, calibrate, or read fleet state — all serving-layer (T4).
- Do NOT add a calibration fleet to `test/fixtures/` — that lives in `fleet.test.ts` (A16).
- Do NOT re-derive compaction/reset logic — reuse the classifier verdict (A2).

### Files Expected

**New files:**
- `server/scorecard/engine.ts` (pattern: `server/gates/engine.ts` + `k2.ts`)
- `server/scorecard/engine.test.ts`
- Minimal `test/fixtures/<synthetic scorecard session>` JSONL (only if a test needs on-disk ingest)

**Modified files:**
- `test/fixtures/README.md` (chronology + intentional edges, if fixtures added)
- `server/ingest/discovery.test.ts` (count update, only if fixtures added — deliberate)
- `specs/gates.md` (scorecard algorithm + evidence contract — domain owner, A13)

**Must NOT modify:**
- `server/cache/classifier.ts` (shared primitive — reused unchanged; cause logic lives here only)
- `server/cache/fixture-regression.test.ts` (pins classifier output — stays green as the guard)

### TDD Sequence (optional)

Build the decomposition ledger + aggregates first (hand-calc fixture), then layer events (classifier reuse), then the dup-warmup detector, then score inputs — each stage asserts before the next builds on it.

---

## Task T3: Store core caching (recompute + accessors)

> **Status:** done
> **Verification:** test-after
> **Effort:** s
> **Priority:** critical
> **Depends on:** T2
> **Satisfies REQs:** R7, R9, N2
> **Footprint slice:** Modified: `server/store/store.ts` — add `scorecardCore` to `SessionState`, call `computeScorecard` in `recompute()`, add `getScorecardCore` / `listScorecardCores`, add read-only `getPricing` / `getPricer`.
> **High-risk areas touched:** Store recompute hot path (M — must stay lazy + O(n log n) or N2 regresses).

### Description

Wire the engine into the Store's existing lazy per-session `recompute()` so cores stay current on live sessions without a full-fleet recompute, and expose read-only snapshot accessors for the fleet projector plus live-pricing getters (the Store is already the live pricing source via `updatePricing`).

### Test Plan

#### Test File(s)
- `server/store/store.test.ts` (add cases)

#### Test Scenarios

##### Cached core

- **caches core on recompute** — GIVEN a session with calls WHEN `getScorecardCore(id)` is read THEN it returns a core equal to `computeScorecard(state.calls, state.turns)` _(verifies R7/R9)_
- **lazy per dirty session** — GIVEN one dirty session among several clean ones WHEN reading its core THEN only that session recomputes; clean sessions are not re-derived _(verifies N2)_
- **listScorecardCores exposes cores + sessionMeta** — THEN every session's core is returned with `sessionMeta` (project/model/branch/host) for the fleet projector _(verifies R7)_
- **getPricing/getPricer return current pricing** — GIVEN `updatePricing({ pricing })` is called WHEN `getPricing()` is read THEN it returns the updated table (not a startup snapshot) _(verifies #2 / R10 liveness)_

##### Regression Guard

- **snapshots only — no grade/dollars in store output** — THEN the core the store returns contains no letter grade, gradeability, or dollar fields (those are serving-layer) _(guards Module Boundaries rule 1)_
- **existing derive path unchanged** — GIVEN a known session WHEN `getSessionSnapshot` / `listSessions` / `listTurns` are called THEN they return the same shape as before the `scorecardCore` field was added _(guards backward-regression risk for `server/store/store.ts` `recompute()`)_

### Implementation Notes

- **Module(s):** `server/store/store.ts` (may import the scorecard engine; must NOT import routes/client/fleet).
- **Pattern reference:** `store.ts` `recompute()` (lazy per-session derive, the `reconcilePremium`/`deriveSession` sequence at `:757-785`), `updatePricing` (`:206`, private `this.pricer`/`this.pricing` — expose read-only getters mirroring it).
- **Key decisions:** A3 (cache the config/pricing-independent core only; Store stays a dumb per-session cache — no range/calibration). #2 (add `getPricing`/`getPricer` rather than threading pricing through `app.ts`).
- **High-risk callouts:** N2 — call `computeScorecard` exactly once per `recompute()`, after `state.turns` is derived; do not add a cross-session loop. `bench:ingest` is the guard (run in T5).

### Scope Boundaries

- Do NOT add band calibration, grading, range filtering, or pricing math to the Store (A3 / Module Boundaries).
- Do NOT recompute all sessions eagerly on ingest (N2).

### Files Expected

**Modified files:**
- `server/store/store.ts` (add field + compute call + four accessors)
- `server/store/store.test.ts` (add cases)

**Must NOT modify:**
- `server/ingest/benchmark.ts` (N2 guard — read by `bench:ingest`, not edited)

---

## Task T4: Fleet projector (bands, grade, pricing, biggest-lever)

> **Status:** done
> **Verification:** tdd
> **Effort:** l
> **Priority:** critical
> **Depends on:** T1, T2
> **Satisfies REQs:** R5, R7, R8, R10
> **Footprint slice:** New: `server/scorecard/fleet.ts` (`resolveBands`, `applyGrade`, `selectBiggestLever`). Folds the `specs/gates.md` band-calibration algorithm.
> **High-risk areas touched:** Fleet band calibration (M — the subtlest logic; a healthy long session must earn A, an all-similar fleet must not grade all F).

### Description

The pure serving-layer projector consuming cached cores: fixed bands below the calibration minimum, nearest-rank percentile calibration above it (uplift capped at one letter, never lowers), discriminated grade states, and range+filter Biggest-Lever selection that prices the rewrite-vs-hit delta with a presentation-ready `kind` and an always-estimated cost basis.

### Test Plan

#### Test File(s)
- `server/scorecard/fleet.test.ts` (new — the ≥20-session calibration fleet is built here with typed factories, never on disk)

#### Test Scenarios

##### Band calibration (R5)

- **fixed bands below the floor** — GIVEN < 20 gradeable scores WHEN `resolveBands` runs THEN fixed `A/B/C/D` from thresholds _(verifies R5)_
- **nearest-rank percentiles at ≥ 20** — GIVEN ≥ 20 gradeable scores WHEN `resolveBands` runs THEN p80/p60/p40/p20 bands, equal scores share a grade _(verifies R5)_
- **percentile uplift capped at one letter, never lowers** — GIVEN a fixed-grade result WHEN calibration applies THEN the letter improves by at most one and never drops _(verifies A5)_
- **not-all-F on a similar fleet** — GIVEN ≥ 20 similar mediocre sessions plus one healthy long session WHEN graded THEN they are not all F AND the healthy session earns A/B _(verifies R5 — high-risk)_

##### Grade states (R4)

- **applyGrade discriminated states** — GIVEN cores below `floorCalls` / with no main-thread calls / with `hygieneScore = null` / gradeable WHEN `applyGrade` runs THEN `too-short` / `no-main-thread-calls` / `no-scoreable-creation` / `graded` respectively _(verifies R4, REQ edge cases)_

##### Biggest-Lever selection (R7)

- **event variant ranks by tokensRewritten within range + filters** — GIVEN multiple events WHEN `selectBiggestLever` runs with a range + project/model/branch/host filters THEN the max in-range event is chosen; ties resolve tokens↓ → timestamp↓ → sessionId → callId _(verifies R7, A9)_
- **event membership by event timestamp** — GIVEN a session spanning the range boundary WHEN selecting THEN an event belongs to the range containing its own timestamp _(verifies R7 boundary rule, A9)_
- **carries presentation-ready kind** — THEN the event payload includes `kind` (not reconstructable client-side) _(verifies #4 / Module Boundaries)_

##### Pricing (R10)

- **incremental loss + estimated basis** — GIVEN a priced model THEN `costEstimate = rewrittenTokens × max(cacheCreate − cacheRead, 0) / 1e6` AND `costBasis` is `"estimated"`/`"computed"` even when the session has observed capture _(verifies R10, A7, A14)_
- **null when unpriced, never $0** — GIVEN a model with no rate THEN `costEstimate = null` and tokens still show _(verifies R10)_

##### Empty/healthy states (R8)

- **healthy variant** — GIVEN a period with cache creation but zero waste events THEN first-write share `(warmup + incremental) / totalCreation` with real numerator/denominator _(verifies R8, A12)_
- **no-cache-activity variant** — GIVEN a period with zero creation THEN a distinct state with `null` share (never a fabricated 100%) _(verifies R8, A12)_

### Implementation Notes

- **Module(s):** `server/scorecard/fleet.ts` (allowed deps: `server/metrics/measures.ts` for pricing, `shared/*`, thresholds).
- **Pattern reference:** `server/store/fleet-baselines.ts` (fleet aggregation shape), `server/metrics/measures.ts` (pricing rate lookup).
- **Key decisions:** A5 (fixed-then-percentile, one-letter uplift cap), A7/A14 (incremental-loss pricing, always-estimated basis, live Store pricing passed in by the route), A9 (event-timestamp membership + global filters), A12 (healthy vs no-activity), A16 (calibration fleet via typed factories in this test file).
- **Libraries:** none new.
- **High-risk callouts:** the <20→≥20 transition is the subtlest logic — test both sides plus the not-all-F case with a factory-built fleet; nearest-rank percentile with shared grades for equal scores.

### Scope Boundaries

- Do NOT read the Store or the clock — the projector is pure; the route injects cores, pricing, range, filters (Module Boundaries rule 2).
- Do NOT persist or cache fleet output — recomputed per request (BiggestLever "not cached").
- Do NOT add a calibration JSONL fixture to `test/fixtures/` (A16).

### Files Expected

**New files:**
- `server/scorecard/fleet.ts` (pattern: `server/store/fleet-baselines.ts`)
- `server/scorecard/fleet.test.ts`

**Modified files:**
- `specs/gates.md` (band-calibration algorithm + thresholds — domain owner, A13)

**Must NOT modify:**
- `server/store/store.ts` (fleet/range/calibration must not leak into the Store — A3)

---

## Task T5: Scorecard HTTP routes + registration

> **Status:** not started
> **Verification:** tdd
> **Effort:** m
> **Priority:** critical
> **Depends on:** T3, T4
> **Satisfies REQs:** R6, R7, R8, N2, N3
> **Footprint slice:** New: `server/routes/scorecard.ts` (both endpoints). Modified: `server/app.ts` (register).
> **High-risk areas touched:** Store recompute hot path (M — N2 bench check runs here).

### Description

Two thin localhost routes reading cached cores + live Store pricing, resolving current scorecard thresholds from config, calling `fleet.ts`, and stamping `evaluatedAt` at the serving layer: `GET /api/sessions/:id/scorecard` returns the core-derived view + grade state + priced `WasteEventView[]`; `GET /api/dashboard/biggest-lever?from&to&<filters>` returns the discriminated event/healthy/no-cache-activity variant. Route registration accepts `configPath`; each request resolves `getScorecardThresholds(await readConfig(configPath))`, matching the live-config pattern in `routes/gates.ts`.

### Test Plan

#### Test File(s)
- `server/routes/scorecard.test.ts` (new — `app.inject`)

#### Test Scenarios

##### Session scorecard endpoint (R6)

- **graded state** — GIVEN a gradeable session WHEN GET `/api/sessions/:id/scorecard` THEN 200 `graded` with core + grade state + priced `WasteEventView[]` (each with `kind`, `costEstimate` or `null`, `costBasis`) + `evaluatedAt` _(verifies R6, #4)_
- **ungraded discriminated states** — GIVEN below-floor / no-main-thread / no-scoreable sessions THEN the respective `too-short` / `no-main-thread-calls` / `no-scoreable-creation` 200 variant, never F/0 _(verifies R4, edge cases)_
- **current floor changes the grade boundary** — GIVEN a session graded under the default floor WHEN config is saved with a higher `floorCalls` and the same route is requested again THEN it returns `too-short` without a restart; lowering the floor makes it graded again _(verifies R4 configurable-boundary acceptance criterion)_
- **404 unknown session** — GIVEN an unknown id THEN 404 _(verifies HTTP errors)_
- **prices with post-edit rates** — GIVEN pricing changed via the Store WHEN the route responds THEN dollars reflect the new rate (live `store.getPricing()`, not a startup closure) _(verifies #2 / R10)_

##### Dashboard biggest-lever endpoint (R7/R8)

- **event variant + range re-selection** — GIVEN multiple events WHEN GET with a range THEN the largest in-range event; changing the range changes the selection _(verifies R7)_
- **healthy + no-cache-activity variants** — GIVEN a zero-waste / zero-creation period THEN the respective 200 discriminated variant _(verifies R8)_
- **400 on malformed/reversed range** — GIVEN `from > to` or unparseable dates THEN 400 _(verifies HTTP errors)_

##### As-of stamping (N3)

- **evaluatedAt stamped at route, not engine** — THEN the deterministic core carries no timestamp; the route adds `evaluatedAt` _(verifies N3, gates precedent)_

##### Performance guard (N2)

- **checklist:** `npm run bench:ingest` shows no material regression vs. the pre-feature baseline — expected: within noise of the recorded benchmark log.

### Implementation Notes

- **Module(s):** `server/routes/scorecard.ts` (deps: store, `scorecard/fleet.ts`, `shared/*`).
- **Pattern reference:** `server/routes/gates.ts` (snapshot read → `readConfig(configPath)` → resolve thresholds → call engine → stamp `evaluatedAt` → typed error bodies), `server/routes/config.ts` `parseConfigPatch` (query/body validation returning a message).
- **Key decisions:** A8 (both endpoints in one route file), A9 (range/filters), A14 (read live Store pricing), R4 (resolve `getScorecardThresholds(await readConfig(configPath))` on every request), N3 (route stamps as-of). Add `configPath?: string` to the route registration options and thread the existing `BuildAppOptions.configPath` through `registerScorecardRoutes` in `app.ts`.
- **High-risk callouts:** N2 — routes read already-cached cores and never re-run `computeScorecard` (Module Boundaries rule 1); confirm with `bench:ingest`. This change touches the packaged runtime → run `npm run test:e2e` per CLAUDE.md.

### Scope Boundaries

- Do NOT run `computeScorecard` in the route (rule 1) or add cause/pricing/calibration logic (rule 2).
- Do NOT add auth (localhost single-user, consistent with all `/api/*`).

### Files Expected

**New files:**
- `server/routes/scorecard.ts` (pattern: `server/routes/gates.ts`)
- `server/routes/scorecard.test.ts`

**Modified files:**
- `server/app.ts` (register `registerScorecardRoutes` and pass `configPath`)

**Must NOT modify:**
- `server/ingest/benchmark.ts` (N2 guard)

---

## Task T6: CacheStrip shared-cause swap (R2 agreement)

> **Status:** not started
> **Verification:** tdd
> **Effort:** s
> **Priority:** high
> **Depends on:** T2
> **Satisfies REQs:** R2
> **Footprint slice:** Modified: `server/session-detail/projector.ts` — replace `classifyCacheCause`'s local heuristic with `classifyCacheWrite(...).baseCause` while preserving the base-cause-only wire shape + `isWriteSpike`.
> **High-risk areas touched:** `session-detail/projector.ts` classifier replacement (backward-regression — CacheStrip base-cause labels shift where K2's read-delta evidence differs from the old marker).

### Description

Make CacheStrip and the scorecard agree literally on cause (R2) by sourcing CacheStrip's `cause` from the single shared classifier with the same `{ threshold: 0 }` option instead of the local `seenCompaction`/`previousModel` heuristic — preserving the existing `SessionDetailCachePoint` shape (base-cause only, plus `isWriteSpike`); attribution stays exclusive to scorecard/Cache Lab.

### Test Plan

#### Test File(s)
- `server/session-detail/projector.test.ts` (add cases)

#### Test Scenarios

##### Shared cause

- **baseCause sourced from the shared classifier at threshold zero** — GIVEN a positive cache write in a stream, including one below the configured/default 10k K2 alert threshold, WHEN `buildCacheStrip` runs THEN its `cause` equals `classifyCacheWrite(stream, i, { threshold: 0 }).baseCause` for the same call _(verifies R2 literal agreement without coupling cause to alert gating)_

##### Regression Guard

- **wire shape preserved** — THEN `SessionDetailCachePoint` still carries base-cause-only `cause` + `isWriteSpike`; no `attribution` field leaks into CacheStrip _(guards backward-regression risk for `server/session-detail/projector.ts`)_
- **intentional compaction-label shift pinned** — GIVEN a fixture where the old `seenCompaction` marker and K2's read-delta ratio disagree WHEN classified THEN assert the **new** K2 label, with a same-call cross-check that scorecard and CacheStrip agree _(guards backward-regression risk for `server/session-detail/projector.ts`; the shift is intentional)_
- **first-call/model-switch unchanged** — GIVEN fixtures unaffected by the compaction-evidence change THEN those verdicts match old and new _(guards regression)_

### Implementation Notes

- **Module(s):** `server/session-detail/projector.ts` (`classifyCacheCause` at `:304`, `buildCacheStrip` at `:314`).
- **Pattern reference:** the existing `buildCacheStrip` loop; `server/cache/classifier.ts` `classifyCacheWrite` (needs the correctly partitioned ordered stream + index — reuse `partitionCacheStreams`, then call with `{ threshold: 0 }`, exactly as T2 does).
- **Key decisions:** Backward-regression row for `projector.ts` (preserve base-cause-only contract + spike flag, source only `baseCause` from the shared classifier at threshold zero, pin affected fixtures). A10 (cause fields canonical). T6 depends on T2 so its same-call regression test can compare CacheStrip output directly with the implemented scorecard engine.
- **High-risk callouts:** the compaction label legitimately changes (K2 read-delta vs the old explicit marker) — that is the intended R2 alignment, not a bug; pin it with a fixture so the shift is asserted, not silent.

### Scope Boundaries

- Do NOT surface `attribution` on CacheStrip (stays scorecard/Cache Lab only).
- Do NOT change `isWriteSpike` or the rest of the projector's wire shape.
- Do NOT use the classifier's default/K2 alert threshold for cause lookup; pass `{ threshold: 0 }` so sub-10k rewritten events agree with the scorecard.

### Files Expected

**Modified files:**
- `server/session-detail/projector.ts` (swap the cause source)
- `server/session-detail/projector.test.ts` (add R2 same-call + regression cases)

**Must NOT modify:**
- `server/cache/classifier.ts` (reused unchanged)

---

## Task T7: Client data layer (query fns, keys, invalidation)

> **Status:** not started
> **Verification:** tdd
> **Effort:** m
> **Priority:** high
> **Depends on:** T5
> **Satisfies REQs:** R9, R10 (client parses tier-honest fields), #2 (pricing invalidation)
> **Footprint slice:** New: `client/src/api/scorecard.ts`. Modified: `client/src/api/queryKeys.ts`, `client/src/ws.ts`, `client/src/pages/settings/PricingEditor.tsx` (invalidate scorecard prefixes on save).
> **High-risk areas touched:** None (reuses existing query/WS wiring).

### Description

The client-side plumbing that keeps both scorecard surfaces fresh: typed query fns + keys under one scorecard prefix, WS `session-updated` prefix invalidation (R9), response guards for every discriminated variant, and the `PricingEditor` fix so a rate edit invalidates scorecard dollars (#2).

### Test Plan

#### Test File(s)
- `client/src/api/scorecard.test.ts` (new — response guards)
- `client/src/api/queryKeys.test.ts` (add cases)
- `client/src/ws.test.ts` (add cases)

#### Test Scenarios

##### Query keys & invalidation

- **keys scoped under a scorecard prefix** — THEN session-scorecard and fleet biggest-lever keys live under one prefix _(verifies R9)_
- **WS session-updated invalidates by prefix** — GIVEN a `session-updated` message WHEN handled THEN both scorecard query shapes are invalidated by key prefix _(verifies R9)_
- **PricingEditor save invalidates scorecard prefixes** — GIVEN a pricing save WHEN it succeeds THEN scorecard query prefixes are invalidated in addition to `qk.prefixes.config` _(verifies #2)_

##### Response guards

- **parses every discriminated variant** — GIVEN each of `graded`/`too-short`/`no-main-thread-calls`/`no-scoreable-creation` and `event`/`healthy`/`no-cache-activity` payloads THEN the client guard narrows correctly; a malformed payload is handled, not thrown _(verifies R6/R7/R8, R10)_

##### Regression Guard

- **other pages' keys/invalidations unchanged** — GIVEN an existing non-scorecard `session-updated`/`scan-updated` flow THEN its invalidations behave as before _(guards backward-regression risk for `client/src/queryKeys.ts`, `client/src/ws.ts`, `PricingEditor.tsx`)_

### Implementation Notes

- **Module(s):** `client/src/api/**` (render-free; no cause/score logic — Module Boundaries).
- **Pattern reference:** `client/src/api/gates.ts` (query fns + keys), `client/src/ws.ts` (prefix invalidation), `client/src/pages/settings/PricingEditor.tsx:69-72` (add scorecard prefixes to the existing `onSuccess` invalidate).
- **Key decisions:** R9 (WS is refetch-only, no scorecard data over WS), #2 (PricingEditor invalidation). Client renders `kind`/`costBasis` from the wire — no reconstruction.
- **High-risk callouts:** none — additive keys; the one edit to `PricingEditor` is an added `invalidateQueries`, guard the existing config invalidation still fires.

### Scope Boundaries

- Do NOT compute cause, grade, or dollars client-side (Module Boundaries — the projector supplies `kind`/`costBasis`).
- Do NOT send scorecard data over WS (R9 — refetch-only).

### Files Expected

**New files:**
- `client/src/api/scorecard.ts` (pattern: `client/src/api/gates.ts`)
- `client/src/api/scorecard.test.ts`

**Modified files:**
- `client/src/api/queryKeys.ts` (scorecard prefix), `client/src/ws.ts` (invalidate on `session-updated`), `client/src/pages/settings/PricingEditor.tsx` (invalidate scorecard prefixes)
- `client/src/api/queryKeys.test.ts`, `client/src/ws.test.ts`

**Must NOT modify:**
- Existing non-scorecard query keys / WS handlers (covered by the regression guard)

---

## Task T8: Session Detail Scorecard section (UI)

> **Status:** not started
> **Verification:** ui
> **Effort:** m
> **Priority:** high
> **Depends on:** T7
> **Satisfies REQs:** R6, R10
> **Footprint slice:** New: `client/src/pages/session-detail/Scorecard.tsx` (+ `.stories.tsx`, `.test.tsx`). Modified: `client/src/pages/session-detail/SessionDetailView.tsx` (mount). Folds the `specs/claude-lens-pages.md` scorecard-section semantics.
> **High-risk areas touched:** Session Detail page (L/M — a second letter grade must stay legible vs. the gate Report Card).

### Description

The R6 section: grade badge or explicit ungraded state, the R1 metrics, and one row per waste event with timestamp, `kind`/cause (explicit "unexplained"), tokens re-written, dollars-or-unavailable (never $0), and a deep link to the event's turn — degrading to `/sessions/:id#cache-scorecard` when the turn can't be resolved.

### Verification Checklist

- **grade badge for graded sessions** — expected: letter badge renders; visually distinct from the gate Report Card grade in the same page space.
- **ungraded states render their reason** — expected: `too-short` / `no-main-thread-calls` / `no-scoreable-creation` each render an explicit reason, never an F or `0`.
- **R1 metrics render** — expected: reads, warmup/incremental/rewritten, waste ratio, hit ratio all shown from the wire.
- **one row per waste event** — expected: each row shows timestamp, `kind` + explicit "unexplained" where `attribution` is unknown, tokens re-written, and dollars-or-"unavailable" (never `$0.00`).
- **per-event deep link** — expected: clicking an event lands on that turn in Turn Inspector; a null-turn event links to `/sessions/:id#cache-scorecard` (plural).
- **two-grade legibility** — expected: on a session with both a gate grade and a scorecard grade, the two are unambiguous (label/placement).
- **viewports** — expected: renders correctly at desktop and a narrow width.

#### Testable Seams
- render (populated), each conditional state (graded / too-short / no-main-thread / no-scoreable / loading / error), deep-link handler (turn + null-turn fallback), a11y basics (badge role, link accessible name).

### Implementation Notes

- **Module(s):** `client/src/pages/session-detail/**` (render only).
- **Pattern reference:** `client/src/pages/session-detail/ReportCard.tsx` (grade badge + section layout, the adjacent gate grade to differentiate from).
- **Key decisions:** #3 (fallback `/sessions/:id#cache-scorecard`), #4 (render `kind`/`costBasis` from the wire — no client cause logic), R10 (never $0). Stories: populated / too-short / no-main-thread / no-scoreable / unexplained-event / loading / error.
- **High-risk callouts:** Session Detail L/M — the two grades must not read as one; use Storybook variants + a legibility component test.

### Scope Boundaries

- Do NOT compute cause/score/dollars in the component (render the wire).
- Do NOT add remediation advice, streaks, or gamification (Out of Scope).

### Files Expected

**New files:**
- `client/src/pages/session-detail/Scorecard.tsx` (+ `.stories.tsx`, `.test.tsx`) (pattern: `ReportCard.tsx`)

**Modified files:**
- `client/src/pages/session-detail/SessionDetailView.tsx` (mount the section)
- `specs/claude-lens-pages.md` (Session Detail scorecard section semantics — domain owner)

**Must NOT modify:**
- `client/src/pages/session-detail/ReportCard.tsx` / `server/routes/gates.ts` (shared visual space — Touched but not changed)

---

## Task T9: Dashboard Biggest Lever card (UI)

> **Status:** not started
> **Verification:** ui
> **Effort:** m
> **Priority:** high
> **Depends on:** T7
> **Satisfies REQs:** R7, R8, R10
> **Footprint slice:** New: `client/src/pages/dashboard/BiggestLeverCard.tsx` (+ `.stories.tsx`, `.test.tsx`). Modified: `client/src/pages/dashboard/Dashboard.tsx` (mount). Folds the `specs/claude-lens-pages.md` card semantics.
> **High-risk areas touched:** Dashboard (L — reuses existing URL filter state + card kit).

### Description

The one-investigation card: the single largest in-range waste event with `kind`/cause (explicit "unexplained"), tokens, dollars-or-unavailable, session/project identity, and a deep link to that session's scorecard section — falling back to a positive healthy summary or a distinct no-cache-activity state, all respecting the dashboard's global range + filters.

### Verification Checklist

- **event state** — expected: largest in-range event with `kind`/cause, tokens, dollars-or-"unavailable" (never $0), session/project, and a deep link to `/sessions/:id#cache-scorecard`.
- **healthy state** — expected: positive period summary (first-write share) with real numbers; visually distinct from loading/error.
- **no-cache-activity state** — expected: a distinct state, no fabricated 100%.
- **respects global filters** — expected: changing the dashboard range or project/model/branch/host filter re-selects the event (URL query state).
- **one event only** — expected: exactly one event surfaced, never a list.
- **viewports** — expected: renders at desktop and narrow width.

#### Testable Seams
- render, the three data states (event / healthy / no-cache-activity) + loading/error, deep-link handler, a11y basics (heading, link accessible name).

### Implementation Notes

- **Module(s):** `client/src/pages/dashboard/**` (render only).
- **Pattern reference:** `client/src/pages/dashboard/LeverageRatio.tsx`, `FailedWorkStat.tsx` (card kit + global filter wiring).
- **Key decisions:** #3 (deep link plural), #4 (`kind` from the wire), A12 (healthy vs no-activity), A9 (range/filters), R10 (never $0). Stories: event / healthy / no-cache-activity / loading / error.
- **High-risk callouts:** Dashboard L — reuse the existing URL filter state, don't introduce a second filter source.

### Scope Boundaries

- Do NOT show more than one event, add repeat-offender/trend content, or recommendations (Out of Scope, "One investigation per visit").
- Do NOT compute cause/dollars client-side.

### Files Expected

**New files:**
- `client/src/pages/dashboard/BiggestLeverCard.tsx` (+ `.stories.tsx`, `.test.tsx`) (pattern: `LeverageRatio.tsx`, `FailedWorkStat.tsx`)

**Modified files:**
- `client/src/pages/dashboard/Dashboard.tsx` (mount the card)
- `specs/claude-lens-pages.md` (Dashboard Biggest Lever semantics — domain owner)

**Must NOT modify:**
- Existing dashboard cards / global filter state module (reused, not changed)

---

## Task T10: Settings scorecard threshold panel (UI)

> **Status:** not started
> **Verification:** ui
> **Effort:** s
> **Priority:** medium
> **Depends on:** T1
> **Satisfies REQs:** R4, R5 (config surface)
> **Footprint slice:** Modified: `client/src/pages/settings/ThresholdsPanel.tsx` (expose scorecard thresholds alongside gate thresholds), `client/src/pages/settings/ThresholdsPanel.stories.tsx`.
> **High-risk areas touched:** Threshold config (L/M — the UI must surface the validator's order/range errors before save).

### Description

Expose the six scorecard-only thresholds (floor, calibration minimum, A/B/C/D cutoffs) in the existing Settings panel next to the gate thresholds, surfacing validation (range + `A > B > C > D` order) before save and invalidating scorecard queries on save.

### Verification Checklist

- **renders both threshold groups** — expected: scorecard thresholds (floor, calibration min, A/B/C/D) render alongside gate thresholds, clearly grouped.
- **invalid entry blocked before save** — expected: an out-of-range band or an order violation (`A ≤ B`) surfaces a validation message and prevents the save.
- **save invalidates scorecard queries** — expected: a successful save invalidates the scorecard query prefixes (grade may change).
- **viewport** — expected: renders at desktop width.

#### Testable Seams
- render (both groups), invalid-input state (range + order), save handler (invalidation fired).

### Implementation Notes

- **Module(s):** `client/src/pages/settings/**`.
- **Pattern reference:** the existing gate-thresholds form inside `ThresholdsPanel.tsx`; `PricingEditor.tsx` save/invalidate shape.
- **Key decisions:** Tech Choices "Thresholds home" (render both groups in the existing panel), T1's validator (mirror its order/range rules in the form). Stories: gate+scorecard groups, invalid-input, saved.
- **High-risk callouts:** Threshold config L/M — the client-side check should match the server validator (pairwise order among present bands, `[0,100]`), so a save that would 400 is caught in the form first.

### Scope Boundaries

- Do NOT add a new settings page (Tech Choices — reuse the existing panel).
- Do NOT duplicate the resolver/defaults client-side beyond what the form needs to validate input.

### Files Expected

**Modified files:**
- `client/src/pages/settings/ThresholdsPanel.tsx` (add the scorecard group)
- `client/src/pages/settings/ThresholdsPanel.stories.tsx` (add states)

**Must NOT modify:**
- The gate-thresholds portion of the panel (reused — existing editing must keep working)

---

## Cypress E2E (spanning T5/T8/T9 — run before merge)

Per CLAUDE.md, `verify` is not all of CI. `cypress/e2e/session-detail.cy.ts` and `cypress/e2e/dashboard.cy.ts` gain: packaged deep links (`/sessions/:id#cache-scorecard`), range selection on the Biggest Lever card, the positive/empty states, and the live append → WS → refetch journey (R9). These are listed in the Change Footprint and exercised as part of T5/T8/T9's `npm run test:e2e` gate, not a standalone task.
