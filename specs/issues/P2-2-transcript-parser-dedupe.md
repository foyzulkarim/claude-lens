---
title: "#P2-2 — Transcript parser + dedupe"
labels: phase-2
milestone: Phase 2 — Data engine (the risk phase)
status: draft
---

Task **#P2-2** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 2.

## Summary
The line-level transcript parser: JSONL line → `CompactCall`, with `message.id` dedupe and malformed-line counting that never throws.

## Scope
- `parse-transcript.ts`: line → `CompactCall`; in-stream `message.id` dedupe with per-session seen-set; retain prompt text, drop tool_result bodies keeping byte sizes; malformed lines increment a per-file counter, never throw.

## Acceptance criteria
- fixture tests pin the compact-record contract (call counts, dedupe counts, token fields incl. `ephemeral_5m/1h`, error counters).

## Dependencies
- Depends on: P2-1; #P0-3 (fixtures are the test substrate)
- Unblocks: P2-3

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md) §4 (TTL field paths), §5.4 (parse + dedupe)
