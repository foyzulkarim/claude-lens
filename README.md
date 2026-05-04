# claude-lens

A local dashboard for visualizing your [Claude Code](https://claude.ai/code) usage — sessions, token costs, cache performance, tool calls, and daily breakdowns.

![Claude Code Usage Dashboard](images/dashboard.png)

## Features

- **Today vs All-Time stats** — sessions, messages, tool calls, estimated cost
- **Cache performance** — hit rate, savings vs no-cache baseline
- **Daily cost & cache table** — per-day token breakdown with estimated spend
- **Tool call analytics** — which tools Claude used most, across all projects
- **Auto-detected data directory** — finds your Claude Code data folder on Windows, macOS, and Linux without configuration; falls back gracefully and tells you which paths it tried if nothing is found
- **Chat page** — a streaming chat UI at `/chat` that talks to your account models (Opus 4.7, Sonnet 4.6, Haiku 4.5) using your local OAuth token. No API key required — inference is billed against your existing Claude account quota. Conversations persist in browser `localStorage`. The token stays server-side; the browser only sees the proxied response stream.
- **Account page** — a separate `/account` view showing your full Claude account state. Reads `.credentials.json` for the OAuth token (server-side only) and calls `api.anthropic.com/api/oauth/profile` to fetch your full name, display name, email, account creation date, plan flags (Claude Max / Pro), organization name and type, billing method, subscription status and start date, rate-limit tier, seat tier, extra-usage flag, Claude Code trial state, plus the OAuth application name/slug, token expiry countdown, and scopes. Remote response is cached for 60s. Access and refresh tokens never reach the browser — only an explicit allow-list of safe fields is forwarded.
- **Light & dark mode** — theme toggle in the header, follows your OS preference by default and remembers your choice
- **System-timezone aware** — daily totals are bucketed by your local date (not UTC), and the active timezone is displayed in the header
- **Configurable pricing** — swap between Bedrock and Anthropic API rates via `.env`

## Requirements

- Node.js 18+
- Claude Code installed (data lives in `~/.claude`)

## Quick start

No install needed — run directly from GitHub:

```bash
npx github:foyzulkarim/claude-lens
```

Then open [http://localhost:3456](http://localhost:3456). The server auto-detects your Claude data directory, so usually no configuration is needed.

## Local setup

```bash
git clone https://github.com/foyzulkarim/claude-lens.git
cd claude-lens
npm install
cp .env.example .env
```

`CLAUDE_DIR` is optional — if you don't set it, claude-lens auto-detects your Claude data directory (see [CLAUDE_DIR auto-detection](#claude_dir-auto-detection) below).

```bash
node server.js
```

Open [http://localhost:3456](http://localhost:3456).

## Configuration

All options are set via `.env`:

| Variable           | Default      | Description                                   |
|--------------------|--------------|-----------------------------------------------|
| `CLAUDE_DIR`       | auto-detected | Path to Claude data directory (override only) |
| `RATE_INPUT`       | `5.0`        | Input token price (USD per 1M)                |
| `RATE_OUTPUT`      | `25.0`       | Output token price (USD per 1M)               |
| `RATE_CACHE_READ`  | `0.5`        | Cache read price (USD per 1M)                 |
| `RATE_CACHE_CREATE`| `6.25`       | Cache write price (USD per 1M)                |

Default rates match **Bedrock cross-region inference (ap-southeast-2)**. For Anthropic API rates use `RATE_INPUT=15`, `RATE_OUTPUT=75`, `RATE_CACHE_READ=1.5`, `RATE_CACHE_CREATE=18.75`.

### CLAUDE_DIR auto-detection

If `CLAUDE_DIR` isn't set (or points somewhere invalid), claude-lens tries these locations in order and uses the first one that looks like a Claude Code data directory:

1. `~/.claude`
2. **Windows:** `%APPDATA%\Claude`, `%APPDATA%\.claude`, `%LOCALAPPDATA%\Claude`, `%USERPROFILE%\.claude`
3. **macOS:** `~/Library/Application Support/Claude`
4. **Linux:** `$XDG_CONFIG_HOME/claude` (or `~/.config/claude`)

A directory is considered valid if it contains any of: `projects/`, `history.jsonl`, `sessions/`, or `stats-cache.json`. The active path and its source are shown in the dashboard header. If nothing valid is found, the dashboard shows an error banner listing every path that was tried — set `CLAUDE_DIR` in `.env` to point at the right one.

### Theme

A theme toggle in the top-right of the dashboard switches between light and dark mode. Defaults to your OS preference; your choice is stored in `localStorage` and survives reloads.
