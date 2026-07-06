---
title: "#P1-2 — Dev & build toolchain"
labels: phase-1
milestone: Phase 1 — Bootstrapping
status: draft
---

Task **#P1-2** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 1.

## Summary
Dev & build toolchain

## Scope
- `tsx watch` dev server; `vite dev` with `/api` + `/ws` proxy; `scripts/build.ts` running vite build → esbuild server bundle → assembled `dist/` (`cli.js` + `public/`). CLI flags `--port`, `--no-open`, `--roots` parsed by hand (no commander).

## Acceptance criteria
- `node dist/cli.js` serves a hello-world SPA, an `/api/ping` route, and a WS upgrade on **one port**; dev mode hot-reloads client and restarts server.

## Dependencies
- Depends on: P1-1
- Unblocks: P1-3

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
