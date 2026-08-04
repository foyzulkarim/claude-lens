---
title: "#P6-5 — Recommendation cards"
labels: phase-6
milestone: Phase 6 — Comprehension, differentiation & distribution
status: draft
---

Task **#P6-5** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 6.

## Summary

Productize gate (#P4-11/#P4-12), anomaly (#P4-2) and efficiency-lever (#P8-1) output into prescriptive, evidence-backed cards: what happened, why it matters, what to do, and a link to the proof. The differentiated core — turns Claude Lens from mirror to advisor.

## Scope

- Four elements per card: **what happened** / **why it matters** (reuses #P6-2's copy verbatim, never re-authored) / **what to do** / **proof link** (reuses #P6-3's evidence links).
- **Sources levers from #P8-1 rather than re-deriving recommendations from raw gate/anomaly output** — see the 2026-08-04 decisions-log row. The same ranked analysis then serves the cards, the MCP opinion layer (#P7-2), the headless report (#P8-3) and the PR action (#P8-9).
- Deterministic: no LLM in the server.

## Acceptance criteria

- Recommendation cards render from real gate/anomaly output with all four elements present and the proof link landing on the exact Turn Inspector turn.

## Dependencies

- Depends on: #P6-2, #P6-3, #P6-4, #P8-1.
- Unblocks: #P7-2.

## References

- `specs/gates.md`, `specs/claude-lens-pages.md` §1 (anomaly feed), §3 (Report Card).
- 2026-08-04 decisions-log row — why levers, not raw gate output, are the input.
