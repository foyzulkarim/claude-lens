---
title: "#P2-1 — Shared contracts"
labels: phase-2
milestone: Phase 2 — Data engine (the risk phase)
status: draft
---

Task **#P2-1** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 2.

## Summary
Shared contracts

## Scope
- `shared/types.ts` (`CompactCall`, `Turn`, `Session`, `TierFlags`), `shared/metrics-contract.ts` (`MetricsQuery`, `Series` per §8), `shared/ws-protocol.ts` (three message shapes per §7).

## Acceptance criteria
- types compile and are imported by both server and client stubs; contract shapes match §7/§8 field-for-field.

## Dependencies
- Depends on: P1-5
- Unblocks: P2-2

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
