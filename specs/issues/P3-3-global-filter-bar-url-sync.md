---
title: "#P3-3 — Global filter bar + URL sync"
labels: phase-3
milestone: Phase 3 — Steel thread
status: filed
issue: 30
url: https://github.com/foyzulkarim/claude-lens/issues/30
---

Task **#P3-3** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 3.

## Summary
The global filter bar with query-string state — permalinks and cross-page filter persistence (spec §0 requirement).

## Scope
- `filters/`: range presets (1D/7D/30D/90D/custom), project/model/branch/host chips; filter state lives in the query string and survives navigation (spec §0 permalink requirement).

## Acceptance criteria
- copy-pasting a URL reproduces the filtered view; filters persist across page changes.

## Dependencies
- Depends on: P3-2
- Unblocks: P3-4

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
- [specs/claude-lens-pages.md](../blob/main/specs/claude-lens-pages.md) §0 (global analytics layer)
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md) §11 (query string, not URL hash — decisions log 2026-07-06)
