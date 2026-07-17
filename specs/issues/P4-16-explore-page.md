---
title: "#P4-16 — Explore page"
labels: phase-4
milestone: Phase 4 — Pages & features
status: filed
issue: 48
url: https://github.com/foyzulkarim/claude-lens/issues/48
---

Task **#P4-16** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
Build the Explore page (pages spec §11): a free-form pivot builder over the same metrics engine every curated page uses.

## Scope
- *(§11)* Pivot builder over the existing engine: measure × dimension × grain × chart type; distribution mode; save-as-Saved-View pinned to Dashboard.

## Acceptance criteria
- matches `explore.html`; any curated chart is reproducible as an Explore query.

## Page contract (pages spec §11)
| Section | Deps | Tier | Notes |
|---|---|---|---|
| Pivot builder: pick measure × dimension × time grain × chart type (bar/line/area/scatter/table) | T+P | 🟢 | The generic layer exposed directly; every curated chart is a preset of this |
| Percentile/distribution mode for any measure | T+P | 🟢 | |
| Save result as a Saved View (pins to Dashboard) | ⚑N (local config) | 🟢 | |

Spec-vs-mockup gaps to implement from the spec table: none for this page

## Definition of done (Phase 4 standing rules)
- [ ] Cypress smoke spec: route renders key sections from fixtures; one drill-link lands filtered
- [ ] Component states covered in Storybook (not Cypress)
- [ ] Manual visual sign-off vs `specs/pages/explore.html` on real data; plan checkbox flipped

## Dependencies
- Depends on: #P4-15 / #47 (saved views and tags); #P4-2 / #34 (Dashboard pin target)
- Unblocks: none

## References
- [specs/claude-lens-pages.md](../blob/main/specs/claude-lens-pages.md)
- `specs/pages/explore.html` (visual reference, not exhaustive contract)
- `specs/pages/explore.png` — static screenshot of the mockup
