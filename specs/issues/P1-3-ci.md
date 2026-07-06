---
title: "#P1-3 — CI"
labels: phase-1
milestone: Phase 1 — Bootstrapping
status: filed
issue: 15
url: https://github.com/foyzulkarim/claude-lens/issues/15
---

Task **#P1-3** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 1.

## Summary
GitHub Actions pipeline: typecheck + vitest on every push/PR, extended by later tasks (Storybook smoke, lint, Cypress E2E).

## Scope
- GitHub Actions workflow on push/PR to `main`: typecheck + vitest. The workflow is designed so lint/format checks can be added by #P1-5 and the Cypress E2E job by #P3-5. Storybook build smoke is **not** a CI gate; it runs as a separate non-blocking script (`npm run storybook:build` or similar) once #P1-4 lands. Single OS/Node version by decision (see decisions log).

## Acceptance criteria
- red CI blocks merge; typecheck+test stage runs in under ~2 min.
- Storybook build is not part of the blocking CI job.

## Dependencies
- Depends on: P1-2; #P0-5 (CI's pinned Node version must match `.nvmrc`)
- Unblocks: P1-4

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
