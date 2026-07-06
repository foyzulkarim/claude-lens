---
title: "#P2-6 — Store + derivations"
labels: phase-2
milestone: Phase 2 — Data engine (the risk phase)
status: draft
---

Task **#P2-6** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 2.

## Summary
Store + derivations

## Scope
- `store.ts` columnar arrays; `derive-turns.ts` (promptId grouping, sidechain attribution); `derive-session.ts` (rollups, per-session tier detection); `invalidation.ts` (dirty-set, 200–500ms per-session debounce, emit hook). Incremental updates touch only the affected session; cross-session aggregates invalidate lazily.

## Acceptance criteria
- fixture tests for turn grouping and rollups; appending calls to one session leaves other sessions' derived state untouched.

## Dependencies
- Depends on: P2-5
- Unblocks: P2-7

## References
- [specs/gates.md](../blob/main/specs/gates.md)
