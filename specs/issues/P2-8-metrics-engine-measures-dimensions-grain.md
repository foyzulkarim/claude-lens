---
title: "#P2-8 — Metrics engine: measures, dimensions, grain"
labels: phase-2
milestone: Phase 2 — Data engine (the risk phase)
status: draft
---

Task **#P2-8** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 2.

## Summary
The core `metrics(query) → Series[]` engine: every measure × dimension × grain, period-over-period, computed-vs-observed cost labeling.

## Scope
- `engine.ts` + `measures.ts` + `dimensions.ts` + `grain.ts`: the single `metrics(query) → Series[]` function; hour/day/week/month bucketing on epoch ms; period-over-period; computed-vs-observed cost labeling.
- Ships the default pricing table (model → per-1M rates) that computed-$ multiplies against, per the #P0-7 measure catalog; the #P4-15 pricing editor overrides it.

## Acceptance criteria
- hand-computed numbers from fixtures match engine output for every measure × a sample of dimensions; unit switching is a measure swap only.

## Dependencies
- Depends on: P2-7
- Unblocks: P2-9

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md) §8 (`MetricsQuery` shape + rules; "unit switching is a measure swap" at §8:283)
- [specs/claude-lens-pages.md](../blob/main/specs/claude-lens-pages.md) Data source legend (lines 19-20 — measure + dimension catalog)
