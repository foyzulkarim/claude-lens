---
title: "#P0-3 — Synthetic JSONL fixtures"
labels: phase-0
milestone: Phase 0 — Spec closure & repo prep
status: filed
issue: 8
url: https://github.com/foyzulkarim/claude-lens/issues/8
---

Task **#P0-3** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 0.

## Summary
Author synthetic JSONL fixtures matching the field shapes catalogued in `claude-lens-data-model.md` (#P0-7) — the single coherent, bootable `test/fixtures/` tree every Phase 2 parser/metrics test and the P3-5 Cypress harness run against. No real `~/.claude` data is copied into the repo; curated fixtures exist for determinism/CI, not privacy.

## Scope
- Author **synthetic** fixtures (no real `~/.claude/projects` data copied in) matching the field shapes in `claude-lens-data-model.md` (#P0-7), covering: a multi-turn transcript with sidechains, model switches, cache TTL fields (`cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`), malformed lines, and a partial trailing line; plus the three premium file types — dot-separated names per architecture §4: `<uuid>.cost.jsonl`, `<uuid>.turn-boundaries.jsonl`, and `cost-log.jsonl` (note: lives at `~/.claude/cost-log.jsonl`, outside the projects root). Land under `test/fixtures/` with a README describing what each fixture exercises. This is the bootable fixture tree P3-5's Cypress harness (`--roots test/fixtures`) and every Phase 2 parser/metrics test run against; gate-scenario fixtures (per-gate pass/fail transcripts, error tool_results) are added later by #P4-11/#P4-2 under the same README convention.

## Acceptance criteria
- fixtures are hand-authored (nothing copied from real transcripts — no real prompt text, paths, or identifiers); each edge case above is represented and documented; fixture filenames match the real capture output exactly.

## Dependencies
- Depends on: #P0-7 (the data-model inventory is this task's field spec — it decides which fields the fixtures must exercise)
- Unblocks: #P2-2 onward — every Phase 2 parser/metrics test runs on these fixtures; #P3-5 boots against this tree

## References
- [specs/claude-lens-data-model.md](../blob/main/specs/claude-lens-data-model.md)
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md)
- [specs/gates.md](../blob/main/specs/gates.md)
