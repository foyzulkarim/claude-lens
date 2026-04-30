# claude-lens

A local dashboard for visualizing your [Claude Code](https://claude.ai/code) usage — sessions, token costs, cache performance, tool calls, and daily breakdowns.

![Claude Code Usage Dashboard](images/dashboard.png)

## Features

- **Today vs All-Time stats** — sessions, messages, tool calls, estimated cost
- **Cache performance** — hit rate, savings vs no-cache baseline
- **Daily cost & cache table** — per-day token breakdown with estimated spend
- **Tool call analytics** — which tools Claude used most, across all projects
- **Configurable pricing** — swap between Bedrock and Anthropic API rates via `.env`

## Requirements

- Node.js 18+
- Claude Code installed (data lives in `~/.claude`)

## Setup

```bash
git clone https://github.com/foyzulkarim/claude-lens.git
cd claude-lens
npm install
cp .env.example .env
```

Edit `.env` and set `CLAUDE_DIR` to your Claude data directory (defaults to `~/.claude`).

## Run

```bash
node server.js
```

Open [http://localhost:3456](http://localhost:3456).

## Configuration

All options are set via `.env`:

| Variable           | Default | Description                          |
|--------------------|---------|--------------------------------------|
| `CLAUDE_DIR`       | `~/.claude` | Path to Claude data directory    |
| `RATE_INPUT`       | `5.0`   | Input token price (USD per 1M)       |
| `RATE_OUTPUT`      | `25.0`  | Output token price (USD per 1M)      |
| `RATE_CACHE_READ`  | `0.5`   | Cache read price (USD per 1M)        |
| `RATE_CACHE_CREATE`| `6.25`  | Cache write price (USD per 1M)       |

Default rates match **Bedrock cross-region inference (ap-southeast-2)**. For Anthropic API rates use `RATE_INPUT=15`, `RATE_OUTPUT=75`, `RATE_CACHE_READ=1.5`, `RATE_CACHE_CREATE=18.75`.
