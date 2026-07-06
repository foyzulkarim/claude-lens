---
title: "#P4-11 — Gates engine"
labels: phase-4
milestone: Phase 4 — Pages & features
status: draft
---

Task **#P4-11** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
Gates engine

## Scope
- *(gates.md)* `gates/engine.ts` + six gate files (V1, V2, P3, C3, K2, E1/E2); shared preprocessing (dedupe, sidechain exclusion, edit/command call classification); evidence with Turn Inspector deep-links; session scoring per gates.md; configurable thresholds.

## Acceptance criteria
- per-gate fixture tests including N/A-turn denominators and E1/E2 filesystem checks (labeled "as of now").

## Dependencies
- Depends on: P4-10
- Unblocks: P4-12

## References
- [specs/gates.md](../blob/main/specs/gates.md)
