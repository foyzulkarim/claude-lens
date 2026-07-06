---
title: "#P3-2 — React shell"
labels: phase-3
milestone: Phase 3 — Steel thread
status: filed
issue: 29
url: https://github.com/foyzulkarim/claude-lens/issues/29
---

Task **#P3-2** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 3.

## Summary
The React shell: wouter routes for all 11 page stubs, TanStack Query with a query-key factory, and the reconnecting WS client that invalidates by key prefix.

## Scope
- `main.tsx`/`App.tsx`: wouter routes (all 11 page stubs), `QueryClientProvider`, query-key factory in `api/`, `ws.ts` with hand-rolled reconnect/backoff invalidating by key prefix, layout chrome.

## Acceptance criteria
- navigation works; WS reconnects after server restart; only mounted queries refetch on invalidation.

## Dependencies
- Depends on: P3-1
- Unblocks: P3-3

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md) §7 (invalidation bus, key-prefix invalidation), §11 (frontend architecture — the 11 page-stub routes)
