---
title: "#P3-5 — Cypress setup + steel-thread smoke spec"
labels: phase-3
milestone: Phase 3 — Steel thread (milestone)
status: draft
---

Task **#P3-5** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 3.

## Summary
Cypress setup + steel-thread smoke spec

## Scope
- Cypress (devDependency) with a boot harness that launches the built app deterministically: `node dist/cli.js --roots test/fixtures --no-open --port <test-port>`. Smoke spec asserts: Dashboard renders the chart from fixture data; filter changes sync to the URL and survive navigation; appending a line to a fixture JSONL mid-test live-updates the chart (regression guard on the full ingest → store → WS → refetch loop). Add the E2E job to CI.

## Acceptance criteria
- smoke spec green locally and in CI against the built `dist/`; the live-update assertion passes without reload or polling hacks.

## Dependencies
- Depends on: P3-4
- Unblocks: none — last in phase

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
