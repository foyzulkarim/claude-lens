---
title: "#P6-6 — Premium-tier end-to-end polish"
labels: phase-6
milestone: Phase 6 — Comprehension, differentiation & distribution
status: draft
---

Task **#P6-6** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 6.

## Summary

Finish the observed-value tier as a coherent surface: clean transcript-only vs premium separation, graceful degradation when hooks are absent. In practice this is mostly closing out #P4-14 (Data Health reconciliation sections), which was blocked on #P4-13 — now done.

## Scope

- Ship #P4-14: Data Health reconciliation sections (computed vs sampled vs logged $), boundary/promptId mismatches, unbucketed tails, capture gaps.
- Tier separation reads as one coherent surface across Session Detail, Sessions, Models, Cache Lab, Data Health.
- Never substitute `0` for an unavailable observed value (`AGENTS.md`); 🔴 stays 🔴.

## Acceptance criteria

- #P4-14 ships; tier separation reads as one coherent surface across Session Detail, Sessions, Models, Cache Lab, Data Health.

## Dependencies

- Depends on: #P4-13 (done); #P4-14 / issue #46 is this task's main remaining scope.

## References

- `specs/claude-lens-pages.md` §9 (Data Health), §3, §6, §7.
- `server/ingest/parse-premium.ts` — C/B/L parsing.
