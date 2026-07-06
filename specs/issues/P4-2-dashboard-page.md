---
title: "#P4-2 — Dashboard page"
labels: phase-4
milestone: Phase 4 — Pages & features
status: filed
issue: 34
url: https://github.com/foyzulkarim/claude-lens/issues/34
---


Task **#P4-2** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
Build the Dashboard page (pages spec §1): all 12 sections, from stat cards to the capture CTA, on top of the #P4-1 shared primitives. Anomaly/gate-feed items may stub until #P4-11 (gates engine).

## Scope
- All 12 sections per pages spec §1: stat cards, cost-over-time chart, burn-rate card, most-recent-session card, mini-leaderboards, anomaly & gate-failure feed (stub OK), records strip, subscription window tracker, leverage ratio headline, savings decomposition stack, failed-work stat, "Set up cost capture" banner
- Every card deep-links per the spec's "→" column
- The anomaly detector itself (turn > N× the user's median turn cost; thresholds configurable in #P4-15) is built here — it feeds the anomaly feed and #P4-5's red per-turn bars

## Acceptance criteria
- matches `specs/pages/dashboard.html` against real data; every card deep-links per the spec's "→" column

## Page contract (pages spec §1)

| Section | Deps | Tier | Drill target |
|---|---|---|---|
| Stat cards (spend, tokens, cache hit %, sessions, avg $/session) with delta + sparkline | T+P; L upgrades $ to observed | 🟡 | Each → its page |
| Cost-over-time area chart (range/granularity/unit toggles, compare ghost) | T+P; C adds intra-day resolution | 🟡 | Click point → Sessions filtered |
| Burn-rate card: MTD $, projected month-end, budget bar | T+P; budget ⚑N (Settings) | 🟢 | → Trends §Budget |
| Most recent session card (trace thumb, turns, ctx %) | T+P; ctx % true value C | 🟡 | → Session Detail |
| Top sessions / projects / models mini-leaderboards (tabbed) | T+P | 🟢 | → 3 / 5 / 6 |
| Anomaly & gate-failure feed | T+P+fs; capture-gap items B/C | 🟡 | → 4, → 3 §Report Card, → 9 |
| Records strip: most expensive day/session/turn, longest session, biggest cache save | T+P | 🟢 | — |
| Subscription window tracker: 5h + 7d bars, "resets in Xh Ym", vs peak; ⚑N calibration | T + ⚑N | 🟢 | — |
| Leverage ratio headline (cache ÷ fresh-billed) | T | 🟢 | — |
| Savings decomposition stack (cache discount + cheap-model routing) | T+P | 🟢 | — |
| Failed-work stat: error tool_results / failed commands | T | 🟢 | — |
| "Set up cost capture" banner (when C/B/L absent) | — | 🔴 CTA | → Settings |

Spec-vs-mockup gaps to implement from the spec table: **failed-work stat** (mockup predates spec — spec table is binding).

## Definition of done (Phase 4 standing rules)
- [ ] Cypress smoke spec: route renders key sections from fixtures; at least one drill-link lands on the right filtered destination
- [ ] Component states covered in Storybook (not Cypress)
- [ ] Manual visual sign-off vs `specs/pages/dashboard.html` on real data; plan checkbox flipped

## Dependencies
- Depends on: #P4-1 (shared dashboard primitives); Phase 3 exit (steel-thread chart layer)
- Unblocks: #P4-3 onward; #P4-12 replaces the stubbed gate feed

## References
- pages spec §0 (global analytics layer) and §1; mockup `specs/pages/dashboard.html` (visual reference, not exhaustive contract)
- `specs/pages/dashboard.png` — static screenshot of the mockup
- Decisions log 2026-07-06: pages spec wins over mockups on section presence
