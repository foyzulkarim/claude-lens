---
title: "#P4-3 — Search index + prompt search"
labels: phase-4
milestone: Phase 4 — Pages & features
status: draft
---

Task **#P4-3** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
Search index + prompt search

## Scope
- `GET /api/search-index` + MiniSearch client integration; results deep-link to Session Detail at the matching turn.

## Acceptance criteria
- search-as-you-type over full history with no server round-trip per keystroke.

## Dependencies
- Depends on: P4-2
- Unblocks: P4-4

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
