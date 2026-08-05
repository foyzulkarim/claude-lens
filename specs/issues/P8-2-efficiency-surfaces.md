---
title: "#P8-2 — Efficiency surfaces (Dashboard + Session Detail)"
labels: phase-8
milestone: Phase 8 — Growth
status: draft
---

Task **#P8-2** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 8.

## Summary

Render #P8-1's levers as preset layouts over the engine — a fleet-level ranked panel on the Dashboard and a per-session report on Session Detail — keeping the "pages are deliberately cheap" rule intact.

## Scope

- **Dashboard**: extend the shipped "Biggest lever this week" card from one event to a ranked set. The existing single-event card is spec'd as "one event only, never a list" in `claude-lens-pages.md` §1 — that line needs updating in the pages spec **before** this changes, per the standing rule that spec deviations are edited into the doc first.
- **Session Detail**: a per-session efficiency report beside the existing Cache Scorecard, with its own heading so the two grades are never confused (same disambiguation rule the Cache Scorecard already follows against the Report Card).
- Every lever row deep-links to its evidence turn in Turn Inspector.
- Pages consume `efficiency()` output through a route; no page-level aggregation of raw records.
- Respects the global filter bar and URL-encoded filter state.

## Acceptance criteria

- Both surfaces render from real `efficiency()` output with per-lever token/$ attribution and a working deep link into Turn Inspector.
- No page-level aggregation of raw records.

## Dependencies

- Depends on: #P8-1 (levers), #P6-3 (evidence links).
- Unblocks: #P6-5 — recommendation cards consume levers rather than re-deriving them.

## References

- `specs/claude-lens-pages.md` §1 (Dashboard, "Biggest lever this week") and §3 (Session Detail, Cache Scorecard) — **§1's one-event line must be amended first**.
- `specs/pages/dashboard.html`, `specs/pages/session-detail.html` — visual reference, not exhaustive contract.

## Definition of done

- [ ] Cypress smoke spec: both surfaces render from fixtures; one lever deep-link lands on the right turn
- [ ] Component states covered in Storybook (populated / empty / no-waste-found)
- [ ] Pages spec §1 amended before implementation
