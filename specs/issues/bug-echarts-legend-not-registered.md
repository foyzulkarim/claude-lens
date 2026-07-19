---
title: "bug: ECharts legend silently dropped in shared Chart wrapper"
labels: bug,phase-4
milestone: Phase 4 — Pages & features
status: filed
issue: 94
url: https://github.com/foyzulkarim/claude-lens/issues/94
---

## Symptom
Any chart built through the shared `client/src/charts/Chart.tsx` wrapper whose ECharts option sets `legend: {...}` rendered with **no legend** — the chart itself drew fine, but ECharts logged a console error instead of throwing, so the gap went unnoticed until manual visual verification.

## Repro
1. Run `npm run dev`, visit `/models` or `/cache` with a fixture range that has multiple series (e.g. Model mix over time, which stacks per-model series).
2. Open the browser console.
3. Observe: `[ECharts] Component legend is used but not imported.` and no legend rendered above/near the chart.

Confirmed on both `/models` (discovered while double-checking #40's completion) and the already-shipped `/cache` (Cache Lab, #41/#P4-9) — both pages' `chart-options.ts` set `legend: {...}`.

## Expected vs actual
- Expected: chart legend renders, mapping series color → label (e.g. model name), matching `models.html` / `cache-lab.html` mockups.
- Actual: legend silently absent; only a console error hints at the cause.

## Suspected area
`client/src/charts/Chart.tsx` — `echarts.use([...])` registered `LineChart, BarChart, ScatterChart, GridComponent, TooltipComponent, CanvasRenderer` but never `LegendComponent`, even though downstream option builders (`pages/models/chart-options.ts`, `pages/cache-lab/chart-options.ts`) both include a `legend` key in their `ComposeOption` unions and rendered options.

## Resolution
Already fixed directly on the `feat/40/models` branch as part of verifying #40 (Models page) was complete: added `LegendComponent` to both the `echarts.use([...])` registration and the `ChartOption` type union in `client/src/charts/Chart.tsx`, and updated the `echarts/components` mock in `client/src/charts/Chart.test.tsx` to include `LegendComponent`. Filed here as a closed record for changelog/history purposes — no open work remains.
