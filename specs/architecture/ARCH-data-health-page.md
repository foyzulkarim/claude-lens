# Architecture: #P4-14 — Data Health page + `/api/health`

> **Date:** 2026-07-21
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Standalone brief — `specs/issues/P4-14-data-health-page-apihealth.md` (GitHub issue #46) + page spec `specs/claude-lens-pages.md` §9 + architecture spec `specs/claude-lens-architecture.md` §9
> **Type:** feature
> **Status:** Architecture accepted; `/api/health` route, `HealthSnapshot` contract, `Store.getHealthSnapshot()`, and the C/B/L `PremiumRollup` shape were already shipped by issue #45 / PR #109 (#P4-13). This document records the *extension* to that seam and the page client.

## Architecture Summary

`GET /api/health` already exists (shipped by #45), backed by `Store.getHealthSnapshot()` and a `HealthSnapshot` wire shape that today surfaces only premium-file (C/B/L) malformed-line health. This task extends that contract additively with the transcript-tier rollups the Data Health page spec requires: dedup stats, pricing coverage, scan coverage, sidecar coverage, and a fleet reconciliation rollup (computed vs observed $) that #45 made possible by threading `Session.premium.costObserved`. The page (`/health`, currently a `PageStub`) becomes a real four-section view, with reconciliation and capture-gap sub-cards now showing real data per session tier (🟢 where premium data exists, 🔴 with `LockedCard` where it doesn't), and boundary/promptId mismatches surfacing honest counts via a small extension to `PremiumRollup`. The route stays a thin store-read; the page consumes it through a single TanStack Query key invalidated on `session-updated`/`session-added`.

## Inferred Requirements (Mode B — issue + spec table, no REQ doc)

| ID  | Inferred Requirement                                                                                  | Source                                              |
|-----|-------------------------------------------------------------------------------------------------------|-----------------------------------------------------|
| R1  | Surface a single `/api/health` endpoint that covers both transcript-tier and premium-tier health     | `specs/issues/P4-14-…md` Summary; arch §9           |
| R2  | Section 1: dedup stats (raw lines → distinct API calls) and pricing coverage (unpriced model list) 🟢 | `specs/claude-lens-pages.md` §9 row 1               |
| R3  | Section 2: scan coverage (roots scanned, transcripts found/parsed/failed) and sidecar coverage       | `specs/claude-lens-pages.md` §9 row 2 + mockup      |
| R4  | Section 3: reconciliation of computed vs sampled vs logged $ (now real via `Session.premium`)        | `specs/claude-lens-pages.md` §9 row 3               |
| R5  | Section 4: boundary / promptId mismatches, unbucketed tails, capture gaps (now partly real)          | `specs/claude-lens-pages.md` §9 row 4               |
| R6  | Use the existing tier system — locked card for sub-sections with no data; honest "n/a" otherwise     | `specs/claude-lens-architecture.md` §4              |
| R7  | Page renders the mockup's visual sections (`specs/pages/data-health.html`); manual sign-off required  | Issue Acceptance criteria + DoD                     |
| R8  | Cypress smoke spec: route renders key sections from fixtures; one drill-link lands filtered          | Issue DoD (Phase 4 standing rules)                  |
| R9  | Component states covered in Storybook (not Cypress) for the 🔴 locked vs 🟢 data variants            | Issue DoD (Phase 4 standing rules)                  |
| R10 | Page is live — invalidates on session/scan updates, not just on a manual refresh                     | `specs/claude-lens-architecture.md` §7 + §11         |
| R11 | Malformed-line counters from #P2-2 surface on the page                                              | Issue Acceptance criteria                           |
| R12 | No new server dependencies; no new metrics-engine route (`/api/health` is store-introspection)       | `specs/claude-lens-architecture.md` §2/§8            |

## High-Level Structure

```
ingest (tailer→parser) ──► Store.applyRecords(result)         [NOW: += transcript duplicate/malformed]
        │                                                          │
        │                                                       [EXTEND]
        │                                       ┌───────────────────┴───────────────────┐
        │                                       │  SessionState: duplicateCount,        │
        │                                       │  malformedCount (transcript tier)     │
        │                                       │  costSamples/turnBoundaries/costLogRow │
        │                                       │  (premium tier — already there)       │
        │                                       └───────────────────┬───────────────────┘
        │                                                              │
        │                                                              ▼
        │                                       Store.recompute → deriveSession → reconcilePremium
        │                                       (already in #45)                              │
        │                                                                                     │
        │  Record on the premium file-health map (already in #45)                              │
        │  ─────────────────────────────────────────────────────────────────────────────────►  │
        │                                                                                     │
        ▼                                                                                     ▼
   pipeline tracks transcriptsFailed (NEW) ──────────────────────────────────────────►       │
                                                                                              ▼
                                                       Store.getHealthSnapshot()  (EXTEND, O(sessions))
                                                                                              │
                                                                              ┌───────────────┴───────────────┐
                                                                              │  files / totalMalformedLines   │ (existing #45)
                                                                              │  dedup / parseErrors / scan    │ (NEW #46)
                                                                              │  pricingCoverage / sidecar...  │ (NEW #46)
                                                                              │  reconciliation / captureGaps  │ (NEW #46)
                                                                              └───────────────┬───────────────┘
                                                                                              │
                                                                            GET /api/health   │ (existing route, contract extended)
                                                                                              ▼
                                                              client/src/api/health.ts → qk.health() = ["health"]
                                                                                              │
                                                                                              ▼
                                                          useHealthQuery → DataHealth page (4 sections)
                                                                                              ▲
                                                                                              │
                                            WS: session-updated / session-added ──► invalidate ["health"]
```

Two extension axes:
1. **Store-side**: per-session transcript counters + new fields on the rolled-up `HealthSnapshot`. Existing `PremiumRollup` gains `promptIdMismatchCount` / `unbucketedTailCount` for §4.
2. **Client-side**: real `DataHealth.tsx` page (currently a `PageStub`) under `pages/data-health/`, single TanStack hook, WS invalidation hook-up, Storybook + Cypress.

The route and the contract **already exist on main** (PR #109) — this task is additive, not replacement. Anything not additive is out of scope.

## Tech Choices

| Area                    | Decision                                                                                | Alternatives Considered           | Rationale                                                                                  |
|-------------------------|-----------------------------------------------------------------------------------------|-----------------------------------|--------------------------------------------------------------------------------------------|
| Wire shape              | Extend `HealthSnapshot` additively in `shared/health-contract.ts`                       | New contract + new route          | #45 already shipped the route; additive fields don't reshape JSON for existing callers     |
| Server routing          | Keep `registerHealthRoute` from `routes/health.ts`; thread `scanRoots` via options      | New route for transcript stats    | Mirrors `registerMetricsRoute` threading `metadata?.pricing`; additive change             |
| Store aggregation       | Extend `Store.getHealthSnapshot()` to roll up new fields in one O(sessions) pass         | New store module                  | Matches #45 precedent; one assembly point, lazy on read, no eager recompute                |
| Transcript counter storage | Per-session `duplicateCount`/`malformedCount` on `SessionState`, `+=` on apply, zero on reset | Module-level map keyed by sessionId | Matches the per-session pattern of `costSamples`/`turnBoundaries`/`costLogRow` (premium tier) |
| `transcriptsFailed` source | Pipeline increments when a tailed file produces zero calls for N consecutive polls      | Omit "failed" entirely            | Mockup shows a "transcripts failed" stat; needs a definition to be honest                  |
| `PremiumRollup` extension | Add `promptIdMismatchCount` + `unbucketedTailCount` to the existing rollup              | Leave §4 sub-card locked          | `reconcilePremium` computes these internally in `attributeSamplesToCalls`; surfacing is cheap and the data is honest |
| Client page layout      | `client/src/pages/data-health/` directory; `DataHealth.tsx` becomes a shim re-export     | Inline in `DataHealth.tsx`        | Projects / Models / Cache Lab / Sessions all use this pattern; consistent test/stories organization |
| Client API              | `client/src/api/health.ts` thin GET wrapper, `qk.health()` / `qk.prefixes.health` keys  | Reuse `qk.config` / `qk.metrics`  | Single source of truth (architecture §11); WS invalidation needs a distinct prefix         |
| Tier display            | Existing `LockedCard` + `TierBadge` for the per-session sub-card rows                    | New custom component              | `client/src/pages/models/LockedLinesPerCost.tsx` is the established pattern                |
| Validation              | Hand-rolled type guards in `shared/health-contract.ts` (no zod)                          | Add zod                           | House rule §2; we own both sides of the API                                                 |
| Metrics engine          | Not used for this page — store introspection only                                        | Wrap as `MetricsQuery`            | Architecture §8: pages are cheap because the engine is the bottleneck; health isn't a measure × dimension query |
| E2E                     | `cypress/e2e/data-health.cy.ts` — route renders key sections from fixtures; one drill-link | None                              | Issue DoD requires it                                                                      |

## Patterns & Conventions

- **Additive contract extension** — every new `HealthSnapshot` field is optional/defaultable from existing callers' perspective; existing JSON consumers ignore unknown fields. Mirrors the #45 additive pattern.
- **Per-session accumulation with `+=` semantics** — `applyRecords` is called by the tailer once per batch; counters must `+=` not assign. `resetSession` (truncation re-read) must zero them. Matches the per-session arrays (`costSamples`, `turnBoundaries`) that #45 added.
- **Lazy rollup on read, not eager recompute** — `getHealthSnapshot()` is invoked on every `GET /api/health`. No new recompute signal. Matches `listSessions()`/`getSessionSnapshot()` precedent.
- **WS-driven invalidation, not polling** — `qk.health()` invalidated on `session-updated` and `session-added` so live transcripts keep the page fresh within `staleTime`. `scan-updated`'s `{kind:"all"}` already covers it.
- **Tier-aware component composition** — `LockedCard` for 🔴 rows with no data; live data + `TierBadge` for 🟢/🟡 rows. No new component.
- **Page directory shim** — `pages/DataHealth.tsx` re-exports `pages/data-health/DataHealth.js`. Matches Projects (#P4-7), Models, Cache Lab, Sessions, etc.
- **Tone of in-source comments** — match the existing store/route comment density (multi-line block above the type/method explaining the "why" + the spec section reference). E.g. mirror the `#P4-13 review E1` block on `getHealthSnapshot()`.

## Data Models

### `HealthSnapshot` (extended) — `shared/health-contract.ts`

**Purpose:** Single response shape for `GET /api/health`. Carries every fleet-level health signal a mounted Data Health page needs.

**Key fields (additions marked 🆕):**

| Field                                | Type / Constraint                | Notes                                                                                  |
|--------------------------------------|----------------------------------|----------------------------------------------------------------------------------------|
| `files`                              | `PremiumFileHealth[]`            | (existing #45) Per-file cumulative malformed lines for C/B/L                            |
| `totalMalformedLines`                | `number`                         | (existing #45) Σ malformed across `files`                                               |
| `observedFileCount`                  | `number`                         | (existing #45) Distinct premium files since server start                                |
| `observedSince`                      | `number` (epoch ms)              | (existing #45) Wall-clock at server start                                                |
| `dedup.rawLines` 🆕                  | `number`                         | Σ raw transcript lines read across all sessions                                         |
| `dedup.distinctCalls` 🆕             | `number`                         | Σ distinct `ApiCall`s after `message.id` dedupe (≈ Σ `state.calls.length`)             |
| `dedup.duplicates` 🆕                | `number`                         | Σ collapsed `message.id` duplicates (= `rawLines - distinctCalls - skipped`)            |
| `parseErrors.malformedLines` 🆕      | `number`                         | Σ malformed transcript lines seen                                                       |
| `parseErrors.byFile` 🆕              | `{ filePath: string; count: number }[]` | Top-N transcript files by malformed count; filePath absolute, client renders basename |
| `scan.roots` 🆕                      | `ScanRoot[]`                     | `scanRoots` from config; each `{path, label?}` (from `shared/settings-contract`)        |
| `scan.transcriptsFound` 🆕           | `number`                         | Pipeline tally of distinct `.jsonl` files discovered                                    |
| `scan.transcriptsParsed` 🆕          | `number`                         | `listSessions().length` — sessions successfully accumulated into the store              |
| `scan.transcriptsFailed` 🆕          | `number`                         | `transcriptsFound - transcriptsParsed` after stale-poll dedupe (see Open Questions)    |
| `scan.sessionsWithSidecars` 🆕       | `number`                         | `count(sidecar flags ≠ all false)`                                                      |
| `pricingCoverage.modelsSeen` 🆕      | `string[]`                       | Distinct `ApiCall.model` across fleet                                                   |
| `pricingCoverage.unpricedModels` 🆕 | `string[]`                       | Subset of `modelsSeen` absent from the pricing table                                    |
| `sidecarCoverage.total` 🆕           | `number`                         | Total sessions                                                                          |
| `sidecarCoverage.withCost` 🆕       | `number`                         | `count(hasCostSamples)`                                                                 |
| `sidecarCoverage.withBoundaries` 🆕 | `number`                         | `count(hasTurnBoundaries)`                                                              |
| `reconciliation.sessionsWithObserved` 🆕 | `number`                   | `count(state.session.costBasis === "observed")`                                         |
| `reconciliation.sessionsWithComputedOnly` 🆕 | `number`              | Total sessions minus the above                                                          |
| `reconciliation.costComputed` 🆕     | `number`                         | Σ `Session.costComputed` (unpriced models contribute $0)                                |
| `reconciliation.costObserved` 🆕    | `number`                         | Σ `Session.premium.costObserved` across premium sessions                                 |
| `reconciliation.costLogTotal` 🆕    | `number?`                        | Σ L rows (when L capture is present)                                                     |
| `captureGaps.sessionsWithoutObserved` 🆕 | `number`                    | Alias of `reconciliation.sessionsWithComputedOnly`; clearer for the §4 sub-card          |

**Lifecycle:** rolled up fresh on every `GET /api/health` request. No persistence; no caching. Invalidated on the client via WS.

**Cross-references:** the same `HealthSnapshot` is the data source for the four page sections; consumers must not assume the order of fields.

### `SessionState` (transcript counters) — `server/store/store.ts`

**Purpose:** Per-session in-memory columnar store. The premium tier already has `costSamples`/`turnBoundaries`/`costLogRow`. The transcript tier now gains the same shape for dedup/malformed tracking.

**Key fields (additions to existing interface):**

| Field              | Type      | Notes                                                                                  |
|--------------------|-----------|----------------------------------------------------------------------------------------|
| `duplicateCount`   | `number`  | Sum of `result.duplicateCount` across all `applyRecords` calls; `0` on `stateFor` first-touch; `0` on `resetSession` |
| `malformedCount`   | `number`  | Sum of `result.malformedCount` across all `applyRecords` calls; reset on `resetSession` |

**Lifecycle:** allocated empty in `stateFor()`; accumulated via `+=` in `applyRecords`; zeroed in `resetSession`; never wiped by `markSidecarPresent` (sidecar presence is independent of transcript truncation). The premium tier's `costSamples`/`turnBoundaries` already follow this same lifecycle.

### `PremiumRollup` (extended) — `server/store/reconcile-premium.ts`

**Purpose:** Per-session rollup of values reconciled from C/B/L sidecars. Already exposes `costObserved`, `contextPctObserved`, `linesAdded`, `linesRemoved`. Gains two more so the §4 sub-card ships with real data.

**Key fields (additions):**

| Field                       | Type     | Notes                                                                                 |
|-----------------------------|----------|---------------------------------------------------------------------------------------|
| `promptIdMismatchCount` 🆕  | `number` | Count of C samples whose `promptId` does not match any turn's `promptId` in this session |
| `unbucketedTailCount` 🆕    | `number` | Count of C samples whose timestamp falls outside any turn's `[start, end]` range       |

**Lifecycle:** computed by `reconcilePremium` during `Store.recompute`; rolled up into `Store.getHealthSnapshot()` via `Σ` across sessions.

### `PipelineStats` (counters) — `server/ingest/pipeline.ts`

**Purpose:** Lightweight pipeline-level counters, separate from per-session state. Surfaced read-only.

**Key fields:**

| Field                | Type     | Notes                                                                            |
|----------------------|----------|----------------------------------------------------------------------------------|
| `transcriptsFound`   | `number` | Distinct `.jsonl` files the poller has discovered since server start              |
| `transcriptsFailed`  | `number` | Sessions whose transcript has been polled ≥ N times with `state.calls.length === 0` (see Open Questions) |

**Lifecycle:** allocated once in the pipeline singleton (`cli.ts`-wires the same instance to `buildApp`); `transcriptsFound` `+=` on first sighting, `transcriptsFailed` re-evaluated each poll. Exposed via `pipeline.getStats()` for `getHealthSnapshot()` to read.

## API Contracts / Interfaces

### `GET /api/health` — `server/routes/health.ts`

**Boundary:** HTTP API (extension of existing endpoint).

**Operations:**

| Method/Op   | Path             | Purpose                                                  | Errors / Returns                          |
|-------------|------------------|----------------------------------------------------------|-------------------------------------------|
| `GET`       | `/api/health`    | Return current `HealthSnapshot` rolled up from the store | `200` with the snapshot; never throws — top-level `setErrorHandler` returns `{error,cause}` on any escape |

**Auth requirements:** None (localhost-only app, same as every other route).

**Threading changes:** `registerHealthRoute(app, store, options?)` gains an optional `scanRoots: ScanRoot[]` so the route can populate `scan.roots` in the snapshot. Mirrors `registerMetricsRoute`'s `metadata?.pricing` pattern. Backward-compatible: existing tests pass no options and the field defaults to `[]`.

### `Store.getHealthSnapshot(scanRoots?)` — `server/store/store.ts`

**Boundary:** internal module API (Store → route).

**Operations:**

| Method/Op                                   | Returns           | Notes                                                                              |
|---------------------------------------------|-------------------|------------------------------------------------------------------------------------|
| `getHealthSnapshot(scanRoots?: ScanRoot[])` | `HealthSnapshot`  | Single O(sessions) pass; reads `premiumFileHealth` (#45) + new rollup + `pricing` for unpriced-model detection |

**Auth requirements:** N/A (internal).

### `Pipeline.getStats()` — `server/ingest/pipeline.ts`

**Boundary:** internal module API (pipeline → store / route).

**Operations:**

| Method/Op     | Returns                | Notes                                                                       |
|---------------|------------------------|-----------------------------------------------------------------------------|
| `getStats()`  | `PipelineStats`        | `transcriptsFound` / `transcriptsFailed` counts. Wire-through: route reads via a closure passed to `registerHealthRoute`. |

**Auth requirements:** N/A (internal).

### `fetchHealth()` — `client/src/api/health.ts`

**Boundary:** client HTTP wrapper.

**Operations:**

| Method/Op        | Path             | Returns            | Notes                                                              |
|------------------|------------------|--------------------|--------------------------------------------------------------------|
| `fetchHealth()`  | `GET /api/health`| `HealthSnapshot`   | Thin fetch wrapper; `signal` parameter for `AbortSignal` parity with `postMetrics` |

**Auth requirements:** N/A.

### `qk.health()` / `qk.prefixes.health` — `client/src/api/queryKeys.ts`

**Boundary:** TanStack Query key factory.

**Operations:**

| Method/Op           | Returns                       | Notes                                                            |
|---------------------|-------------------------------|------------------------------------------------------------------|
| `qk.health()`       | `readonly ["health"]`         | Bare literal-array key; single cache entry for the page         |
| `qk.prefixes.health`| `readonly ["health"]`         | Prefix for `queryClient.invalidateQueries` on WS messages        |

**Auth requirements:** N/A.

### WS message → invalidation action — `client/src/ws.ts`

**Boundary:** event producer/consumer (server invalidation bus → React Query).

**Operations:**

| Message type          | New action emitted            | Notes                                                            |
|-----------------------|-------------------------------|------------------------------------------------------------------|
| `session-updated`     | `{kind:"health"}` (NEW)       | Transcript appends change dedup/malformed; page must refetch     |
| `session-added`       | `{kind:"health"}` (NEW)       | New session contributes to fleet coverage stats                  |
| `scan-updated`        | `{kind:"all"}` (existing)     | Already covers `health`; no change needed                        |

The action is added to the `InvalidationAction` union and the `applyInvalidationAction` switch; the exhaustive `never` check at the bottom guards future variants.

## Module Boundaries

| Module / Package                                | Responsibility                                                          | Allowed Dependencies                                              |
|-------------------------------------------------|-------------------------------------------------------------------------|-------------------------------------------------------------------|
| `shared/health-contract.ts`                     | Owns the `HealthSnapshot` wire shape + `PremiumFileHealth`; type guards | none (pure types)                                                 |
| `server/store/store.ts`                         | Owns `Store.getHealthSnapshot()` + per-session counter accumulation     | `parse-transcript.ts`, `derive-session.ts`, `reconcile-premium.ts`, `health-contract.ts` |
| `server/store/derive-session.ts`                | (unchanged) — derives `Session` from raw + `PremiumRollup`             | `reconcile-premium.ts`, `parse-premium.ts`, types                 |
| `server/store/reconcile-premium.ts`             | (extension only) — gains `promptIdMismatchCount` / `unbucketedTailCount` on `PremiumRollup` | `parse-premium.ts`, `derive-turns.ts` |
| `server/ingest/pipeline.ts`                     | (extension only) — gains `transcriptsFound` / `transcriptsFailed` counters | `poller.ts`, `tailer.ts`, `parse-transcript.ts`, `parse-premium.ts` |
| `server/ingest/parse-transcript.ts`             | (unchanged) — already returns `duplicateCount` / `malformedCount`        | none (pure)                                                       |
| `server/routes/health.ts`                       | (extension only) — threads `scanRoots`; no behavior change              | `store.ts`, `health-contract.ts`                                  |
| `client/src/api/health.ts`                      | `fetchHealth()` thin GET wrapper                                         | `health-contract.ts`                                              |
| `client/src/api/queryKeys.ts`                   | `qk.health` / `qk.prefixes.health`                                      | none (pure)                                                       |
| `client/src/ws.ts`                              | (extension only) — adds `health` action                                 | `queryKeys.ts`, `ws-protocol.ts`                                  |
| `client/src/pages/data-health/DataHealth.tsx`   | Page composition; reads `useHealthQuery` and renders 4 sections         | `api/health.ts`, `components/*` (LockedCard, TierBadge, StatCard, DataTable) |
| `client/src/pages/data-health/useHealthQuery.ts`| Single `useQuery({ queryKey: qk.health() })`                            | `api/health.ts`, `api/queryKeys.ts`                               |
| `client/src/pages/data-health/<panels>`         | Section components: `DedupPricingStats`, `PricingCoverageTable`, `ScanCoverage`, `ReconciliationPanel`, `CaptureGapsPanel`, `BoundaryMismatchesPanel` | same as `DataHealth.tsx` |

## Change Footprint

### New files / modules

| Path                                                              | Purpose                                                                                       | Pattern reference                          |
|-------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|--------------------------------------------|
| `client/src/api/health.ts`                                        | `fetchHealth()` GET wrapper                                                                   | `client/src/api/config.ts`                 |
| `client/src/api/health.test.ts`                                   | Wrapper test                                                                                  | `client/src/api/config.test.ts`            |
| `client/src/pages/data-health/DataHealth.tsx`                     | Real page (replaces `PageStub`)                                                               | `client/src/pages/projects/Projects.tsx`   |
| `client/src/pages/data-health/useHealthQuery.ts`                  | Single TanStack hook                                                                          | `client/src/pages/projects/useProjectsQueries.ts` |
| `client/src/pages/data-health/DedupPricingStats.tsx`              | §1 stats row                                                                                  | `client/src/pages/dashboard/StatCardsRow.tsx` |
| `client/src/pages/data-health/PricingCoverageTable.tsx`           | §1 unpriced-model table                                                                       | `client/src/pages/sessions/TagsSection.tsx` |
| `client/src/pages/data-health/ScanCoverage.tsx`                   | §2 scan + sidecar coverage                                                                    | `client/src/pages/dashboard/CaptureBanner.tsx` |
| `client/src/pages/data-health/ReconciliationPanel.tsx`            | §3 computed vs observed vs logged $                                                           | `client/src/pages/dashboard/SavingsDecomposition.tsx` |
| `client/src/pages/data-health/CaptureGapsPanel.tsx`               | §4 capture-gap sub-card (real data: `sessionsWithoutObserved`)                                | `client/src/pages/dashboard/FailedWorkStat.tsx` |
| `client/src/pages/data-health/BoundaryMismatchesPanel.tsx`        | §4 boundary/promptId sub-card (real data: Σ `promptIdMismatchCount`, Σ `unbucketedTailCount`) | `client/src/pages/models/LockedLinesPerCost.tsx` (when not locked) |
| `client/src/pages/data-health/DataHealth.stories.tsx`             | Storybook for all four sections + locked/unlocked variants                                    | `client/src/pages/models/Models.stories.tsx` |
| `client/src/pages/data-health/DataHealth.test.tsx`                | Page tests (one per section; locked vs unlocked variants)                                    | `client/src/pages/models/Models.test.tsx`   |
| `cypress/e2e/data-health.cy.ts`                                   | Smoke: route renders key sections from fixtures; one drill-link lands filtered                | `cypress/e2e/premium-tier.cy.ts` (sister)  |

### Modified files / modules

| Path                                                              | What changes here                                                                                                                  |
|-------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------|
| `shared/health-contract.ts`                                       | Add 🆕 fields to `HealthSnapshot` (see Data Models); re-export new nested types (`DedupStats`, `ParseErrorSummary`, `ScanCoverage`, `PricingCoverage`, `SidecarCoverage`, `ReconciliationRollup`, `CaptureGaps`) |
| `server/store/store.ts`                                           | `SessionState` gains `duplicateCount` / `malformedCount`; `applyRecords` does `+=` on both; `resetSession` zeros them; `getHealthSnapshot()` rolls up the new fields, reading `pricing` to compute `pricingCoverage.unpricedModels` and `state.session.costComputed` / `state.session.premium` for the reconciliation rollup |
| `server/store/store.test.ts`                                      | Coverage for counter `+=`/reset, snapshot fields, unpriced-model derivation, reconciliation rollup (including a transcript-only session for the "computed only" branch) |
| `server/store/derive-session.ts`                                  | (no behavior change) — `PremiumRollup` type already passed through                                         |
| `server/store/reconcile-premium.ts`                               | `PremiumRollup` gains `promptIdMismatchCount` / `unbucketedTailCount`; `attributeSamplesToCalls` populates them; `rollupSession` sums them into the rollup |
| `server/store/reconcile-premium.test.ts`                          | Coverage for new fields: mismatch case, unbucketed-tail case, both present, both absent (transcript-only session) |
| `server/ingest/pipeline.ts`                                       | New `PipelineStats` counter block; `transcriptsFound` `+=` on first sighting; `transcriptsFailed` incremented when a session has been polled with zero calls for ≥ N consecutive polls (definition in Open Questions) |
| `server/ingest/pipeline.test.ts`                                  | Coverage for new counters; verify the "failed" increment doesn't fire on a session that simply hasn't been read yet |
| `server/ingest/health-pipeline.test.ts`                           | (existing #45 file) — if pipeline changes bleed into it, audit assertions |
| `server/routes/health.ts`                                         | `registerHealthRoute(app, store, options?)` accepts `{ scanRoots?: ScanRoot[]; pipelineStats?: () => PipelineStats }`; threads them into `getHealthSnapshot` |
| `server/routes/health.test.ts`                                    | New fixture: multi-session with unpriced model + one premium session + one transcript-only session; assert all new snapshot fields; backward-compat (no options) still returns the old fields |
| `server/app.ts`                                                   | `registerHealthRoute(app, store, { scanRoots: buildRuntimeMetadata({scanRoots: merged.scanRoots}).scanRoots, pipelineStats: pipeline.getStats })` — mirrors how `metadata?.pricing` is threaded to `registerMetricsRoute` |
| `client/src/api/queryKeys.ts`                                     | Add `qk.health()` and `qk.prefixes.health`                                                                          |
| `client/src/api/queryKeys.test.ts`                                | Add key cases                                                                                                  |
| `client/src/ws.ts`                                                | Add `{kind:"health"}` to `InvalidationAction`; map `session-updated` / `session-added` to it; `applyInvalidationAction` invokes `invalidateQueries({queryKey: qk.prefixes.health})` |
| `client/src/ws.test.ts`                                           | New cases: `session-updated` emits `health`; `session-added` emits `health`; `scan-updated` still emits `all` (which subsumes `health`) |
| `client/src/pages/DataHealth.tsx`                                 | Replace `PageStub` with `export { DataHealth } from "./data-health/DataHealth.js"` shim; add stories/test re-exports if a sibling pattern requires it |
| `client/src/App.tsx`                                              | (no change expected) — `routes.ts` already routes `/health` to `DataHealth`; verify the shim re-export resolves |
| `client/src/routes.ts`                                            | (no change) — already has `{ path: "/health", label: "Data Health", component: DataHealth }`; verify nav still works |
| `shared/health-contract.test.ts` (or new)                         | Type-guard tests for the new nested types                                                                         |

### Deleted / replaced

| Path                                | Reason                                                                                                            |
|-------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `client/src/pages/DataHealth.tsx` body (the `PageStub` lines) | Replaced by the shim re-export. The shell of the file stays (`export { DataHealth } from "./data-health/DataHealth.js"`) per the Projects/Models shim pattern. |

### Touched but not changed (silent-regression hotspots)

| Path                                                              | Why it matters                                                                                                          |
|-------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------|
| `client/src/routes.ts`                                            | Already routes `/health` → `DataHealth`; verify the shim re-export resolves on cold load + HMR                          |
| `client/src/App.tsx`                                              | Imports via `routes.ts`; no direct import of `DataHealth.tsx`, but HMR regressions on shim files are easy to miss       |
| `server/store/store.test.ts` (any deep-equality assertions)      | Additive fields on `SessionState` could break `toEqual` snapshots that don't expect `duplicateCount` / `malformedCount` |
| `server/store/reconcile-premium.test.ts`                          | Extending `PremiumRollup` shifts fixture data — additive, but the test's expected values now need the new fields        |
| `server/ingest/pipeline.test.ts`                                  | Adding the `transcriptsFailed` counter could shift "no change" expectations                                            |
| `server/routes/health.test.ts` (#45)                              | New options/fields are added — existing test should pass without modification, but the route now has 2 optional args  |
| `shared/health-contract.ts` consumers                              | The wire shape grows; clients that destructure the response (rather than the whole object) keep working; clients that assert "no extra fields" break — audit |
| `client/src/ws.test.ts` `actionsForMessage` exhaustive `never`    | Adding `health` to the InvalidationAction union forces the action switch through; if the producer side adds a 4th `WsServerMessage` variant, the union guards catch it. The exhaustive `never` checks at the bottom of both switches must stay |
| Any Cypress spec that mounts the `DataHealth` page via direct URL | If the page now has a `useHealthQuery` mounted, ensure the fixture data is sufficient to render the four sections without `isPending` flash |

## Areas of Impact

| Area                                                       | Impact                                                                                  | Risk (L/M/H) | Why                                                                                                  |
|------------------------------------------------------------|-----------------------------------------------------------------------------------------|--------------|------------------------------------------------------------------------------------------------------|
| `HealthSnapshot` wire shape                                | Grows additively; existing consumers ignore unknown fields; new fields are populated   | **L**        | Additive; JSON-safe; mirrors #45's additive precedent                                                  |
| `Store` per-session counter accumulation                   | New code path; `+=` semantics must match truncation semantics                          | **M**        | Tailer calls `applyRecords` repeatedly; wrong semantics = inflated counts. #45 premium counters are the precedent (cumulative on re-read) |
| `Store.getHealthSnapshot()` extension                      | One O(sessions) pass with new branches                                                   | **L–M**      | O(sessions) per request; for typical fleets (≤10k sessions) this is fast but worth measuring          |
| `PremiumRollup` extension                                  | Additive; `reconcilePremium` returns more fields                                         | **L**        | Additive; existing tests need fixture updates only; attribution internals already compute these counts |
| `pipeline.ts` counter for `transcriptsFailed`              | New metric with a definition that needs to land                                         | **M**        | No existing "failed" surface; "zero calls after N polls" is one definition but could be wrong for sessions mid-tail — see Open Questions |
| `routes/health.ts` thread `scanRoots` + `pipelineStats`     | Optional args; backward-compatible                                                       | **L**        | Mirrors how `registerMetricsRoute` threads `metadata?.pricing`; optional args keep existing tests valid |
| `app.ts` wiring                                            | `registerHealthRoute` gains options; one extra call                                      | **L**        | Plumbing only                                                                                        |
| Client `qk.health()` / `qk.prefixes.health`                | Additive                                                                                | **L**        | New factory entries; no collision with existing keys                                                  |
| WS invalidation table                                      | New action; new exhaustiveness check                                                     | **L**        | Exhaustive `never` checks at the bottom of the switches catch regressions; existing `scan-updated → all` already covers most cases |
| `client/src/pages/DataHealth.tsx` becomes a shim           | Pattern established by Projects/Models                                                   | **L**        | Established pattern; `routes.ts` already routes correctly                                             |
| Tests around `getHealthSnapshot`                           | Existing assertions grow; new fixtures                                                  | **L**        | #45 wrote `server/routes/health.test.ts` already; new options add cases but don't break old ones      |

**Contract changes:** `GET /api/health` response shape gains new fields. Any client that asserts the response is *exactly* `{ files, totalMalformedLines, observedFileCount, observedSince }` breaks — none expected in this repo. The shape is documented in `shared/health-contract.ts` and the only consumer (this page) uses the whole object.

**Cross-cutting ripples:**
- *Auth*: none (localhost-only).
- *Telemetry*: existing pino logger; no new logs. The pipeline `transcriptsFailed` counter *is* the observability surface for "is the poller healthy".
- *Migrations*: none.
- *Feature flags*: none.
- *Build pipeline*: no new dependencies; no `package.json` change.
- *Storybook*: new stories required by DoD; one stories file for the page; all section panels have stories.
- *Cypress*: one new e2e spec per DoD.

## Cross-Cutting Concerns

- **Errors:** `/api/health` is a pure store read; the existing top-level `setErrorHandler` in `app.ts` returns `{error,cause}` on any escape. The route itself doesn't catch — `Store.getHealthSnapshot` must not throw (every branch returns, no async I/O).
- **Logging & metrics:** no new log lines. The pipeline's `transcriptsFailed` counter is the metric.
- **Auth / authz:** none.
- **Performance:** `getHealthSnapshot()` is O(sessions). At today's fleet sizes (≤10k sessions), the pass is well under 10ms. Worth measuring in the test suite (add a `getHealthSnapshot` perf case if `server/store/store.test.ts` doesn't have one already). The client query has a `staleTime` (suggested: 30s) so the page doesn't refetch on every interaction; WS invalidation re-fires the query when sessions change.
- **Security:** no new attack surface — the route is read-only and surfaces only aggregated counts, not session content. The premium-side malformed-line `filePath` is already absolute (#45 already chose this; clients render basename); the new transcript-side `parseErrors.byFile[].filePath` follows the same convention. No secrets.
- **Migrations / rollout:** purely additive. Ships behind no flag. Backward-compat: existing `/api/health` JSON consumers ignore unknown fields. Tests that destructure the response keep working.

## Architecture Decisions Log

| #   | Decision                                                                       | Alternatives                              | Chosen Because                                                                                | Satisfies     |
|-----|--------------------------------------------------------------------------------|-------------------------------------------|-----------------------------------------------------------------------------------------------|---------------|
| A1  | Extend `HealthSnapshot` additively; do not create a new contract or route     | New `/api/health-transcript` route; new contract | #45 already shipped the route/contract; additive fields are JSON-safe and align with #45's additive pattern; consumers destructure the whole object | R1, R12       |
| A2  | Per-session `duplicateCount` / `malformedCount` on `SessionState`; `+=` on `applyRecords`; zero on `resetSession` | Module-level map keyed by sessionId | Matches the per-session arrays the premium tier already uses (`costSamples` / `turnBoundaries` / `costLogRow`); one source of truth per session | R2, R11       |
| A3  | `getHealthSnapshot()` rolls up all fields in one O(sessions) pass              | New module per concern                   | #45 precedent (one assembly point, lazy on read, no eager recompute)                          | R12           |
| A4  | `transcriptsFailed` defined as "polled ≥ N times with zero calls accumulated"  | Omit "failed" entirely; count files that disappeared | The mockup shows a "transcripts failed" stat; needs a definition to be honest; this definition is conservative (zero calls after N polls = real failure) | R3, R5, R7    |
| A5  | Extend `PremiumRollup` with `promptIdMismatchCount` / `unbucketedTailCount`    | Leave §4 sub-card locked                 | `reconcilePremium` already computes these in `attributeSamplesToCalls`; surfacing is cheap and the data is honest; the user *should* see these numbers | R5            |
| A6  | Page consumes the snapshot via a single TanStack Query key `["health"]`        | Multiple keys (one per section)          | One snapshot drives the page; sections are derivations; WS invalidation invalidates one key | R10, R12      |
| A7  | WS invalidation: emit `health` on `session-updated` and `session-added`        | Only on `scan-updated`                   | `session-updated` fires on every transcript append — the events that change dedup/malformed. Without this, the page is stale during a live session | R10           |
| A8  | Page directory `pages/data-health/` + shim at `pages/DataHealth.tsx`           | Single file                              | Matches Projects/Models/Cache Lab/Sessions/Settings pattern                                     | R7, R8        |
| A9  | `LockedCard` for sub-sections with no data; live data + `TierBadge` otherwise   | Custom "tier" component                  | `LockedLinesPerCost.tsx` is the established pattern; no new component                          | R6, R7        |
| A10 | Scan roots threaded via `metadata?.scanRoots` (mirrors `metadata?.pricing`)     | Read from `readConfig` directly in the route | Same plumbing as the metrics route; preserves the "buildApp owns runtime config" invariant     | R3, R12       |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario                                                                                    | How the Design Handles It                                                                                       |
|---------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------|
| Tailer truncation mid-session (file re-read from byte 0)                                    | `resetSession` zeros `duplicateCount` / `malformedCount`; counters start fresh on re-read. Mirrors how the premium tier handles truncation. |
| Pipeline never surfaces a "failed" definition (Q1)                                          | Counter is `transcriptsFound - transcriptsParsed` after a stale-poll dedupe; conservative — won't fire on a session that simply hasn't been read yet. See Open Questions. |
| `pricing` is `undefined` (no pricing configured yet)                                         | `pricingCoverage.unpricedModels` = all `modelsSeen`; `cacheSavingsComputed` stays 0; route still returns; honest "no pricing" rather than fabricated numbers. |
| `metadata?.scanRoots` is undefined                                                          | `scan.roots = []`; everything else still works; route returns a valid snapshot.                                |
| Two C samples with the same `promptId` and identical timestamp                              | `attributeSamplesToCalls` walks the sorted list; counts are deterministic; Σ at the session level still equals the original samples' total. Existing #45 tests cover this. |
| A session has L only (no C)                                                                 | `reconcilePremium` falls back to L's session total for `costObserved`; `reconciliation.costLogTotal` is the L Σ. |
| A session has C only (no L)                                                                 | `reconciliation.costLogTotal` is `undefined`; the route serializes that field as absent.                        |
| Session mid-debounce when `/api/health` is called                                          | `getHealthSnapshot()` reads `state.session` lazily (same caveat as `listSessions()`); document the "fresh within ~debounceMs" expectation in the route comment. |
| Fleet grows 21 → 10k sessions                                                               | Snapshot is O(n) per request; TanStack `staleTime: 30s` + WS-only invalidation bounds request rate. Memoize in `Store` if it bites. |
| Server restart with active sessions                                                          | All in-memory counters reset; `observedSince` updates; client refetches via WS reconnect `{kind:"all"}`. |
| Reconcile inputs change (e.g. C file edited by user)                                         | `pipeline.applyRecords` re-records; `recompute` runs; `Store.getHealthSnapshot` returns fresh numbers; `session-updated` invalidates the client query. |
| `reconcilePremium` attribution internal counters exposed on `PremiumRollup` could surface weirdness | The numbers are honest: `promptIdMismatchCount` is *only* the count of samples that couldn't be attributed to a turn. If real-world data has many mismatches, that's a signal the user needs. |

### Backward — regression risk per touched area

| Touched area                                           | What could regress                                                                                       | How we'd know / mitigation                                                                            |
|--------------------------------------------------------|----------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| `Store.applyRecords` counter `+=` semantics            | Re-assign instead of `+=` (e.g. `state.malformedCount = result.malformedCount`) — every batch overwrites the previous, hiding malformed lines | `server/store/store.test.ts` cases that call `applyRecords` twice on the same session and assert the Σ; if this regresses, those tests fail |
| `Store.resetSession` not zeroing transcript counters   | Truncation re-read inflates malformed counts on every re-read                                            | Same tests cover reset; add an explicit "reset zeroes both counters" case                              |
| `HealthSnapshot` wire shape extension breaks existing JSON consumers | A consumer asserts the response is *exactly* `{ files, totalMalformedLines, observedFileCount, observedSince }` | None expected in this repo; the only consumer is this page; `shared/health-contract.ts` documents the full shape |
| `PremiumRollup` extension breaks `reconcile-premium.test.ts` fixtures | Test asserts the rollup object is *exactly* the old set of fields                                       | Fixture update is part of the change; new tests cover the new fields                                  |
| `pipeline.ts` `transcriptsFailed` fires on never-read sessions | A session is discovered but not yet tailed; counter inflates                                            | Definition is "polled ≥ N times with zero calls"; `N` chosen to be well above the normal cold-boot lag. New test case: "session with zero calls but no polls → counter doesn't fire" |
| `ws.ts` health invalidation not emitted on `session-updated` | Page stays stale during a live transcript append                                                        | `client/src/ws.test.ts` cases assert the action list per message; new cases here                      |
| `ws.ts` exhaustive `never` checks not updated          | A new `WsServerMessage` variant is added later; switch silently drops the message                       | Compile-time guard at the bottom of `actionsForMessage` and `applyInvalidationAction`                  |
| `routes/health.ts` option threading breaks `app.ts`    | `metadata?.scanRoots` undefined path; pipeline stats not threaded                                       | Backward-compat: options are optional; existing `registerHealthRoute(app, store)` call still works   |
| Page `useHealthQuery` missing `staleTime`              | Page refetches on every component re-render                                                              | Set `staleTime: 30_000`; document in the hook                                                        |
| `LockeCard` import path on the boundary-mismatches panel | Imports from the wrong path; HMR error in dev                                                            | Mirror `client/src/pages/models/LockedLinesPerCost.tsx` import line verbatim                          |

## Open Questions

- **Q1. `transcriptsFailed` definition.** Current proposal: "polled ≥ N times with `state.calls.length === 0`". What is N? Recommendation: 5 polls (the tailer's `slowReGlob` interval is ~5s, so this is "no calls after ~25s" — long enough to ignore cold-boot and short polling hiccups, short enough to flag a genuinely broken transcript). **Impact if unresolved**: counter either never fires (N too high) or fires for sessions that simply haven't been read yet (N too low). **Suggested default**: N=5; add a comment in the pipeline citing the rationale.
- **Q2. `pricingCoverage.unpricedModels` and `cacheSavingsComputed` interaction.** The existing `derive-session.ts` zeros `cacheSavingsComputed` if *any* seen model is unpriced. `pricingCoverage` reports the unpriced set; should it also zero out the *computed* totals on the reconciliation rollup? Recommendation: **no** — `costComputed` is `Σ pricer(call.usage, call.model)` and an unpriced model contributes $0 honestly, so the sum is right. `unpricedModels` is reported separately; the user sees "model X unpriced" and "reconciliation total" side by side. **Impact if unresolved**: confusion if a reader expects the reconciliation total to silently drop unpriced models' calls.
- **Q3. Tier display for the per-session sub-cards.** When a session is 🟢 computed-only (no premium capture), the §3 / §4 sub-cards should show "n/a — no premium capture" rather than zeros. The existing `TierBadge` supports this, but the page should compose it cleanly. **Suggested default**: sub-card shows the count for premium sessions and a `TierBadge` for the others. **Impact if unresolved**: readers see "0 capture gaps" and think everything is fine when in fact 100% of sessions are capture-gap'd.

## Out of Scope

- Surfacing per-session health directly in a Session Detail sub-card (#P4-5 / #P4-7 already has its own; this task is the page-level rollup, not per-session).
- Adding a `PipelineStats` field beyond `transcriptsFound` / `transcriptsFailed` (e.g. tailer errors, poller errors) — defer until a need is shown.
- Pricing *editing* on this page (already in #P4-15 Settings).
- New file types beyond what the existing pipeline already discovers.
- Network / cloud ingestion — all parsing is local.

---

# Tasks

_This section is populated by the **generate-tasks** skill (Phase 3)._
_Run: `/generate-tasks from: specs/architecture/ARCH-data-health-page.md`_

## Cross-references

- Issue: `specs/issues/P4-14-data-health-page-apihealth.md` (issue #46)
- Context: `specs/context/46.md`
- Spec: `specs/claude-lens-pages.md` §9 (Data Health) — binding over `specs/pages/data-health.html`
- Spec: `specs/claude-lens-architecture.md` §9 (`GET /api/health`)
- Sister artifact: `specs/architecture/ARCH-45.md` (premium tier — the foundation this task extends)
- Sister code (existing): `server/routes/health.ts`, `server/store/store.ts` (Store), `shared/health-contract.ts`, `client/src/pages/PageStub.tsx`, `client/src/routes.ts`
- Sister patterns: `client/src/pages/models/LockedLinesPerCost.tsx` (locked card), `client/src/pages/projects/Projects.tsx` (shim pattern), `client/src/pages/dashboard/StatCardsRow.tsx` (stats row), `client/src/pages/dashboard/SavingsDecomposition.tsx` (split-bar panel)
