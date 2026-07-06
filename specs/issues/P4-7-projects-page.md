---
title: "#P4-7 — Projects page"
labels: phase-4
milestone: Phase 4 — Pages & features
status: draft
---

Task **#P4-7** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
Projects page

## Scope
- *(§5)* Spend + WoW, stacked-area composition, efficiency table, per-branch breakdown, → Sessions links.

## Acceptance criteria
- matches `projects.html`.

## Page contract (pages spec §5)
| Section | Deps | Tier | Notes |
|---|---|---|---|
| Spend by project + WoW growth per project | T+P; L upgrades | 🟡 | |
| Stacked-area composition: spend share by project over time | T+P | 🟢 | "Which project is eating the budget lately" |
| Per-project efficiency table ($/session, cache %, tokens/turn, gate pass rate, last active) | T+P+fs | 🟢 | $/line 🔴 |
| Per-branch breakdown within a project | T (`gitBranch`) | 🟢 | Feature-branch cost accounting |
| Project → sessions | T | 🟢 | → 2 |
Spec-vs-mockup gaps to implement from the spec table: none for this page

## Definition of done (Phase 4 standing rules)
- [ ] Cypress smoke spec: route renders key sections from fixtures; one drill-link lands filtered
- [ ] Component states covered in Storybook (not Cypress)
- [ ] Manual visual sign-off vs `specs/pages/projects.html` on real data; plan checkbox flipped

## Dependencies
- Depends on: P4-6
- Unblocks: P4-8

## References
- [specs/claude-lens-pages.md](../blob/main/specs/claude-lens-pages.md)
- `specs/pages/projects.html` (visual reference, not exhaustive contract)
