# Synthetic fixture tree

Hand-authored, synthetic `<uuid>.jsonl` transcripts — nothing copied from a real
`~/.claude` directory (no real prompt text, paths, or identifiers). Filenames
and directory layout mirror real capture output exactly
(`<scan-root>/<project-slug>/<uuid>.jsonl`) so `--roots test/fixtures` (used by
the Cypress smoke spec, #P3-5) globs them identically to a real scan root.

This tree started with #P2-2 (absorbed from the superseded #P0-3) and is
extended by later tasks under the same convention — one entry per fixture
file below, added to as new fixtures land.

## `projects/-Users-demo-project-alpha/`

| File | Exercises |
|---|---|
| `11111111-1111-4111-8111-111111111111.jsonl` | **Clean multi-turn session.** Two turns; a `tool_use`/`tool_result` round trip; a sidechain sub-agent response (`isSidechain: true` + `agentId`); a model switch mid-session (`claude-sonnet-5` → `claude-fable-5` → back); both cache-TTL buckets (`cache_creation.ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens`) each non-zero on at least one call; a duplicated `message.id` (simulates an API retry) to exercise dedupe; sidecar metadata lines (`mode`, `ai-title`, `system/turn_duration`) that must be skipped, not counted as malformed. |
| `22222222-2222-4222-8222-222222222222.jsonl` | **Malformed lines.** Five intentionally-broken lines interleaved with four valid `assistant` lines: truncated/unbalanced JSON, a bare JSON array (valid JSON, wrong shape), a JSON object missing `type` entirely, an `assistant` line missing `message.id`, and non-JSON garbage text. Also includes one blank trailing line, which must be skipped (not malformed) since it's a normal JSONL formatting artifact. |
| `33333333-3333-4333-8333-333333333333.jsonl` | **Partial trailing line.** Two complete, valid `assistant` lines followed by a third line that was cut mid-write (no trailing newline, incomplete JSON) — simulates polling a file while Claude Code is still writing to it. Reused by the tailer's (#P2-4) partial-line-withholding tests. |

## Scope

Out of scope for this tree (added later by their own tasks, under this same
README convention):

- Premium capture files (`.cost.jsonl`, `.turn-boundaries.jsonl`, `cost-log.jsonl`) — #P4-13.
- Gate-scenario fixtures (per-gate pass/fail transcripts) — #P4-11.
- Dashboard-anomaly fixtures — #P4-2.
