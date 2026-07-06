---
title: "#P0-5 — LICENSE + repo hygiene"
labels: phase-0
milestone: Phase 0 — Spec closure & repo prep
status: filed
issue: 10
url: https://github.com/foyzulkarim/claude-lens/issues/10
---

Task **#P0-5** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 0.

## Summary
Commit a license and pin the Node version via `.nvmrc`. The `engines`/`packageManager` pins moved to #P1-1 — between #P0-2 and #P1-1 there is no root `package.json` to carry them.

## Scope
- Choose and commit a license (MIT unless decided otherwise); add `.nvmrc` so contributors and CI agree on the Node version.
- Out of scope: `engines` field and `packageManager` — those land with the fresh root `package.json` in #P1-1 (see decisions log 2026-07-06).

## Acceptance criteria
- LICENSE at repo root; `.nvmrc` present.

## Dependencies
- Depends on: none — independent of the other Phase 0 tasks
- Unblocks: #P1-3 (CI reads `.nvmrc` to match the pinned Node version)

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
