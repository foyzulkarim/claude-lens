---
title: "#P4-11 — Gates engine"
labels: phase-4
milestone: Phase 4 — Pages & features
status: draft
---

Task **#P4-11** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
The gates engine: six gates over shared preprocessing, session scoring, and evidence deep-links per `gates.md`.

## Scope
- *(gates.md)* `gates/engine.ts` + six gate files (V1, V2, P3, C3, K2, E1/E2); shared preprocessing (dedupe, sidechain exclusion, edit/command call classification); evidence with Turn Inspector deep-links; session scoring per gates.md; configurable thresholds.
- Adds the gate-scenario fixtures (per-gate pass/fail transcripts) under the #P0-3 `test/fixtures/` README convention.
- K2 gate imports the miss-attribution classifier built in #P4-9 (Cache Lab) — it does not reimplement it.
- Engine ships configurable-threshold plumbing + defaults; the Settings UI for threshold editing belongs to #P4-15.
- E1/E2 evidence is session-scoped per gates.md §1: `{filePath, detail}` only, no `turnN`/`callId` — consumers must not assume evidence is turn-keyed.

## Acceptance criteria
- per-gate fixture tests including N/A-turn denominators and E1/E2 filesystem checks (labeled "as of now").
- `V1` applies the softer final-turn framing: a session with only its last turn failing (edit with no later verify) is not scored the same as a mid-session failing turn.
- `V2` detects repeated failing commands via `tool_result.is_error` and exit-code markers.
- `P3` treats a user-message attachment containing the target file path as a prior read.
- `C3` evidence includes the recurring-cost estimate (`size/4 tokens × remaining API calls in session`), not just the raw result size.
- `K2` fixture tests cover all four classifier branches (first call, model switch, compaction, unexplained) and report which one fired.
- `E1/E2` size total follows `@import` references one level, per `gates.md`.

## Dependencies
- Depends on: P4-10 (phase ordering); #P4-9 (functional — reuses the Cache Lab miss-attribution classifier for gate K2)
- Unblocks: P4-12; #P4-7 (Projects gate-pass-rate column stubbed until this lands)

## References
- [specs/gates.md](../blob/main/specs/gates.md) — evidence contract; Report Card scoring
