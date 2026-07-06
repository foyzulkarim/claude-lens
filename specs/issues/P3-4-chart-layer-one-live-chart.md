---
title: "#P3-4 — Chart layer + one live chart"
labels: phase-3
milestone: Phase 3 — Steel thread (milestone)
status: draft
---

Task **#P3-4** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 3.

## Summary
Chart layer + one live chart

## Scope
- *(the demo milestone)* ECharts wrapper (~50-line mount/setOption/ResizeObserver/dispose — no `echarts-for-react`); timeseries option builder; unit switcher, compare ghost, smoothing, granularity, click-to-drill implemented **in this layer** per §11. Mount one cost-over-time chart on the Dashboard stub.

## Acceptance criteria
- with Claude Code running a real session, the chart updates within a few seconds without reload. **Go/no-go checkpoint for Phase 4.**

## Dependencies
- Depends on: P3-3
- Unblocks: P3-5

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
