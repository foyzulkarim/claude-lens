---
title: "#P2-9 — Distributions + smoothing + compare"
labels: phase-2
milestone: Phase 2 — Data engine
status: filed
issue: 26
url: https://github.com/foyzulkarim/claude-lens/issues/26
---

Task **#P2-9** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 2.

## Summary
Distribution mode (percentiles, histograms, pareto), `ma7` smoothing, and previous-period compare alignment for the metrics engine.

## Scope
- `distributions.ts`: percentiles, histograms, pareto (`mode: "distribution"`); `ma7` smoothing; `compare: "previous-period"` alignment.

## Acceptance criteria
- percentile/histogram tests against known inputs; previous-period alignment correct across DST/month boundaries at each grain.

## Dependencies
- Depends on: P2-8
- Unblocks: P2-10

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md) §8 (mode/compare/smoothing in `MetricsQuery`), §13 (testing priorities)
- [specs/claude-lens-pages.md](../blob/main/specs/claude-lens-pages.md) §8 (Pareto panel definition)
