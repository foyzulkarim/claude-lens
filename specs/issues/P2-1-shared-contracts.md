---
title: "#P2-1 — Shared contracts"
labels: phase-2
milestone: Phase 2 — Data engine
status: filed
issue: 18
url: https://github.com/foyzulkarim/claude-lens/issues/18
---

Task **#P2-1** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 2.

## Summary
Transcribe the data-model spec into the shared TS contracts (`types.ts`, `metrics-contract.ts`, `ws-protocol.ts`) that both server and client import.

## Scope
- `shared/types.ts` (`CompactCall`, `Turn`, `Session`, `TierFlags`), `shared/metrics-contract.ts` (`MetricsQuery`, `Series` per §8), `shared/ws-protocol.ts` (three message shapes per §7).
- Field definitions come from `specs/claude-lens-data-model.md` (#P0-7) — this task transcribes, it does not design.

## Acceptance criteria
- types compile and are imported by both server and client stubs; contract shapes match `claude-lens-data-model.md` (and §7/§8 where it defers to them) field-for-field.

## Dependencies
- Depends on: #P0-7 (field definitions) + #P1-1 (the `shared/` root exists); sequenced after Phase 1 exit
- Unblocks: P2-2

## References
- `specs/claude-lens-data-model.md` (#P0-7 deliverable — the field-level source of truth)
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
