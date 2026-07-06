---
title: "#P4-10 — Trends, Calendar & Budget page"
labels: phase-4
milestone: Phase 4 — Pages & features
status: filed
issue: 42
url: https://github.com/foyzulkarim/claude-lens/issues/42
---

Task **#P4-10** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
Build the Trends, Calendar & Budget page (pages spec §8): temporal heatmaps, Pareto, forecast, and the budget configuration.

## Scope
- *(§8)* Calendar heatmap, hour×weekday heatmap, stacked weekly bars, Pareto, rolling efficiency, forecast (EWMA, labeled naive), budget config + projection band + Dashboard threshold alert. Gate pass-rate trend stubs until #P4-11.
- Includes a minimal `settings.ts` + `GET/PUT /api/config` limited to the budget value — #P4-15 extends it to the full config surface; this task must not lock down the full `/api/config` schema, since #P4-15 owns it.

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
| Gate pass-rate trend per week (habits improving?) | T+fs | 🟢 | Promoted from gates.md deferred list; stubs to #P4-11 until gates engine lands |
| Budget: monthly cap, projection band (linear/EWMA), threshold alerts on Dashboard | T+P + ⚑N budget config | 🟢 | Local notifications only |
| Forecast: month-end spend projection with confidence band | T+P | 🟢 | Simple EWMA; labeled as naive |
Spec-vs-mockup gaps to implement from the spec table: Trends — stacked weekly bars

## Definition of done (Phase 4 standing rules)
- [ ] Cypress smoke spec: route renders key sections from fixtures; one drill-link lands filtered
- [ ] Component states covered in Storybook (not Cypress)
- [ ] Manual visual sign-off vs `specs/pages/trends.html` on real data; plan checkbox flipped

## Dependencies
- Depends on: P4-9; #P4-2 (Dashboard threshold alert is a cross-task write onto the Dashboard built in #P4-2)
- Unblocks: P4-11

## References
- [specs/claude-lens-pages.md](../blob/main/specs/claude-lens-pages.md)
- `specs/pages/trends.html` (visual reference, not exhaustive contract)
- `specs/pages/trends.png` — static screenshot of the mockup
