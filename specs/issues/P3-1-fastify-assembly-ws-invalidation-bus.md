---
title: "#P3-1 — Fastify assembly + WS invalidation bus"
labels: phase-3
milestone: Phase 3 — Steel thread
status: filed
issue: 28
url: https://github.com/foyzulkarim/claude-lens/issues/28
---

Task **#P3-1** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 3.

## Summary
Assemble the Fastify app: static SPA serving, `/ws` upgrade, and the ingest→invalidation→WS wiring (invalidation bus only — three message types, never data).

## Scope
- `app.ts`: static assets + SPA fallback, `/ws` upgrade, ingest→invalidation→WS wiring (three message types, never data).

## Acceptance criteria
- appending to a watched fixture file emits one debounced `session-updated` over WS.

## Dependencies
- Depends on: P2-10
- Unblocks: P3-2

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md) §7 (WS protocol), §9 (route ownership: `/ws` + SPA fallback)
