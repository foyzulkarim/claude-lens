---
title: "#P8-3 — Headless report command (claude-lens report)"
labels: phase-8
milestone: Phase 8 — Growth
status: draft
---

Task **#P8-3** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 8.

## Summary

A no-browser, no-port subcommand printing a period summary plus #P8-1's top levers to stdout. This is what makes claude-lens pipeable into a Claude Code session, cron-able and CI-able — and it is the artifact people paste into Slack.

## Scope

- New `report` subcommand in `server/cli.ts`, alongside the existing default (serve) behaviour and `--port`/`--no-open`/`--roots`/`--config-dir` flags.
- Runs ingest to completion, prints, exits — never binds a port, never opens a browser, never starts the poller/tailer loop.
- `--format text|md|json`; `--last <range>` (or reuse the existing range vocabulary); `--roots` honoured as today.
- Output: period totals (spend, tokens, sessions, cache hit %), period-over-period deltas, and the top N levers from #P8-1 with token/$ attribution.
- `json` output is a versioned, documented shape — #P8-9's action and any MCP consumer parse it.
- Non-zero exit on unreadable roots; malformed transcript lines stay counted-not-thrown per the ingest contract.

## Acceptance criteria

- `npx @foyzulkarim/claude-lens report --last 7d --format md` prints a summary + ranked levers and exits 0 without binding a port or opening a browser.
- All three formats covered by tests.
- Exit code is non-zero on unreadable roots.

## Dependencies

- Depends on: #P8-1.
- Unblocks: #P8-9.

## References

- `server/cli.ts` — flag parsing and composition root.
- `server/ingest/pipeline.ts` — needs a run-once path if one does not already exist.
- `AGENTS.md` — "the supported distribution path is `npx @foyzulkarim/claude-lens@latest`".
