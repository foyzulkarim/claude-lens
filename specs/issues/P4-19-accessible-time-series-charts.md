---
title: "#P4-19 — Accessible time-series charts"
labels: phase-4
milestone: Phase 4 — Pages & features
status: draft
---

Task **#P4-19** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary

Complete the shared time-series chart accessibility foundation before Phase 4 pages compose it, so chart data and drill-downs do not depend on seeing or pointing at the canvas.

## Scope

- Expose each chart's range, trend, and bucket values through an equivalent non-canvas representation.
- Provide a focusable keyboard route from each drillable bucket to the same filtered Sessions destination as the canvas interaction.
- Bring loading and error status text to WCAG 2.1 AA contrast.
- Validate the shared behavior with keyboard and screen-reader coverage before page-specific chart work begins.

## Acceptance criteria

- every time-series chart exposes its range, trend, and bucket values without relying on the canvas; every drillable bucket reaches the same filtered Sessions view by keyboard; loading/error status text meets WCAG 2.1 AA contrast; keyboard and screen-reader validation passes.

## Dependencies

- Depends on: #P4-1 / #33
- Unblocks: #P4-2 / #34

## References

- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
- [specs/architecture/ARCH-cypress-steel-thread-smoke.md](../blob/main/specs/architecture/ARCH-cypress-steel-thread-smoke.md) — PR #83's intentionally limited semantic-summary contract
- `CODE-REVIEW-PR-83-Sol.md` A11Y-1
- `CODE-REVIEW-PR-83-opus.md` A11Y-2 and manual contrast check
