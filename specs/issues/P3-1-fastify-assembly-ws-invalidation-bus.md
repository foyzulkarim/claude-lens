---
title: "#P3-1 — Fastify assembly + WS invalidation bus"
labels: phase-3
milestone: Phase 3 — Steel thread (milestone)
status: draft
---

Task **#P3-1** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 3.

## Summary
Fastify assembly + WS invalidation bus

## Scope
- `app.ts`: static assets + SPA fallback, `/ws` upgrade, ingest→invalidation→WS wiring (three message types, never data).

## Acceptance criteria
- appending to a watched fixture file emits one debounced `session-updated` over WS.

## Dependencies
- Depends on: P2-10
- Unblocks: P3-2

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
