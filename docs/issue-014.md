# Issue #14 — Dev & build toolchain

**Plan task:** #P1-2 · **Phase:** 1 · **PR(s):** #60 · **Closed:** 2026-07-11 · [GitHub issue #14](https://github.com/foyzulkarim/claude-lens/issues/14)

Wired the dev loop (`tsx watch` + Vite proxy) and the production build (`scripts/build.ts` →
`dist/cli.js` + `public/`) with hand-parsed CLI flags. `tsx watch` dev server; `vite dev` with `/api`
+ `/ws` proxy; `scripts/build.ts` running vite build → esbuild server bundle → assembled `dist/`.
CLI flags `--port`, `--no-open`, `--roots` parsed by hand (no commander). Default port
auto-increments if taken, prints the URL, opens the browser (`--no-open` suppresses).

## Docs

- [Review](issue-014/review) — code review of PR #60: ⚠️ approve with comments, 2 High findings
  (incomplete `--port` range validation, missing `buildApp()` return type), several Medium/Low

## Outcome

`node dist/cli.js` serves a hello-world SPA, an `/api/ping` route, and a WS upgrade on one port; dev
mode hot-reloads client and restarts server — acceptance criteria verified working. The
pino-pretty/esbuild worker-thread interaction (the specific risk the issue called out) is correct, no
path-traversal or CORS issues, localhost-only binding confirmed throughout. Unblocked #P1-3 (CI).
