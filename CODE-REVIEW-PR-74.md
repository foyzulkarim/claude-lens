# Review Report

## Metadata

| Field | Value |
|-------|-------|
| **Review Mode** | PR #74 |
| **Target** | https://github.com/foyzulkarim/claude-lens/pull/74 (`p2-6-p2-7-store-derivations-and-boot-checkpoint` → `main`) |
| **Date** | 2026-07-14 |
| **Tech Stack** | TypeScript (strict, Node 22), Vitest, Biome — no framework routes/DB/React touched in this diff |
| **Checks Run** | Code Quality, Test Coverage, Performance, Error Handling, TypeScript Strictness, Runtime Behavior, Async Patterns, Migration |
| **Checks Skipped** | Task Completion (general PR mode, no ARCH/REQ to verify against), Security (no user-facing endpoints or new attack surface), Documentation (internal implementation, no public API surface), Config-Dependencies (only an npm script added, no new deps/env vars), React/Express/Database/Accessibility (no matching files in the diff) |
| **Files Changed** | 17 (8 new: `server/store/{store,derive-turns,derive-session,invalidation}.ts` + tests, `server/ingest/{pipeline,benchmark}.ts` + `pipeline.test.ts`; 9 modified: `package.json`, `specs/claude-lens-plan.md`, `server/ingest/{parse-transcript,warm-cache}.ts` + tests) |
| **Lines Changed** | +1272 / -4 |

## Review Process

- [x] Preflight checks passed (git repo, `gh` authenticated)
- [x] Diff gathered (17 files, 1426-line `gh pr diff`)
- [x] Tech stack detected: TypeScript, Node 22, Vitest, Biome
- [x] Context read (CLAUDE.md; PR description; commit message)
- [x] Triage proposed and developer confirmed
- [x] 8 checks dispatched: Code Quality, Test Coverage, Performance, Error Handling, TypeScript Strictness, Runtime Behavior, Async Patterns, Migration
- [x] Results collected and deduplicated
- [x] Report compiled
- [x] Verdict determined

## Re-review Update (2026-07-14, same day)

All 19 findings addressed per the developer's request to fix everything, not just the Must-Fix items. Re-ran the full suite after: **111/111 tests pass** (was 102; +9 new regression tests), `npm run verify` clean, and a fresh `npm run bench:ingest` shows no regression (0.20s cold boot, 0.03s warm boot, 181.4MB RSS — consistent with the original 0.21s/179.2MB reading; session/call counts grew slightly from normal real-usage between runs, not from this change).

One fix went beyond its original recommendation: Finding #6's suggested test (`Promise.all([poller.runDiscovery(), poller.runDiscovery()])`) was added as specified and **initially failed** — proving `poller.runDiscovery()` is genuinely non-atomic at its own level, not just unsafe when called the way the old `pipeline.ts` called it. Rather than leave that test red or weaken it, `Poller.runDiscovery()` itself was made idempotent under concurrency (collapses overlapping calls onto one in-flight run), closing the race at its actual source instead of relying solely on caller-side call-ordering discipline.

| # | Finding | Status | Notes |
|---|---------|--------|-------|
| 1 | `invalidation.ts` `flush()`/`flushAll()` no try/catch | ✅ Resolved | Added `safeOnFlush()` wrapper; regression tests added (throwing `onFlush` in a debounced flush and in `flushAll()` no longer propagates or aborts remaining sessions). |
| 2 | `pipeline.stop()` not a hard boundary | ✅ Resolved | Added `stopped` flag in the `settled` IIFE (skips `poller.start()` if stop() fired mid-flight) + `stopped` flag in `Invalidator` (rejects `markDirty`/`markAdded`/`markScanDirty` post-stop). Regression test added; required correcting the test's own assertions once written, since `getSession()` now correctly stays undefined post-stop (no recompute without a flush) even though raw `getCalls()` still reflects the in-flight read that couldn't be cancelled — that's the intended boundary, not a gap. |
| 3 | `poller.ts` fire-and-forget timers, no `.catch` | ✅ Resolved | `.catch()` added to all three call sites (initial + slow-interval `runDiscovery`, fast-interval `pollOnce`), logging via a new `logTimerError` helper. |
| 4 | `track()`'s undocumented no-reject invariant | ✅ Resolved | Comment added at the `track()` definition. |
| 5 | No test for sidecar/file-reset pipeline wiring | ✅ Resolved | Two new `pipeline.test.ts` cases: cost-sidecar wiring (asserts `tier.hasCostSamples` isolated per session) and file-truncation reset (asserts stale calls are cleared, not accumulated). |
| 6 | No regression test for the concurrent-discovery race at its source | ✅ Resolved (exceeded scope) | Test added as specified; it caught a real gap (see above), which was then fixed in `poller.ts` itself rather than left as a known-red or caller-discipline-only guard. |
| 7 | `pipeline.stop()` not in `afterEach`, leaks timers on failure | ✅ Resolved | All `pipeline.test.ts` cases now register via a `track()` helper; `afterEach` stops every pipeline started that test, failure or not. |
| 8 | No out-of-order-timestamp test for `assignPromptIds` | ✅ Resolved | New `derive-turns.test.ts` case feeds both `calls`/`prompts` in reverse-chronological array order and asserts correct timestamp-based assignment. |
| 9 | Loose-bound usage assertions in `derive-session.test.ts` | ✅ Resolved | Replaced with exact totals, independently computed from the raw fixture JSON (not derived from the implementation under test). |
| 10 | `recompute()` not incremental within a session | ✅ Resolved (as designed) | Confirmed as an accepted architecture tradeoff, not a defect — documented explicitly in a docstring so the tradeoff is visible in-code, not just in this report. |
| 11 | `listSessions()` staleness contract overstated in comment | ✅ Resolved | Docstring rewritten to state the bounded-staleness guarantee precisely (fresh within ~debounceMs, not always-current), and why that's consistent with the WS-refetch model. |
| 12 | `drainInFlight()` size-equality convergence check | ✅ Resolved | Simplified to `while (inFlight.size > 0)` per both checks' converged recommendation — removes the fragile heuristic entirely rather than just documenting around it. |
| 13 | `listSessions()`/`flushAll()` synchronous multi-session cascade | ✅ Resolved (as designed) | Forward-looking note only, per the original finding (not a defect in this PR's scope) — folded into the same docstring as #11, flagged explicitly for #P3-1. |
| 14 | Invalidation debounce has no `maxWait` ceiling | ⏭️ Intentionally not implemented | The finding itself frames this as speculative ("optional... if ever observed in practice," "unlikely" at real API cadence) and it's not in the architecture spec's 200-500ms debounce contract. Adding a `maxWait` mechanism now would be a feature not requested by any spec or reproduced failure — held back per this codebase's own stated discipline against speculative complexity. Flagging here rather than silently dropping it. |
| 15 | `emptyUsage()`/`addUsage()` duplicated across two files | ✅ Resolved | Extracted to new `server/store/token-usage.ts`, imported by both `derive-turns.ts` and `derive-session.ts`. |
| 16 | Biome import-ordering drift | ✅ Resolved | `npx biome check --write` run across all touched files; `npm run verify` unaffected (organize-imports isn't part of the gate, but the drift itself is now gone). |
| 17 | `deriveTurns` ~67 lines, could extract a helper | ✅ Resolved | Extracted `buildTurn()`; `deriveTurns()` is now the grouping loop only. |
| 18 | `acc.calls[0]?.sessionId ?? ""` masks an invariant violation | ✅ Resolved | Now throws (`unreachable: turn accumulator for ${promptId} has no calls`) instead of silently writing `""`, matching the explicit-throw pattern already used elsewhere in the same file. |
| 19 | Warm-cache validator tightening undocumented/untested | ✅ Resolved | Comment added above `isPromptTextRecordShape` explaining the pre-upgrade-cache-invalidation behavior and why it's safe; regression test added simulating an old cache entry missing `timestamp`. |

**Updated Verdict: ✅ APPROVE** — all 19 findings resolved (18 fixed in code/tests, 1 explicitly and reasonably deferred with rationale recorded above), no regressions, benchmark re-confirmed in-band.

---

## Original Verdict: ❌ REQUEST CHANGES

The core work is sound: `derive-turns.ts`'s chronological promptId assignment is a well-reasoned, clearly documented solution to a real data gap (confirmed against real capture data — `ApiCall` never carries `promptId`), the store's session-isolation guarantee is thoroughly tested, TypeScript strictness is clean (zero `any`/assertions/`@ts-ignore`), and the #P2-7 benchmark (0.21s cold boot, 179.2MB RSS on real data) genuinely validates the checkpoint. The double-registration race the developer found and fixed mid-implementation is verified correct.

What blocks merge is four High findings, all narrow and cheap to fix, clustered in two places: (1) `invalidation.ts`'s `flush()` has no try/catch around a callback that can throw inside a `setTimeout` — an uncaught exception there crashes the whole process, breaking the established convention every sibling module (`poller.ts`, `tailer.ts`) already follows; `pipeline.stop()` isn't a hard boundary, corroborated independently by three separate checks; and (2) two of this PR's own core deliverables — sidecar-file wiring and the file-reset path — and the concurrency fix itself have zero regression test coverage. None of these require a design change; each is a localized fix or a test addition. Recommend addressing before merge given #P3-1 will build directly on `pipeline.ts` and inherit any of these landmines.

### Finding Counts

| Category | 🔴 | 🟠 | 🟡 | 💭 | ⚠️ |
|----------|-----|-----|-----|-----|-----|
| Error Handling | 0 | 2 | 0 | 0 | 0 |
| Test Coverage | 0 | 2 | 2 | 1 | 0 |
| Async Patterns | 0 | 0 | 2 | 1 | 0 |
| Performance | 0 | 0 | 2 | 1 | 0 |
| Runtime Behavior | 0 | 0 | 1 | 0 | 0 |
| Code Quality | 0 | 0 | 1 | 2 | 0 |
| TypeScript Strictness | 0 | 0 | 0 | 1 | 0 |
| Migration | 0 | 0 | 0 | 1 | 0 |
| **Total** | **0** | **4** | **8** | **7** | **0** |

*(Findings #2, #7, #11, and #12 were each independently flagged by 2-3 checks; counted once here under their primary domain, cross-referenced in the other checks' sections below.)*

---

## Error Handling & Process Lifecycle

**Files reviewed:** `server/store/invalidation.ts`, `server/store/store.ts`, `server/ingest/pipeline.ts`

### Findings Table

| # | Severity | File | Line | Issue | Recommendation |
|---|----------|------|------|-------|----------------|
| 1 | 🟠 High | `server/store/invalidation.ts` | 32–35, 55–61 | `flush()` calls `options.onFlush(...)` with no try/catch, unlike every analogous consumer-callback site in `poller.ts`/`tailer.ts` (which explicitly wrap to keep errors from "escaping the loop"). `Store`'s `onFlush` wiring runs `this.recompute()` (which calls into an injected `pricer` — an external, user-supplied callback landing in #P2-8) and then `options.onInvalidate(message)` (eventually a WS send in #P3-1). Since `flush` fires inside a `setTimeout` callback, an uncaught throw here becomes an uncaught exception that crashes the whole Node process — one bad session's pricer or one WS write failure takes down the entire dashboard. `flushAll()`'s synchronous loop has the same gap: a throw mid-loop aborts remaining flushes, leaving their timers already-cancelled-but-unflushed. | Wrap `flush()`'s body in try/catch (matching the `poller.ts`/`tailer.ts` pattern), and log-and-continue in `flushAll()`'s loop rather than letting one failure abort the rest. |
| 2 | 🟠 High | `server/ingest/pipeline.ts` | 94–107 | `stop()` calls `poller.stop()` + `store.stop()`, but neither guards against work already in flight. If `stop()` is called while the `settled` IIFE is still inside `await poller.runDiscovery()` / `drainInFlight()`, that IIFE has no "was I stopped?" check and unconditionally calls `poller.start()` afterward — resurrecting the fast/slow timers after the caller believed everything was torn down. Separately, in-flight `tailer.onFileAdded`/`onFileChanged` promises tracked in `inFlight` aren't cancelled by `stop()`; when they resolve they call `store.applyRecords()` → `invalidator.markDirty()`, which schedules a **new** `setTimeout` — `Invalidator.stop()` only clears currently-pending timers, it doesn't set a flag to reject post-stop scheduling. Net effect: `stop()` is not a hard boundary. **Corroborated independently by Runtime Behavior and Async Patterns checks** — both traced the exact same code path and reached the same conclusion. No current caller in this PR triggers the failure window (tests/`benchmark.ts` only call `stop()` after `whenSettled()` resolves), but `pipeline.ts` is explicitly built for #P3-1 to reuse, which will call `stop()` on server shutdown/restart without that guarantee. | Add a `stopped` flag checked before `poller.start()` in the `settled` IIFE, and have `Invalidator`/`Store` reject `markDirty`/`markAdded`/`markScanDirty` after `stop()` (or have `pipeline.stop()` await/cancel in-flight tailer work before calling `store.stop()`). |

### Coverage Checklist
```
- [x] server/store/invalidation.ts — flush() try/catch ⚠️ → #1, flushAll() partial-failure loop ⚠️ → #1, stop() cancels all pending timers ✅
- [x] server/store/store.ts — recompute() error surface ⚠️ → #1 (via invalidator), applyRecords/markSidecarPresent/resetSession ✅ no issues
- [x] server/ingest/pipeline.ts — stop() completeness ⚠️ → #2, onRecords/onFileReset/onFileAdded/onFileChanged callback safety ✅ (delegated to tailer/poller's existing try/catch)
- [x] server/store/derive-turns.ts — "unreachable" guard reachability ✅ confirmed genuinely unreachable (nothing ever deletes from `accumulators` after insert)
- [x] server/ingest/warm-cache.ts — stricter validator fails closed (cache miss), not throw ✅
```

### Review Comments

**#1:** I noticed `flush()` calls `onFlush` with no try/catch, breaking the pattern every sibling module in this codebase already follows for exactly this reason. Since this fires inside a `setTimeout`, an uncaught exception here doesn't just fail one session's update — it takes down the whole process. Given `recompute()` will soon call an injected pricer (#P2-8) that's outside this module's control, this seems worth closing now rather than after a pricer bug crashes a running dashboard. What do you think?

**#2:** Three independent domain checks (error-handling, runtime-behavior, async-patterns) traced `pipeline.ts`'s `stop()` through the exact same path and landed on the same gap: it's not a hard boundary against in-flight work. Nothing in this PR's own call sites hits the failure window, but `pipeline.ts` exists specifically for #P3-1 to build the live server on — would it make sense to close this now, before that dependency lands, rather than risk it becoming a subtle shutdown bug in production?

---

## Test Coverage

**Files reviewed:** all new/modified `*.test.ts` files paired with their implementation.

### Findings Table

| # | Severity | File | Line | Issue | Recommendation |
|---|----------|------|------|-------|----------------|
| 5 | 🟠 High | `server/ingest/pipeline.test.ts` | n/a | No test exercises the poller→store sidecar wiring (`onFileAdded` for `class: "cost"`/`"turn-boundaries"` → `store.markSidecarPresent`, `pipeline.ts:66-70`) or the truncation-reset wiring (`onFileReset` → `store.resetSession`, `pipeline.ts:48-50`). Both are new glue code this task is meant to cover ("ingest pipeline wiring"), and neither has any assertion in the diff. | Add a test that writes a `<uuid>.cost.jsonl` alongside a transcript and asserts `store.getSession(id)?.tier.hasCostSamples === true` after `whenSettled()`; add another that truncates+rewrites a transcript file mid-test and asserts the session's `callCount` resets rather than accumulates stale calls. |
| 6 | 🟠 High | `server/ingest/pipeline.ts` (94-107) / `server/ingest/poller.test.ts` | n/a | The developer's fix for the concurrent-`runDiscovery()` double-registration race (serializing `runDiscovery()` before `poller.start()`) has no direct regression test. `poller.ts`'s `runDiscovery()` itself is still non-atomic (check-then-await-then-set on `this.registry`); nothing pins that at the source. The only thing that would currently catch a regression is the incidental `expect(session?.callCount).toBe(1)` in `pipeline.test.ts`'s first test — not a targeted test, and it wouldn't localize the failure to the real cause. | Add a unit test in `poller.test.ts`: `await Promise.all([poller.runDiscovery(), poller.runDiscovery()])` against a registry with one discoverable file, and assert `onFileAdded` fired exactly once. This pins the bug at its source regardless of how `pipeline.ts` later calls the poller. |
| 7 | 🟡 Medium | `server/ingest/pipeline.test.ts` | 81, 129 | `pipeline.stop()` is called only at the end of each test body, after assertions. If an assertion throws first, `stop()` is skipped, leaking the poller's real `setInterval`/`setTimeout` timers across the test run — this file uses real timers and real fs I/O, so this is a genuine open-handle/flaky-runner risk, not just tidiness. **Also flagged independently by Async Patterns** as part of Finding #2's untested boot-race scenario. | Track started pipelines in an array and call `pipeline.stop()` for each in `afterEach`, mirroring the existing `tmpDirs` cleanup pattern already used in this file. |
| 8 | 🟡 Medium | `server/store/derive-turns.test.ts` | n/a | `assignPromptIds` defensively sorts both `calls` and `prompts` before assigning (`derive-turns.ts:62-63`), but every test feeds already-chronological input. No test proves out-of-order input is handled correctly — a regression in the sort/comparator would not be caught. | Add a test with `calls`/`prompts` passed in shuffled order and assert turn grouping is still correct by timestamp, not array order. |
| 9 | 💭 Low | `server/store/derive-session.test.ts` | 43-45 | The usage-rollup test asserts `inputTokens > 0` and `0 < cacheHitPct <= 1` rather than exact totals, even though `derive-turns.test.ts` computes exact per-turn sums from the same fixture. | Assert exact `session.usage` values (computable from the numbers already used in `derive-turns.test.ts`). |

### Coverage Checklist
```
- [x] server/store/store.ts — applyRecords/resetSession/markSidecarPresent isolation ✅, recompute per-session-only ✅, listSessions lazy recompute ✅, concurrent/interleaved multi-session dirtying ✅
- [x] server/store/derive-turns.ts — empty calls ✅, calls preceding every prompt ✅, sidechain split ✅, dual-cache-TTL usage sum ✅, out-of-order timestamp input ⚠️ → #8
- [x] server/store/derive-session.ts — zeroed empty-session rollup ✅, pricer injection ✅, sidecar flag passthrough ✅, exact usage totals ⚠️ → #9
- [x] server/store/invalidation.ts — coalescing ✅, independent per-session debounce ✅, immediate markAdded/markScanDirty ✅, flushAll no-double-flush ✅, stop cancels without flushing ✅
- [x] server/ingest/pipeline.ts — transcript discover+tail+populate ✅, cross-session isolation via full pipeline ✅, sidecar wiring ⚠️ → #5, file-reset wiring ⚠️ → #5, race regression ⚠️ → #6, stop() cleanup on assertion failure ⚠️ → #7
- [x] server/ingest/parse-transcript.ts / warm-cache.ts (timestamp field) — covered in existing tests ✅
```

### Review Comments

**#5:** I noticed `pipeline.ts` wires cost/turn-boundaries sidecar detection and file-reset straight into the store, but there's no test driving either path end-to-end. Since this task's own scope is "ingest pipeline wiring," could we add coverage for both before merge?

**#6:** Since the concurrent-registration race already bit this PR once during development, a direct `Promise.all([poller.runDiscovery(), poller.runDiscovery()])` test at the component that actually has the race seems like cheap, high-value insurance against it reopening via a future refactor of the calling sequence.

---

## Async Patterns

**Files reviewed:** `server/ingest/pipeline.ts`, `server/store/invalidation.ts`, `server/store/store.ts`, `server/ingest/benchmark.ts` (+ unchanged context: `server/ingest/poller.ts`, `server/ingest/tailer.ts`)

**Race-condition fix verification:** traced `startIngest()`'s `settled` IIFE exactly as written, independent of the developer's own description. `await poller.runDiscovery()` runs every discovered file's `stat()`/`registry.set()` sequentially to completion before the `await` resolves; only then does `drainInFlight()` run; only after *that* resolves does `poller.start()` execute, with no intervening await for a new file to sneak in. **The fix is correct and complete** — confirmed independently, not taken on faith.

### Findings Table

| # | Severity | File | Line | Issue | Recommendation |
|---|----------|------|------|-------|----------------|
| 3 | 🟡 Medium | `server/ingest/poller.ts` (unchanged) | 35, 39 | `start()`'s initial `void this.runDiscovery()` and the recurring `setInterval(() => this.runDiscovery(), slowMs)` have no `.catch`. `runDiscovery()`'s body is already defensively try/caught internally, so realistic reject likelihood is low today — but this PR is the *first* production wiring of `poller.start()` (previously exercised only in its own unit tests), so this dormant gap becomes live in a long-running server process for the first time, recurring every `slowMs` forever. | Wrap the `setInterval` callback (and the initial call) in `.catch()` — cheap defense-in-depth. |
| 12 | 🟡 Medium | `server/ingest/pipeline.ts` | 86-92 | `drainInFlight()`'s exit condition compares `inFlight.size` across iterations, not promise identity — logically fragile if this helper is ever reused. **Verified via direct trace (reconciling a more severe read from the Performance check): in the current code, nothing can add to `inFlight` during the drain window** — the only producers of new tracked promises are the poller's `onFileAdded`/`onFileChanged` callbacks, which only fire from within `runDiscovery()` (already fully awaited before `drainInFlight()` starts) or the fast-poll timer (not yet started, since `poller.start()` runs *after* the drain). So the bug is real as written but not currently reachable given this exact call sequence — it's correctness debt, not a live defect. | Simplify to `while (inFlight.size > 0) { await Promise.all([...inFlight]); }` — removes the fragile size-equality heuristic entirely and closes the gap for any future reuse, at no cost. |
| 4 | 💭 Low | `server/ingest/pipeline.ts` | 36-40 | `track()`'s `promise.finally(() => inFlight.delete(promise))` attaches no rejection handler. Currently safe only because `Tailer.enqueue()` guarantees the promise it returns never rejects (`task().catch(...)` swallows internally) — an invariant `track()` relies on but never documents. | Add a one-line comment at `track()` noting it assumes its input never rejects. |

*(Finding #2, the `stop()` boundary gap, is reported under Error Handling above — this check independently reached the same conclusion via its own trace.)*
*(Finding #7, the missing boot-race test, is reported under Test Coverage above — this check independently flagged the same gap.)*

### Tracing Notes — `startIngest()`'s settle sequence
**Callers:** `benchmark.ts` and both `pipeline.test.ts` tests, all `await` it immediately — no dangling caller found (future `app.ts` from #P3-1 not yet present). **Frequency:** one-time per pipeline instance (cold-boot barrier), not a hot path. **Callees:** `poller.runDiscovery()` (awaited, effectively non-rejecting today), `drainInFlight()` (awaited), `poller.start()` (sync call, fires an un-awaited internal rediscovery plus two `setInterval`s for the process lifetime). **Why it matters:** this is the exact sequence already patched once for the double-registration race, and the only call site of `poller.start()` in the codebase.

### Coverage Checklist
```
- [x] server/ingest/pipeline.ts — unhandled rejections ✅ (traced inFlight/track, safe today, undocumented invariant → #4), race conditions ✅ (fix verified correct), resource cleanup ⚠️ → #2 (cross-ref), sequential-vs-parallel ✅ no missed Promise.all
- [x] server/store/invalidation.ts — fully setTimeout-based, no promises, timer cleanup on stop()/flushAll() ✅
- [x] server/store/store.ts — constructor callback wiring synchronous throughout ✅, no hidden async assumptions ✅
- [x] server/ingest/benchmark.ts — sequential cold/warm runs is a real dependency not a missed Promise.all ✅, top-level main().catch() ✅
- [x] server/ingest/poller.ts (context, unchanged) — fire-and-forget timers ⚠️ → #3
- [x] server/ingest/tailer.ts (context, unchanged) — enqueue()'s rejection-swallowing chain ✅ confirmed as the invariant #4 depends on
```

---

## Performance & Runtime Behavior

**Files reviewed:** `server/store/store.ts`, `server/store/derive-turns.ts`, `server/store/derive-session.ts`, `server/store/invalidation.ts`, `server/ingest/pipeline.ts`, `server/ingest/benchmark.ts`

### Tracing Notes — `Store.recompute()` and `markDirty`
**`recompute()` callers (3):** the debounced `onFlush` handler (one session at a time), `listSessions()` (loops the *entire* sessions Map, recomputes every stale one synchronously in one call), `Invalidator.flushAll()` (same, no yield between iterations). **Callees:** `deriveTurns` (two `O(n log n)` sorts) + `deriveSession` (single `O(n)` pass), both pure and scoped to one session's arrays. **`markDirty` callers:** `Store.applyRecords` (hottest — fires on every tailer batch) correctly clears the prior timer before rescheduling, no accumulation.

### Findings Table

| # | Severity | File | Line | Issue | Recommendation |
|---|----------|------|------|-------|----------------|
| 10 | 🟡 Medium | `server/store/store.ts` | 111-116 | `recompute()` re-derives turns+session from the **full** accumulated `state.calls`/`state.prompts` every debounce cycle, not incrementally. At today's benchmarked scale (~26 calls/session avg, 4136 total) this is invisible; for a marathon session (thousands of calls over hours), each subsequent recompute during active use costs `O(n log n)` over the *whole* history so far, not just the new delta. | Accepted per architecture spec (only cross-session isolation is required, not intra-session incrementality) — flag as a known scaling limit to revisit once real long-session data exists, not a blocker. |
| 11 | 🟡 Medium | `server/store/store.ts` | 76-82, 130-139 | `applyRecords`/`markSidecarPresent` call `markDirty` but never null `state.session`; only `resetSession` does. `listSessions()`'s staleness check is `if (!state.session)`, which only catches "never yet computed," not "recomputed once, then dirtied again." Within the debounce window (200-500ms) after new calls land on an already-computed session, `listSessions()` silently returns the stale pre-append snapshot. **Corroborated independently by Runtime Behavior.** | Consistent with the WS-driven eventual-consistency model (client refetches on `session-updated`) — likely intentional, but the docstring "recomputes any session whose derived state is stale" overstates what the null-check actually catches. Tighten the comment to state the bounded-staleness contract explicitly, or confirm this is the intended read-consistency guarantee. |
| 13 | 🟡 Medium | `server/store/store.ts` (130-139) / `server/store/invalidation.ts` (55-62) | — | Both `listSessions()` and `flushAll()` loop synchronously over every stale/pending session with no yield between them; each `recompute()` is `O(n log n)` in that session's call count. Not a bug today — no HTTP handler calls `listSessions()` yet (that's #P3-1) — but it's documented as the read path a future per-request page will use; a burst of simultaneously-stale sessions (cold boot, or a wave of concurrent CC activity) would block the event loop for the sum of all their recompute costs in one synchronous call, on a project explicitly built "single-threaded until proven otherwise." | Forward note for #P3-1: either cap/paginate how many sessions `listSessions()` recomputes per call, or budget a yield (`setImmediate`) between recomputes if profiling shows this matters at real data volumes. Not required for this PR. |
| 14 | 💭 Low | `server/store/invalidation.ts` | 38-45 | `markDirty` is a pure trailing debounce (clear+reset), no leading edge / `maxWait`. Under writes sustained faster than `debounceMs` apart, a session's flush could theoretically be pushed back indefinitely. | Real API call cadence (seconds) makes sub-300ms sustained bursts unlikely; optional `maxWait` ceiling if ever observed in practice. |

*(Finding #12, the `drainInFlight()` convergence check, is reported under Async Patterns above — that check's more rigorous trace reconciled the reachability question; both checks agree on the recommendation.)*

### Observations (Low confidence)
- `Store.getCalls()`/`getTurns()` return direct references to live internal arrays, not copies (also noted independently by Code Quality). No current caller mutates them; worth awareness as more consumers (`/api/*` routes) land later.
- `state.calls.push(...result.calls)` spreads a batch into `push` args — defensive-only concern about the JS engine's argument-count ceiling (~65k+), not observed at current scale.
- No megamorphism concerns: accumulator/state objects are always constructed with the same fixed property set, never grown conditionally after creation.

### Coverage Checklist
```
- [x] server/store/derive-turns.ts — assignPromptIds complexity ✅ true O(n log n), no hidden quadratic
- [x] server/store/store.ts — recompute() incrementality ⚠️ → #10, listSessions() staleness ⚠️ → #11, synchronous cascade ⚠️ → #13, hot-path allocations ✅ minor only
- [x] server/store/derive-session.ts — single O(n) pass ✅
- [x] server/store/invalidation.ts — timer lifecycle ✅, stop() clears all ✅, debounce starvation ⚠️ → #14, reusable-after-stop gap ⚠️ → cross-ref #2
- [x] server/ingest/pipeline.ts — inFlight self-cleans via .finally() ✅, drainInFlight() convergence ⚠️ → cross-ref #12, stop() doesn't cover in-flight work ⚠️ → cross-ref #2
- [x] server/ingest/benchmark.ts — one-shot CLI, no listener/timer leak of its own ✅
```

---

## Code Quality

**Files reviewed:** all new/modified `*.ts` and `*.test.ts` files. Ran `tsc --noEmit`, `vitest run` (102/102 pass), `biome lint`/`format`/`check`.

### Findings Table

| # | Severity | File | Line | Issue | Recommendation |
|---|----------|------|------|-------|----------------|
| 15 | 🟡 Medium | `server/store/derive-session.ts:18-40`, `server/store/derive-turns.ts:31-53` | — | `emptyUsage()`/`addUsage()` are copy-pasted line-for-line between the two sibling files (identical field list, identical `?? 0` handling for the four optional `TokenUsage` fields). Any future `TokenUsage` field addition has to be remembered in both places. | Extract to a shared `server/store/token-usage.ts` (`emptyUsage()`, `addUsage(target, usage)`); have `derive-turns.ts` call `addUsage(target, call.usage)`. |
| 16 | 💭 Low | `server/store/store.ts`, `server/store/derive-session.ts`, `server/ingest/pipeline.ts`, `server/ingest/benchmark.ts` | — | Import ordering violates Biome's `organizeImports` assist in all four new/changed files. Every pre-existing file in `server/ingest`/`server/store` passes `biome check` cleanly, so this is new drift — and it's not caught by the actual gate: `npm run lint` (`biome lint`) and `npm run format:check` (`biome format`) don't run the organize-imports assist, only `biome check` does, and that isn't part of `verify`. | Run `npx biome check --write` on the four files. |
| 17 | 💭 Low | `server/store/derive-turns.ts:82-148` | — | `deriveTurns` is ~67 lines — the accumulator-building loop and the final `.map()` turn-assembly are both inlined in the same function. | Optional: extract the `.map()` body into a `buildTurn(acc, toolResultBytesByPromptId)` helper. Not urgent — the two phases are already visually distinct. |

### Observations (low confidence, grouped)
- `Store.getSession`/`getTurns`/`getCalls`/`listSessions` return live references into internal arrays/objects, not copies — likely intentional for the "cheap read" goal; flagging for awareness as more consumers land in later phases (also noted by Runtime Behavior).
- `Store.recompute()` is `public` but only ever called from within the class itself — could be `private`.
- `markSidecarPresent` can create a session entry (and fire `session-added`) before any transcript records exist, if a sidecar file is discovered before its transcript — order-dependent, not exercised by tests, plausibly harmless given the debounced re-emit once records land.

### Coverage Checklist
```
- [x] server/store/store.ts — naming ✅, complexity ✅ (153 lines, focused methods), encapsulation → Observation, session-isolation invariant ✅ verified against store.test.ts, imports ⚠️ → #16
- [x] server/store/derive-turns.ts — naming ✅, duplication ⚠️ → #15, function length ⚠️ → #17, sidechain design ✅ intentional and documented
- [x] server/store/derive-session.ts — naming ✅, duplication ⚠️ → #15, imports ⚠️ → #16, pricer optionality ✅ tested
- [x] server/store/invalidation.ts — naming ✅, complexity ✅, debounce logic ✅ verified against invalidation.test.ts
- [x] server/ingest/pipeline.ts — naming ✅, wiring/SRP ✅, imports ⚠️ → #16
- [x] server/ingest/benchmark.ts — naming ✅, imports ⚠️ → #16, script-not-business-logic ✅ no test expected
- [x] server/ingest/parse-transcript.ts / warm-cache.ts — WHY comment present on new field ✅, downstream consumer verified ✅
- [x] *.test.ts files — naming describes behavior not implementation ✅, fixture reuse consistent with existing convention ✅
```

---

## TypeScript Strictness

**Config confirmed:** `tsconfig.base.json` sets only `strict: true` (no `noUncheckedIndexedAccess`, no `exactOptionalPropertyTypes`). No `any`, `as X` assertions, `!` non-null assertions, or `@ts-ignore`/`@ts-expect-error` appear anywhere in the diff. All exported functions have explicit return types. `npm run typecheck` passes clean.

### Findings Table

| # | Severity | File | Line | Issue | Recommendation |
|---|----------|------|------|-------|----------------|
| 18 | 💭 Low | `server/store/derive-turns.ts` | 127 | `sessionId: acc.calls[0]?.sessionId ?? ""` — by construction, `acc.calls.push(call)` executes unconditionally right after every `acc` is created (same iteration), so `acc.calls[0]` is never actually undefined. The optional chain + `?? ""` silently produces an empty `sessionId` if that invariant were ever broken by a refactor, rather than failing loudly — inconsistent with the explicit `throw new Error("unreachable...")` guard three lines above for the analogous `accumulators.get(key)` lookup. | Either assert the invariant explicitly, or use direct indexing (`acc.calls[0].sessionId`) so a future violation throws instead of silently writing `""` into session data. |

### Observations (Low confidence / style only)
- `derive-turns.ts:57-60` — the redundant `?.`/`?? ""` on `sortedPrompts[promptIndex + 1]` is already guarded by the bounds check in the same `&&` expression — harmless, not masking anything.
- `store.ts` — `getSession`/`getTurns`/`getCalls`'s `?.` chains off `Map.get()` correctly reflect that the key may not exist; `getSession`'s `?.session ?? undefined` is a no-op fallback, purely stylistic.
- `server/store/store.test.ts:134` — an `as typeof invalidations.push` cast on a test mock, standard test-double pattern, no production impact.

### Coverage Checklist
```
- [x] All 8 source files + 7 test files — any ✅, assertions ✅, non-null ✅, ts-ignore ✅ across the board; array index access reviewed → #18 (one finding), one redundant-but-harmless chain → Observation
```

---

## Migration & Compatibility

**Files reviewed:** `server/ingest/parse-transcript.ts`, `server/ingest/warm-cache.ts`, and their test files.

### Findings Table

| # | Severity | File | Line | Issue | Recommendation |
|---|----------|------|------|-------|----------------|
| 19 | 💭 Low | `server/ingest/warm-cache.ts` | 54-61 | `PromptTextRecord` gained a required `timestamp` field, and `isPromptTextRecordShape` was tightened to match. **Traced and confirmed safe:** any pre-upgrade on-disk cache file containing a prompt record fails validation → `deserializeEntry` returns `null` (all-or-nothing, no partial-corruption path) → clean cache miss → full re-parse + atomic re-save via `tailer.ts`'s existing fallback. No thrown exception anywhere in the chain, no data loss (the cache is a rebuildable derived artifact; the source-of-truth transcripts are untouched). This safety property is real but currently lives only in this review, not in the code or PR description. | Add a one-line comment above `isPromptTextRecordShape` noting that tightening this check invalidates pre-existing cache files missing the field, and that this is intentional/self-healing. Add a regression test mirroring the existing "missing required fields" pattern, using a `prompt` record without `timestamp`. |

### Coverage Checklist
```
- [x] server/ingest/parse-transcript.ts — new required field on internal (non-shared-contract) type ✅, toStr fallback prevents throw on missing/non-string timestamp ✅
- [x] server/ingest/warm-cache.ts — on-disk NDJSON cache schema change ⚠️ → #19, deserializeEntry all-or-nothing behavior traced and confirmed safe ✅, Tailer fallback traced and confirmed no throw / no data loss ✅
- [x] server/ingest/parse-transcript.test.ts / warm-cache.test.ts — new field covered in existing fixtures ✅, missing explicit upgrade-path regression test ⚠️ → #19
```

---

## Manual Checks Required

- [ ] None — all checks were verifiable from code, tests, and the recorded benchmark output.

## Prioritized Action Items

### Must Fix (🔴 Critical / 🟠 High)
1. **#1** — Add try/catch around `onFlush` in `invalidation.ts`'s `flush()`/`flushAll()` (process-crash risk).
2. **#2** — Make `pipeline.stop()` a real boundary: guard `poller.start()` in the `settled` IIFE against a stop-in-progress, and have `Invalidator`/`Store` reject post-stop scheduling.
3. **#5** — Add pipeline tests for sidecar-file wiring (`markSidecarPresent`) and file-reset wiring (`resetSession`).
4. **#6** — Add a direct regression test in `poller.test.ts` pinning the concurrent-`runDiscovery()` fix at its source.

### Should Address (🟡 Medium)
- **#3** — `.catch()` on `poller.ts`'s `setInterval`/initial `runDiscovery()` call (now live in production for the first time via this PR).
- **#7** — Move `pipeline.stop()` into `afterEach` in `pipeline.test.ts` to avoid leaking real timers on assertion failure.
- **#8** — Add an out-of-order-timestamp test for `assignPromptIds`.
- **#10, #11, #13** — Forward notes for #P3-1: intra-session recompute cost, `listSessions()` bounded-staleness contract, synchronous multi-session recompute cascade. None block this PR; worth a comment or tracked note so #P3-1 inherits the context.
- **#12** — Simplify `drainInFlight()`'s exit condition to `while (inFlight.size > 0)`.
- **#15** — Extract `emptyUsage()`/`addUsage()` to a shared helper.

### Nice to Have (💭 Low)
- **#4, #9, #14, #16, #17, #18, #19** — see individual sections above.

---
*Generated by Review — 2026-07-14*
