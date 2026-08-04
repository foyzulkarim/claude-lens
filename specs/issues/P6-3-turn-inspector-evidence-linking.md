---
title: "#P6-3 — Turn Inspector evidence-linking completion"
labels: phase-6
milestone: Phase 6 — Comprehension, differentiation & distribution
status: draft
---

Task **#P6-3** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 6.

## Summary

Make every derived claim — anomalies, gate results, metric callouts — click through to its exact source turn in the Turn Inspector. Turns "trust these numbers" into "verify these numbers."

## Scope

- Close the remaining gaps, not a rebuild: #P4-12 already shipped turn-keyed evidence links for gates.
- Remaining: anomaly-feed items (Dashboard), flagged metric callouts across Dashboard / Sessions / Session Detail.
- Each link lands on the **exact** turn that produced the claim, with the Turn Inspector scrolled/anchored to it.

## Acceptance criteria

- Every anomaly-feed item, gate-evidence link, and flagged metric callout across Dashboard/Sessions/Session Detail links to the exact turn in Turn Inspector that produced it.

## Dependencies

- Depends on: #P4-6 (Turn Inspector), #P4-12 (gate evidence links) — both closed.
- Unblocks: #P6-5, #P8-2.

## References

- `specs/claude-lens-pages.md` §4 (Turn Inspector), §1 (anomaly feed).
- `server/turn-inspector/projector.ts` — the existing evidence projection.
