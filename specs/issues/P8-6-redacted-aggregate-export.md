---
title: "#P8-6 — Redacted aggregate export"
labels: phase-8
milestone: Phase 8 — Growth
status: draft
---

Task **#P8-6** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 8.

## Summary

An export carrying metrics only — per day × project × model — with no prompt text, no `cwd` paths, and hashed project identifiers. This is the privacy gate every org-level use case sits behind: transcripts contain prompts, so no team roll-up is adoptable until there is an export that provably carries none.

## Scope

- New export mode producing aggregate rows (day × project × model), not per-session or per-turn records.
- Redaction rules, all verifiable:
  - no prompt text, no `tool_result` content, no file paths,
  - project identifiers hashed (stable across exports from the same machine so time series join, opaque across machines unless a shared salt is configured),
  - branch and CC version retained (low-cardinality, non-identifying); `cwd` never emitted raw.
- Versioned schema — #P8-7 reads it and needs to reject or migrate unknown versions.
- Independent of the existing session CSV/JSON export (#P4-17), which stays exactly as-is.

## Acceptance criteria

- The redacted export contains no prompt text, no absolute paths, and no raw project identifiers, verified by a test asserting against the fixture corpus.
- The schema is versioned.
- The existing CSV/JSON session export (#P4-17) is unchanged.

## Dependencies

- Depends on: none blocking.
- Unblocks: #P8-7.

## References

- `server/routes/export.ts` — the existing export route this sits beside.
- `specs/claude-lens-pages.md` §0 — export/permalink capabilities.
- Note: the 2026-07-10 decisions-log row records that transcript PII is already public *on the user's own machine* and so was not a fixture-anonymisation driver. That reasoning does **not** transfer here — this export leaves the machine by design, so redaction is load-bearing, not hygiene.
