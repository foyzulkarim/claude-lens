---
title: "#P4-15 — Settings page + config/local-store"
labels: phase-4
milestone: Phase 4 — Pages & features
status: draft
---

Task **#P4-15** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
Settings page + config/local-store

## Scope
- *(§10)* `~/.claude-lens/config.json` + `local.json` (settings.ts, local-store.ts); pricing table editor, labeled scan roots (host dimension), budget/anomaly/gate thresholds, saved-views + tags managers, cost-capture setup guide. `GET/PUT /api/config`, `/api/views`, `/api/tags`.

## Acceptance criteria
- matches `settings.html`; root relabeling reflects in the host dimension without restart; tags now filterable on Sessions.

## Page contract (pages spec §10)
| Section | Deps | Tier | Notes |
|---|---|---|---|
| Pricing table editor | P | 🟢 | |
| Scan roots with labels (label = host/machine dimension) | fs | 🟢 | Multi-machine without new capture |
| Budget & alert thresholds | ⚑N | 🟢 | |
| Gate thresholds (`V2_REPEAT`, `C3_MAX_CHARS`, `K2_SPIKE`, `E2_MAX_CHARS/LINES`) | — | 🟢 | `gates.md` |
| Anomaly thresholds — the "expensive turn" detector feeding the Dashboard anomaly feed and Session Detail red bars; independent of gates | — | 🟢 | e.g. turn > N× user's median turn cost |
| Saved views manager · tags manager | ⚑N | 🟢 | |
| Cost-capture setup guide (+ optional hostname field for true multi-host capture ⚑N) | — | 🟢 enables 🔴 | |
Spec-vs-mockup gaps to implement from the spec table: none for this page

## Definition of done (Phase 4 standing rules)
- [ ] Cypress smoke spec: route renders key sections from fixtures; one drill-link lands filtered
- [ ] Component states covered in Storybook (not Cypress)
- [ ] Manual visual sign-off vs `specs/pages/settings.html` on real data; plan checkbox flipped

## Dependencies
- Depends on: P4-14
- Unblocks: P4-16

## References
- [specs/claude-lens-pages.md](../blob/main/specs/claude-lens-pages.md)
- `specs/pages/settings.html` (visual reference, not exhaustive contract)
