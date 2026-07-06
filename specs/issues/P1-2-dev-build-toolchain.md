---
title: "#P1-2 — Dev & build toolchain"
labels: phase-1
milestone: Phase 1 — Bootstrapping
status: filed
issue: 14
url: https://github.com/foyzulkarim/claude-lens/issues/14
---

Task **#P1-2** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 1.

## Summary
Wire the dev loop (`tsx watch` + Vite proxy) and the production build (`scripts/build.ts` → `dist/cli.js` + `public/`) with hand-parsed CLI flags.

## Scope
- `tsx watch` dev server; `vite dev` with `/api` + `/ws` proxy; `scripts/build.ts` running vite build → esbuild server bundle → assembled `dist/` (`cli.js` + `public/`). CLI flags `--port`, `--no-open`, `--roots` parsed by hand (no commander).
- Concrete build steps (architecture §12): `scripts/build.ts` runs `vite build` → `client/dist`, then `esbuild server/cli.ts --bundle --platform=node --target=node18` → `dist/cli.js`; `pino-pretty` runs in a worker thread, so esbuild bundling must handle the worker; `dist/public/` is the assembled static-asset dir.
- Default runtime behavior (architecture §12): default port auto-increments if taken; prints the URL; opens the browser (`open` dep from §2) — `--no-open` suppresses.

## Acceptance criteria
- `node dist/cli.js` serves a hello-world SPA, an `/api/ping` route, and a WS upgrade on **one port**; dev mode hot-reloads client and restarts server.

## Dependencies
- Depends on: P1-1
- Unblocks: P1-3

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md) §2 (production deps + excluded commander), §12 (build/dev/distribution)
