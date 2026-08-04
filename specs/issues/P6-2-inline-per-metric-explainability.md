---
title: "#P6-2 — Inline per-metric explainability"
labels: phase-6
milestone: Phase 6 — Comprehension, differentiation & distribution
status: draft
---

Task **#P6-2** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 6.

## Summary

A "why this number / why it matters" affordance on each metric and chart — opinionated teaching copy shown at the metric itself, not behind a help page. Becomes the substrate #P6-5 and #P7-2 reuse.

## Scope

- Authored why-this-matters copy for each headline metric: spend, total tokens, cache hit %, avg $/session, anomalies.
- Shown **in place** at the metric — not a generic tooltip, not a separate help route.
- Copy lives as structured content modules so #P6-5 (recommendation cards) and #P7-2 (MCP) reuse the exact same strings rather than re-authoring them. `client/src/content/gateGlossary.ts` and `scorecardGlossary.ts` (shipped in #127) are the existing precedent — extend that pattern rather than inventing a second one.
- Applies across Dashboard, Sessions, Session Detail, Models, Cache Lab.

## Acceptance criteria

- Every headline metric across Dashboard/Sessions/Session Detail/Models/Cache Lab surfaces authored why-this-matters copy in place (not a generic tooltip).

## Dependencies

- Depends on: none blocking.
- Unblocks: #P6-5, #P7-2.

## References

- `client/src/content/gateGlossary.ts`, `client/src/content/scorecardGlossary.ts` — the shipped content-module pattern to follow.
- `specs/claude-lens-pages.md` §1, §2, §3, §6, §7 — the metric inventory.
- Plan note: this copy doubles as distribution content — the same teaching text is a shareable post.
