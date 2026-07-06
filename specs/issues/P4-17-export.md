---
title: "#P4-17 — Export"
labels: phase-4
milestone: Phase 4 — Pages & features
status: filed
issue: 49
url: https://github.com/foyzulkarim/claude-lens/issues/49
---

Task **#P4-17** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
Streaming CSV/JSON export of the current filtered view, plus export + copy-permalink buttons in the global layer.

## Scope
- `GET /api/export?format=csv|json` streaming the current view; export + copy-permalink buttons in the global layer.

## Acceptance criteria
- exported CSV of a filtered Sessions view opens correctly; permalink reproduces the view.
- exported JSON of a filtered Sessions view round-trips (opens/parses correctly).

## Dependencies
- Depends on: P4-16 (phase ordering); #P3-3 (permalink reproduces the view via P3-3's URL↔filter sync — this task adds only the clipboard affordance); #P4-4 (acceptance exports a Sessions view)
- Unblocks: P4-18

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md) §9 (`GET /api/export`), §11 (permalink = query-string state)
