# Review Report

## Metadata

| Field | Value |
|-------|-------|
| **Review Mode** | PR #109 |
| **Target** | https://github.com/foyzulkarim/claude-lens/pull/109 — `feat(45): Premium tier C/B/L parsers + observed-value upgrades (#P4-13)` |
| **Branch** | `feature/45/premium-tier-cbl-parser` → `main` |
| **Date** | 2026-07-21 |
| **Tech Stack** | TypeScript (strict), Fastify, React + wouter + TanStack Query, Vitest, Cypress, Storybook, Biome |
| **Checks Run** | code-quality, test-coverage, typescript-strictness, error-handling, performance, react-patterns, async-patterns, config-dependencies, runtime-behavior, documentation, security |
| **Checks Skipped** | task-completion (general PR mode), accessibility, database-patterns (no DB), express-patterns (V2 is Fastify), migration (purely additive) |
| **Files Changed** | 44 |
| **Lines Changed** | +2415 / −119 |
| **Commits** | `da6aece feat(45): parse premium C/B/L capture files and flip 🟡→🟢 upgrades`<br>`5c8f0a9 test(45): premium C/B/L fixtures, e2e double-run harness, tier stories`<br>`e276420 docs(45): audit record + start-task provenance` |

## Review Process

- [x] Preflight checks passed (`git rev-parse`, `gh auth status`, default branch detected: `main`)
- [x] Diff gathered (44 files, +2415 / −119, 3340 lines of diff)
- [x] Tech stack detected: TypeScript strict, Fastify, React+wouter+TanStack Query, Vitest, Cypress, Storybook, Biome
- [x] Context read (CLAUDE.md, PR body, commits)
- [x] Triage proposed and developer confirmed (11 checks run, 5 skipped)
- [x] 11 checks dispatched: code-quality, test-coverage, typescript-strictness, error-handling, performance, react-patterns, async-patterns, config-dependencies, runtime-behavior, documentation, security
- [x] Results collected and deduplicated
- [x] Report compiled
- [x] Verdict determined

## Verdict: ❌ FAIL

The parsers and reconciler are implemented cleanly for documented happy paths, and test coverage of the upgrade mechanism itself is strong (1522 tests passing). However, the PR ships with **one Critical gap that contradicts its own acceptance criterion**: `malformedCount` is produced by `parse-premium.ts` and then **discarded at the pipeline boundary** (`server/ingest/pipeline.ts:99-105`), never reaching a store contract, never surfacing through `/api/*`, with the Data Health page still a `PageStub`. ARCH-45 and the PR body both call out this work as the **gating dependency for #P4-14** ("Data Health surfacing of `malformedCount`") — without surfacing the count, that gate is unmet. In addition, two High-severity contract violations in the reconciler (D3 call-span fallback is not implemented; cross-session ID validation is missing) silently leak observed values into the wrong session or leave `wallMs` undefined when the documented fallback should have populated it. The PR cannot merge until the Critical finding is addressed; the two High contract bugs should also be fixed to keep the documented invariant set intact. Performance, security, and doc findings are detailed below for the next pass.

### Finding Counts

| Category | 🔴 | 🟠 | 🟡 | 💭 | ⚠️ |
|----------|-----|-----|-----|-----|-----|
| code-quality | 0 | 1 | 5 | 5 | 0 |
| test-coverage | 0 | 3 | 7 | 4 | 0 |
| typescript-strictness | 0 | 0 | 0 | 1 | 0 |
| error-handling | **1** | 2 | 2 | 0 | 0 |
| performance | 0 | 2 | 4 | 1 | 0 |
| react-patterns | 0 | 0 | 0 | 4 | 1 |
| async-patterns | 0 | 0 | 1 | 3 | 0 |
| config-dependencies | 0 | 0 | 0 | 0 | 0 |
| runtime-behavior | 0 | 1 | 4 | 0 | 0 |
| documentation | 0 | 0 | 5 | 2 | 0 |
| security | 0 | 1 | 2 | 2 | 0 |
| **Total** | **1** | **10** | **30** | **22** | **1** |

(Cross-check findings are deduplicated — e.g. `applyCostLog` storm is counted once at its primary source.)

---

## Critical Findings

### 🔴 E1 — `malformedCount` is dropped at the pipeline boundary

**Source:** error-handling #1 (verified independently by direct file read)
**Files:** `server/ingest/pipeline.ts:99-105`, `client/src/pages/DataHealth.tsx:1-4`, `server/routes/sessions.ts:533`

The parser correctly populates `malformedCount` in each `ParseCostSamplesResult` / `ParseTurnBoundariesResult` / `ParseCostLogResult`. `readPremiumFile` then forwards only `.samples` / `.boundaries` / `.rows`:

```ts
// server/ingest/pipeline.ts:99-105
if (file.class === "cost") {
  if (!file.sessionId) return;
  store.applyCostSamples(file.sessionId, parseCostSampleLines(lines).samples);  // .malformedCount discarded
} else if (file.class === "turn-boundaries") {
  if (!file.sessionId) return;
  store.applyTurnBoundaries(file.sessionId, parseTurnBoundaryLines(lines).boundaries);  // .malformedCount discarded
} else if (file.class === "cost-log") {
  store.applyCostLog(parseCostLogLines(lines).rows);  // .malformedCount discarded
}
```

`Store` has no `malformedCount` state field, no health API endpoint exists (`server/routes/sessions.ts:533` carries the comment "GET `/api/health` is #P4-14's job, not built yet"), and `client/src/pages/DataHealth.tsx` is a `PageStub`:

```tsx
// client/src/pages/DataHealth.tsx:1-4
import { PageStub } from "./PageStub.js";
export function DataHealth() {
  return <PageStub title="Data Health" />;
}
```

**Why this is Critical:** the PR body and `ARCH-45.md` both explicitly state this work **gates #P4-14** — "Premium capture files are the only source for observed $, intra-day wall resolution, true context-window %, waterfall widths from `api_duration_ms`, and Δlines/api-vs-wall columns. The plan task #P4-13 was the gate to unlocking #P4-14 (Data Health surfacing of the parsers' `malformedCount`)." Without a path from parser → store → API → Data Health, the gate is unmet; the same parser-strictness guarantee that the architecture §5 ingest pipeline promises for the main transcript parser (`malformedCount` *does* flow into `server/ingest/warm-cache.ts` → `entry.malformedCount`) is **not** delivered here.

**Must-fix scope:**
1. `readPremiumFile` must thread the per-file counts into store state (e.g. `applyCostSamples(sessionId, samples, { malformedCount, filePath })`), or accumulate them in a per-session/per-file map.
2. Add a `HealthContract` in `shared/` exposing aggregate and per-file counts.
3. Add a `/api/health` route and wire `DataHealth.tsx` to it.
4. Add an end-to-end pipeline test that parses a C file with one malformed + one valid line and asserts the count surfaces.

---

## High Findings

### 🟠 H1 — `readPremiumFile` reads whole file with no byte cap or streaming

**Source:** security #1 + performance #1
**File:** `server/ingest/parse-premium.ts:97` and `server/ingest/pipeline.ts:90-97`

`readFile(file.path, "utf8")` materializes the entire premium file in memory, then `content.split("\n")` allocates a separate JS string per line. For a hypothetical 100 MB `~/.claude/cost-log.jsonl` (≈1 M rows), each `onFileChanged` allocates ~100 MB string + 1 M-element string array + ~1 M `CostLogRow` objects held simultaneously. Two compounding concerns:

- **Security:** multi-GB attacker-controlled file OOMs the desktop app process (a hostile capture-file generator or any `--roots`-mounted directory could write a multi-GB file).
- **Performance:** ~300 MB transient heap per change vs. < 1 MB with streaming.

**Fix:** `fs.stat` + per-class byte cap (5 MB for C/B, 50 MB for L is generous per `security` review), or stream via `readline.createInterface` over `createReadStream` with early-terminate on cap.

### 🟠 H2 — `applyCostLog` immediate-session-added flood + N-fan-out

**Source:** performance #2 + async-patterns #1 + security #2
**File:** `server/store/store.ts:295-302`

For each row in `cost-log.jsonl`, `stateFor(row.sessionId)` invokes `invalidator.markAdded(sessionId)`, which fires `session-added` immediately with no debounce (`server/store/invalidation.ts:65`). On cold-boot of a 10 k-session L file: **10 k immediate WS broadcasts + 10 k debounced recomputes** 300 ms later. With 100 client tabs, that is 1 M socket sends for one file change. Additionally, `row.sessionId` is attacker-controlled and unbounded (no length cap, no UUID format check) — `security #2` notes one row with a 1 MB `session_id` would broadcast a 1 MB+ WS frame to every connected client (memory + amplification DoS).

**Fix (two parts):** (a) batch `markAdded` calls into a single aggregate WS notification (or coalesce via `queueMicrotask`), or guard with `if (state.wasJustCreated)` so brand-new sessions created by this same `applyCostLog` call suppress WS emissions; (b) cap `sessionId` length in `parse-premium.ts`'s `toStr` to mirror `LOCAL_STORE_STRING_MAX = 200`.

### 🟠 H3 — `reconcilePremium` is a 165-LOC mega-function owning five phases

**Source:** code-quality #1
**File:** `server/store/reconcile-premium.ts:76-245`

Argument validation / fast-path, per-call C attribution, annotated-call-copy synthesis, turn annotation (with four sub-concerns: call rewire, observed rollup, observed `wallMs`, `gateStatus` copy), and session rollup — all in one function. Phases are not separable into named helpers. Five conceptually distinct phases interleaved in 165 LOC.

**Fix:** extract `attributeSamplesToCalls`, `annotateCalls`, `annotateTurns`, `rollupSession`. `reconcilePremium` becomes ~15 LOC of dispatch; each helper gets single-purpose JSDoc.

### 🟠 H4 — O(B × T) boundary lookup with redundant `parseMs`

**Source:** runtime-behavior #1 + performance #3
**File:** `server/store/reconcile-premium.ts:195-198`

```ts
boundaries.find((b) => {
  const bMs = parseMs(b.turnEnd);
  ...
})
```

Per turn: linear scan of all B boundaries + `parseMs(b.turnEnd)` re-parsed for every comparison. For T=100 turns and B=100 boundaries: 10 k iterations × 2 `Date.parse` calls ≈ 20 k ISO-8601 parses per recompute. Recompute fires every ~300 ms per dirty session. The C-attribution block (lines 92-132) already solves the same shape with a sorted-array + scanning pointer — this D3 path didn't pick up the same trick.

**Fix:** parse boundary timestamps once into `{ ms, boundary }[]`, then advance a single `bIdx` pointer across turns in chronological order (mirrors the C loop).

### 🟠 H5 — D3 call-span fallback not implemented

**Source:** error-handling #3
**File:** `server/store/reconcile-premium.ts:187-201`

The PR body and `reconcile-premium.ts` header both promise: *"D3 turn `wallMs` upgrades to B boundary span on main-chain turns; **degrades to call span**."* The implementation only enters the boundary logic when `hasB` is true, and if no valid boundary matches it leaves `Turn.wallMs` unchanged. Production `deriveTurns` does not populate `wallMs`, so a main-chain turn with valid C data but no B file (or an invalid/unmatched B boundary) returns `wallMs === undefined` instead of `Date.parse(endedAt) - Date.parse(startedAt)`. Contract violation.

**Fix:** compute the main-chain call span as the baseline, then replace it with the B boundary span only when a valid, matching boundary exists. Add tests for no B file, malformed boundary timestamps, and an unmatched boundary.

### 🟠 H6 — Cross-session ID validation gap

**Source:** error-handling #2
**File:** `server/ingest/parse-premium.ts:135-137`

The parser validates only that `sessionId` is non-empty. The pipeline applies every record from `A.cost.jsonl` to session A regardless of the record's `session_id` field. So a record with `session_id: "B"` inside `A.cost.jsonl` is silently accepted and contributes observed cost, API duration, lines, or boundary time to **A**. Same hole exists for B records; L rows are correctly routed by their own ID.

**Fix:** pass the expected filename session ID into the parser (or filter records before applying them); count mismatches as malformed and surface through the same health contract as E1.

### 🟠 T1 — `costLogRow`-only path leaves `wallMs`/`apiMs` undefined silently

**Source:** test-coverage #1
**File:** `server/store/reconcile-premium.test.ts:174-198`

The test "uses L per-session totals when only L is present" verifies `costObserved`, `linesAdded`, `contextPctObserved` from L, but does not pin that `wallMs`/`apiMs` stay `undefined` on the session. A future refactor that accidentally applies L's `durationMs` to `wallMs` would silently leak a fabricated value.

**Fix:** add `expect(s.wallMs).toBeUndefined()` + assert `hasCostSamples`/`hasCostBoundaries` stay false on the resulting turn.

### 🟠 T2 — Defensive coercion of `string wrong-type` not exercised

**Source:** test-coverage #2
**File:** `server/ingest/parse-premium.test.ts:78-89`

The "counts malformed lines" test covers blank / invalid-JSON / wrong-shape-objects / missing-required-string, but never a record where a numeric field is a string. `toNum` returns 0 for non-numbers — a deliberate coerce-not-drop decision documented at `parse-premium.ts:97-110`; if a future change tightened `toNum` to drop the line, that intent is lost.

**Fix:** add one C line with `cost_delta_usd: "0.42"` and assert the sample still appears with `costDeltaUsd === 0` and `malformedCount === 0`. Same for `session_id: 12345` (number, not string) — should yield `sessionId === ""` and be counted as malformed.

### 🟠 T3 — Cypress negative branches pass vacuously via substring matches

**Source:** test-coverage #3
**File:** `cypress/e2e/premium-tier.cy.ts:30-78`

Every `isPremium` branch asserts an *upgrade* (text "exists" / "not.exist"), but the spec never asserts the *exclusivity* of the asserted substrings. `cy.contains("+11/")` matches any visible `+11/` substring on the sessions page; on the T-only path a different session rendering `+11` anywhere in the DOM (e.g. an unrelated column) would still pass the negative branch.

**Fix:** scope each `+5/` / `+11/` assertion to a `data-testid` on the observed-Δlines cell, or add `isPremium ? "not.exist" : "exist"` assertions on an upgrade-bearing element (e.g. the drift row) that is exclusive to the premium tier.

---

## Medium Findings (deduplicated; see per-check sections for source)

### Server / reconciler

- **M1:** `reconcilePremium` per-call object spread + array allocations + redundant sorts on every recompute (runtime-behavior #2, #4, #5 + performance #4, #5, #6, #7). Concrete: `calls.map` allocates a fresh `ApiCall` for every call with any accumulator; `[...calls].sort()` and `[...input.costSamples].sort()` run unconditionally; `reconcilePremium` runs even on prompt-only invalidations. Fix: memoize on a per-session "premium revision" counter that bumps only inside `applyCostSamples`/`applyTurnBoundaries`/`applyCostLog`.
- **M2:** `aggregateGlobalCapture` computes `globalCapture.costBasis` from `hasCostSamples` only, ignoring `hasCostLog` (error-handling #5). An L-only session reports `tier.costBasis: "observed"` but the fleet-level session response still says `meta.globalCapture.costBasis: "computed"`. Fix: base the aggregate on `hasCostSamples || hasCostLog`.
- **M3:** Out-of-order concurrent reads can apply stale (error-handling #4). `trackPremium` launches independent whole-file reads per poll event; `inFlight` drains but does not preserve version order, so a slower older snapshot can overwrite a newer one. Fix: per-path promise chain or monotonic generation/mtime check.
- **M4:** L row `sessionId` (and other parser strings) unbounded (security #2 + #3). `toStr`/`toNum`/`toOptionalNum` accept raw strings with no length cap; downstream consumers (WS broadcasts, query keys, tag Map keys) carry these verbatim. Fix: mirror `LOCAL_STORE_STRING_MAX = 200` for string fields.
- **M5:** `localeCompare` sort tie instability for attribution (code-quality #3). `[...calls].sort()` and `[...input.costSamples].sort()` use `localeCompare` on ISO strings — when two calls share a timestamp, attribution is implementation-defined. Fix: ms-sorts + `uuid`/`sessionId` discriminator tie-break.
- **M6:** Sidecar-apply DRY in `store.ts` (code-quality #4). `applyCostSamples` / `applyTurnBoundaries` / `applyCostLog` are 5-line near-duplicates of the same `stateFor + sidecars.<flag> = true + markDirty` triple. Fix: collapse to one `applySidecar<K>` private helper.
- **M7:** Hidden-class megamorphism in `buildCostSample` (runtime-behavior #3). Base `CostSample` literal carries 10 fields, then `turn`/`epoch`/`sample` appended via separate `if` blocks (`parse-premium.ts:154-159`). Across a C file with both index variants, the hot loop produces 4-8 hidden classes. Fix: declare all three optionals at construction with `undefined` for absent.
- **M8:** `reconcile-premium.ts:147-151` builds `annotatedByOriginal` via a separate `forEach` after `calls.map` already iterated the same array (code-quality #2). Fix: move `annotatedByOriginal.set(call, next)` inside the map callback.
- **M9:** Unbounded parallel `trackPremium` reads in discovery (async-patterns #2). Wrap in a p-limit-style helper (e.g. 8 concurrent reads) when fleet scale demands.
- **M10:** Sync parser on event loop for multi-MB L files (async-patterns #3). Move to streaming `for await (const line of readline.createInterface(...))` only if real L volumes demand; today's scale is fine.

### Frontend / client

- **M11:** Silent observed/total mix in `LatencyByModel` + `ThroughputByModel` (code-quality #5). Per-row "observed" predicate `apiMs > 0` classifies a model as observed whenever the metrics engine returns any `apiMs` sum — but that sum is over observed-only calls while `apiCalls` is over all calls. For a mixed-coverage model, `secondsPerCall = observed-sum / total-calls` is neither observed nor total rate, yet the row reads as observed. **Correctness bug** — could justify promotion to 🟠 depending on product priority.
- **M12:** `SessionBrowser.tsx:138-143` reinvents `formatLineDelta` (code-quality #6 + react-patterns #1). Two renderers of the same `+A/−R` / `"—"` rule drift risk. Fix: import the helper from `session-detail/format.ts`.
- **M13:** `ContextGrowthPanel.tsx:25-28` `useMemo` evaluates both ternary branches (react-patterns #2). `data ? buildContextGrowthOption(data.curves) : buildContextGrowthOption([])` builds both on every memo hit. Fix: `data?.curves ?? []`.
- **M14:** `LatencyByModel`/`ThroughputByModel` `deriveResult` does O(N × M) `data.filter` inside a `for (const model of modelKeys)` loop (react-patterns #3). Fix: pre-bucket via `Map<model, Series[]>`.

### Test coverage gaps (Medium)

- **M15:** `parseCostLogLines` malformed path not unit-tested (test-coverage #4).
- **M16:** No empty-but-present C file fixture for "honest $0 observed" path (test-coverage #5; `store.ts:266-272` documents the behavior).
- **M17:** `costLogRow` sessionId-mismatch not pinned in reconciler test (test-coverage #6).
- **M18:** `applyTurnBoundaries` not unit-tested in `store.test.ts` (test-coverage #7).
- **M19:** `wallMs` clamping when `boundary.turnEnd < turn.startedAt` not pinned (test-coverage #8).
- **M20:** Client tier predicates (`costTierLevel`, `formatCostBasis`, `isPremiumUnavailable`) not unit-tested (test-coverage #9). Server `derive-session.test.ts:87-98` pins the predicate; client counterpart is the gap.
- **M21:** `PremiumPartial` Storybook story missing for empty-but-present C (test-coverage #10).
- **M22:** Per-panel isolation stories missing in `PremiumTierUpgrades.stories.tsx` (test-coverage #11).

### Documentation gaps

- **M23:** ARCH-45 references "CLAUDE.md §4 tier semantics" (line 70) but CLAUDE.md has no §4 — tier semantics live in `claude-lens-architecture.md` §4 (documentation #1). Fix: correct the cross-reference; add a back-link.
- **M24:** ARCH-45 uses two naming conventions for the same seven decisions: the diagram/table say "D1-D7", but `reconcile-premium.ts:11` only labels "D1-D3, D7" and the decisions log renumbers them A1-A7 (documentation #2). PR body says "D1-D7 documented inline" but inline comments don't carry D-labels — they're in the header block. Fix: pick one convention and reconcile everywhere.
- **M25:** ARCH-45 modified-files table is incomplete: lists 13 entries, the actual diff has ~35 (documentation #3). Fix: expand the table or move test files to a separate "Test coverage" subsection.
- **M26:** ARCH-45:198 mentions "AnomalyFeed stories cover the visual state" without naming the file (documentation #4). Fix: cite `client/src/pages/dashboard/AnomalyFeed.stories.tsx` explicitly.
- **M27:** ARCH-45 Architecture Summary and Module Boundaries mention pages by name without citing `claude-lens-pages.md` §2-§7 (documentation #5; CLAUDE.md says "page section tables are binding over the HTML mockups"). Fix: add inline page-spec cross-refs.

---

## Low Findings (selected; full list in per-check sections)

- `console.error` at `pipeline.ts:113` logs full `Error` object including absolute file path — privacy leak in shared log streams (security #4).
- `JSON.parse` at `parse-premium.ts:130` has no depth guard — CPU DoS via deeply nested JSON (security #5).
- `applyCostLog` overwrites prior row silently when L file carries multiple rows for the same session (`store.ts:298`) — staleness window.
- `parseCostSampleLines` / `parseTurnBoundaryLines` / `parseCostLogLines` are three near-identical 9-line loops (`parse-premium.ts:188-216`) — borderline-DRY.
- `formatLineDelta` returns `+5/−0` when `removed` is undefined — silent coerce-to-zero (format.ts:68-71).
- `SessionDetailField` union labels `header.contextPct` as `// premium-only` (`session-detail-contract.ts:31`) but `session-detail/projector.ts:720-725` adds this availability key for the estimated case too — comment/implementation drift.
- `ContextGrowthPanel.tsx:33-41` `typeof point.inputTokens === "number"` is dead defensive code on a non-optional `number` field.
- `TierBadge.tsx` keeps three parallel records (`DOT`, `VARIANT`, `LABEL`) — add a lock-step comment.
- `ContextGrowthPanel` `useMemo` evaluates both ternary branches (see M13).
- `LatencyByModel`/`ThroughputByModel` O(N × M) filter (see M14).
- Inline handlers in `SessionBrowser.tsx:251-256` recreated every render.
- `parse-premium.test.ts` carries the 12 inherited `noNonNullAssertion` warnings (typescript-strictness #1) — PR body count is accurate; Biome's auto-fix would weaken the assertions. Captured in ARCH-45 Open Questions. Non-blocking.
- `test/fixtures/README.md` doesn't cross-link existing fixture rows to the new premium overlay section.
- `markSidecarPresent` is now invoked only in tests — pipeline bypasses it; dead production path.
- `specs/context/45.md:13` says "State: OPEN" while ARCH-45 status line says the work is already merged — post-merge state mismatch (documentation #7).
- ARCH-45 Open Questions on lint warnings: 12 `samples[0]!` honestly counted but no follow-up issue link or "non-blocking" rationale documented.
- ARCH-45 doesn't cite `specs/claude-lens-data-model.md §7` for `TurnBoundary.transcriptPath` cross-tier collision table.
- Stale premium data after transcript reset (observations): `resetSession` clears `calls`/`prompts`/`toolResultBytes`/`compactions`/`turns`/`session` but retains `costSamples`/`turnBoundaries`/`costLogRow`. Combined with pipeline's no-op on premium-file removal, those arrays feed a now-empty session rollup forever. Bounded but worth a Data Health flag or wipe on transcript reset.
- Per-call memory delta of `*Observed`/`apiMs`/`linesAdded`/`linesRemoved` fields (~5 properties × 100 k calls ≈ 4 MB additional shape-tagged slots for fully-attributed sessions — not a regression but worth profiling under `--prof` if observed-call memory shows up).
- Test cleanup (`pipeline.test.ts:23-29`): `afterEach` calls `pipeline.stop()` then `rm`s the dir while in-flight IIFE may still be reading — errors swallowed by inner try, may produce one extra `[ingest] premium read failed` log line per leaked read.
- Dead defensive `.catch` at `pipeline.ts:113` is the documented belt-and-suspenders for `track()`'s contract — worth a comment so a future refactor doesn't tighten the inner try and quietly break the contract.

---

## Per-Check Sections

### code-quality (1 🟠 + 5 🟡 + 5 💭)

**Files reviewed:** 24 production files (1 new, 23 modified) listed in scope.

| # | Sev | File | Line | Issue |
|---|-----|------|------|-------|
| 1 | 🟠 | `server/store/reconcile-premium.ts` | 76-245 | 165-LOC mega-function owning five phases — extract `attributeSamplesToCalls` / `annotateCalls` / `annotateTurns` / `rollupSession`. |
| 2 | 🟡 | `server/store/reconcile-premium.ts` | 147-151 | `annotatedByOriginal` built by a separate `forEach` after `calls.map` — collapse into one pass. |
| 3 | 🟡 | `server/store/reconcile-premium.ts` | 92-95 | `localeCompare` sort tie is implementation-defined — switch to ms-sort + `uuid`/`sessionId` discriminator. |
| 4 | 🟡 | `server/store/store.ts` | 269-302 + 253-258 | `applyCostSamples` / `applyTurnBoundaries` / `applyCostLog` are 5-line near-duplicates — collapse to one `applySidecar<K>` helper. |
| 5 | 🟡 | `client/src/pages/models/LatencyByModel.tsx:70-77` + `ThroughputByModel.tsx:63-72` | Silent observed/total mix — see M11. |
| 6 | 🟡 | `client/src/pages/sessions/SessionBrowser.tsx:138-143` + `client/src/pages/session-detail/format.ts:68-71` | Reinvented `formatLineDelta` — see M12. |
| 7-11 | 💭 | Various | `parse-premium.ts:188-216` parse-loop DRY; `format.ts:68-71` `formatLineDelta` undefined-coerce; `session-detail-contract.ts:31` comment drift; `ContextGrowthPanel.tsx:33-41` dead `typeof`; `TierBadge.tsx:12-28` lock-step comment. |

**Coverage checklist:** all 24 in-scope files reviewed for naming, function sizes, types, error handling, DRY, layer boundaries, sort stability, availability-key comment discipline.

### test-coverage (3 🟠 + 7 🟡 + 4 💭)

**Files reviewed:** `server/ingest/parse-premium.test.ts`, `server/ingest/premium-fixtures.test.ts`, `server/store/reconcile-premium.test.ts`, `cypress/e2e/premium-tier.cy.ts`, `client/src/pages/PremiumTierUpgrades.stories.tsx`, `client/src/pages/session-detail/SessionDetail.stories.tsx`, all modified tests, fixtures, `scripts/e2e.ts`.

The three Highs (T1, T2, T3) are listed above. The seven Mediums (M15-M22) are listed above. The four Lows (#12-16 in the agent report) cover: structural-not-value C-wins test, 1111 fixture stronger assertion, mixed-fleet basis guard for `analysis.ts`, per-turn $1.50 anomaly preservation, and a Cypress drift-row assertion.

**Coverage checklist:**
- ✅ `parse-premium.test.ts` malformed-blank-JSON coverage; ⚠️ string-wrong-type numbers → T2; ⚠️ L malformed unit coverage → M15
- ✅ `premium-fixtures.test.ts` C+B / C-over-L / L-only / T-only control; ⚠️ empty C file → M16
- ✅ `reconcile-premium.test.ts` attribution / MAX/LAST/SUM / turn rollup / session rollup / wallMs / sidechain wallMs / L-only / C-wins-over-L / pre-first-call fallback / immutability; ⚠️ costLogRow sessionId mismatch → M17, wallMs negative-span clamp → M19, C-wins-structural-not-value → #12
- ✅ `cypress/premium-tier.cy.ts` every assertion has `isPremium` branch; ⚠️ banner exclusivity / substring match → T3, drift row assertion → #16
- ⚠️ `PremiumTierUpgrades.stories.tsx` per-panel isolation stories → M22
- ⚠️ `SessionDetail.stories.tsx` PremiumPartial story → M21
- ⚠️ `store.test.ts` applyTurnBoundaries unit → M18
- ✅ `session-detail/projector.test.ts`, `turn-inspector/projector.test.ts`, `cache/analysis.test.ts`, `metrics/measures.test.ts`, `pipeline.test.ts`
- ⚠️ `TierBadge.tsx` `costTierLevel` / `formatCostBasis` / `isPremiumUnavailable` client unit tests → M20

### typescript-strictness (1 💭, otherwise clean)

| # | Sev | File | Line | Issue |
|---|-----|------|------|-------|
| 1 | 💭 | `server/ingest/parse-premium.test.ts` | 48, 61, 74-75, 96-97, 113-114, 146-149 | 12 `noNonNullAssertion` lint warnings — PR body count is accurate and fully contained to this test file. Biome's auto-fix converts to `arr[0]?.x` which weakens the assertion contract. Captured in ARCH-45 Open Questions. |

**Coverage checklist:**
- ✅ `*Observed` fields truly optional in `shared/types.ts:89-93, 118-120, 153, 156-157, 170`
- ✅ `TierFlags.costBasis` (`shared/types.ts:127`) is closed union, properly exhaustive
- ✅ No new `as` casts; pre-existing casts in `server/routes/sessions.ts` and `server/cache/analysis.ts` all guarded
- ✅ Parser coercion trio (`toStr`/`toNum`/`toOptionalNum`) is the only type-boundary coercion
- ✅ `ReconcileResult` and `PremiumRollup` are typed interfaces (no `Partial<>`)
- ✅ Projector consumers gate with `if (x !== undefined)` before assignment

### error-handling (1 🔴 + 2 🟠 + 2 🟡)

**Files reviewed:** `server/ingest/pipeline.ts`, `server/store/reconcile-premium.ts`, `server/ingest/parse-premium.ts`, `server/store/store.ts`, `server/store/derive-session.ts`, `server/ingest/tailer.ts`, all corresponding tests.

| # | Sev | File | Line | Issue |
|---|-----|------|------|-------|
| 1 | 🔴 | `server/ingest/pipeline.ts` | 99-105 | `malformedCount` discarded at pipeline boundary; no Store contract, no API, DataHealth is a `PageStub` — see **E1**. |
| 2 | 🟠 | `server/ingest/parse-premium.ts` | 135-137 | Cross-session ID validation gap — see **H6**. |
| 3 | 🟠 | `server/store/reconcile-premium.ts` | 187-201 | D3 call-span fallback not implemented — see **H5**. |
| 4 | 🟡 | `server/ingest/pipeline.ts` | 111-113 | Out-of-order concurrent reads can apply stale — see **M3**. |
| 5 | 🟡 | `server/routes/sessions.ts` | 514-527 | `aggregateGlobalCapture` uses `hasCostSamples` only — see **M2**. |

**Coverage checklist:**
- ✅ Invalid JSON, non-object JSON, empty session IDs, blank lines, numeric coercion all reviewed; malformed structural lines counted, never thrown
- ⚠️ Parsers correctly count malformed; **discarded at boundary** — E1
- ✅ No `readFile` resource leak; tailer closes `FileHandle` in `finally`
- ⚠️ No malformed-line logging with file/line context; only `console.error` for store apply failures
- ⚠️ Removed/read-failed files retain prior observed state by design
- ✅ `parse-premium.test.ts` direct parser tests pass; ⚠️ no B/L malformed counter coverage, no wrong-session-id coverage, no oversized input coverage

### performance (2 🟠 + 5 🟡 + 2 💭, deduplicated)

| # | Sev | File | Line | Issue |
|---|-----|------|------|-------|
| 1 | 🟠 | `server/ingest/pipeline.ts` + `server/ingest/parse-premium.ts` | pipeline.ts:90-106 + parse-premium.ts:97 | Whole-file read / no streaming / no byte cap — see **H1**. |
| 2 | 🟠 | `server/store/store.ts` | 295-302 | `applyCostLog` N-fan-out — see **H2**. |
| 3 | 🟡 | `server/store/reconcile-premium.ts` | 195-198 | O(B × T) boundary find — folded into **H4**. |
| 4 | 🟡 | `server/store/reconcile-premium.ts` | 147-160 | Unconditional allocation for B-only — folded into **M1**. |
| 5 | 🟡 | `server/store/reconcile-premium.ts` | 90-95 | Two full-array sorts per recompute — folded into **M1**. |
| 6 | 🟡 | `server/store/reconcile-premium.ts` | 208-235 | Session rollup re-iterates `costSamples` — folded into **M1**. |
| 7 | 🟡 | `server/store/reconcile-premium.ts` | 122-131 | `parseMs` for every sample — folded into **M1**. |
| 8 | 💭 | `server/store/reconcile-premium.ts` | 147-151 | `annotatedByOriginal` Map uses original `ApiCall` ref as key — short-lived, no leak. |

**Coverage checklist:**
- ✅ Early-return when files absent; empty-file handling; small per-line allocation
- ⚠️ `reconcile-premium.ts` M1 cluster (see M1)
- ⚠️ `pipeline.ts` whole-file read — H1
- ⚠️ `store.ts` applyCostLog fan-out — H2
- ✅ `derive-session.ts`, projector files, `cache/analysis.ts`, `metrics/measures.ts` all thread observed fields without recomputation
- ✅ Fixtures confirmed (2 L rows, 4-9 C lines per file, 2-5 B lines per file)

### react-patterns (4 💭 + 1 ⚠️, otherwise clean)

**Files reviewed:** 12 client components in the diff.

| # | Sev | File | Line | Issue |
|---|-----|------|------|-------|
| 1 | 💭 | `client/src/pages/sessions/SessionBrowser.tsx` | 135-143 | Reinvented `formatLineDelta` — see M12. |
| 2 | 💭 | `client/src/pages/cache-lab/ContextGrowthPanel.tsx` | 25-28 | `useMemo` evaluates both ternary branches — see M13. |
| 3 | 💭 | `client/src/pages/models/LatencyByModel.tsx:62`, `ThroughputByModel.tsx:59` | O(N × M) inner filter — see M14. |
| 4 | ⚠️ | `client/src/pages/PremiumTierUpgrades.stories.tsx` | 96-106 | `withProviders` constructs a fresh `QueryClient` per `render()` — benign today (no `useQuery` in rendered panels); pre-empt with `useState(() => new QueryClient(...))` before a future contributor adds a `useQuery` to any panel. |
| 5 | 💭 | `client/src/pages/sessions/SessionBrowser.tsx` | 251-256 | Inline handlers recreated every render — revisit only if profiler flags. |

**Coverage checklist:**
- ✅ Hooks-rules / stale-closure audit across all modified components — clean
- ✅ WS subscription / refetch behavior on tier flip verified end-to-end
- ✅ Memoization discipline consistent
- ✅ ECharts wrapper bypassed correctly (project-mandated `Chart` component used)
- ✅ Tier correctly NOT in URL (server-derived, permalinks requirement preserved)
- ✅ Storybook deterministic (no `Math.random`/`Date.now()`)
- ✅ Key-prop audit clean (no `key={index}` anti-patterns)
- ✅ No SSR/hydration boundary issues (Vite SPA)

### async-patterns (1 🟡 + 4 💭)

| # | Sev | File | Line | Issue |
|---|-----|------|------|-------|
| 1 | 🟡 | `server/store/store.ts` | 295-302 | `applyCostLog` immediate-session-added flood — folded into H2. |
| 2 | 💭 | `server/ingest/pipeline.ts` | 117-135 | `trackPremium` no concurrency cap — see M9. |
| 3 | 💭 | `server/ingest/parse-premium.ts` | 188-216 | Sync parsers on event loop for multi-MB L — see M10. |
| 4 | 💭 | `server/ingest/pipeline.ts` | 89-114 | Dead defensive `.catch` at line 113 (intentional per `track()`'s contract) — see low-finding list. |
| 5 | 💭 | `server/ingest/pipeline.ts` | 174-188 | After `stop()`, in-flight reads can still mutate `state`; benign because `Invalidator.stop()` suppresses WS. |
| 6 | 💭 | `scripts/e2e.ts` | 444-457 | Pass 1 / Pass 2 sequential teardown verified correct. |
| 7 | 💭 | `server/ingest/pipeline.test.ts` | 23-29 | `afterEach` `rm` may race with in-flight IIFE — benign noise. |

**Coverage checklist:**
- ✅ `pipeline.ts` track() contract enforcement, readPremiumFile try/catch, drainInFlight loop, IIFE stop guard
- ✅ `store.ts` apply* sync writes, applyCostLog fan-out (flagged), `invalidate.stop()` no-op
- ✅ `parse-premium.ts` sync vs async decision
- ✅ Test async isolation, malformed lines never throw, no shared state
- ✅ `reconcile-premium.ts` sync purity
- ✅ `scripts/e2e.ts` sequential double-run teardown, port collision guard, fixture root isolation

### config-dependencies ✅ No findings

`package.json` / `package-lock.json` unchanged from main — PR claim of "no new deps" verified. New imports in diff map only to existing devDeps (`react`, `wouter`, `@tanstack/react-query`, `@storybook/react-vite`, `vitest`) or Node built-ins (`node:fs/promises`, `node:os`, `node:path`, `node:url`). No new `process.env.X` reads. `Cypress.env("premium")` is Cypress-runner state (set via `--env premium=true`), not a Node env var. `biome.json`, `tsconfig*.json`, `cypress.config.ts`, `vitest.config.ts`, `.github/workflows/`, `.nvmrc`, `engines` all unchanged. CLAUDE.md's "deps pinned by §2" constraint satisfied.

### runtime-behavior (1 🟠 + 4 🟡, observations bundled)

| # | Sev | File | Line | Issue |
|---|-----|------|------|-------|
| 1 | 🟠 | `server/store/reconcile-premium.ts` | 195 | O(B × T) boundary find — see **H4**. |
| 2 | 🟡 | `server/store/reconcile-premium.ts` | 139, 159-160 | Per-call object spread + new array per turn — see **M1**. |
| 3 | 🟡 | `server/ingest/parse-premium.ts` | 141-161 | Hidden-class megamorphism in `buildCostSample` — see **M7**. |
| 4 | 🟡 | `server/store/reconcile-premium.ts` | 92, 93, 155 | Two full-array sorts per recompute + idempotency cost — see **M1**. |
| 5 | 🟡 | `server/store/store.ts` | 359-365 | Reconcile re-runs on every prompt-only invalidation — see **M1**. |

**Observations:** stale premium data after transcript reset (worth Data Health flag or wipe on reset); per-call memory delta of 5 new fields (~4 MB / 100 k fully-attributed calls, not a regression); `applyCostLog` row fan-out (folded into H2); tailer partial-line behavior clean; no prototype-pollution risk found; no event-listener / timer / fs-handle leaks found.

### documentation (3 🟠 + 2 🟡 + 2 💭)

Wait — the documentation agent reported **3 High** + 2 Medium + 2 Low. I downgraded those to Medium above because they are doc-quality, not code-correctness issues. The 3 Highs from the doc agent are real and worth fixing before merge, but they don't meet the 🟠 bar in the severity scale (which is "Significant bug, major performance issue, auth/authz gap, type safety hole"). I'll keep them at Medium in the count and flag prominently in the report body.

| # | Sev | File | Line | Issue |
|---|-----|------|------|-------|
| 1 | 🟡 | `specs/architecture/ARCH-45.md` | 70 | References "CLAUDE.md §4 tier semantics" — CLAUDE.md has no §4; tier semantics live in `claude-lens-architecture.md` §4 — see **M23**. |
| 2 | 🟡 | `specs/architecture/ARCH-45.md` | 33, 160 | D1-D7 vs A1-A7 naming inconsistency — see **M24**. |
| 3 | 🟡 | `specs/architecture/ARCH-45.md` | 167-181 | Modified-files table lists 13 entries vs. ~35 actual — see **M25**. |
| 4 | 🟡 | `specs/architecture/ARCH-45.md` | 198 | AnomalyFeed stories file not named — see **M26**. |
| 5 | 🟡 | `specs/architecture/ARCH-45.md` | 11, 145-146 | Page-spec cross-refs to `claude-lens-pages.md` §2-§7 missing — see **M27**. |
| 6 | 💭 | `specs/architecture/ARCH-45.md` | 251-253 | Open Questions on lint warnings: no follow-up issue link, no "non-blocking" rationale. |
| 7 | 💭 | `specs/context/45.md` | 13 | "State: OPEN" but work is post-merge — add a "Last updated: post-merge audit" timestamp. |

**Observations:** `reconcile-premium.ts:4-29` header labels D1-D3, D7 but inline comments don't carry D-labels (source of the "D1-D7 documented inline" claim); `test/fixtures/README.md` doesn't cross-link existing rows to the new premium overlay section; ARCH-45 doesn't cite `specs/claude-lens-data-model.md §7` for `TurnBoundary.transcriptPath` cross-tier collision table.

**Coverage checklist:** D1-D7 coverage map (D4/D7 partially covered), hardcoded Cypress numbers, `costLogRow.sessionId` consumed silently by reconciler, `markSidecarPresent` is test-only seam.

### security (1 🟠 + 2 🟡 + 2 💭)

| # | Sev | File | Line | Issue |
|---|-----|------|------|-------|
| 1 | 🟠 | `server/ingest/pipeline.ts` | 90-97 | `readPremiumFile` no byte cap / whole-file read — see **H1**. |
| 2 | 🟡 | `server/store/store.ts` | 295-302 | L row `sessionId` unbounded string → Map key + WS broadcast — folded into **M4**. |
| 3 | 🟡 | `server/ingest/parse-premium.ts` | 100-110 | `toStr`/`toNum` no length cap — folded into **M4**. |
| 4 | 💭 | `server/ingest/pipeline.ts` | 113 | `console.error` logs full `Error` (incl. absolute path) — privacy leak. |
| 5 | 💭 | `server/ingest/parse-premium.ts` | 130 | `JSON.parse` no depth guard — CPU DoS via deeply nested JSON. |

**Observations:** No CORS middleware in `app.ts` (Fastify default behavior fine for SPA+Vite-proxy model); no auth on `/api/sessions/*` (per CLAUDE.md posture, single-user desktop app); prototype pollution clean (object literals only, no `Object.assign(_, parsed)`); `NaN` discipline correct; TierBadge XSS-clean.

---

## Manual Checks Required

- [ ] **(⚠️ React-patterns #4)** If anyone adds a `useQuery` to any panel rendered in `client/src/pages/PremiumTierUpgrades.stories.tsx`, pre-empt with `useState(() => new QueryClient(...))` to avoid client-churn flakiness.
- [ ] **(Stale premium data after transcript reset, runtime-behavior observation)** Decide whether `resetSession` should also wipe premium state (`costSamples`/`turnBoundaries`/`costLogRow`) or whether Data Health should flag a zero-call session with non-zero `costObserved`. Either is acceptable; document the choice.
- [ ] **(MarkSidecarPresent, code-quality observation)** Confirm whether the test-only seam is intentional or dead production code; if dead, document or delete.
- [ ] **(Per-call memory delta)** Profile a fully-attributed session under `--prof` to confirm the ~4 MB / 100 k calls estimate holds in V8.

---

## Prioritized Action Items

### Must Fix (🔴 Critical)

1. **E1 — thread `malformedCount` through to Data Health.** Required for the PR's own stated acceptance criterion ("the gate to unlocking #P4-14 Data Health surfacing of the parsers' `malformedCount`"). Until this ships, the PR is functionally incomplete.

### Should Fix (🟠 High)

2. **H1 — cap `readPremiumFile` byte size or stream.** Multi-GB attacker-controlled file is a realistic OOM DoS path; combined with performance #1 it is also the dominant GC pressure source.
3. **H5 — implement D3 call-span fallback.** Documented contract is "degrades to call span" but the code only writes `wallMs` when B matches. Contract violation.
4. **H6 — validate cross-session ID at parse/apply time.** A record with `session_id: "B"` inside `A.cost.jsonl` is silently applied to A. Same hole for B records; L is correctly routed.
5. **H2 — batch `applyCostLog` WS emissions + cap row `sessionId` length.** 10 k immediate WS broadcasts + 10 k debounced recomputes on cold-boot of a real L file is the dominant scaling cliff; unbounded `sessionId` is a one-row broadcast DoS.
6. **H3 — split `reconcilePremium` into named helpers.** 165 LOC across five phases — single function owning multiple concerns.
7. **H4 — fix O(B × T) boundary find + redundant `parseMs`.** Mirrors the sorted-array scanning pointer pattern already used in the C-attribution block.
8. **T1 — pin `wallMs`/`apiMs` undefined in L-only path.** Test gap that lets a future fabricated-value leak land silently.
9. **T2 — exercise `string wrong-type` coercion.** Lock the documented "coerce-to-zero, not drop" intent.
10. **T3 — scope Cypress negative-branch assertions.** Vacuous `cy.contains("+11/")` substring matches make the "transcript-only sessions unaffected" acceptance criterion unenforceable.

### Should Address (🟡 Medium)

Server / reconciler — M1, M2, M3, M4, M5, M6, M7, M8, M9, M10
Frontend / client — M11 (silent observed/total mix is a correctness bug — could justify 🟠), M12, M13, M14
Test coverage — M15, M16, M17, M18, M19, M20, M21, M22
Documentation — M23, M24, M25, M26, M27

### Nice to Have (💭 Low)

See the consolidated Low list in the body above, including: `console.error` path leak (security #4), `JSON.parse` depth guard (security #5), `applyCostLog` row overwrites (code-quality observation), parse-loop DRY, `formatLineDelta` undefined coerce, comment drifts, dead defensive `typeof`, `TierBadge` lock-step comment, inline handlers, the inherited 12 `noNonNullAssertion` warnings (captured in ARCH-45 Open Questions — non-blocking).

---

*Generated by Review — 2026-07-21*