---
title: "#P2-8 — Metrics engine: measures, dimensions, grain"
labels: phase-2
milestone: Phase 2 — Data engine (the risk phase)
status: draft
---

Task **#P2-8** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 2.

## Summary
Metrics engine: measures, dimensions, grain

## Scope
- `engine.ts` + `measures.ts` + `dimensions.ts` + `grain.ts`: the single `metrics(query) → Series[]` function; hour/day/week/month bucketing on epoch ms; period-over-period; computed-vs-observed cost labeling.

## Acceptance criteria
- hand-computed numbers from fixtures match engine output for every measure × a sample of dimensions; unit switching is a measure swap only.

## Dependencies
- Depends on: P2-7
- Unblocks: P2-9

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
