---
title: "#P0-6 — GitHub project scaffolding"
labels: phase-0
milestone: Phase 0 — Spec closure & repo prep
status: filed
issue: 11
url: https://github.com/foyzulkarim/claude-lens/issues/11
---

Task **#P0-6** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 0.

## Summary
Create the phase labels and milestones on GitHub that issue tracking — and the batch publish of these very drafts — depends on.

## Scope
- Create the `phase-0`…`phase-5` labels and one milestone per phase. Issue creation is handled by the existing `/create-issue` skill (`.claude/skills/create-issue/`), so no static issue template is required. Labels and milestones must exist **before** `.claude/skills/create-issue/scripts/publish.sh` files the drafted issues — `gh issue create` fails if a label or milestone doesn't exist yet.
- Milestone titles must match the draft frontmatter strings exactly (em-dash included — `publish.sh` passes the string verbatim to `gh --milestone`): `Phase 0 — Spec closure & repo prep`, `Phase 1 — Bootstrapping`, `Phase 2 — Data engine (the risk phase)`, `Phase 3 — Steel thread (milestone)`, `Phase 4 — Pages & features`, `Phase 5 — Finalize & publish`.

## Acceptance criteria
- labels + milestones exist and match the plan (`phase-0`…`phase-5` + six phase milestones)
- `/create-issue` skill remains the issue-creation path; no static GitHub issue template is added

## Dependencies
- Depends on: none — independent of the other Phase 0 tasks
- Unblocks: the batch publish of all drafted issues (`.claude/skills/create-issue/scripts/publish.sh` passes `--label`/`--milestone`, which must already exist)

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
