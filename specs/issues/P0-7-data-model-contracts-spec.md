---
title: "#P0-7 — Data model & contracts spec"
labels: phase-0
milestone: Phase 0 — Spec closure & repo prep
status: filed
issue: 12
url: https://github.com/foyzulkarim/claude-lens/issues/12
---

> **⚠️ SUPERSEDED 2026-07-09.** This local draft captures the originally-filed scope of GitHub issue #12. The issue has since been re-scoped to **#P0-7 — Data inventory (observed-field evidence)** (pure evidence catalog, no derived contracts). The originally-planned 7-point contract scope was hallucinated from the filed issue text; the user's actual intent is an observed-field inventory only. The live GitHub issue title/body and the local context file at [`specs/context/12.md`](../blob/main/specs/context/12.md) reflect the re-scoped content; this draft body is retained verbatim as audit trail only — do not treat it as the current task description. The REQ + ARCH docs that scaffolded the contract version (`specs/requirements/REQ-data-model-contracts-spec.md`, `specs/architecture/ARCH-data-model-contracts-spec.md`) have been deleted. See [`specs/context/plan-data-inventory.md`](../blob/main/specs/context/plan-data-inventory.md) for the governing plan.

Task **#P0-7** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 0.

## Summary
Investigate real `~/.claude/projects` JSONL (plus the three premium capture files) and write `specs/claude-lens-data-model.md` — the field-level contract the architecture doc names but never defines. The architecture doc references `CompactCall`, `Turn`, `Session`, `TierFlags`, and `Series` by name only, and §8's "parser contract in claude-lens-pages.md" points at a single prose paragraph. Without this doc, #P2-1 would invent field shapes at implementation time and every Phase 4 page would negotiate with those invented shapes ad-hoc. Design/investigation only — no implementation.

## Scope
The doc covers, sourced from observed real data:
- **Source inventory** — raw JSONL record shapes actually observed (assistant/user/summary lines, `usage` block, `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`, sidechain markers, compaction lines), with anonymized examples as the evidence layer
- **`CompactCall`** field-for-field — type, source JSON path, nullability, tier (🟢/🟡), and deliberate exclusions (tool_result bodies → byte sizes only, per architecture §5.4)
- **Derivation rules** — `Turn` (grouping by `promptId`, boundary edge cases: sidechains, mid-session model switch, compaction) and `Session` rollups, as rules with examples
- **Tier system schemas** — `TierFlags` plus the three premium file formats (`<uuid>.cost.jsonl`, `<uuid>.turn-boundaries.jsonl`, `~/.claude/cost-log.jsonl`) field-for-field, per architecture §4
- **Measure & dimension catalogs** — each pages-§0 measure with its formula (e.g. cache-hit %, wall minutes, computed-vs-observed $) and each dimension with its source field
- **API envelopes** — `Series`, sessions list/detail payloads, health payload, `config.json`/`local.json` shapes (architecture §9–§10)
- **Behavior contracts** — dedupe semantics, malformed-line/truncation handling, time bucketing & timezone rules, query-key serialization, rounding — specified, not implemented

## Acceptance criteria
- `specs/claude-lens-data-model.md` merged
- every type named in architecture §3/§5/§8 is defined field-for-field with source provenance
- each measure/dimension in pages.md's Data source legend (lines 19-20) has a formula or source field
- every claim about raw data cites an observed example
- #P2-1's acceptance re-pointed to this doc

## Dependencies
- Depends on: none — spec-only; can run in parallel with #P0-2
- Unblocks: #P0-3 (the field investigation decides which fields the fixtures must exercise); re-scopes #P2-1 (shared contracts transcribe this doc instead of inventing fields)

## References
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md) §3–§10 (names the types; this task defines them)
- [specs/claude-lens-pages.md](../blob/main/specs/claude-lens-pages.md) Data source legend (lines 19-20 — measures + dimensions) and §Parser contract
- Decisions log 2026-07-06: "#P0-7 added — data-model & contracts spec before any contract code"
