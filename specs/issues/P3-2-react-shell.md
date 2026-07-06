---
title: "#P3-2 — React shell"
labels: phase-3
milestone: Phase 3 — Steel thread (milestone)
status: draft
---

Task **#P3-2** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 3.

## Summary
React shell

## Scope
- `main.tsx`/`App.tsx`: wouter routes (all 11 page stubs), `QueryClientProvider`, query-key factory in `api/`, `ws.ts` with hand-rolled reconnect/backoff invalidating by key prefix, layout chrome.

## Acceptance criteria
- navigation works; WS reconnects after server restart; only mounted queries refetch on invalidation.

## Dependencies
- Depends on: P3-1
- Unblocks: P3-3

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
