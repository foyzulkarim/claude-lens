---
title: "#P4-12 — Report Card UI + gate feeds"
labels: phase-4
milestone: Phase 4 — Pages & features
status: filed
issue: 44
url: https://github.com/foyzulkarim/claude-lens/issues/44
---

Task **#P4-12** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
Render gate results everywhere they surface: Report Card on Session Detail, feeds on Dashboard, trend on Trends, filter/column on Sessions.

## Scope
- Report Card section on Session Detail; anomaly & gate-failure feed on Dashboard; gate pass-rate trend on Trends; gate-status filter/column on Sessions; replace the Projects gate-pass-rate stub with live results.

## Acceptance criteria
- turn-keyed evidence (V1/V2/P3/C3/K2) deep-links to Turn Inspector at the exact turn; session-keyed E1/E2 evidence links to Session Detail with `filePath`+`detail` (it has no `turnN` — gates.md §1, plan decisions log 2026-07-06).

## Dependencies
- Depends on: #P4-11 / #43
- Unblocks: none — terminal gate-UI integration

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
- [specs/gates.md](../blob/main/specs/gates.md) — evidence-shape contract; Report Card scoring (warn counts half-weight, letter/fraction not a percentage)
