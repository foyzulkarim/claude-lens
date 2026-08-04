---
title: "#P7-1 — Thin MCP data surface"
labels: phase-7
milestone: Phase 7 — Conversational delivery (MCP)
status: draft
---

Task **#P7-1** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 7.

## Summary

Expose structured metrics and gate results as MCP resources over the existing Fastify process (`/mcp`, Streamable HTTP — no runtime change). Gives conversational access to Claude Lens data from inside Claude Code early, while the opinion layer matures. Positioned as a data surface, not "the MCP feature."

## Scope

- `/mcp` endpoint on the **existing** Fastify instance — one process, one port, no new runtime, no new transport service (architecture §1).
- Resources: metrics queries and gate results. Read-only.
- Same loopback-origin discipline the `/ws` upgrade already enforces (`isAllowedOrigin` in `server/app.ts`).
- Data surface only — the opinion layer is #P7-2.

## Acceptance criteria

- An MCP client (e.g. Claude Code) can list and read metrics/gate-result resources from a running `claude-lens` instance without a separate process or runtime change.

## Dependencies

- Depends on: none blocking.
- Unblocks: #P7-2, #P8-5 (the plugin bundles this).

## References

- `server/app.ts` — Fastify assembly, `/ws` origin guard to mirror.
- `shared/metrics-contract.ts` — the query language to expose.
- Note: moved from last in the roadmap to execution stage 4 — see the 2026-08-04 decisions-log row (MCP is the download multiplier and the AI delivery surface, not an epilogue).
