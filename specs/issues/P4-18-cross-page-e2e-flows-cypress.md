---
title: "#P4-18 — Cross-page E2E flows (Cypress)"
labels: phase-4
milestone: Phase 4 — Pages & features
status: filed
issue: 50
url: https://github.com/foyzulkarim/claude-lens/issues/50
---

Task **#P4-18** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
The five cross-page Cypress journeys (search→detail, drill, permalink, export, gate evidence) green in CI — the Phase 4 exit guard.

## Scope
- The journeys that span pages, run against the fixture-root harness from #P3-5: prompt search → Session Detail at the matching turn; drill-anywhere from a Dashboard chart slice → Sessions filtered to that slice; permalink copy → paste reproduces the exact view; CSV export downloads; gate evidence link → Turn Inspector at the exact turn.

## Acceptance criteria
- all five flows green in CI.

## Dependencies
- Depends on: all Phase 4 page and feature issues #35–#49 merged; runs alone with no other Phase 4 work in flight
- Unblocks: none — last in phase

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
