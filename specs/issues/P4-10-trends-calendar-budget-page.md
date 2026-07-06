---
title: "#P4-10 — Trends, Calendar & Budget page"
labels: phase-4
milestone: Phase 4 — Pages & features
status: draft
---

Task **#P4-10** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
Trends, Calendar & Budget page

## Scope
- *(§8)* Calendar heatmap, hour×weekday heatmap, stacked weekly bars, Pareto, rolling efficiency, forecast (EWMA, labeled naive), budget config + projection band + Dashboard threshold alert. Gate pass-rate trend stubs until #P4-11.

## Acceptance criteria
- matches `trends.html`; budget value persists in `~/.claude-lens/config.json`.

## Page contract (pages spec §8)
| Section | Deps | Tier | Notes |
|---|---|---|---|
| Calendar heatmap ($ or tokens per day) | T+P | 🟢 | → 2 |
| Hour-of-day × weekday heatmap: when do I burn money | T+P | 🟢 | Pure timestamp math, high delight |
| Stacked weekly bars by project/model (toggle) | T+P | 🟢 | |
| Pareto panel: top 10% turns = X% of spend; cumulative curve | T+P | 🟢 | |
| Rolling efficiency: $/day 7d-MA, cache-hit trend, tokens-per-$ deflator | T+P | 🟢 | "Am I getting cheaper per unit of work" |
| Gate pass-rate trend per week (habits improving?) | T+fs | 🟢 | Promoted from gates.md deferred list |
| Budget: monthly cap, projection band (linear/EWMA), threshold alerts on Dashboard | T+P + ⚑N budget config | 🟢 | Local notifications only |
| Forecast: month-end spend projection with confidence band | T+P | 🟢 | Simple EWMA; labeled as naive |
Spec-vs-mockup gaps to implement from the spec table: Trends — stacked weekly bars

## Definition of done (Phase 4 standing rules)
- [ ] Cypress smoke spec: route renders key sections from fixtures; one drill-link lands filtered
- [ ] Component states covered in Storybook (not Cypress)
- [ ] Manual visual sign-off vs `specs/pages/trends-calendar--budget.html` on real data; plan checkbox flipped

## Dependencies
- Depends on: P4-9
- Unblocks: P4-11

## References
- [specs/claude-lens-pages.md](../blob/main/specs/claude-lens-pages.md)
- `specs/pages/trends-calendar--budget.html` (visual reference, not exhaustive contract)
