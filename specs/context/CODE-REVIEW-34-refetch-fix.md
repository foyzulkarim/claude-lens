---
name: code-review-34-refetch-fix
description: "Code review of commit 41a3cf6 (stop dashboard refetch storms and 400s from unstable query ranges) — issue #34 / #P4-2"
type: review
source: local
---

# Code review: `41a3cf6` — stop dashboard refetch storms and 400s from unstable query ranges

Reviewed range: `git diff HEAD~1...HEAD` on `feat/34/dashboard-page`, commit `41a3cf6`.
Method: 8 finder angles (line-by-line, removed-behavior, cross-file, reuse, simplification,
efficiency, altitude, CLAUDE.md conventions) + 1-vote verification on the top candidates.

## Status

Fixed. Findings 1–3 addressed in the same branch:

- **Finding 1** (frozen `now`): extracted `client/src/pages/dashboard/useStableNow.ts`, a hook
  that keeps `now` stable across renders (no per-render query-key churn) but ticks on its own
  60s interval when no `injectedNow` is supplied, so month/window boundaries and the countdown
  roll forward without a page reload. Both `BurnRateCard` and `SubscriptionWindow` now use it —
  this also resolves finding 3 (the duplicated inline pattern), since both cards now share one
  hook instead of two copies.
- **Finding 2** (sort-order sentinel): `compareSessions` in `server/routes/sessions.ts` now
  special-cases `lastAt === ""` to always sort last, regardless of `order`. Covered by a new test
  (`sort=lastAt always places a session with no parsed calls yet ... last, regardless of order`).

Filed here (rather than only in the PR description) so the findings and their resolution survive
until `#34`/`#P4-2` closes and this context gets archived to the wiki.

## Findings

### 1. CONFIRMED — Frozen `now` regression (BurnRateCard / SubscriptionWindow)

**Files:** `client/src/pages/dashboard/BurnRateCard.tsx:76`, `client/src/pages/dashboard/SubscriptionWindow.tsx:158`

The refetch-storm fix replaced `now = new Date()` (a default parameter, fresh every render) with:

```ts
const now = useMemo(() => injectedNow ?? new Date(), [injectedNow]);
```

No real caller passes `injectedNow` — `client/src/pages/Dashboard.tsx` renders both cards with
no props (`<BurnRateCard />`, `<SubscriptionWindow />`). Since `injectedNow` is permanently
`undefined`, the memo's dependency never changes, so `now` is computed once at mount and frozen
for the component's entire lifetime.

**Failure scenario:** a user opens the dashboard and leaves the tab open. New spend is ingested;
a WS `session-updated` message fires `queryClient.invalidateQueries()`, which re-runs the
*existing* query object — but `now`/`monthStart`/`query.range.to` never change, so the refetch
requests the identical range as the initial mount. New activity is silently excluded from MTD
spend and the month-end projection forever (and if the session spans a UTC month boundary,
BurnRateCard never rolls to the new month) until a full page reload. The same mechanism in
SubscriptionWindow additionally freezes the rolling 5h/7d window and its "resets in Xh Ym"
countdown.

Verified independently by three finder angles (line-by-line, removed-behavior audit, altitude)
and confirmed by a dedicated verifier that read `Dashboard.tsx`, `ws.ts`'s
`invalidateForMessage`/`onopen`, and both card components end-to-end — no `setInterval`,
`useEffect` timer, or other periodic-refresh mechanism exists anywhere in the chain.

**Suggested direction:** either restore liveness deliberately (e.g. round `now` to a stable
granularity — minute/hour — inside the query key so it both stays stable across renders *and*
advances on a sane cadence) or add an explicit periodic refresh (interval bumping local state)
rather than freezing `now` permanently at mount.

### 2. CONFIRMED — Session list sort still broken for the same `""` sentinel

**File:** `server/routes/sessions.ts:357` (sort) vs. `:363` (new filter)

The commit added a `timestamped = matched.filter((s) => s.firstAt !== "" && s.lastAt !== "")`
guard before computing `matchedExtent`, to stop the `""` unset-sentinel (sessions with no parsed
calls yet, per `server/store/derive-session.ts`) from poisoning the min/max extent. But
`matched.sort((a, b) => compareSessions(a, b, sort, order))` runs *before* that filter and is
never guarded — the same sentinel class still corrupts list ordering.

**Failure scenario:** default `GET /api/sessions` uses `sort=lastAt, order=desc`. A session with
`lastAt === ""` compares via `"".localeCompare(realDate) < 0`; negated for `desc`, this pushes
the in-progress session to the very bottom of the "most recent first" list (potentially off page
1 given the default limit of 25). With `?sort=lastAt&order=asc` it instead jumps to the very top.
The diff's own new test (`s-empty` in `sessions.test.ts`) proves such a session reaches `matched`
— the exact array this sort runs over. This is the identical bug class the commit explicitly
fixed for `matchedExtent`, left unfixed for ordering.

**Suggested direction:** extend the same sentinel-awareness to the comparator (e.g. treat `""` as
sorting last regardless of `order`, or share a `hasTimestamps(session)` predicate between the sort
and the extent filter so the sentinel's meaning is guarded in one place rather than reimplemented
per call site — `server/store/derive-session.ts` already encodes this rule for duration
computation).

### 3. Cleanup — Duplicated "stable now" pattern

**Files:** `client/src/pages/dashboard/BurnRateCard.tsx:76`, `SubscriptionWindow.tsx:158`
(and the pre-existing sibling pattern `useMemo(() => new Date(), [])` in
`AnomalyFeed.tsx:141`, `LeaderboardsCard.tsx:127`)

`const now = useMemo(() => injectedNow ?? new Date(), [injectedNow])` is duplicated verbatim
(only the comment differs) between the two touched files, with no shared hook — and the same
directory already has two more variants of "freeze `new Date()` once" nearby.

**Cost:** the dashboard is expected to grow more live-window cards (architecture doc frames the
page as preset queries + layout). Without a single named `useStableNow(injectedNow?)` hook, the
next card is more likely to copy the old buggy `now = new Date()` default-param pattern (3 of 4
existing precedents look like that) than the fixed one, reintroducing the refetch-storm bug this
commit exists to prevent.

## Findings investigated and refuted / dropped

- **Cypress `cy.wait(750)`/`cy.wait(1000)` flakiness** (`cypress/e2e/dashboard.cy.ts`) —
  REFUTED. The reconnect backoff (`BASE_DELAY_MS = 500` in `client/src/ws.ts`) only applies to
  reconnects after a prior close, never to the first connection attempt, and the e2e harness
  (`scripts/e2e.ts`'s `waitForReady()`) only starts Cypress once the built server is already
  serving live fixture responses. 750ms is generous for a loopback fixture-server handshake.
- `timestamped` filter allocating an extra array before the extent loop — real but minor
  (sub-millisecond at realistic session counts); not included as a top finding.
- `server/routes/sessions.test.ts`'s new test hardcodes `total: 21` (fixture-count-coupled) —
  minor test fragility, not included as a top finding.
- `useMemo` is technically a "hint, not a guarantee" per React docs (cache could theoretically be
  evicted and `new Date()` re-run) — theoretically real but not a practically actionable risk in
  this codebase; noted here only for completeness, not filed as a standalone finding.
