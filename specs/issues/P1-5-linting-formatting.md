---
title: "#P1-5 — Linting + formatting"
labels: phase-1
milestone: Phase 1 — Bootstrapping
status: draft
---

Task **#P1-5** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 1.

## Summary
Linting + formatting

## Scope
- One tool across all three TS roots, wired into CI (#P1-3) and an npm script. **Default: Biome** (single fast tool for lint+format, fits the minimal-tooling ethos); switch to ESLint + Prettier at task start only if a concretely needed rule/plugin is missing — record either outcome in the decisions log. Config lives at repo root; `legacy/` excluded.

## Acceptance criteria
- `npm run lint` and `npm run format:check` pass on the skeleton; a deliberately misformatted file fails CI.

## Dependencies
- Depends on: P1-4
- Unblocks: none — last in phase

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
