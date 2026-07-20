---
title: "Replace placeholder model context-window limits with verified values"
labels:
milestone:
status: filed
issue: 90
url: https://github.com/foyzulkarim/claude-lens/issues/90
---

Ad-hoc follow-up from PR #89 review finding CQ5 — `server/metrics/model-metadata.ts` ships with a uniform 200,000-token placeholder in `DEFAULT_CONTEXT_WINDOWS`, which makes the Dashboard's `contextPctEstimated` column technically true for every model rather than reflecting real per-model limits.

## Summary

Replace the uniform 200,000-token placeholder values in `server/metrics/model-metadata.ts` with verified per-model context-window limits.

## Scope

- Verify supported model limits against the official Anthropic model reference.
- Update `DEFAULT_CONTEXT_WINDOWS` without changing exact model-key matching.
- Add regression coverage for models with differing limits.
- Confirm Dashboard `contextPctEstimated` remains clearly identified as estimated.

## Acceptance criteria

- per-model limits sourced from the official Anthropic model reference, not a placeholder
- model-key matching (exact match) unchanged
- regression coverage for models whose limits differ from the old 200K placeholder
- Dashboard's `contextPctEstimated` column continues to be flagged as 🟡 estimated

## Dependencies
- Depends on: #P4-8 / #40 (Models page), #P4-2 / #34 (Dashboard contextPctEstimated)
- Unblocks: none

## References
- PR #89 review finding CQ5
- `server/metrics/model-metadata.ts`
- `specs/claude-lens-architecture.md` §4 (tier system — 🟡 estimated flagged where observed value is unavailable)