---
title: "#P2-10 — `POST /api/metrics` route"
labels: phase-2
milestone: Phase 2 — Data engine (the risk phase)
status: draft
---

Task **#P2-10** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 2.

## Summary
Expose the metrics engine over HTTP as `POST /api/metrics`, respecting the §3 module boundary.

## Scope
- Wire the engine to Fastify. Route handlers import only `store/` per the §3 module boundary.

## Acceptance criteria
- end-to-end test: fixture data in store → HTTP query → expected `Series[]`.

## Dependencies
- Depends on: P2-9
- Unblocks: none — last in phase

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md) §3 (module boundaries), §9 (HTTP API surface)
