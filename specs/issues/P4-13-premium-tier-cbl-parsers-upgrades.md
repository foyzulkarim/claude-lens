---
title: "#P4-13 — Premium tier: C/B/L parsers + upgrades"
labels: phase-4
milestone: Phase 4 — Pages & features
status: draft
---

Task **#P4-13** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
Premium tier: C/B/L parsers + upgrades

## Scope
- `parse-premium.ts`; per-session tier detection wiring through to `TierFlags`; every 🟡 upgrade path lights up: observed $, intra-day resolution, true ctx %, waterfall widths from `api_duration_ms`, Δlines/api-vs-wall columns, latency/throughput on Models, context growth curves on Cache Lab; drift badge on Session Detail.

## Acceptance criteria
- verified upgrade-by-upgrade, not as one blob — run the Cypress harness twice (T-only fixture set, then T+C/B/L) and confirm each listed 🟡 upgrade flips: value changes where expected, tier badge updates, transcript-only sessions unaffected. Tier-upgrade component states (🟡 columns lighting up, drift badge) additionally covered by Storybook stories — these are hard to reproduce on demand with real data.

## Dependencies
- Depends on: P4-12
- Unblocks: P4-14

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
