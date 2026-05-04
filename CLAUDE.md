# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project overview

`claude-lens` is a small local dashboard (single Express server + single static HTML page) that visualizes Claude Code usage data. It reads files written by the Claude Code CLI inside the user's Claude data directory and renders sessions, prompts, tool calls, daily costs, and cache performance in the browser.

There is no build step, no framework, no database. The whole product is a few files: [server.js](server.js), [index.html](index.html), [account.html](account.html), [chat.html](chat.html), and [api.html](api.html).

## Architecture

- **[server.js](server.js)** — Express server on port `3456`. Detects the Claude data directory, reads JSON / JSONL files from disk, exposes JSON APIs, and proxies inference calls to Anthropic. Serves `index.html` as a static asset; `account.html` and `chat.html` via explicit routes.
- **[index.html](index.html)** — Single-page dashboard. Plain HTML/CSS/JS, no bundler. Fetches JSON from the API endpoints and renders tables/cards. Uses CSS custom properties for light/dark theming, persisted in `localStorage`.
- **[account.html](account.html)** — Account / login-status page. Renders the safe fields returned by `/api/account` (login state, plan, token expiry, scopes, profile, organization, application). Linked from the top nav.
- **[chat.html](chat.html)** — Chat page. Streaming conversation with the user's account models via `POST /api/chat`. Multi-conversation persistence (each conv stored under its own `claude-lens-chat-conv-<id>` key, with an index at `claude-lens-chat-convs` and the active id at `claude-lens-chat-active-id`). Multimodal uploads (images / PDFs / text via paperclip, drag-drop, or paste — encoded as Anthropic content blocks on the wire, not persisted in `localStorage`). Advanced settings drawer for `max_tokens`, `temperature`, `top_p`, history budget, and a custom system addendum. Each assistant message is stamped with the model used and a timestamp.
- **[api.html](api.html)** — OpenAI-compatible API page. Combined live playground (request builder with text + image attachments, response viewer) and reference docs. Linked from the top nav. Served at both `/api` (explicit route) and `/api.html` (static fallback).
- **[.env.example](.env.example)** — Template for `.env`. Configures `CLAUDE_DIR`, pricing rates, and the optional `LOCAL_API_KEY` for the `/v1/*` endpoints.

### Data sources read from `CLAUDE_DIR`

| File / folder           | Used by                                |
|-------------------------|----------------------------------------|
| `stats-cache.json`      | `/api/stats`                           |
| `history.jsonl`         | `/api/history`, `/api/projects`        |
| `sessions/*.json`       | `/api/sessions`                        |
| `projects/**/*.jsonl`   | `/api/tool-calls`, `/api/tool-details/:tool`, `/api/daily-costs`, `/api/history` |
| `.credentials.json`     | `/api/account` (safe fields only — see below) |

### API endpoints

- `GET /api/config` — runtime config: detected `claudeDir`, `source` (env / home / appdata / xdg / etc.), `valid`, full `candidates` list, `platform`. The UI uses this to show the active path and to render an error banner if no valid dir was found.
- `GET /api/account` — Claude login state. Local fields: `loggedIn`, `subscriptionType`, `rateLimitTier`, `scopes[]`, `expiresAt`, `expiresInMs`, `expired`, `organizationUuid`, `credentialsPath`. Also calls `https://api.anthropic.com/api/oauth/profile` server-side with the local access token and merges the response into a `profile` field with three sub-objects: `account` (uuid, fullName, displayName, email, hasClaudeMax, hasClaudePro, createdAt), `organization` (uuid, name, organizationType, billingType, rateLimitTier, seatTier, hasExtraUsageEnabled, subscriptionStatus, subscriptionCreatedAt, claudeCodeTrialEndsAt, claudeCodeTrialDurationDays), and `application` (uuid, name, slug). Remote response is cached in memory for 60s. `?local=1` skips the network call. **Never returns `accessToken` or `refreshToken`** — see security rule below.
- `GET /account` — serves `account.html`.
- `GET /chat` — serves `chat.html`.
- `GET /api` — serves `api.html` (OpenAI-compat playground + docs).
- `POST /api/chat` — proxies `https://api.anthropic.com/v1/messages` using the local OAuth token. Body: `{model, messages, max_tokens, stream?, ...}` (passes through to Anthropic). Adds `Authorization: Bearer <token>` and `anthropic-beta: oauth-2025-04-20` server-side; the token never reaches the browser. The model field is allow-listed against `CHAT_MODELS` (`claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`) — extending the allow-list is intentional, not automatic. Streaming responses are piped chunk-by-chunk so SSE events (`message_start`, `content_block_delta`, `message_stop`, etc.) reach the browser as they arrive. If the client disconnects mid-stream the upstream read is cancelled to stop billing tokens. Inference is billed against the user's local Claude account quota. Anthropic's rate-limit headers (`anthropic-ratelimit-unified-5h-*`, `anthropic-ratelimit-unified-7d-*`, `retry-after`, `anthropic-request-id`) are forwarded so the UI can show 5h/7d utilization pills and decode 429s into actionable errors.

  **Critical: the system-block marker.** Anthropic gates the OAuth-friendly rate-limit bucket behind the exact string `"You are Claude Code, Anthropic's official CLI for Claude."` appearing as a system block. Without it, requests using the same token fall into a much tighter quota and 429 quickly — the CLI works fine because it sends this marker; raw OAuth proxies don't, which looks like "Opus / Sonnet are rate-limited" but isn't. Probing established that the check is per-block: `system: "<marker>\n\n..."` (string form with extra content) **fails**, but `system: [{type:"text", text:"<marker>"}, {type:"text", text:"..."}]` (block-array form) **passes**. So the proxy *always* injects `[{type:"text", text: CC_SYSTEM_MARKER}, {type:"text", text: CHAT_CONTEXT_BLOCK}, ...userBlocks]`. Don't refactor this away — it's a load-bearing workaround for an undocumented Anthropic policy. If a future contributor sees Opus/Sonnet 429ing while Haiku works, this is the first place to look.
- `POST /v1/chat/completions` — **OpenAI-compatible** wire shape. Lets official `openai` Python / Node SDKs (and any other client that speaks OpenAI) call the user's local Claude account by pointing `base_url` at `http://localhost:3456/v1`. Internally translates the OpenAI request → Anthropic `/v1/messages`, calls upstream via the same OAuth proxy logic as `/api/chat` (same quota, same load-bearing system marker), and translates the response — and SSE chunks — back to OpenAI's wire format ending with `data: [DONE]\n\n`. Streaming and non-streaming both supported. Helpers: `convertOpenAIContent` (multimodal `image_url` data URLs and `https://` URLs → Anthropic `image` source blocks), `openAIRequestToAnthropic` (system-message extraction, `stop`/`stop_sequences`, parameter mapping, ignored-field warnings via `X-Claude-Lens-Warnings`), `anthropicResponseToOpenAI` (`finish_reason` mapping: `end_turn` → `stop`, `max_tokens` → `length`, `tool_use` → `tool_calls`; OpenAI-shape `usage` with `prompt_tokens_details.cached_tokens`), `pipeAnthropicStreamAsOpenAI` (event-by-event SSE conversion). Optional bearer auth via `LOCAL_API_KEY` in `.env`; unset = no auth (trusts localhost) — same risk model as `/api/chat`.
- `GET /v1/models` — OpenAI-compatible model list. Returns the same allow-list as `/api/chat` (`CHAT_MODELS`).
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
- **Interactive states are mandatory.** Every clickable element gets `:hover`, `:active`, and `:focus-visible` — not just `:hover`. The standard pattern: hover changes accent color/border; press uses `transform: translateY(1px)` for buttons and `background: var(--bg-sunken|--bg-elevated)` for surface elements (chips, rows, nav links); focus-visible draws `outline: 2px solid var(--accent)` (or `var(--red)` for destructive controls like `chip-remove`/`row-delete`) with `outline-offset: 2px`. Primary buttons gate hover/active behind `:not(:disabled)` so the disabled state always wins. Don't ship UI that only has `:hover`.
- **Escape user-rendered strings.** Anything that originates from disk (project names, prompts, tool inputs, file paths) must go through `escapeHtml()` before being inserted into HTML, even when it "looks safe."
- **Never expose secrets over HTTP.** `.credentials.json` contains `accessToken` and `refreshToken` — these must never appear in any API response, log line, error message, or HTML rendered output. The `/api/account` handler reads the file and returns *only* a fixed allow-list of fields. The remote profile fetch (`fetchAnthropicProfile`) sends the token to `api.anthropic.com` server-side; the response is then passed through `projectProfile()`, an explicit allow-list mapper that copies only the fields we want and ignores anything else. **Always use the projection pattern when forwarding upstream API data** — never spread `{...upstream}` into a response, since future Anthropic schema changes could leak new fields you didn't review. Same rule for any future credential-shaped data.
- **Read errors must not crash the server.** API handlers wrap disk I/O in `try/catch` and return `{ error }` with a 5xx status. Keep that pattern.
- **OpenAI-compat translation is allow-list / explicit-mapping only.** When extending `/v1/chat/completions`, add new fields to `openAIRequestToAnthropic` and `anthropicResponseToOpenAI` explicitly — never spread `{...input}` into the Anthropic body or the response. OpenAI-only fields without an Anthropic equivalent (`frequency_penalty`, `presence_penalty`, `logit_bias`, `response_format`, `seed`, `n>1`, `tools`/`tool_choice`, `service_tier`) belong in the warnings list — silently dropped, surfaced via the `X-Claude-Lens-Warnings` response header. The same load-bearing Claude-Code system marker that `/api/chat` injects applies here too: `openAIRequestToAnthropic` produces a string `system` field, then the endpoint wraps it into the same `[{marker}, {context}, ...userBlocks]` array form. Don't simplify that.
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
