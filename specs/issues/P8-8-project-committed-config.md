---
title: "#P8-8 — Project-committed config (.claude-lens.json)"
labels: phase-8
milestone: Phase 8 — Growth
status: draft
---

Task **#P8-8** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 8.

## Summary

Let a repo commit its pricing table, budget, gate thresholds, and anomaly thresholds so a team standardizes settings instead of each developer configuring locally.

## Scope

- A `.claude-lens.json` in a scanned project root supplies pricing, budget, gate thresholds (`V2_REPEAT`, `C3_MAX_CHARS`, `K2_SPIKE`, `E2_MAX_CHARS/LINES`) and anomaly thresholds.
- **Layering, not replacement**: repo file is the base, the existing local config store overrides it. A developer can always deviate locally.
- The effective value and its source (repo file vs local override vs default) must be visible in Settings — silent precedence is a support burden.
- Malformed file is untrusted input: report it in Data Health, never crash ingest (`AGENTS.md`).

## Acceptance criteria

- A `.claude-lens.json` in a scanned project root supplies pricing/budget/gate/anomaly settings.
- Local config still overrides it.
- A malformed file is reported in Data Health and never crashes ingest.

## Dependencies

- Extends: #P4-10 / #P4-15's config store.

## References

- `server/settings.ts`, `server/local-store.ts` — existing config layering.
- `server/gates/thresholds.ts` — the threshold vocabulary.
- `specs/claude-lens-pages.md` §9 (Data Health), §10 (Settings).
