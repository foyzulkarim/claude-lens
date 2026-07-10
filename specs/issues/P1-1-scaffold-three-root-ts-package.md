---
title: "#P1-1 — Scaffold three-root TS package"
labels: phase-1
milestone: Phase 1 — Bootstrapping
status: filed
issue: 13
url: https://github.com/foyzulkarim/claude-lens/issues/13
---

Task **#P1-1** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 1. *(absorbs #P0-5's LICENSE, 2026-07-10 — see decisions log; `.nvmrc` dropped from scope, 2026-07-10)*

## Summary
Scaffold the V2 skeleton: one npm package with `shared/`, `server/`, `client/` strict-TS roots, the §2 dependency lists, the root `package.json` runtime pins, and (absorbed from #P0-5) the LICENSE.

## Scope
- `shared/`, `server/`, `client/` per §3; strict TypeScript everywhere; production deps limited to the §2 server list; client deps as devDependencies.
- Root `package.json` carries the `engines` (Node ≥ 18) and `packageManager` pins (moved here from #P0-5) plus a `license` field; add a LICENSE file at repo root (MIT unless decided otherwise).
- Package `name` is a **placeholder** — `claude-lens` is taken on npm (#P0-4 finding); the real name is decided before #P5-2 and is a two-field rename, not a rescaffold.

## Acceptance criteria
- `tsc --noEmit` passes across all three roots; dependency lists match §2 (deviations require editing the architecture doc first); `npm pkg get engines packageManager license` returns the pinned values; LICENSE at repo root.

## Dependencies
- Depends on: #P0-2 (root emptied of V1 so the fresh `package.json` can land)
- Unblocks: P1-2

## References
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md)
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — decisions log, 2026-07-10 (P0-5 absorption, P0-4 npm-name finding, `.nvmrc` drop)
