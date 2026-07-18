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
| `44444444-4444-4444-8444-444444444444.jsonl` | **Dashboard anomaly + failed tool result (#P4-2, T15).** Three turns, timestamped after the other fixture sessions so this session sorts as most-recent (`sort: "lastAt"`, feeding `RecentSessionCard`). Turn 2 uses a ~50x-scaled `input_tokens`/`output_tokens` usage block (50,000 in / 3,000 out vs. the ~1,000/50 pattern elsewhere in this tree) so its computed cost clears the anomaly detector's 5×-median threshold (`shared/anomaly.ts` `detectTurnCostAnomalies`, consumed by `AnomalyFeed`'s pooled turn-cost-delta sampling) against the combined population of all fixture sessions. Turn 3 includes a `tool_result` block with `"is_error": true` (a simulated failed `npm test` run) to exercise the `toolErrors` measure that feeds `FailedWorkStat`. |
| `55555555-5555-4555-8555-555555555555.jsonl` | **Cache Lab fixture (#P4-9, T1).** Session timestamped 2026-06-15, deliberately earlier than `4444…` so it never becomes the most-recent session and does not change `Dashboard`'s established "latest session" anchor. The main-stream sequence exercises every K2 cause branch and TTL-overlay outcome in order: (a) **first-call** spike at 09:00 (no prior call), (b) low-write cache hit at 09:30 that establishes a high read baseline, (c) **compaction** spike at 09:55 (prev read drops 14k→100 vs. 0→14k baseline), (d) **model-switch** spike at 10:05 from `sonnet` → `fable`, (e) **prefix-change** (`unknown` base cause) at 10:16 with 60s gap inside the 5m TTL, (f) **ttl-lapse** at 10:35 with 19-min gap beyond the 5m TTL, (g) **mixed-bucket unknown** at 11:00 (5m + 1h both non-zero), (h) **missing-bucket unknown** at 11:30 (no `cache_creation.ephemeral_*_input_tokens` fields). Two additional sidechain streams close the file: `agent-5555a` (two calls, finishes with a compaction spike) and `agent-5555b` (single first-call spike) — together they exercise `classifier`'s stream-partitioning input under both K2 branches. Used by `server/cache/classifier.test.ts`'s fixture regression guard and by the Cache Lab route test. Out of scope: gate-scenario fixtures for K2's pass/fail UI (owned by #P4-11). |

## Scope

Out of scope for this tree (added later by their own tasks, under this same
README convention):

- Premium capture files (`.cost.jsonl`, `.turn-boundaries.jsonl`, `cost-log.jsonl`) — #P4-13.
- Gate-scenario fixtures (per-gate pass/fail transcripts) — #P4-11.
