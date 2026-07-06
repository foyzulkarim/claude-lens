---
title: "#P4-4 — Sessions page"
labels: phase-4
milestone: Phase 4 — Pages & features
status: draft
---

Task **#P4-4** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
Build the Sessions page (pages spec §2): the sortable sessions table plus timeline, scatter, histogram, and compare views over all sessions — and the `GET /api/sessions` list route that feeds it.

## Scope
- *(§2)* Table (sortable, tier-dependent columns), timeline/gantt toggle, efficiency scatter with regression, cost histogram with percentile markers, compare mode. Tags column stubs until #P4-15; gate-score column stubs until #P4-11 (filled by #P4-12). Tier-dependent columns (lines ±, observed $, ctx %) light up when C/L files are present — pages spec §2 row 3.
- Includes the `GET /api/sessions` list route (architecture §9 — the sortable, tier-dependent list payload).
- The page contract's first row (full-text prompt search) is built by #P4-3 and mounted on this page — this issue does not re-implement search.

## Acceptance criteria
- matches `sessions.html`; drill-in from Dashboard lands filtered.

## Page contract (pages spec §2)
| Section | Deps | Tier | Notes |
|---|---|---|---|
| Full-text prompt search across all sessions ("when did I ask about X") | T | 🟢 | Results → 3 at the matching turn; the sleeper killer feature |
| Filter bar (inherits global + cost range, gate status, has-drilldown, branch, entrypoint) | T | 🟢 | |
| Sessions table (sortable: $, tokens, turns, duration, cache %, gate score, branch, version) | T+P | 🟡 | lines ±, observed $, ctx % columns light up with C/L |
| Timeline/gantt view: sessions as bars on a day axis (overlaps = parallel sessions) | T | 🟢 | Toggle with table |
| Efficiency scatter (any-measure × any-measure, regression line) | T+P | 🟢 | Presets: $×duration, tokens×turns |
| Session cost distribution histogram + p50/p90/p99 markers | T+P | 🟢 | "Is this session normal?" |
| Compare mode (2–3 sessions side-by-side) | T+P | 🟢 | |
| Tags: manual labels on sessions, filterable | ⚑N (local store) | 🟢 | |
Spec-vs-mockup gaps to implement from the spec table: Sessions — compare mode + tags

## Definition of done (Phase 4 standing rules)
- [ ] Cypress smoke spec: route renders key sections from fixtures; one drill-link lands filtered
- [ ] Component states covered in Storybook (not Cypress)
- [ ] Manual visual sign-off vs `specs/pages/sessions.html` on real data; plan checkbox flipped

## Dependencies
- Depends on: P4-3
- Unblocks: P4-5

## References
- [specs/claude-lens-pages.md](../blob/main/specs/claude-lens-pages.md)
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md) §9 (sortable, tier-dependent list payload)
- `specs/pages/sessions.html` (visual reference, not exhaustive contract)
- `specs/pages/sessions.png` — static screenshot of the mockup
