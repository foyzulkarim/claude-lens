---
title: "#P2-9 — Distributions + smoothing + compare"
labels: phase-2
milestone: Phase 2 — Data engine (the risk phase)
status: draft
---

Task **#P2-9** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 2.

## Summary
Distributions + smoothing + compare

## Scope
- `distributions.ts`: percentiles, histograms, pareto (`mode: "distribution"`); `ma7` smoothing; `compare: "previous-period"` alignment.

## Acceptance criteria
- percentile/histogram tests against known inputs; previous-period alignment correct across DST/month boundaries at each grain.

## Dependencies
- Depends on: P2-8
- Unblocks: P2-10

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
