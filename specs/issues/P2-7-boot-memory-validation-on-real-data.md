---
title: "#P2-7 — Boot & memory validation on real data"
labels: phase-2
milestone: Phase 2 — Data engine (the risk phase)
status: draft
---

Task **#P2-7** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 2.

## Summary
Boot & memory validation on real data

## Scope
- *(checkpoint task)* Run ingest against the real `~/.claude/projects`. Measure cold boot, warm boot, RSS.

## Acceptance criteria
- results recorded in this doc (below); memory in the expected "low hundreds of MB" band or a paging decision is escalated **before** Phase 3. This is the only assumption in the architecture that can force a redesign — fail fast here.

## Dependencies
- Depends on: P2-6
- Unblocks: P2-8

## References
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md)
