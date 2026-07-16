---
title: "bug: make time-series charts operable without the canvas"
labels: bug, phase-4
milestone: Phase 4 — Pages & features
status: draft
---

## Symptom

Time-series charts expose only a title, series count, and total to assistive technology. Their range, trend, and bucket values remain available only through the canvas, and bucket drill-down is pointer-only. The loading and error text also use light-mode colors below the WCAG AA contrast threshold.

## Repro

1. Open the Dashboard with fixture-backed chart data.
2. Navigate with a screen reader and inspect the `Cost over time` chart.
3. Try to discover individual bucket values and activate the chart's `/sessions?from=…&to=…` drill-down using only the keyboard.
4. Inspect the light-mode loading and error status text against a white background.

## Expected vs actual

Expected: Every chart has an equivalent non-canvas representation of its range, trend, and bucket values; each drillable bucket has a focusable keyboard route to the same filtered Sessions destination; status text meets WCAG 2.1 AA contrast; and the result passes keyboard and screen-reader validation.

Actual: Assistive technology receives only aggregate image metadata, the canvas click target has no keyboard equivalent, and the existing light-mode status colors fall below 4.5:1.

## Suspected area

The shared `Chart` / `ChartCard` presentation boundary introduced in PR #83 and reused by the Phase 4 page work. Source findings: `CODE-REVIEW-PR-83-Sol.md` A11Y-1 and `CODE-REVIEW-PR-83-opus.md` A11Y-2 plus its manual contrast check. PR #83 intentionally remains limited by `specs/architecture/ARCH-cypress-steel-thread-smoke.md` to the semantic-summary contract.
