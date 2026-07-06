---
title: "#P1-1 — Scaffold three-root TS package"
labels: phase-1
milestone: Phase 1 — Bootstrapping
status: draft
---

Task **#P1-1** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 1.

## Summary
Scaffold the V2 skeleton: one npm package with `shared/`, `server/`, `client/` strict-TS roots, the §2 dependency lists, and the root `package.json` runtime pins.

## Scope
- `shared/`, `server/`, `client/` per §3; strict TypeScript everywhere; production deps limited to the §2 server list; client deps as devDependencies.
- Root `package.json` carries the `engines` (Node ≥ 18) and `packageManager` pins (moved here from #P0-5 — no root `package.json` exists before this task).

## Acceptance criteria
- `tsc --noEmit` passes across all three roots; dependency lists match §2 (deviations require editing the architecture doc first); `npm pkg get engines packageManager` returns the pinned values.

## Dependencies
- Depends on: #P0-2 (root emptied of V1 so the fresh `package.json` can land)
- Unblocks: P1-2

## References
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md)
