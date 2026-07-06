---
title: "#P0-3 — Anonymized JSONL fixtures"
labels: phase-0
milestone: Phase 0 — Spec closure & repo prep
status: draft
---

Task **#P0-3** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 0.

## Summary
Anonymized JSONL fixtures

## Scope
- Produce anonymized fixtures from real `~/.claude/projects` data covering: a multi-turn transcript with sidechains, model switches, cache TTL fields (`cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`), malformed lines, and a partial trailing line; plus the three premium file types — dot-separated names per architecture §4: `<uuid>.cost.jsonl`, `<uuid>.turn-boundaries.jsonl`, and `cost-log.jsonl` (note: lives at `~/.claude/cost-log.jsonl`, outside the projects root). Land under `test/fixtures/` with a README describing what each fixture exercises. Every parser/metrics/gates test depends on these.

## Acceptance criteria
- fixtures contain no real prompt text, paths, or identifiers; each edge case above is represented and documented; fixture filenames match the real capture output exactly.

## Dependencies
- Depends on: P0-2
- Unblocks: P0-4

## References
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md)
- [specs/gates.md](../blob/main/specs/gates.md)
