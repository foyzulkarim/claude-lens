---
title: "#P2-2 — Transcript parser + dedupe"
labels: phase-2
milestone: Phase 2 — Data engine
status: filed
issue: 19
url: https://github.com/foyzulkarim/claude-lens/issues/19
---

Task **#P2-2** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 2.

**Note:** this issue absorbs `#P0-3`'s scope (synthetic fixture-tree authoring). `#P0-3`'s original issue (#8) closed `NOT_PLANNED` on 2026-07-10 without shipping fixtures; rather than reopen it, that work is folded in here since `#P2-2` was always its first real consumer. See `specs/claude-lens-plan.md` decisions log, 2026-07-13.

## Summary
The line-level transcript parser: JSONL line → `ApiCall`, with `message.id` dedupe and malformed-line counting that never throws — plus the synthetic fixture tree it's tested against (absorbed from `#P0-3`/#8).

## Scope
- `parse-transcript.ts`: line → `ApiCall`; in-stream `message.id` dedupe with per-session seen-set; retain prompt text, drop tool_result bodies keeping byte sizes; malformed lines increment a per-file counter, never throw.
- **Synthetic fixtures** (absorbed from `#P0-3`): hand-authored under `test/fixtures/` — no real `~/.claude` data copied in — covering a multi-turn transcript with sidechains, model switches, cache TTL fields (`cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`), malformed lines, and a partial trailing line. Filenames match real capture output exactly. Land with a README describing what each fixture exercises — this becomes the fixture tree `#P3-5`'s Cypress harness and later Phase 2/4 parser/metrics tests build on; gate-scenario and premium-file (C/B/L) fixtures stay out of scope here and are added later by their respective tasks (`#P4-11`/`#P4-2`/`#P4-13`) under the same README convention.

## Acceptance criteria
- fixture tests pin the compact-record contract (call counts, dedupe counts, token fields incl. `ephemeral_5m/1h`, error counters).
- fixtures are hand-authored (nothing copied from real transcripts — no real prompt text, paths, or identifiers); each edge case above is represented and documented; fixture filenames match real capture output exactly.

## Dependencies
- Depends on: P2-1 (done, PR #67)
- Unblocks: P2-3

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md) §4 (TTL field paths), §5.4 (parse + dedupe)
