# Fix PR #89 review findings (CODE-REVIEW-PR-89.md)

## Context

`/review`'s pipeline-mode pass on PR #89 (Dashboard page, #34) dispatched 9 parallel checks against the ARCH doc and returned **FAIL**: 1 Critical, 3 High, 11 Medium, 12 Low across 24 findings. I re-verified every must-fix finding directly against the current code (not just the subagents' report) before planning — all confirmed accurate, with two corrections: the `SavingsDecomposition.test.tsx` client test already asserts the *correct* A8 invariant (so no test-side fix needed there, only the doc-comment claim needs re-truing once the server bug is fixed), and the reviewer's cited `sessions.ts:8059` line numbers were wrong — the real file is 403 lines; correct locations are noted below.

The user chose to fix **all 24 findings** in this pass, not just the 4 must-fix ones. This plan groups them by root cause/shared fix rather than by original check name, since three checks independently rediscovered the same "frozen `now`" bug and two independently rediscovered the same `runtime.ts`/`priceCall` duplication.

## Fix groups

### 1. 🔴 Critical — `routingSavingsComputed` double-counts savings

**File:** `server/metrics/measures.ts:156-175`

The formula subtracts `actual` from `opusUncachedPrice`, but `cacheSavingsComputed` (lines 142-155) also subtracts `actual` from `uncachedPrice`. Summed, they equal `uncached + opusUncached - 2·actual`, not the documented A8 invariant `opusUncached - actual`. Fix: subtract `uncachedPrice(call, pricing)` (the same counterfactual `cacheSavingsComputed` uses), not `actual`.

```ts
// routingSavingsComputed loop body, line ~171:
if (!(call.model in pricing)) return null;
const uncached = uncachedPrice(call, pricing); // reuse, not actual
savings += opusUncachedPrice(call, opusRate) - (uncached ?? 0); // uncached is non-null here (model confirmed priced above)
```
Also update the misleading comment at lines 157-160 to state the corrected algebra.

**Test fix:** `server/metrics/measures.test.ts:458-525` — the test currently hand-computes and asserts `opusUncached - actual` for `routing` (line 519) and explicitly comments that the *true* non-overlapping sum is `opusUncached + currentUncached - 2·actual`, i.e. it was adapted to match the bug. Rewrite the assertion to `routing ≈ opusUncached - currentUncached` and delete the now-false "NOT equal" comment block (lines 521-524) — replace with a comment confirming `cache + routing == opusUncached - actual` holds post-fix.

**Doc-comment fix:** `client/src/pages/dashboard/SavingsDecomposition.tsx:89-97` currently asserts the correct A8 invariant as fact — leave as-is once the server fix lands (it becomes true, no edit needed). `client/src/pages/dashboard/SavingsDecomposition.test.tsx` requires **no changes** — its fixture (`modelA`/`modelB`, lines 48-49) and assertions already encode the correct A8 sum; it happened to pass only because the fixture was hand-picked to satisfy both formulas coincidentally (routing savings there is small enough not to expose the discrepancy) — verify it still passes after the fix, don't assume it needs editing.

Add one new regression case to `measures.test.ts` with a cache-heavy fixture (large `cacheReadTokens`) specifically chosen so the old buggy formula and the fixed formula diverge measurably, to lock against regressing back to the double-counted version.

---

### 2. 🟠 High — real `$0` savings collapsed to "unavailable"

**File:** `server/store/derive-session.ts:137-138`

```ts
cacheSavingsComputed: cacheSavingsComputed > 0 ? cacheSavingsComputed : undefined,
maxTurnCostComputed: maxTurnCostComputed > 0 ? maxTurnCostComputed : undefined,
```

Both key the `undefined` fallback off the *value*, not off whether pricing was available — violating the project's own "0 = measured zero, undefined = unavailable" rule (already correctly implemented for `cacheSavingsComputed`'s `hasUnpricedModel` flag at line 70, just not honored at the return site). Fix: key off presence of `pricing`/`pricer` instead.

```ts
cacheSavingsComputed: pricing ? cacheSavingsComputed : undefined,
maxTurnCostComputed: pricer ? maxTurnCostComputed : undefined,
```

**Test:** add to `server/store/derive-session.test.ts` a case with a fully-priced session whose calls have zero cache-read tokens (so `cacheSavingsComputed` computes to exactly `0`) and assert the returned field is `0`, not `undefined`. Same for a session with a single free/degenerate turn asserting `maxTurnCostComputed === 0`.

---

### 3. 🟠 High — sidechain tool-result bytes/errors leak into the parent turn

**File:** `server/ingest/parse-transcript.ts` (`ToolResultBytesRecord`, lines 14-21) + `server/store/derive-turns.ts` (lines 91-92, 104-119)

`ToolResultBytesRecord` has no `isSidechain` field even though raw tool_result lines carry it. `toolResultBytesByPromptId`/`errorToolResultCountByPromptId` bucket purely by `promptId`; `buildTurn` then attributes the *entire* bucketed sum to the non-sidechain turn (`acc.isSidechain ? 0 : map.get(promptId)`), so a sub-agent's own tool_result records — sharing the parent's `promptId` — get folded into the main thread's `toolResultBytes`/`errorToolResults`.

Fix, mirroring the `${promptId}::${isSidechain}` composite key `deriveTurns` already uses for its `accumulators` map (line 128):

1. `parse-transcript.ts`: add `isSidechain: boolean` to `ToolResultBytesRecord`; populate it in `parseUserLine` from the raw line's `isSidechain` field (same `=== true` coercion pattern already used for `RawAssistantLine.isSidechain` at line 158 — note `RawUserLine` currently has no `isSidechain` field declared, so it needs adding there too, mirroring `RawAssistantLine`).
2. `derive-turns.ts`: change `toolResultBytesByPromptId`/`errorToolResultCountByPromptId` to key by `` `${record.promptId}::${record.isSidechain ? "side" : "main"}` `` (same convention as the `accumulators` map), and change `buildTurn`'s lookup to use `` `${acc.promptId}::${acc.isSidechain ? "side" : "main"}` `` instead of the current `acc.isSidechain ? 0 : map.get(promptId)` special-case.

**Test:** add a fixture/unit case to `derive-turns.test.ts` with one promptId that has both a main-thread call and a sidechain call, plus `toolResultBytes`/error records tagged to each — assert the main turn's `toolResultBytes`/`errorToolResults` reflect only its own records, and the sidechain turn gets its own (not zero, not the main thread's).

---

### 4. 🟠 High — frozen `now` in 7 sibling components (same bug class the PR's own follow-up commits just fixed)

**Files:** `StatCardsRow.tsx:267,279`, `RecentSessionCard.tsx:21`, `SavingsDecomposition.tsx:104`, `AnomalyFeed.tsx:141`, `LeaderboardsCard.tsx:127`, `LeverageRatio.tsx:66`, `FailedWorkStat.tsx:49` (plus the pre-existing, out-of-diff `ChartCard.tsx:301` — fold into the same fix since it's the same pattern and this is the natural moment to cover it).

Each resolves the default preset range's `to` via a bare `new Date()` inside a `useMemo` gated on `filtersKey` (or `[]` for `AnomalyFeed`/`LeaderboardsCard`) — since `serializeFilters` omits the default preset from the URL, `filtersKey` never changes from time passing alone, so the resolved range silently stops advancing. `BurnRateCard`/`SubscriptionWindow` already fixed this exact bug via `useStableNow(injectedNow)` (`client/src/pages/dashboard/useStableNow.ts` — a `useState` + 60s `setInterval` that stays referentially stable within a tick, ticks forward, and lets tests/stories inject a fixed value).

Fix, applying the identical pattern each of the 7 components:
1. Add an optional `now?: Date` prop to the component (matching `BurnRateCard`'s `{ now: injectedNow }` destructure).
2. `const now = useStableNow(injectedNow);` (import from `./useStableNow.js`).
3. Replace `new Date()` in that component's query-building `useMemo` with `now`, and add `now` to the `useMemo`'s dependency array (dropping the `biome-ignore ... useExhaustiveDependencies` comment where it becomes unnecessary, or updating it if `filtersKey` is still the only other covered dep).
4. For `LeaderboardsCard.tsx`/`AnomalyFeed.tsx`, replace `useMemo(() => new Date(), [])` with `useStableNow(injectedNow)` directly.

**Tests:** extend `client/src/pages/dashboard/LiveWindowCards.test.tsx` (or add sibling test files, following its exact pattern — mock `postMetrics`/`listSessions`, assert no new query fires purely from a re-render, per its "does not create a new query after its response renders" case) to cover the 7 newly-fixed components. At minimum, add a fake-timer test advancing past `useStableNow`'s 60s interval and asserting the query key changes (this hook itself doesn't yet have that test angle covered per the async-patterns finding) — put it once in `useStableNow`'s own test coverage rather than duplicating per component.

---

### 5. 🟡 Medium — `.claude/settings.json` deletion mislabeled as docs-only

Commit `46960c2` ("docs(34): split Dashboard ARCH into 16 implementable tasks", message claims "Docs-only change") deleted `.claude/settings.json` (a 9-line `CHANGELOG.md` permission allowlist), which isn't mentioned in ARCH's Change Footprint. Restore the file:

```json
{
  "permissions": {
    "allow": [
      "Read(CHANGELOG.md)",
      "Write(CHANGELOG.md)",
      "Edit(CHANGELOG.md)"
    ]
  }
}
```
(Confirm with the user this deletion was accidental before restoring — if it was intentional tooling cleanup unrelated to this PR, skip and note it in the PR description instead.)

---

### 6. 🟡 Medium — duplicated formatting / series-point-value helpers (Code Quality #3, #4)

**#3 — money formatting:** `RecordsStrip.tsx:38-42` (`formatMoney`), `RecentSessionCard.tsx:13` (`CURRENCY_FORMAT`), `FailedWorkStat.tsx:10` (`COUNT_FORMAT`) each hand-roll an `Intl.NumberFormat` instance duplicating `client/src/charts/units.ts`'s existing `formatUnitValue`/`CURRENCY_FORMAT`. Add a null-safe wrapper to `units.ts`:
```ts
export function formatUnitValueOrDash(value: number | null | undefined, unit: Unit): string {
  return typeof value === "number" && Number.isFinite(value) ? formatUnitValue(value, unit) : "—";
}
```
Update `RecordsStrip.tsx`'s `formatMoney` calls to `formatUnitValueOrDash(value, "$")` and remove its local `MONEY_FORMAT`. `RecentSessionCard.tsx` and `FailedWorkStat.tsx` can keep their non-null-safe direct formatting (their values are always defined at the call site) but should import `CURRENCY_FORMAT`/`INTEGER_FORMAT`-equivalent from `units.ts` rather than re-declaring — only worth doing if `units.ts` exports its format instances (currently module-private); export `CURRENCY_FORMAT` and `INTEGER_FORMAT` from `units.ts` alongside `formatUnitValue`.

**#4 — series point-value extraction:** `pointValue()` is independently reimplemented (same guard, 3 different fallback conventions — `0`, `null`, skip) in `StatCardsRow.tsx:32`, `BurnRateCard.tsx` (`sumSeriesValues`), `SubscriptionWindow.tsx` (`toPoints`), `FailedWorkStat.tsx` (`failedWorkCount`), `LeverageRatio.tsx` (`aggregateValue`), `RecordsStrip.tsx` (`dayRecordRow`'s inline loop). Extract one canonical helper into a new `client/src/charts/series-math.ts`:
```ts
export function pointValue(point: SeriesPoint | undefined): number | null {
  return typeof point?.value === "number" && Number.isFinite(point.value) ? point.value : null;
}
```
Have each of the 6 files import this and apply their own local `?? 0` / skip / keep-null decision at the call site rather than re-deriving the guard itself. `StatCardsRow.tsx`'s existing `pointValue`/`sumPoints`/`combinedSparkline`/etc. helpers (lines 32-53) are the most complete existing implementation — move `pointValue` out to the new shared module and have `StatCardsRow.tsx` import it back, keeping `sumPoints`/`combinedSparkline`/`combinedTotal` local (they're StatCardsRow-specific compositions, not duplicated elsewhere).

---

### 7. 🟡 Medium — `model-metadata.ts` Haiku key mismatch + unlinked TODO

**File:** `server/metrics/model-metadata.ts:21` — catalog key `"claude-haiku-4-5-20251001"` never matches `DEFAULT_PRICING_TABLE`'s `"claude-haiku-4-5"` (`server/metrics/measures.ts:29`). `resolveContextWindow` does exact-string lookup, so `contextPctEstimated` silently resolves `undefined` for every Haiku session — even after real context-window numbers replace the `200_000` placeholders, since the mismatch is absorbed as "unknown model," not surfaced as a bug.

Fix: change the catalog key to `"claude-haiku-4-5"` to match the pricing table (the module's own doc comment at lines 10-13 already says "Model names must match... `DEFAULT_PRICING_TABLE` exactly" — this is a straightforward correction, not a design decision). Update the doc comment's now-stale note about intentionally keeping two different keys "in sync with their respective sources."

Separately: the placeholder `200_000` values for every model (line 18-19 comment: "should be verified against the official Anthropic model reference before production use") is an unlinked TODO. File a follow-up GitHub issue for real per-model context windows and reference it in the comment (`// TODO(#<issue>): ...`) rather than leaving it bare.

---

### 8. 🟡 Medium — duplicated pricing formula (`runtime.ts` vs `priceCall`) — Code Quality #6 + Database/Store #16 (same finding, independently found twice)

**File:** `server/runtime.ts:47-60` — `buildRuntimeMetadata`'s inline `pricer` hand-copies `priceCall`'s formula (`server/metrics/measures.ts:39-50`) rather than delegating, per a comment explaining it avoids "synthesiz[ing] a fake ApiCall." Both only need `(usage, model, pricing)`, not a full `ApiCall`. Extract a shared primitive in `measures.ts`:

```ts
export function priceUsage(usage: TokenUsage, model: string, pricing: PricingTable): number {
  const rate = pricing[model];
  if (!rate) return 0;
  const { inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens } = usage;
  return (inputTokens * rate.input + outputTokens * rate.output +
    cacheReadTokens * rate.cacheRead + cacheCreateTokens * rate.cacheCreate) / 1_000_000;
}

export function priceCall(call: ApiCall, pricing: PricingTable): number {
  return priceUsage(call.usage, call.model, pricing);
}
```
Update `runtime.ts`'s `pricer` to `(usage, model) => priceUsage(usage, model, pricing)`, deleting the hand-copied formula and its justifying comment.

---

### 9. 🟡 Medium — accessibility: `LeaderboardsCard` tablist keyboard nav + `AnomalyFeed` `role="feed"` completeness

**`LeaderboardsCard.tsx:188-203`:** `role="tablist"` is Tab/Enter-operable but has no roving-tabindex arrow-key navigation (Left/Right/Home/End) per the ARIA Tabs pattern. Add an `onKeyDown` handler on the tablist container that:
- On ArrowLeft/ArrowRight, moves `activeTab` to the previous/next entry in `TABS` (wrapping), and moves focus to that tab button.
- On Home/End, jumps to the first/last tab.
Set `tabIndex={0}` only on the active tab's button, `tabIndex={-1}` on the rest, so Tab enters/exits the widget as one stop.

**`AnomalyFeed.tsx:195-207`:** `<ul role="feed">` renders plain `<li>` children with no `role="article"`/`aria-posinset`/`aria-setsize`/`aria-busy`. Given this is a bounded 5-item static list (not a continuously-loading stream), the simpler fix is to **drop `role="feed"`** in favor of a plain `<ul>` (remove the `role="feed"` and `aria-label` attrs, or keep `aria-label` on a plain list) — feed semantics aren't earned by this component's actual behavior. Note this changes the finding's originally-proposed direction (complete-the-contract vs. drop-the-role); dropping is simpler and matches the component's real semantics, so prefer it unless a future change makes this genuinely a live-appending feed.

Also (Low, same file) add distinguishing `aria-label`s to each row's "View →" link (`AnomalyFeedRow`, line ~121), matching `LeaderboardsCard`'s `getRowActionLabel` convention already used elsewhere in this PR: `aria-label={`View session ${item.sessionId}${item.turnId ? `, turn ${item.turnId}` : ""}`}`.

---

### 10. 🟡 Medium — `RecordsStrip` 4× per-mount request pattern (Performance #23)

Accepted as a documented tradeoff per the review (no multi-sort batch capability in `/api/sessions` today) — no code change planned in this pass. Leave as-is; note in the PR description that this was reviewed and accepted, so it isn't re-flagged next review.

---

### 11. 🟡 Medium — `limit` clamp-vs-400 inconsistency (Security #12)

`server/routes/sessions.ts:337-344` (`SESSIONS_MAX_LIMIT` clamp) is explicitly commented as deliberate ("the route never 400s on an oversized page") and matches its own cited test. No code change — confirmed intentional design, not a defect. Leave as-is.

---

### 12. 💭 Low — remaining nits

- **`OPUS_MODEL_KEY` constant** (`server/metrics/measures.ts:163`, `"claude-opus-4-8"` bare string): define `export const OPUS_MODEL_KEY = "claude-opus-4-8";` near `DEFAULT_PRICING_TABLE`, use it in both the pricing table object key and `routingSavingsComputed`'s lookup.
- **Import order** (`server/routes/sessions.ts:1-12`): reorder to shared/* types together, then server-local types, matching the rest of the codebase's convention.
- **`sortValue`/`compareSessions` cast** (`server/routes/sessions.ts:199-213`, `242-244` — corrected line numbers from the report's incorrect `8059-8060`): low-risk as-is; optionally assert `typeof av === "number" && typeof bv === "number"` before the cast in the `else` branch instead of a bare `as number` — skip unless touching this function for another reason, per the review's own "low-risk as-is" framing.
- **`RecentSessionCard.tsx:70`** `trace[0] as TracePoint` cast: leave as-is (guarded by the `trace.length === 0` early return at line 64); only worth hoisting a `const first = trace[0]` narrowing if this function is touched again.
- **`RecentSessionCard.tsx:143` / `LeaderboardsCard.tsx:225`** raw template-literal `/sessions/${id}` hrefs: not exploitable (wouter client nav, UUID-shaped ids), but inconsistent with `ChartCard.tsx`'s `URLSearchParams`-only convention. Low priority — align only if these lines are touched for another reason in this pass; not scheduling a dedicated edit.
- **`StatCard.tsx` sparkline `role="img"` wording** (pre-existing, unmodified by this PR): no action — out of scope, flagged only as a documentation-vs-implementation mismatch to reconcile in a future pass.

---

## Verification

1. `npm run verify` (typecheck → lint → format:check → test) — must pass clean; this exercises every unit/integration test touched above (`measures.test.ts`, `derive-session.test.ts`, `derive-turns.test.ts`, `parse-transcript.test.ts`, `LiveWindowCards.test.tsx` + new sibling coverage, `SavingsDecomposition.test.tsx` unchanged-but-re-verified).
2. `npm run test:e2e` — confirms `cypress/e2e/dashboard.cy.ts` and `steel-thread.cy.ts` still pass after the `AnomalyFeed`/`LeaderboardsCard` prop changes and the `role="feed"` removal.
3. Manual spot-check: run the app against the `44444444-...` fixture session (has cache usage) and confirm the Savings Decomposition card's total now differs from the pre-fix value in the expected direction (lower) — this is the one user-visible number this fix changes.
4. Re-run `/review` (or a focused re-review against `CODE-REVIEW-PR-89.md`'s finding list) after the fixes land, per the original report's offer, to get a clean delta report before merge.
