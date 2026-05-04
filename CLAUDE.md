# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project overview

`claude-lens` is a small local dashboard (single Express server + single static HTML page) that visualizes Claude Code usage data. It reads files written by the Claude Code CLI inside the user's Claude data directory and renders sessions, prompts, tool calls, daily costs, and cache performance in the browser.

There is no build step, no framework, no database. The whole product is two files: [server.js](server.js) and [index.html](index.html).

## Architecture

- **[server.js](server.js)** — Express server on port `3456`. Detects the Claude data directory, reads JSON / JSONL files from disk, and exposes JSON APIs. Serves `index.html` as a static asset.
- **[index.html](index.html)** — Single-page dashboard. Plain HTML/CSS/JS, no bundler. Fetches JSON from the API endpoints and renders tables/cards. Uses CSS custom properties for light/dark theming, persisted in `localStorage`.
- **[.env.example](.env.example)** — Template for `.env`. Configures `CLAUDE_DIR` and pricing rates.

### Data sources read from `CLAUDE_DIR`

| File / folder           | Used by                                |
|-------------------------|----------------------------------------|
| `stats-cache.json`      | `/api/stats`                           |
| `history.jsonl`         | `/api/history`, `/api/projects`        |
| `sessions/*.json`       | `/api/sessions`                        |
| `projects/**/*.jsonl`   | `/api/tool-calls`, `/api/tool-details/:tool`, `/api/daily-costs` |

### API endpoints

- `GET /api/config` — runtime config: detected `claudeDir`, `source` (env / home / appdata / xdg / etc.), `valid`, full `candidates` list, `platform`. The UI uses this to show the active path and to render an error banner if no valid dir was found.
- `GET /api/stats` — returns `stats-cache.json` as-is.
- `GET /api/history` — flattened entries from `history.jsonl`.
- `GET /api/sessions` — array of session JSONs.
- `GET /api/tool-calls` — aggregate tool counts across all projects + per-project breakdown.
- `GET /api/tool-details/:toolName` — per-call detail rows for one tool, sorted by timestamp desc.
- `GET /api/projects` — project-level summary (messages, sessions, first/last seen).
- `GET /api/daily-costs` — per-day token usage, derived cost (using `RATES`), and totals.

### CLAUDE_DIR auto-detection

Implemented in `detectClaudeDir()` ([server.js](server.js)). It tries candidates in this order:

1. `process.env.CLAUDE_DIR` (if set)
2. `~/.claude`
3. Platform-specific:
   - **Windows**: `%APPDATA%\Claude`, `%APPDATA%\.claude`, `%LOCALAPPDATA%\Claude`, `%USERPROFILE%\.claude`
   - **macOS**: `~/Library/Application Support/Claude`
   - **Linux**: `$XDG_CONFIG_HOME/claude` (or `~/.config/claude`)

A directory is considered valid if it contains any of: `projects/`, `history.jsonl`, `sessions/`, or `stats-cache.json`. The first valid candidate wins. If none is valid, the server still starts and the UI shows an error banner with the list of paths that were tried — instead of crashing.

## Conventions

- **No new dependencies without a reason.** The point of this project is to stay tiny — `express` + `dotenv` + `nodemon` is the whole `package.json`.
- **No build step.** Don't introduce TypeScript, bundlers, or frameworks. Edit `index.html` directly.
- **No CSS frameworks.** Styling lives in the `<style>` block in `index.html`. Use the existing CSS custom properties (`--bg`, `--text`, `--accent`, etc.) so light and dark themes both work — never hardcode hex colors in new UI.
- **Escape user-rendered strings.** Anything that originates from disk (project names, prompts, tool inputs, file paths) must go through `escapeHtml()` before being inserted into HTML, even when it "looks safe."
- **Read errors must not crash the server.** API handlers wrap disk I/O in `try/catch` and return `{ error }` with a 5xx status. Keep that pattern.
- **Don't break the no-arg/`npx` flow.** The README advertises `npx github:foyzulkarim/claude-lens`. The server must run with zero configuration when `~/.claude` exists.
- **Keep README in sync.** Whenever a user-visible feature changes (new env var, new endpoint, new UI section, behavior change in auto-detect), update [README.md](README.md) in the same change.

## Running locally

```bash
npm install
npm run dev      # nodemon auto-reload
# or
npm start        # plain node
```

Open http://localhost:3456.

`npm run dev` (nodemon) auto-restarts on file changes — useful during development. Note: if a server is already running on `3456`, a second one fails with `EADDRINUSE`. Stop the existing process first.

## Adding a new metric or endpoint

Typical flow:

1. Add a parser/aggregator function in [server.js](server.js) following the pattern of `parseDailyCosts` or `parseJsonlForTools` (stream + readline, swallow malformed lines).
2. Expose a new `app.get('/api/...')` handler that calls it.
3. In [index.html](index.html), add a `<section>`, write a `renderXyz(data)` function, and call `fetch('/api/...')` from the `load()` function.
4. Use existing CSS variables for any new styles.
5. Update README.md (Features list, and Configuration table if you added an env var).
