---
title: "#P4-16 — Explore page"
labels: phase-4
milestone: Phase 4 — Pages & features
status: draft
---

Task **#P4-16** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
Explore page

## Scope
- *(§11)* Pivot builder over the existing engine: measure × dimension × grain × chart type; distribution mode; save-as-Saved-View pinned to Dashboard.

## Acceptance criteria
- matches `explore.html`; any curated chart is reproducible as an Explore query.

## Page contract (pages spec §11)
Spec-vs-mockup gaps to implement from the spec table: none for this page

## Definition of done (Phase 4 standing rules)
- [ ] Cypress smoke spec: route renders key sections from fixtures; one drill-link lands filtered
- [ ] Component states covered in Storybook (not Cypress)
- [ ] Manual visual sign-off vs `specs/pages/explore.html` on real data; plan checkbox flipped

## Dependencies
- Depends on: P4-15
- Unblocks: P4-17

## References
- [specs/claude-lens-pages.md](../blob/main/specs/claude-lens-pages.md)
- `specs/pages/explore.html` (visual reference, not exhaustive contract)
