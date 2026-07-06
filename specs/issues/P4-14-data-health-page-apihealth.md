---
title: "#P4-14 — Data Health page + `/api/health`"
labels: phase-4
milestone: Phase 4 — Pages & features
status: draft
---

Task **#P4-14** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
Data Health page + `/api/health`

## Scope
- *(§9)* Dedup stats, pricing coverage, scan coverage, parse errors; reconciliation and boundary/capture-gap sections (🔴, needs #P4-13).

## Acceptance criteria
- matches `data-health.html`; malformed-line counters from #P2-2 surface here.

## Page contract (pages spec §9)
| Section | Deps | Tier | Notes |
|---|---|---|---|
| Dedup stats · pricing coverage (unpriced models) | T+P | 🟢 | |
| Scan coverage: roots scanned, transcripts found/parsed/failed | fs | 🟢 | |
| Reconciliation (computed vs sampled vs logged $) | T+P+C+L | 🔴 | |
| Boundary/promptId mismatches, unbucketed tails, capture gaps | B+C | 🔴 | |
Spec-vs-mockup gaps to implement from the spec table: none for this page

## Definition of done (Phase 4 standing rules)
- [ ] Cypress smoke spec: route renders key sections from fixtures; one drill-link lands filtered
- [ ] Component states covered in Storybook (not Cypress)
- [ ] Manual visual sign-off vs `specs/pages/data-health.html` on real data; plan checkbox flipped

## Dependencies
- Depends on: P4-13
- Unblocks: P4-15

## References
- [specs/claude-lens-pages.md](../blob/main/specs/claude-lens-pages.md)
- `specs/pages/data-health.html` (visual reference, not exhaustive contract)
