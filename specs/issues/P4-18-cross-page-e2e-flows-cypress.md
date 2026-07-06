---
title: "#P4-18 — Cross-page E2E flows (Cypress)"
labels: phase-4
milestone: Phase 4 — Pages & features
status: draft
---

Task **#P4-18** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
Cross-page E2E flows (Cypress)

## Scope
- The journeys that span pages, run against the fixture-root harness from #P3-5: prompt search → Session Detail at the matching turn; drill-anywhere from a Dashboard chart slice → Sessions filtered to that slice; permalink copy → paste reproduces the exact view; CSV export downloads; gate evidence link → Turn Inspector at the exact turn.

## Acceptance criteria
- all five flows green in CI.

## Dependencies
- Depends on: P4-17
- Unblocks: none — last in phase

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
