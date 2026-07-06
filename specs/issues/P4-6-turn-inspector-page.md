---
title: "#P4-6 — Turn Inspector page"
labels: phase-4
milestone: Phase 4 — Pages & features
status: draft
---

Task **#P4-6** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
Turn Inspector page

## Scope
- *(§4)* Turn summary, API-call waterfall (timestamp-delta fallback widths), cache narrative, transcript peek (lazy raw-file read route), sidechain breakdown. Needs `GET /api/sessions/:id/turns/:n` and `/transcript?turn=n`.

## Acceptance criteria
- matches `turn-inspector.html`; reachable from Session Detail and gate evidence links.

## Page contract (pages spec §4)
| Section | Deps | Tier | Notes |
|---|---|---|---|
| Turn summary ($, tokens, models, flags, percentile vs your history) | T+P | 🟢 | api/wall/idle split 🔴 |
| API-call waterfall | T+P; widths from api_duration 🔴, fallback timestamp deltas | 🟡 | |
| Cache narrative (read/re-written + inferred cause) | T | 🟢 | |
| Transcript peek | T | 🟢 | |
| Sidechain breakdown | T+P | 🟢 | |
Spec-vs-mockup gaps to implement from the spec table: none for this page

## Definition of done (Phase 4 standing rules)
- [ ] Cypress smoke spec: route renders key sections from fixtures; one drill-link lands filtered
- [ ] Component states covered in Storybook (not Cypress)
- [ ] Manual visual sign-off vs `specs/pages/turn-inspector.html` on real data; plan checkbox flipped

## Dependencies
- Depends on: P4-5
- Unblocks: P4-7

## References
- [specs/claude-lens-pages.md](../blob/main/specs/claude-lens-pages.md)
- `specs/pages/turn-inspector.html` (visual reference, not exhaustive contract)
