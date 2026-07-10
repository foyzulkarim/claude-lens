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
Design and implement the shared TS contracts (`types.ts`, `metrics-contract.ts`, `ws-protocol.ts`) that both server and client import, using the observed-field evidence in `claude-lens-data-model.md` as the source-of-truth for raw field shapes. The data-model doc is evidence-only (no `CompactCall` / `Turn` / `Session` / `TierFlags` contract definitions); this task designs those derived contracts from the evidence.

## Scope
- `shared/types.ts` (`CompactCall`, `Turn`, `Session`, `TierFlags`), `shared/metrics-contract.ts` (`MetricsQuery`, `Series` per `architecture.md` §8), `shared/ws-protocol.ts` (three message shapes per `architecture.md` §7).
- Field evidence comes from `specs/claude-lens-data-model.md` (#P0-7) — observed field name / type / presence / anonymized example across T/C/B/L. This task designs the derived `CompactCall`/`Turn`/`Session`/`TierFlags` contracts from that evidence (which fields to retain, drop, expose); it does not survey raw data itself.

## Acceptance criteria
- types compile and are imported by both server and client stubs; derived `CompactCall`/`Turn`/`Session`/`TierFlags` shapes are consistent with the observed fields catalogued in `claude-lens-data-model.md`. `MetricsQuery`/`Series` conform to `architecture.md` §8; ws-protocol message shapes conform to `architecture.md` §7.

## Dependencies
- Depends on: #P0-7 (field evidence) + #P1-1 (the `shared/` root exists); sequenced after Phase 1 exit
- Unblocks: P2-2

## References
- `specs/claude-lens-data-model.md` (#P0-7 deliverable — the field-level evidence source)
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md) §7 (ws-protocol), §8 (MetricsQuery/Series shapes)
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
