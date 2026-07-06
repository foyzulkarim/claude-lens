---
title: "#P2-3 — Discovery + polling"
labels: phase-2
milestone: Phase 2 — Data engine (the risk phase)
status: draft
---

Task **#P2-3** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 2.

## Summary
Discovery + polling

## Scope
- `discovery.ts` (fast-glob over roots, filename classification T/C/B/L) and `poller.ts` (fast stat loop 2–5s, slow re-glob ~30s). Mid-run discovery registers brand-new session files.

## Acceptance criteria
- unit tests for classification; a file created after boot is picked up within one slow-loop interval.

## Dependencies
- Depends on: P2-2
- Unblocks: P2-4

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
