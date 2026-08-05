---
title: "#P6-7 — Shareable branded chart export"
labels: phase-6
milestone: Phase 6 — Comprehension, differentiation & distribution
status: draft
---

Task **#P6-7** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 6.

## Summary

Per-chart "Share" producing a branded PNG (footer = install command + repo) plus a number-first caption and first-comment link block. The image is the billboard; turns every user into a distributor.

## Scope

⚠️ **Scope is unresolved — do not start implementation from this issue as written.** The source roadmap doc claimed this was "already scoped in a separate issue," but a search of this repo's open and closed issues found nothing matching (chart export, branded PNG, share). Confirm where it was scoped, or run `/plan-requirements` to scope it fresh, before this leaves draft.

Provisional scope, pending that resolution:

- A "Share" affordance on charts rendered through the hand-rolled ECharts wrapper.
- Branded PNG output with a footer carrying the install command and repo link.
- A number-first caption and a first-comment link block generated alongside the image.

## Acceptance criteria

- Exporting any chart produces a branded PNG with footer + caption; matches whatever spec this scopes to.

## Dependencies

- Depends on: scope resolution (above).
- Unblocks: #P6-8.

## References

- `client/src/charts/` — the ~50-line ECharts wrapper; PNG export path needs deciding against it.
- `specs/claude-lens-plan.md` Phase 6, #P6-7 `*Dependencies:*` line — the unresolved-scope note.
