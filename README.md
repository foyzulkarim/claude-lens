# claude-lens

A local-first observability dashboard for [Claude Code](https://claude.ai/code) sessions — token usage, cost, cache performance, tool calls, and trends across all your projects.

The dashboard reads directly from your `~/.claude` transcripts; nothing leaves your machine.

## Presentation

https://foyzulkarim.github.io/claude-lens/claude-lens-v2-presentation.html#1

## Dashboard

<img width="2940" height="1604" alt="lens-v2" src="https://github.com/user-attachments/assets/86107d01-9440-4046-996d-7eac2503671b" />


## Quick start

```bash
npx @foyzulkarim/claude-lens@latest
```

This runs the app and opens it in your browser (defaults to `~/.claude` for data, and picks a free port starting at `4128` if that one's busy).

To run straight from a branch or commit instead of the published release, use `npx github:foyzulkarim/claude-lens[#ref]`.

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
- **Tiered accuracy**: every metric carries a 🟢 observed, 🟡 estimated, or 🔴 locked label. The default install shows 🟡 everywhere; the "Cost capture" section below explains how to unlock 🟢.
- **One process, one port**: Fastify serves the built SPA, the `/api/*` metrics endpoints, and the `/ws` upgrade together — no separate services to run.

## Tier accuracy

Three tiers, labeled in the UI on every relevant column:

- **🟡 Estimated** (default) — derived from your `~/.claude/projects` transcripts alone. Token counts, call counts, cache %, and computed $ (from the configured pricing table) are accurate enough for high-level trends. Every session shows 🟡 on first install.
- **🟢 Observed** — when a session has matching premium capture files (C/B/L sidecars), the dashboard upgrades to observed values for cost, API latency, lines-changed, and turn boundaries. See the next section.
- **🔴 Locked** — premium-only features (latency waterfalls, observed $, lines-changed, the `contextPctEstimated` curve on the Dashboard and Cache Lab) appear with a "Set up cost capture" CTA that links to the in-app setup steps.

The session-level tier is shown in the `tier` column on the Sessions page; a header dot on the Dashboard summarizes the fleet split.

## Cost capture (unlocks 🟢 observed values)

To upgrade matching sessions from 🟡 to 🟢, install the producer scripts that write the C/B/L sidecars while Claude Code runs:

```sh
bash capture/install.sh
```

The installer copies four `.cjs` scripts to `~/.claude/scripts/` and merges a `statusLine` (cost-aware) + `hooks.Stop` (turn-boundary) entry into your `~/.claude/settings.json`. It's idempotent — re-run it any time; if nothing needs to change it reports "already configured" and touches nothing. It backs up your existing `settings.json` to `settings.json.backup-<timestamp>` before writing, so rollback is a single `cp` away.

**Manual setup** (if you'd rather not run the script): copy the four `.cjs` files into `~/.claude/scripts/` yourself and merge the `statusLine` + `hooks.Stop` keys from [`capture/settings.snippet.json`](capture/settings.snippet.json) into your own `~/.claude/settings.json`. See [`capture/README.md`](capture/README.md) for the exact file layout and field names — those are load-bearing and read directly by `server/ingest/parse-premium.ts` in this repo.

**Verify it worked:** open `/settings` in claude-lens and check the "Cost capture setup" panel — it should show the latest sample timestamp and the capturing-session count. Run one Claude Code session anywhere; the next time claude-lens polls your `~/.claude` directory, matching sessions flip to 🟢.

See `specs/claude-lens-architecture.md` for the full design and `specs/claude-lens-pages.md` for what each page shows.

## Legacy (V1)

The original single-file Express dashboard has moved to [`legacy/`](legacy/) and is kept only for existing users who haven't migrated — see `legacy/README.md` to run it (`node legacy/server.js`). New development happens in this V2 app.
