---
title: "#P1-1 — Scaffold three-root TS package"
labels: phase-1
milestone: Phase 1 — Bootstrapping
status: draft
---

Task **#P1-1** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 1.

## Summary
Scaffold three-root TS package

## Scope
- `shared/`, `server/`, `client/` per §3; strict TypeScript everywhere; production deps limited to the §2 server list; client deps as devDependencies.

## Acceptance criteria
- `tsc --noEmit` passes across all three roots; dependency lists match §2 (deviations require editing the architecture doc first).

## Dependencies
- Depends on: P0-6
- Unblocks: P1-2

## References
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md)
