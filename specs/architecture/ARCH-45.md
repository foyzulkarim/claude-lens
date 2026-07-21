# Architecture: #P4-13 — Premium tier: C/B/L parsers + upgrades

> **Date:** 2026-07-21
> **Phase:** 2 of 5 (System Architecture) — **audit / close-out variant**
> **Requirements source:** `specs/context/45.md` (GitHub issue #45)
> **Type:** feature
> **Status:** Already implemented in PR #108 (`claude/phase-4-issues-priority-tkj794`, squash-merged). This document records the shipped footprint and verifies coverage against the issue's acceptance criteria.

## Architecture Summary

Three premium capture files (C = `<uuid>.cost.jsonl`, B = `<uuid>.turn-boundaries.jsonl`, L = `cost-log.jsonl`) are discovered alongside transcripts, parsed defensively (malformed → counter, never throw), reconciled into per-call / per-turn / per-session observed annotations on copies of transcript-derived structures, and exposed through `TierFlags` so the 🟡 estimated → 🟢 observed flip propagates uniformly to Session Detail (`specs/claude-lens-pages.md §3`), Sessions (`specs/claude-lens-pages.md §2`), Turn Inspector (`specs/claude-lens-pages.md §4`), Models (`specs/claude-lens-pages.md §6`), and Cache Lab (`specs/claude-lens-pages.md §7`). Storybook carries the fleet-aggregate upgrade states the Cypress double-run can't deterministically reproduce.

## High-Level Structure

```
┌──────────────────────────────────────────────────────────────────────┐
│ Discovery (server/ingest/discovery.ts)                               │
│   transcript | cost (C) | turn-boundaries (B) | cost-log (L)         │
│                                                       ▲              │
│                                                       │ ~ claudeDir  │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Parsers (server/ingest/parse-premium.ts)                             │
│   parseCostSampleLines / parseTurnBoundaryLines / parseCostLogLines  │
│   ↳ malformed counted, never thrown                                  │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Reconciliation (server/store/reconcile-premium.ts)                   │
│   A1-A7: timestamp attribution · per-field aggregation ·            │
│   C-wins-over-L · turn wallMs upgrade from B                         │
│   ↳ zero-cost early return when no C/B/L (transcript-only path)      │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Store (server/store/store.ts)                                        │
│   deriveTurns → reconcilePremium → deriveSession → TierFlags          │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                ┌─────────────────┼─────────────────┐
                ▼                 ▼                 ▼
        Projectors         Contracts             UI
   session-detail       shared/types.ts        TierBadge
   turn-inspector       TierFlags:123          LockedCard
   metrics/measures     sessions-contract      CaptureBanner
                        globalCapture          PremiumTierUpgrades (stories)
```

## Tech Choices

| Area              | Decision                              | Rationale                                              |
|-------------------|---------------------------------------|--------------------------------------------------------|
| Parser style      | Pure functions, JSONL line-by-line    | Matches `parse-transcript.ts`; testable without I/O    |
| Reconciliation    | Pure: input structures → annotated copies | Store orchestrates; module is side-effect-free      |
| Attribution key   | `timestamp` (not `turn`/`epoch` index) | A1 — every C line carries `timestamp`; variant-agnostic |
| Field aggregation | SUM cost/lines · MAX apiMs · LAST ctx% | A2 — matches per-field semantics                  |
| Turn wall time    | B boundary span when main-chain       | A3 — Stop-hook fires on main thread only             |
| C vs L            | C wins when both present              | L is session-total only; C carries per-sample signal  |
| Storage shape     | In-memory columnar (existing)         | Per the architecture doc §5                            |

## Patterns & Conventions

- **Defensive coercion** — `toStr` / `toNum` / `toOptionalNum` mirror `parse-transcript.ts`; required strings yield `""`, numbers yield `0`.
- **Malformed counting, never throwing** — shared with transcript parser; counters surface on Data Health (#P4-14).
- **Pure reconciliation** — `reconcilePremium` reads no store state; the store is the sole caller. Matches the project's "derived state in pure functions, store orchestrates" idiom.
- **`specs/claude-lens-architecture.md §4` tier semantics** — 🟢 observed / 🟡 estimated / 🔴 unavailable. The reconciliation produces `*Observed` fields rather than mutating base types, so the tier status is a derived predicate (`costObserved !== undefined`) rather than a stored flag.

## Data Models

### `CostSample` (server/ingest/parse-premium.ts:28)

**Purpose:** One parsed line of `<uuid>.cost.jsonl`. Carries observed per-call deltas.

| Field                 | Type    | Notes                                                |
|-----------------------|---------|------------------------------------------------------|
| sessionId             | string  | Partition key; missing/empty → malformed             |
| timestamp             | string  | Reconciliation key (A1)                              |
| costDeltaUsd          | number  | Σ for session/turn rollup                             |
| cumulativeCostUsd     | number  | Carried but not used for attribution (per A1)        |
| apiDurationMs         | number  | MAX per call (A2)                                    |
| contextPct            | number  | LAST per call (A2)                                   |
| linesAdded/Removed    | number  | Σ per call (A2)                                      |
| cacheRead/WriteTokens | number  | Reserved for future premium tier, currently passthrough |
| turn?                 | number  | Turn-indexed variant only                             |
| epoch? / sample?      | number  | Epoch-indexed variant only (mutually exclusive with `turn`) |

### `TurnBoundary` (server/ingest/parse-premium.ts:50)

| Field         | Type   | Notes                                        |
|---------------|--------|----------------------------------------------|
| sessionId     | string | Partition key                                |
| transcriptPath| string | Carried for cross-validation; not yet asserted |
| turnEnd       | string | Wall-time end marker                         |
| turnEndEpoch  | number | Numeric form; convenience for sorting       |

### `CostLogRow` (server/ingest/parse-premium.ts:66)

**Purpose:** One row of `cost-log.jsonl` — per-session totals.

| Field           | Type   | Notes                                                              |
|-----------------|--------|--------------------------------------------------------------------|
| sessionId       | string | Partition key                                                      |
| costUsd         | number | Session total (vs `costDeltaUsd`/`cumulativeCostUsd` in C)          |
| durationMs      | number | Session wall (vs `apiDurationMs` in C)                             |
| cacheRead/Write | number | Field-name differs from C (`cache_read` vs `cache_read_tokens`)    |
| contextPct      | number | Source percent; divided by 100 in `clampFraction` for the rollup   |

### `TierFlags` (shared/types.ts:123)

Carries the per-session upgrade state surfaced through every contract. Reconciler populates the `*Observed` fields; the tier predicate is derived (🟢 if any `costObserved` is set; 🟡 otherwise; 🔴 unavailable when data missing).

## API Contracts / Interfaces

### `parseCostSampleLines(rawLines) → { samples, malformedCount }`
### `parseTurnBoundaryLines(rawLines) → { boundaries, malformedCount }`
### `parseCostLogLines(rawLines) → { rows, malformedCount }`

**Boundary:** library API. Called from `server/store/store.ts` after the discovery layer hands over file contents.

**Errors:** none thrown. Malformed lines increment counters; valid records with empty `sessionId` are also counted as malformed (per `parsePremiumLine`).

### `reconcilePremium(calls, turns, input) → ReconcileResult`

**Boundary:** library API. Pure. Called from `server/store/store.ts` between `deriveTurns` and `deriveSession`.

**Returns:** annotated copies of `calls` / `turns` plus `PremiumRollup`. Returns the original `calls` / `turns` references (no copy) when no C/B/L is present — keeps the transcript-only path zero-cost.

### Tier surface (shared contracts)

- `shared/session-detail-contract.ts:87` — `tier: TierFlags`
- `shared/sessions-contract.ts:212` — per-session `tier: TierFlags`
- `shared/sessions-contract.ts:252` — `globalCapture: TierFlags` (OR-aggregate across the unfiltered file set)

## Module Boundaries

| Module                                      | Responsibility                                                        |
|---------------------------------------------|-----------------------------------------------------------------------|
| `server/ingest/parse-premium.ts`            | JSONL → typed records + malformed counters                            |
| `server/store/reconcile-premium.ts`         | Pure annotation of transcript-derived structures                      |
| `server/store/store.ts`                     | Orchestrates parse → reconcile → derive (sole `reconcilePremium` caller) |
| `server/ingest/discovery.ts`                | Locates C/B/L files (already shipped in #P2-3, unchanged here)        |
| `server/routes/sessions.ts`                 | Sessions page API (`specs/claude-lens-pages.md §2`)                   |
| `server/session-detail/*`                   | Session Detail page (`specs/claude-lens-pages.md §3`)                 |
| `server/turn-inspector/*`                   | Turn Inspector page (`specs/claude-lens-pages.md §4`)                 |
| `server/metrics/*`                          | Models (`specs/claude-lens-pages.md §6`) and Cache Lab (`specs/claude-lens-pages.md §7`) |
| `client/src/components/TierBadge*`          | Render tier (🟢/🟡/🔴)                                                  |

## Change Footprint

_This work is already shipped (PR #108). The footprint below is the record of what landed._

### New implementation / UI files

| Path | Purpose |
|---|---|
| `server/ingest/parse-premium.ts` | C/B/L parsers |
| `server/store/reconcile-premium.ts` | Pure reconciliation (A1–A7) |
| `client/src/pages/PremiumTierUpgrades.stories.tsx` | Fleet-aggregate upgrade states |

### Modified implementation / UI files

| Path | What changed |
|---|---|
| `shared/types.ts` | Added `TierFlags` and `*Observed` fields on `ApiCall` / `Turn` / `Session` |
| `shared/cache-lab-contract.ts` | Exposes premium context-growth contract fields |
| `shared/session-detail-contract.ts` | Exposes tier and observed Session Detail fields |
| `shared/turn-inspector-contract.ts` | Exposes observed waterfall fields |
| `server/cache/analysis.ts` | Threads observed values into Cache Lab analysis |
| `server/metrics/measures.ts` | Routes `apiMs` through Models latency/throughput |
| `server/routes/sessions.ts` | Exposes observed session fields and global capture metadata |
| `server/session-detail/projector.ts` | Reads observed fields for Session Detail |
| `server/store/derive-session.ts` | Builds `TierFlags` from the reconciled rollup |
| `server/store/store.ts` | Wires premium sidecars and `reconcilePremium` into recompute |
| `server/turn-inspector/projector.ts` | Reads observed fields for the waterfall |
| `server/ingest/pipeline.ts` | Reads and applies premium sidecars during ingest |
| `client/src/pages/cache-lab/ContextGrowthPanel.tsx` | Renders premium context-growth curves |
| `client/src/pages/models/LatencyByModel.tsx` | Renders premium latency values |
| `client/src/pages/models/ThroughputByModel.tsx` | Renders premium throughput values |
| `client/src/pages/models/useModelsQueries.ts` | Queries model latency/throughput measures |
| `client/src/pages/session-detail/Header.tsx` | Reflects `costObserved` / `contextPctObserved` |
| `client/src/pages/session-detail/SessionDetail.stories.tsx` | Covers premium Session Detail states |
| `client/src/pages/session-detail/TurnsSection.tsx` | Renders observed turn timing and line deltas |
| `client/src/pages/session-detail/format.ts` | Formats observed line deltas |
| `client/src/pages/sessions/SessionBrowser.tsx` | Renders observed session line deltas |
| `client/src/pages/turn-inspector/Waterfall.tsx` | Uses observed API durations for widths |

### Test coverage

| Path | Coverage added or changed |
|---|---|
| `server/ingest/parse-premium.test.ts` | Parser unit tests |
| `server/ingest/premium-fixtures.test.ts` | Premium fixture integration tests |
| `server/ingest/pipeline.test.ts` | Premium ingest wiring |
| `server/store/reconcile-premium.test.ts` | Reconciliation unit tests |
| `server/store/store.test.ts` | Sidecar store behavior |
| `server/cache/analysis.test.ts` | Cache Lab premium analysis |
| `server/metrics/measures.test.ts` | Models latency/throughput measures |
| `server/session-detail/projector.test.ts` | Session Detail observed fields |
| `server/turn-inspector/projector.test.ts` | Waterfall observed fields |
| `cypress/e2e/premium-tier.cy.ts` | T-only and premium double-run upgrade harness |
| `scripts/e2e.ts` | Isolated fixture runs for the Cypress harness |

### Test fixtures

| Path | Purpose |
|---|---|
| `test/fixtures-premium/cost-log.jsonl` | Premium L session-total fixture |
| `test/fixtures-premium/projects/-Users-demo-project-alpha/11111111-1111-4111-8111-111111111111.cost.jsonl` | Premium C fixture for the first session |
| `test/fixtures-premium/projects/-Users-demo-project-alpha/11111111-1111-4111-8111-111111111111.turn-boundaries.jsonl` | Premium B fixture for the first session |
| `test/fixtures-premium/projects/-Users-demo-project-alpha/44444444-4444-4444-8444-444444444444.cost.jsonl` | Premium C fixture for the second session |
| `test/fixtures-premium/projects/-Users-demo-project-alpha/44444444-4444-4444-8444-444444444444.turn-boundaries.jsonl` | Premium B fixture for the second session |
| `test/fixtures/README.md` | Documents the premium fixture overlay |

### Audit / provenance records

| Path | Purpose |
|---|---|
| `specs/architecture/ARCH-45.md` | Shipped architecture audit record |
| `specs/context/45.md` | Start-task provenance and acceptance contract |

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|---|---|
| `server/ingest/parse-transcript.ts` | The reconciliation layer assumes its derived `ApiCall` / `Turn` shapes — any future shape change ripples here |
| `server/ingest/discovery.ts` | `cost-log.jsonl` lives at `claudeDir` not the projects root — a future config change that drops the `claudeDir` link breaks L silently |

## Areas of Impact

| Area                                | Impact                                                       | Risk | Why                                                          |
|-------------------------------------|--------------------------------------------------------------|------|--------------------------------------------------------------|
| Data Health (#P4-14)                | Surface per-file `malformedCount` from the three parsers     | L    | Counters are returned but not yet surfaced in any route — follow-up #46 |
| Models / Cache Lab                  | Aggregate tier only flips when *every* shown session is premium | M | Storybook covers; real-data fallback relies on data shape |
| Drift detection on Session Detail   | `client/src/pages/dashboard/AnomalyFeed.stories.tsx` covers the visual state | L    | Drift source is reconciliation-driven; reviewed in `reconcile-premium.ts` |
| Existing Tier badge consumers       | `costTierLevel` maps `TierFlags` → "exact" / "estimated"     | L    | Two-tier mapping is intentional; "locked" not derivable from flags |

**Contract changes:** none to external API shape — `TierFlags` was added to existing per-session payloads. The `globalCapture` aggregate is additive.

**Cross-cutting ripples:**
- `npm run verify` passes; 12 lint warnings remain on `samples[0]!` non-null assertions in `parse-premium.test.ts` (style-only, inherited from PR #108).
- The reconciler adds per-session work proportional to `costSamples.length` × `calls.length` — for the realistic fleet size (C files small), this is negligible.

## Cross-Cutting Concerns

- **Errors:** none thrown by parsers or reconciler; malformed and missing-session-id lines are counted. The store path remains "no exceptions from ingest."
- **Logging & metrics:** the per-file `malformedCount` is the only emitted signal; surfaces on Data Health (#P4-14).
- **Auth / authz:** none — all local file reads, no network.
- **Performance:** the hot path (transcript-only) is zero-cost via the `if (!hasC && !hasB && !hasL)` early return. C reconciliation is `O(samples × calls)` per session in the worst case; bounded by session size in practice.
- **Security:** no PII amplification — fields already in transcripts (model, tokens, cost) are surfaced more precisely, not widened.
- **Migrations / rollout:** no schema migration needed; in-memory store shape only.

## Architecture Decisions Log

| #  | Decision                                              | Alternatives                       | Chosen Because                                           | Satisfies |
|----|-------------------------------------------------------|------------------------------------|----------------------------------------------------------|-----------|
| A1 | Timestamp-based attribution (not `turn`/`epoch` index)| Index-keyed join                   | Every C line carries `timestamp`; one rule for both variants | Issue §"every 🟡 upgrade path" |
| A2 | Per-field aggregation (SUM / MAX / LAST)              | Whole-record merge                 | Field semantics differ (cost additive, apiMs max, ctx% latest) | Issue §observed $ / waterfall widths / true ctx % |
| A3 | C wins over L when both present                       | Union / prefer L's session total  | C has per-sample resolution; L is session-only rollup    | Issue scope §C/B/L parsing    |
| A4 | B boundaries upgrade `wallMs` only on main-chain turns| All turns                          | Stop-hook fires on main thread, not sub-agents           | Issue §intra-day resolution  |
| A5 | Pure `reconcilePremium`, store orchestrates           | Reconciler reads store             | Easier to test, matches project idiom                    | Issue §tier detection wiring |
| A6 | `*Observed` fields on copies, not mutating base types | Mutate in place                    | Lets 🟡 / 🟢 coexist in derived views; tier is a predicate | Issue scope                  |
| A7 | Fleet-aggregate upgrade states via Storybook          | Extend Cypress with another pass  | Fleet panels only flip when *every* shown session is premium; mixed fleet can't reproduce deterministically | Acceptance §Storybook stories |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario                                                                  | How the Design Handles It                                            |
|---------------------------------------------------------------------------|----------------------------------------------------------------------|
| `cost-log.jsonl` corrupted (every line malformed)                         | `malformedCount` increments; L's `costLogRow` stays undefined → C wins if present, otherwise session rollup stays empty |
| `<uuid>.cost.jsonl` has 10× more samples than calls                       | `accByCall` still converges via the timestamp-walk; O(samples × calls) is bounded by the per-session sample count |
| `cost.jsonl` timestamp earlier than every transcript call                 | `callIdx = -1` falls through to `sortedCalls[0]`; samples still roll up at session level |
| A session has C but no transcript (orphaned sidecar)                      | `sortedCalls` is empty; `if (!target) continue` skips per-call attribution; session rollup still accumulates from the samples |
| `turn-boundaries.jsonl` has more entries than main-chain turns            | `boundaries.find(...)` returns the first at-or-after the turn's last call; extra entries are silently ignored |
| Transcript-only session mixed with premium sessions in the same fixture   | `reconcilePremium` returns the original arrays for the transcript-only session; `TierFlags` is 🟡; `globalCapture` reflects any |
| `Cypress.env("premium")` removed (e.g. e2e script change)                 | `isPremium === false` everywhere; spec still passes as the T-only half — silent regression possible if the script drops the env flag entirely (mitigated by `cypress/scripts/e2e.ts` review) |

### Backward — regression risk per touched area

| Touched area                           | What could regress                                                  | How we'd know                                              |
|----------------------------------------|---------------------------------------------------------------------|------------------------------------------------------------|
| `server/store/store.ts` ordering       | Forgetting `reconcilePremium` between `deriveTurns` and `deriveSession` | Tier badge stays 🟡 across the fleet under premium fixtures (E2E catches it) |
| `reconcilePremium` zero-cost early-out | Returning a fresh `{ calls, turns, session: {} }` instead of original refs | Transcript-only path copies arrays unnecessarily; perf test |
| `TierFlags` shape change               | A new field added without a default                                  | Storybook `FromTierFlags` story would no longer compile; typecheck |
| `cost-tier-level` mapping              | A future "locked" tier added but mapping not updated                 | `TierBadge.stories.tsx` would not cover the new state     |

## Open Questions

- **Lint warnings** — 12 `noNonNullAssertion` in `parse-premium.test.ts` are test-only style debt. **TODO:** keep this non-blocking for now: Biome's auto-fix would weaken the assertions by converting `samples[0]!` to `samples[0]?.x`, which Vitest treats as undefined-allowed. Leave the assertions intact for a deliberate follow-up.
- **`transcriptPath` on `TurnBoundary`** — carried but not asserted anywhere; safe to drop if no future cross-validation work is planned.
- **`cacheReadTokens` / `cacheWriteTokens` on `CostSample`** — passthrough; no consumer yet. Suggested default: keep — they're a tier-3 upgrade hook.

## Out of Scope

- Surfacing `malformedCount` on Data Health (#P4-14, the unblocking follow-up).
- New file types beyond C/B/L — the parsers are explicitly named to those three.
- Network / cloud ingestion — all parsing is local.

---

# Tasks

_This section is populated by the **generate-tasks** skill (Phase 3)._
_Run: `/generate-tasks from: specs/architecture/ARCH-45.md`_

## Cross-references

- Requirements and task provenance: [`specs/context/45.md`](../context/45.md) for GitHub issue #45 / #P4-13.
- Owning plan task: [`specs/claude-lens-plan.md`](../claude-lens-plan.md) `#P4-13`.
- Tier semantics and the C/B/L input contract: [`specs/claude-lens-architecture.md`](../claude-lens-architecture.md) §4.
- Binding page tables: [`specs/claude-lens-pages.md`](../claude-lens-pages.md) §§2–7.
