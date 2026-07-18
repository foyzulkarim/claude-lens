# claude-lens

A local-first observability dashboard for [Claude Code](https://claude.ai/code) sessions — token usage, cost, cache performance, tool calls, and trends across all your projects.

The dashboard reads directly from your `~/.claude` transcripts; nothing leaves your machine.

## Quick start

```bash
npx github:foyzulkarim/claude-lens
```

This builds and runs the app, then opens it in your browser (defaults to `~/.claude` for data, and picks a free port starting at `4128` if that one's busy).

## Local setup

```bash
git clone https://github.com/foyzulkarim/claude-lens.git
cd claude-lens
npm ci
npm start
```

`npm start` runs the built CLI (`dist/cli.js`). If you're developing, use `npm run dev` instead (see below).

### CLI options

```bash
node dist/cli.js [--port <n>] [--no-open] [--roots <path> [<path> ...]]
```

- `--port` — preferred port (default `4128`); if taken, the next free port is used.
- `--no-open` — don't auto-open a browser tab.
- `--roots` — one or more directories to scan for Claude Code project transcripts instead of the default `~/.claude/projects`.

## Development

```bash
npm ci
npm run dev
```

Starts the backend (Fastify + `/api/*` + `/ws`) on port `4128` and the Vite dev server on `4129`. Set `CLAUDE_LENS_PORT_BASE=N` to shift the whole block: backend `N`, Vite `N+1`, E2E `N+2`, Storybook `N+3`.

Other useful scripts:

| Script | Purpose |
|---|---|
| `npm run verify` | Full CI gate: typecheck → lint → format:check → test. Runs automatically on `git push` via a pre-push hook. |
| `npm run build` | Production CLI + SPA bundle into `dist/`. |
| `npm run test:e2e` | Isolated fixture copy + built server + Cypress. |
| `npm run storybook` | Component explorer (defaults to `4131`, or `CLAUDE_LENS_PORT_BASE+3`). |

## How it works

- **Ingest pipeline**: discovers and tails your `~/.claude/projects/**/*.jsonl` transcripts incrementally, parsing them into an in-memory store of API calls, turns, and sessions. A `/ws` connection pushes lightweight invalidation events so the UI refetches automatically as new activity comes in — no data over the socket, no manual refresh.
- **Tiered accuracy**: metrics are 🟢 exact or 🟡 estimated from transcripts alone; optional premium capture files upgrade specific sessions to 🟢 observed values.
- **One process, one port**: Fastify serves the built SPA, the `/api/*` metrics endpoints, and the `/ws` upgrade together — no separate services to run.

See `specs/claude-lens-architecture.md` for the full design and `specs/claude-lens-pages.md` for what each page shows.

## Legacy (V1)

The original single-file Express dashboard has moved to [`legacy/`](legacy/) and is kept only for existing users who haven't migrated — see `legacy/README.md` to run it (`node legacy/server.js`). New development happens in this V2 app.
