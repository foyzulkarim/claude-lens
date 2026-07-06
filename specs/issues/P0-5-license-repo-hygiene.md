---
title: "#P0-5 — LICENSE + repo hygiene"
labels: phase-0
milestone: Phase 0 — Spec closure & repo prep
status: draft
---

Task **#P0-5** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 0.

## Summary
LICENSE + repo hygiene

## Scope
- Choose and commit a license (MIT unless decided otherwise); add `engines` field (Node ≥ 18), `.nvmrc`, and `packageManager` so contributors and CI agree on runtime versions.

## Acceptance criteria
- LICENSE at repo root; `npm pkg get engines packageManager` returns the pinned values.

## Dependencies
- Depends on: P0-4
- Unblocks: P0-6

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
