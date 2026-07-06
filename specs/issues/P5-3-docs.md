---
title: "#P5-3 — Docs"
labels: phase-5
milestone: Phase 5 — Finalize & publish
status: filed
issue: 53
url: https://github.com/foyzulkarim/claude-lens/issues/53
---

Task **#P5-3** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 5.

## Summary
User-facing docs: README, cost-capture setup guide, CHANGELOG — good enough to take a new user from `npx claude-lens` to premium tier unaided.

## Scope
- README (install, screenshots, tier explanation), cost-capture setup guide (statusline + Stop hook), CHANGELOG. `legacy/` pointer note.
- The root README's `legacy/` pointer overlaps with #P0-2's placeholder: #P0-2 plants a one-line pointer early in Phase 0, this task rewrites the README in full.

## Acceptance criteria
- a new user can go from `npx claude-lens` to premium tier using docs alone.

## Dependencies
- Depends on: P5-2
- Unblocks: P5-4

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md) §4 (premium capture files + tier explanation source)
