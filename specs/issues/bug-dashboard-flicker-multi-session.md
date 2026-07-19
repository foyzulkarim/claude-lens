---
title: "bug: dashboard charts flicker / reload under concurrent multi-session load"
labels: bug, phase-4
milestone: Phase 4 — Pages & features
status: draft
---

## Symptom

With several Claude Code sessions active concurrently, the dashboard (`client/src/pages/dashboard/`) visibly flickers: mounted charts redraw from scratch repeatedly, and cards that run a probe-then-query pattern (currently only `SubscriptionWindow`) flash back to their "Loading…" state instead of updating smoothly in place. Two screenshots of the same dashboard, seconds apart, show `SubscriptionWindow` swap between a `Loading…` placeholder and its populated 5h/7d bars.

This does not happen with a single active session — it scales with the number of concurrently-active sessions.

## Repro

1. Start 3+ concurrent Claude Code sessions writing to different transcripts under the same watched root.
2. Open the dashboard and let it sit for a minute or two while all sessions are actively producing turns.
3. Observe: `SubscriptionWindow` intermittently flashes `Loading…` instead of updating its bars in place; other chart cards visibly redraw/flicker on the same cadence.

## Expected vs actual

- **Expected:** live updates land smoothly — bar/number changes, no loading-state flashes, no visible chart redraw.
- **Actual:** cards flash to a loading state and charts appear to fully redraw on every session's flush, with the effect compounding as more sessions are active simultaneously.

## Root cause analysis

Confirmed by reading the ingest, WS, and dashboard-query code (not the server's per-request compute path, which is in-memory only — see "Ruled out" below).

**1. Per-session invalidation fan-out is coarse (`server/store/invalidation.ts`, `client/src/ws.ts`).** The store debounces invalidation *per session* (default 300ms), so N concurrently-active sessions can each independently emit a `session-updated` message within the same rough window. `invalidateForMessage` (`client/src/ws.ts:58-68`) maps every `session-updated`/`session-added` to the **entire** `metrics` and `sessions` query-key prefixes — not just the affected session — so every mounted chart on the dashboard refetches on *every* session's flush. With N active sessions this is N refetch waves per debounce window instead of one coalesced wave.

**2. `SubscriptionWindow`'s query keys churn on every flush (`client/src/pages/dashboard/SubscriptionWindow.tsx`).** This card runs a two-stage query: it probes `/api/sessions` for `meta.matchedExtent`, then embeds `extentFrom`/`extentTo` from that probe directly into the query keys of four hourly metrics queries (lines 242-248: `range: { from: extentFrom, to: extentTo }` inside `qk.metrics(...)`). Since `matchedExtent.to` advances on every append to any in-scope session, each invalidation wave mints **new** query keys for all four metrics queries — these are cache misses, not refetches of an existing entry, so `placeholderData: keepPreviousData` (which bridges same-key transitions) does not fully smooth them. While the upstream probe itself is pending, the card's `isPending` is true and it renders `Loading…` (line 305-309).

**3. Browser connection queueing amplifies the effect.** Each invalidation wave produces well over a dozen simultaneous query fetches across the dashboard's cards. HTTP/1.1 same-origin connection limits (~6 concurrent in Chromium) queue the rest, stretching the `SubscriptionWindow` probe's pending window long enough to be visibly caught mid-flight.

**4. Charts redraw instead of updating in place (`client/src/charts/Chart.tsx:69`).** `chartRef.current?.setOption(option, { notMerge: true })` discards the existing series on every option change and rebuilds from scratch, rather than letting ECharts diff/merge/animate the transition. Combined with (1)'s refetch cadence, this is what reads as "flicker" on charts that aren't showing a loading state at all — they're just repainting on a fast, avoidable cadence.

**Ruled out:** the server does not re-read or re-parse transcript files to answer a request. `server/ingest/tailer.ts`'s `readGrowth` only reads bytes appended past a saved offset (`handle.read(buffer, 0, length, state.offset)`), and it runs only on the ingest/poll path, never inside a request handler. Per-request work in `server/store/` and the metrics engine is in-memory aggregation over the already-parsed columnar store. This rules out a server-language/runtime rewrite (Rust/Go) as a fix — an infinitely fast server would reproduce this exact symptom, since the mechanism is invalidation fan-out + query-key churn + client redraw strategy, not request latency.

## Suspected area

- `server/store/invalidation.ts` / `client/src/ws.ts` — invalidation granularity and prefix fan-out.
- `client/src/pages/dashboard/SubscriptionWindow.tsx` — self-churning query keys via `extentFrom`/`extentTo`.
- `client/src/charts/Chart.tsx` — `notMerge: true` on every `setOption`.

## Proposed fix

Three independent changes, each with standalone value; recommended order is by leverage-to-risk ratio, not strict sequencing:

1. **Coalesce metrics-prefix invalidation across sessions.** Either (a) client-side: debounce/throttle `queryClient.invalidateQueries({ queryKey: qk.prefixes.metrics })` in `client/src/ws.ts` so K session-updated messages within a short window collapse to one invalidation, or (b) server-side: batch the broadcaster so multiple sessions settling within the same tick emit one combined WS message. (b) is more correct (fixes the fan-out at the source for every future consumer, not just this client) but touches `server/store/invalidation.ts` and `server/ws/broadcaster.ts`; (a) is a smaller, purely client-side change. Recommend starting with (a) to validate the fix cheaply, then evaluate whether (b) is worth doing for other consumers.

2. **Stabilize `SubscriptionWindow`'s query key.** Round `extentTo` (and correspondingly the derived `extentFrom` usage) to the enclosing hour bucket before it enters `qk.metrics(...)`. The metrics query is already hour-grain, so sub-hour movement of `extentTo` cannot change which buckets come back — only the key identity — meaning this rounding is lossless for the card's own math while making repeated probes hit the *same* cache entry (a true refetch `keepPreviousData` can bridge) instead of minting a new one. Precise rounding boundary needs a decision: floor to the hour, or ceil — pick whichever keeps the current/latest hour's partial data included (likely ceil, to avoid dropping the in-progress hour).

3. **Switch live chart updates away from full-redraw semantics.** In `client/src/charts/Chart.tsx`, replace `setOption(option, { notMerge: true })` with `replaceMerge: ["series"]` (or equivalent partial-merge option) for the live-refetch path, and consider disabling entrance animation on refetch-driven updates specifically (first-mount animation can stay). Needs a pass over existing chart consumers to confirm none rely on `notMerge`'s full-reset behavior (e.g. category/dimension changes that must clear stale series) — likely worth keeping `notMerge: true` for structural option changes (different measures/dimensions) and only relaxing it for same-shape data refreshes.

Suggest (1a) + (2) as the first fix — both are small, dashboard-scoped, and should eliminate the `SubscriptionWindow` Loading-flash and most of the refetch-driven flicker on their own. (3) is a separate, slightly broader change to the shared `Chart` component and can land independently once its blast radius across existing chart consumers is confirmed (check Storybook stories + snapshot tests for `notMerge`-dependent behavior first).

## References

Conversation analysis in this session (dashboard flicker root-cause discussion); `client/src/ws.ts`, `client/src/pages/dashboard/SubscriptionWindow.tsx`, `client/src/charts/Chart.tsx`, `server/ingest/tailer.ts`, `server/store/invalidation.ts`.
