---
title: "#P1-3 — CI"
labels: phase-1
milestone: Phase 1 — Bootstrapping
status: draft
---

Task **#P1-3** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 1.

## Summary
CI

## Scope
- GitHub Actions: typecheck + vitest on push/PR to main, plus a `storybook build` smoke step (once #P1-4 lands) and lint/format checks (once #P1-5 lands). The Cypress E2E job is added later by #P3-5. Single OS/Node version by decision (see decisions log).

## Acceptance criteria
- red CI blocks merge; typecheck+test stage runs in under ~2 min.

## Dependencies
- Depends on: P1-2
- Unblocks: P1-4

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
