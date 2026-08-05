---
title: "#P8-1 — Token efficiency engine"
labels: phase-8
milestone: Phase 8 — Growth
status: draft
---

Task **#P8-1** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 8.

## Summary

A deterministic engine that turns already-derived signals into a ranked list of token-waste levers, each with an evidence set and a computed $ cost. This is the substrate four separate surfaces consume (#P8-2 dashboards, #P8-3 headless report, #P6-5 recommendation cards, #P7-2 MCP opinion layer), so it is built once, store-independent, and without any LLM or network dependency.

## Scope

- New `server/efficiency/` module exposing `efficiency(calls, turns, sessions) → Lever[]`.
- Takes **plain arrays**, not a `Store` instance — matches `server/metrics/engine.ts` and the pure-function shape of `derive-turns.ts`/`derive-session.ts` (2026-07-14 decisions-log row). Nothing under `server/efficiency/` may import from `server/store/`.
- Each `Lever` carries: a stable detector id, a human-readable label, the token cost, the computed $ cost (via the runtime pricing table, same source as the metrics engine), and turn-keyed evidence refs.
- Levers are ranked by size so consumers never re-sort.
- Initial detector set — all transcript-only (🟢), all reusing signals the codebase already derives:
  - **Repeated reads** — the same file path `Read` N times within a session (context duplication).
  - **Model-switch busts** — reuses the existing K2 classifier in `server/cache/`.
  - **TTL-lapse busts** — idle gap exceeding the cache TTL, using the `ephemeral_5m`/`ephemeral_1h` split already parsed.
  - **Baseline bloat** — oversized first cache-write per session (system prompt + CLAUDE.md + MCP overhead), reusing Cache Lab's baseline-weight trend.
  - **Failed work** — error `tool_result`s and failed commands.
  - **Sidechain share** — subagent cost as a share of session cost.
  - **Compaction re-reads** — context re-acquisition following a compaction event.
- Unavailable inputs stay `undefined`; never substitute `0` for an unavailable observed value (`AGENTS.md`).

## Acceptance criteria

- `efficiency()` returns a ranked `Lever[]` from plain arrays with per-lever token + computed-$ attribution and turn-keyed evidence for every lever.
- Each detector has unit tests over `test/fixtures/`.
- The engine imports nothing from `server/store/`.

## Dependencies

- Depends on: none blocking — reuses shipped gate/cache/metrics primitives.
- Unblocks: #P8-2, #P8-3, #P6-5, #P7-2.

## References

- `specs/claude-lens-plan.md` Phase 8, and the 2026-08-04 decisions-log row (why the analysis stays deterministic).
- `server/metrics/engine.ts` — the store-independent engine shape to mirror.
- `server/cache/analysis.ts` — K2 classifier and bust cause labelling.
- `specs/claude-lens-pages.md` §7 (Cache Lab) — baseline weight trend, invalidation causes.
- `specs/gates.md` §Cache Scorecard scoring — the existing waste-event vocabulary this must not contradict.
