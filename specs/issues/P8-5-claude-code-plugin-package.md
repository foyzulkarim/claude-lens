---
title: "#P8-5 — Claude Code plugin package"
labels: phase-8
milestone: Phase 8 — Growth
status: draft
---

Task **#P8-5** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 8.

## Summary

Ship claude-lens as an installable Claude Code plugin bundling the MCP server, a `/lens` skill, and the capture hooks. This is the strongest single download lever in the phase: it converts install-once-per-human into invoke-per-session, and it makes the 🟢 capture tier the default rather than an opt-in chore.

## Scope

- Plugin manifest registering three things in one install:
  - the MCP server from #P7-1/#P7-2 (Streamable HTTP over the existing Fastify process — no new runtime),
  - a `/lens` skill wrapping the common questions ("what's wasting tokens in this project", "explain my cache grade"),
  - the capture statusline + `hooks.Stop` wiring from #P8-4.
- No manual `~/.claude/settings.json` editing by the user at any point.
- Clean uninstall — the capture wiring in particular must be removable without clobbering unrelated `settings.json` keys, the same merge discipline `capture/merge-settings.cjs` already implements.
- Keep the constraint from `AGENTS.md`: no native modules, no postinstall work, no alternate runtimes.

## Acceptance criteria

- Installing the plugin registers the MCP server, the skill, and the capture statusline/Stop hooks in one step.
- A fresh Claude Code session can query claude-lens without a manual `~/.claude/settings.json` edit.
- Uninstall is clean.

## Dependencies

- Depends on: #P7-1 (MCP surface), #P8-4 (capture subcommand).
- Related: #P7-2 supplies the opinion layer the `/lens` skill surfaces.

## References

- `specs/claude-lens-plan.md` Phase 8 growth thesis — non-human invocation as the download-curve lever.
- `capture/settings.snippet.json`, `capture/merge-settings.cjs` — the wiring and its merge/backup discipline.
