---
title: "#P1-4 — Storybook setup"
labels: phase-1
milestone: Phase 1 — Bootstrapping
status: filed
issue: 16
url: https://github.com/foyzulkarim/claude-lens/issues/16
---

Task **#P1-4** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 1.

## Summary
Stand up Storybook as the component workbench: Vite builder, Tailwind loaded, dark/light toggle; never enters the published `dist/`.

## Scope
- Storybook (Vite builder) wired to the client root as a devDependency: Tailwind styles loaded, dark/light theme toggle matching the dashboard aesthetic. Dev workbench only — no test-runner/play functions for now (revisit if UI regressions bite). Stories and `.storybook/` never enter the published `dist/`.

## Acceptance criteria
- `npm run storybook` renders a sample story with Tailwind applied in both themes.

## Dependencies
- Depends on: P1-3
- Unblocks: P1-5

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
