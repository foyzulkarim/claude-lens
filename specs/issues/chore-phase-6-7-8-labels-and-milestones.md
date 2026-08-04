---
title: "chore: create phase-6/7/8 labels and milestones before filing"
labels: documentation
status: draft
---

## What & why

`gh issue create` fails on a missing label or milestone, and `publish.sh` files drafts sequentially — so a missing label aborts the batch partway through. The `phase-6`, `phase-7` and `phase-8` labels and their three milestones do not exist yet (the #P0-6 precedent: labels and milestones are scaffolded before the first issue of a phase is filed).

This must run **before** `.claude/skills/create-issue/scripts/publish.sh` is invoked for any of the Phase 6/7/8 drafts.

## Acceptance

- Labels `phase-6`, `phase-7`, `phase-8` exist, styled consistently with `phase-0`…`phase-5`.
- Milestones exist and match the `milestone:` frontmatter in the drafts verbatim:
  - `Phase 6 — Comprehension, differentiation & distribution`
  - `Phase 7 — Conversational delivery (MCP)`
  - `Phase 8 — Growth`
- A dry run of `publish.sh` no longer fails on a missing label or milestone.

## References

- `specs/claude-lens-plan.md` — Phase 6, 7 and 8 preambles each carry the "label + milestone need creating before filing" note.
- `.claude/skills/create-issue/scripts/publish.sh`, `.claude/skills/create-issue/SKILL.md` Step 3.
