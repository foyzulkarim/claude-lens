---
title: "#P4-3 — Search index + prompt search"
labels: phase-4
milestone: Phase 4 — Pages & features
status: filed
issue: 35
url: https://github.com/foyzulkarim/claude-lens/issues/35
---

Task **#P4-3** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
Server-built MiniSearch index + client-side search-as-you-type over all prompt text, deep-linking to the matching turn.

## Scope
- `GET /api/search-index` + MiniSearch client integration; results deep-link to Session Detail at the matching turn.

## Acceptance criteria
- search-as-you-type over full history with no server round-trip per keystroke.
- results deep-link to Session Detail at the matching turn.

## Dependencies
- Depends on: P4-2; #P4-5 (deep-link target is Session Detail, which lands later in sequence — link wiring finalizes once #P4-5 exists)
- Unblocks: P4-4

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md) §9 (`GET /api/search-index`), §11 (MiniSearch client integration)
