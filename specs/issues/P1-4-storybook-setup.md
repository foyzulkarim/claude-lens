---
title: "#P1-4 — Storybook setup"
labels: phase-1
milestone: Phase 1 — Bootstrapping
status: draft
---

Task **#P1-4** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 1.

## Summary
Storybook setup

## Scope
- Storybook (Vite builder) wired to the client root as a devDependency: Tailwind styles loaded, dark/light theme toggle matching the dashboard aesthetic. Dev workbench only — no test-runner/play functions for now (revisit if UI regressions bite). Stories and `.storybook/` never enter the published `dist/`.

## Acceptance criteria
- `npm run storybook` renders a sample story with Tailwind applied in both themes.

## Dependencies
- Depends on: P1-3
- Unblocks: P1-5

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
