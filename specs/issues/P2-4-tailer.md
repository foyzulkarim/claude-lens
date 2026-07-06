---
title: "#P2-4 — Tailer"
labels: phase-2
milestone: Phase 2 — Data engine (the risk phase)
status: draft
---

Task **#P2-4** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 2.

## Summary
Tailer

## Scope
- `tailer.ts`: byte-offset map; read-from-offset on growth; truncation fallback (drop + full reparse); advance offset only to last newline (partial-line rule).

## Acceptance criteria
- tests cover partial trailing line, mid-write reads, truncation/rewrite, offset advancement — the §13 priority list.

## Dependencies
- Depends on: P2-3
- Unblocks: P2-5

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
