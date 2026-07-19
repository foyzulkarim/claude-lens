---
title: "#P4-20 — Dashboard live-update flicker fix"
labels: bug, phase-4
milestone: Phase 4 — Pages & features
status: draft
---

Task **#P4-20** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4, filed as a follow-up on the already-closed #P4-2 (Dashboard page), not a reopen — the page matches its mockup; this is a regression under concurrent load, not a missing section.

## Summary

Under several concurrently-active Claude Code sessions, the dashboard visibly flickers and `SubscriptionWindow` intermittently flashes back to its `Loading…` state instead of updating in place. Root-caused during a discussion about whether a Rust/Go server rewrite would help — it wouldn't: the mechanism is entirely client-side (invalidation fan-out, self-churning query keys, full chart redraws), and the server's per-request path is confirmed in-memory only, never re-reading transcript files.

## Symptom / repro

1. Start 3+ concurrent Claude Code sessions writing to different transcripts under the same watched root.
2. Open the dashboard and let it sit for a minute or two while all sessions are actively producing turns.
3. Observe: `SubscriptionWindow` intermittently flashes `Loading…` instead of updating its bars in place; other chart cards visibly redraw/flicker on the same cadence. Does not reproduce with a single active session — severity scales with concurrent-session count.

**Expected:** live updates land in place — bar/number changes, no loading-state flashes, no visible chart redraw.

## Root cause

1. **Per-session invalidation fan-out is coarse** (`server/store/invalidation.ts`, `client/src/ws.ts`). The store debounces invalidation *per session* (default 300ms); N concurrently-active sessions independently emit `session-updated` within the same rough window. `invalidateForMessage` (`client/src/ws.ts:58-68`) maps every `session-updated`/`session-added` to the **entire** `metrics`/`sessions` query-key prefixes, not just the affected session — every mounted chart refetches on *every* session's flush, so N sessions produce N dashboard-wide refetch waves per debounce window instead of one coalesced wave.
2. **`SubscriptionWindow`'s query keys churn on every flush** (`client/src/pages/dashboard/SubscriptionWindow.tsx:242-248`). It probes `/api/sessions` for `meta.matchedExtent`, then embeds the probe's `extentFrom`/`extentTo` directly into the four hourly metrics queries' keys. `matchedExtent.to` advances on every append to any in-scope session, so each invalidation wave mints **new** query keys — cache misses, not refetches of an existing entry — which `placeholderData: keepPreviousData` (bridges same-key transitions only) can't fully smooth. While the upstream probe is pending, `isPending` is true and the card renders `Loading…` (line 305-309).
3. **Browser connection queueing amplifies it.** Each invalidation wave fires well over a dozen simultaneous queries across the dashboard's cards; HTTP/1.1 same-origin connection limits (~6 concurrent in Chromium) queue the rest, stretching the `SubscriptionWindow` probe's pending window long enough to be visibly caught mid-flight.
4. **Charts redraw instead of updating in place** (`client/src/charts/Chart.tsx:69`). `setOption(option, { notMerge: true })` discards existing series and rebuilds from scratch on every option change, rather than letting ECharts diff/merge/animate. Combined with (1)'s cadence, this is what reads as flicker on charts not showing a loading state at all.

**Ruled out:** a server-language/runtime rewrite. `server/ingest/tailer.ts`'s `readGrowth` only reads bytes appended past a saved offset (`handle.read(buffer, 0, length, state.offset)`), runs only on the ingest/poll path, never inside a request handler. Per-request work in `server/store/` and the metrics engine is in-memory aggregation over the already-parsed columnar store — an infinitely fast server would reproduce this exact symptom, since the mechanism is invalidation fan-out + query-key churn + client redraw strategy, not request latency.

## Scope

Three independent changes; recommended order is by leverage-to-risk ratio, not strict sequencing:

- **Coalesce metrics-prefix invalidation across sessions.** Either (a) client-side: debounce/throttle `queryClient.invalidateQueries({ queryKey: qk.prefixes.metrics })` in `client/src/ws.ts` so K `session-updated` messages within a short window collapse to one invalidation, or (b) server-side: batch the broadcaster so multiple sessions settling within the same tick emit one combined WS message. (b) fixes the fan-out at the source for every future consumer but touches `server/store/invalidation.ts` and `server/ws/broadcaster.ts`; (a) is the smaller, purely client-side change — start there to validate cheaply, then decide if (b) is worth it.
- **Stabilize `SubscriptionWindow`'s query key.** Round `extentTo` to the enclosing hour bucket before it enters `qk.metrics(...)`. The metrics query is already hour-grain, so sub-hour movement of `extentTo` can't change which buckets come back — only key identity — so rounding is lossless for the card's own math while making repeated probes hit the same cache entry instead of minting a new one. Needs a rounding-direction decision (floor vs. ceil — likely ceil, to keep the in-progress hour's partial data included).
- **Switch live chart updates away from full-redraw semantics.** In `client/src/charts/Chart.tsx`, replace `setOption(option, { notMerge: true })` with `replaceMerge: ["series"]` (or equivalent) for the live-refetch path; consider disabling entrance animation specifically on refetch-driven updates (first-mount animation can stay). Requires confirming no existing chart consumer relies on `notMerge`'s full-reset behavior (e.g. structural measure/dimension changes that must clear stale series) — likely keep `notMerge: true` for those and only relax it for same-shape data refreshes. Check Storybook stories + snapshot tests for `notMerge`-dependent behavior before relaxing.

The first two are small and dashboard-scoped and should eliminate the `SubscriptionWindow` loading-flash and most of the refetch-driven flicker on their own; the chart-merge change is a separate, slightly broader change to the shared `Chart` component and can land independently once its blast radius across existing chart consumers is confirmed.

## Acceptance criteria

- With 3+ concurrent Claude Code sessions active, the dashboard's `SubscriptionWindow` and chart cards update in place with no loading-state flashes and no full chart redraws.
- #P4-2/#P4-19's existing acceptance criteria remain green.

## Dependencies

- Depends on: #P4-2 (Dashboard page), #P4-19 (accessible time-series charts) — both already shipped; this is a follow-up fix, not blocked on new work.
- Unblocks: none currently.

## References

`client/src/ws.ts`, `client/src/pages/dashboard/SubscriptionWindow.tsx`, `client/src/charts/Chart.tsx`, `server/ingest/tailer.ts`, `server/store/invalidation.ts`; `specs/claude-lens-plan.md` #P4-20 entry and 2026-07-19 decisions-log row.
