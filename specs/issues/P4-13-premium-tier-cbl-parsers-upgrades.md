---
title: "#P4-13 — Premium tier: C/B/L parsers + upgrades"
labels: phase-4
milestone: Phase 4 — Pages & features
status: filed
issue: 45
url: https://github.com/foyzulkarim/claude-lens/issues/45
---

Task **#P4-13** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
Parse the three premium capture files (C/B/L) and flip every 🟡 estimated value to observed, verified upgrade-by-upgrade.

## Scope
- `parse-premium.ts`; per-session tier detection wiring through to `TierFlags`; every 🟡 upgrade path lights up: observed $, intra-day resolution, true ctx %, waterfall widths from `api_duration_ms`, Δlines/api-vs-wall columns, latency/throughput on Models, context growth curves on Cache Lab; drift badge on Session Detail.
- Three file types, parsed as-is (discovery already locates them per #P2-3 — this task does not re-derive their locations): **C** = `<uuid>.cost.jsonl`, **B** = `<uuid>.turn-boundaries.jsonl`, **L** = `cost-log.jsonl` (at `~/.claude/`, parent of the projects root).

## Acceptance criteria
- verified upgrade-by-upgrade, not as one blob — run the Cypress harness twice (T-only fixture set, then T+C/B/L) and confirm each listed 🟡 upgrade flips: value changes where expected, tier badge updates, transcript-only sessions unaffected. Tier-upgrade component states (🟡 columns lighting up, drift badge) additionally covered by Storybook stories — these are hard to reproduce on demand with real data.

## Dependencies
- Depends on: P4-12 (sequential ordering only — premium parsing has no functional dependency on the Report Card UI); functional deps: #P0-3 (premium fixtures for the T+C/B/L Cypress run), #P2-1 (`TierFlags`), #P3-5 (Cypress harness — acceptance runs it twice); upgrade targets: #P4-5 (drift badge), #P4-8 (latency/throughput), #P4-9 (context growth curves)
- Unblocks: P4-14

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md) §4 (three premium file patterns; the `cost-log.jsonl` location wrinkle)
