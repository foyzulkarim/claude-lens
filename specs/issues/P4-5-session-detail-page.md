---
title: "#P4-5 — Session Detail page"
labels: phase-4
milestone: Phase 4 — Pages & features
status: draft
---

Task **#P4-5** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
Build the Session Detail page (pages spec §3): everything about one session, from cumulative cost timeline to context composition; the Report Card section lands later in #P4-12.

## Scope
- *(§3)* All sections except Report Card (lands in #P4-12): header, cumulative timeline, per-turn bars, turn table, turn-vs-history distribution, cache strip, tool mix, prompt list, workflow funnel, token funnel, context composition. Needs `GET /api/sessions/:id`.

## Acceptance criteria
- matches `session-detail.html`; live-updates during an active session.

## Page contract (pages spec §3)
| Section | Deps | Tier | Notes |
|---|---|---|---|
| Header (id, dir, branch, CC version, models, turns, computed $, vs-your-median badge) | T+P | 🟢 | Drift badge (computed vs observed) 🔴 |
| Cumulative $ timeline + turn rules + ctx sparkline + compaction flags | T+P; C upgrades resolution & true ctx % | 🟡 | |
| Per-turn cost bars (stacked main/sidechain; anomalies red; unit switcher) | T+P | 🟢 | Tail bucket only in B-mode |
| Turn table (# · $ · tokens · hit % · models · tools · timing · Δlines · flags) | T+P | 🟡 | Δlines, api-vs-wall 🔴 |
| Turn cost distribution vs your all-time turn distribution (percentile per turn) | T+P | 🟢 | Turns "expensive" is now relative to *you* |
| Cache strip (per-call hit rate, write spikes cause-labeled) | T | 🟢 | |
| Tool mix panel (+ tool timeline: which tools when) | T+P | 🟢 | |
| Prompt list (per-turn user text) | T | 🟢 | |
| Report Card (gates, session score, evidence links) | T+fs | 🟢 | Specs in `gates.md` |
| Workflow funnel: read → plan → edit → verify → commit coverage across turns | T | 🟢 | Same signals as gates V1/P3 rendered as a funnel |
| Token funnel: context offered → served from cache → fresh-billed → output | T+P | 🟢 | Shows output is ~1% of wire |
| Context composition: tool_result bytes by tool (Read vs Bash vs Grep…) | T | 🟢 | "My context is 80% file reads" |
Spec-vs-mockup gaps to implement from the spec table: Session Detail — tool mix panel/timeline

## Definition of done (Phase 4 standing rules)
- [ ] Cypress smoke spec: route renders key sections from fixtures; one drill-link lands filtered
- [ ] Component states covered in Storybook (not Cypress)
- [ ] Manual visual sign-off vs `specs/pages/session-detail.html` on real data; plan checkbox flipped

## Dependencies
- Depends on: P4-4
- Unblocks: P4-6

## References
- [specs/claude-lens-pages.md](../blob/main/specs/claude-lens-pages.md)
- `specs/pages/session-detail.html` (visual reference, not exhaustive contract)
