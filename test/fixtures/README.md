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
| `55555555-5555-4555-8555-555555555555.jsonl` | **Cache Lab fixture (#P4-9, T1) — also serves K2 gate coverage (#P4-11).** Session timestamped 2026-06-15, deliberately earlier than `4444…` so it never becomes the most-recent session and does not change `Dashboard`'s established "latest session" anchor. The main-stream sequence exercises every K2 cause branch and TTL-overlay outcome in order: (a) **first-call** spike at 09:00 (no prior call), (b) low-write cache hit at 09:30 that establishes a high read baseline, (c) **compaction** spike at 09:55 (prev read drops 14k→100 vs. 0→14k baseline), (d) **model-switch** spike at 10:05 from `sonnet` → `fable`, (e) **prefix-change** (`unknown` base cause) at 10:16 with 60s gap inside the 5m TTL, (f) **ttl-lapse** at 10:35 with 19-min gap beyond the 5m TTL, (g) **mixed-bucket unknown** at 11:00 (5m + 1h both non-zero), (h) **missing-bucket unknown** at 11:30 (no `cache_creation.ephemeral_*_input_tokens` fields). Two additional sidechain streams close the file: `agent-5555a` (two calls, finishes with a compaction spike) and `agent-5555b` (single first-call spike) — together they exercise `classifier`'s stream-partitioning input under both K2 branches. Used by `server/cache/classifier.test.ts`'s fixture regression guard, by the Cache Lab route test, AND by `server/gates/k2.test.ts` to verify the gate fires on the `prefix-change`/`unknown` spike at 10:16 — the only K2 fail branch in this tree (the rest are "explained" branches that should produce no fail events). |
| `66666666-6664-4666-8666-666666666666.jsonl` | **V1 mid-session fail (#P4-11).** Three turns: turn 1 reads `/src/foo.ts`, edits it, then runs `ls` (V1 pass — Bash after Edit); turn 2 (mid-session) edits `/src/foo.ts` with no Bash after (V1 fail); turn 3 has no edits (N/A). V1 status is `fail` because a non-final turn failed. |
| `77777777-7774-4777-8777-777777777777.jsonl` | **V1 final-turn-only fail (#P4-11, softer framing).** Two turns: turn 1 reads + edits + runs `ls` (pass); turn 2 (final) edits `/src/config.ts` with no Bash after. V1 status is `warn` — only the final turn failed, so the softer framing applies (acceptance R9). |
| `88888888-8884-4888-8888-888888888888.jsonl` | **V2 fail (#P4-11).** Single turn: the Bash command `npm test` is invoked three times in sequence, each producing a `tool_result` with `"is_error": true`. With the default `v2Repeat=3`, V2 fires once the third failure lands — emits one evidence entry with the normalized command `"npm test"` and the three failing call ids in order. |
| `99999999-9994-4999-8999-999999999999.jsonl` | **P3 fail (#P4-11).** Single turn: a user prompt asks Claude to edit `/Users/demo/projects/alpha/src/exists.ts`; the assistant immediately issues an `Edit` tool_use on that path with no prior `Read` and no `@`-mention of the path in the user prompt. P3 emits one evidence entry for the file path with detail citing the missing read. |
| `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl` | **C3 fail (#P4-11).** Single turn: a `Read` tool_use on `/Users/demo/projects/alpha/services.txt` produces a `tool_result` with 16,000 chars of content (above the 15,000 default). C3 emits one evidence entry with the recurring-cost estimate: `16,000 / 4 = 4,000 tokens × remaining calls in session`. |
| `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jsonl` | **E1 fail (#P4-11, filesystem-checked).** Minimal session whose `cwd` is `/tmp/claude-lens-fixture-e1` — the test that consumes this fixture is responsible for ensuring (a) the directory exists with no `CLAUDE.md`, and (b) `~/.claude/CLAUDE.md` is absent or pointed elsewhere for the test. Result is E1 fail with two evidence entries (one per checked path). |
| `cccccccc-cccc-4ccc-8ccc-cccccccccccc.jsonl` | **E2 fail (#P4-11, filesystem-checked + `@import` walker).** Minimal session whose `cwd` is `/tmp/claude-lens-fixture-e2` — the test creates a `CLAUDE.md` there with `> 4,000 chars` (and/or `> 60 lines`) plus a `@import` reference to a same-directory file the test also creates. The size total includes the imported file (one level deep per gates.md §E1/E2; the walker rejects imports that escape the importer's directory). |

## Sessions page coverage (#P4-4 / ARCH-sessions-page.md T9)

The Sessions page (`cypress/e2e/sessions.cy.ts`) reuses this same four-session
fixture set — no task-specific fixture rewrite was needed:

- All four sessions fall inside the July 2026 fixture range and populate the
  Sessions table, timeline, cost distribution, and efficiency scatter with
  real (not zero-valued) rows.
- The `11111111-…` (clean multi-turn, model switch, both cache buckets) and
  `44444444-…` (anomaly + failed tool result) sessions are used by the
  compare-mode smoke test — both have distinct, well-formed cost/token/turn
  totals that render clearly in a side-by-side table.
- `22222222-…` (malformed lines) and `33333333-…` (partial trailing line)
  exercise the honest-partial-data path: their session-level totals reflect
  only the successfully parsed lines, which the Sessions table/timeline must
  render without crashing or fabricating missing values.
- The Dashboard → Sessions drill-link test (`cypress/e2e/dashboard.cy.ts`)
  asserts the destination renders the live composed page (not the pre-#36
  `PageStub` placeholder) with fixture-matching rows.

## Premium capture overlay (`../fixtures-premium/`, #P4-13)

The premium tier's C/B/L capture files live in a **separate sibling tree**,
`test/fixtures-premium/`, not in this transcript tree. Keeping them apart is
what lets the Cypress harness run twice: a transcript-only (T) pass against
`test/fixtures/` alone, then a premium (T+C/B/L) pass with the overlay copied
*on top of* the same isolated fixture root (`scripts/e2e.ts`). The overlay's
paths mirror this tree so the copy lands each file beside its transcript, plus
a root-level `cost-log.jsonl` (the glob under the scan root catches it — the L
file's real `~/.claude/` home isn't reachable from a fixture root).

| Overlay file | Session | Exercises |
|---|---|---|
| `…/11111111….cost.jsonl` | `1111…` | **C, both index variants.** Turn-indexed lines for turn 1, then epoch-indexed (`epoch`+`sample`) lines for turn 2 — a CC-version switchover within one file. Observed totals: cost $0.22, +11/−3 lines, last ctx% 15. |
| `…/11111111….turn-boundaries.jsonl` | `1111…` | **B.** Two `turn_end` markers → observed per-turn `wallMs`. |
| `…/44444444….cost.jsonl` | `4444…` | **C over the anomaly turn.** Turn 2's $1.50 sample keeps the session's anomaly visible under observed cost. Observed total $1.85. |
| `…/44444444….turn-boundaries.jsonl` | `4444…` | **B**, three boundaries. |
| `cost-log.jsonl` (root) | `4444…`, `6666…` | **L.** `4444…` (also has C) verifies **C wins** for `costObserved` ($1.85, not L's $1.88); `6666…` has **no C**, so it exercises the **L-only** upgrade path (costBasis observed, $0.75). |

Sessions without an overlay entry (e.g. `2222…`) stay transcript-only and are
the control that the upgrade never leaks onto a T-only session.
`server/ingest/premium-fixtures.test.ts` boots the merged tree through the real
ingest pipeline and asserts each of these observed values.
