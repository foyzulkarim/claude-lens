---
title: "#P4-1 — Shared dashboard primitives"
labels: phase-4
milestone: Phase 4 — Pages & features
status: draft
---

Task **#P4-1** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
Shared dashboard primitives

## Scope
- `components/`: stat-card (delta + sparkline), data-table (TanStack Table + virtualization), tier-badge, locked-card ("Set up cost capture" CTA), empty-state, chip. Tailwind, no component library. Built in Storybook first.

## Acceptance criteria
- each primitive has stories covering its states (stat-card delta up/down/flat + sparkline, tier-badge 🟢/🟡/🔴, locked-card CTA, empty-state, table loading/virtualized rows); visual check against the mockups' shared elements.

## Dependencies
- Depends on: P3-5
- Unblocks: P4-2

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
