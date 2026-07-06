---
title: "#P5-2 — Package hygiene + npx cold-start"
labels: phase-5
milestone: Phase 5 — Finalize & publish
status: filed
issue: 52
url: https://github.com/foyzulkarim/claude-lens/issues/52
---

Task **#P5-2** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 5.

## Summary
Publish-readiness: `dist/`-only tarball, no postinstall/native modules, cold `npx` verified on clean macOS + Linux.

## Scope
- Publish `dist/` only; no postinstall, no native modules (hard rules, §12); package size a few MB. Test `npx claude-lens` from a packed tarball on a clean environment (macOS + Linux at minimum). Verify `.storybook/`, `*.stories.tsx`, and `cypress/` are excluded from the tarball.

## Acceptance criteria
- tarball size recorded and within the "a few MB" target (architecture §12); cold `npx` boot works with zero prior installs; no dev-tooling files in the published package.
- the `npx` cold-start test is run manually, not as a CI gate (consciously skipped — decisions log 2026-07-06).

## Dependencies
- Depends on: P5-1
- Unblocks: P5-3

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
