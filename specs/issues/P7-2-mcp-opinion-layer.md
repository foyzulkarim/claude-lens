---
title: "#P7-2 — MCP opinion layer"
labels: phase-7
milestone: Phase 7 — Conversational delivery (MCP)
status: draft
---

Task **#P7-2** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 7.

## Summary

Deliver explainability (#P6-2) and recommendations (#P6-5) through MCP so questions like "why did cache hit drop this session?" get Claude Lens's computed opinion answered inside Claude Code, at the moment of work.

## Scope

- Surface the **same** why-this-matters copy (#P6-2) and recommendation-card content (#P6-5) the dashboard shows — not a re-derived answer, not a second phrasing.
- The efficiency levers (#P8-1) come through here too: this is how "suggest how to do more work with fewer tokens" gets answered inside a live session.
- **No LLM client in the server.** The calling Claude Code is the model; claude-lens supplies deterministic structured analysis and authored copy. A BYO-key model call from the server would contradict the README's "nothing leaves your machine" claim — see the 2026-08-04 decisions-log row.

## Acceptance criteria

- An MCP query surfaces the same why-this-matters copy and recommendation-card content the dashboard shows, not a re-derived answer.

## Dependencies

- Depends on: #P7-1, #P6-2, #P6-5.
- Related: #P8-5 ships this to users via the plugin.

## References

- `client/src/content/` — the shared content modules #P6-2 extends.
- 2026-08-04 decisions-log row — the no-LLM-in-server constraint and its rationale.
