---
title: "#P5-4 — Publish v0.1.0"
labels: phase-5
milestone: Phase 5 — Finalize & publish
status: draft
---

Task **#P5-4** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 5.

## Summary
Publish v0.1.0

## Scope
- npm publish; GitHub release; tag.

## Acceptance criteria
- `npx claude-lens@latest` works from the public registry.

---

## Benchmark log (filled in by checkpoint tasks)

| Date | Task | Cold boot | Warm boot | RSS | Data size | Notes |
|---|---|---|---|---|---|---|
| — | #P2-7 | | | | | |
| — | #P5-1 | | | | | |

## Decisions log

Current as of the dated rows; re-scan at each phase exit and prune rows that have become moot.

| Date | Decision | Where reflected |
|---|---|---|
| 2026-07-06 | V1 app moves to `legacy/`, stays runnable | #P0-2 |
| 2026-07-06 | Tasks tracked as sequential GitHub issues, one per task above, labeled by phase | this doc |
| 2026-07-06 | Storybook (Vite builder, devDependency) as the component workbench; primitives built stories-first; workbench only, no test-runner for now | #P1-4, #P4-1, #P4-13 |
| 2026-07-06 | Cypress for E2E only, booting built app via `--roots test/fixtures`; component states stay in Storybook (no duplication) | #P3-5, Phase 4 standing rule, #P4-18 |
| 2026-07-06 | Review fixes (PR #5): premium filenames are **dot-separated** (`<uuid>.cost.jsonl` — verified against real `~/.claude/projects` files and V1 `server.js`); `cost-log.jsonl` lives at `~/.claude/`, not under the projects root; global filters use the **query string**, never URL hash; gates evidence `turnN` is optional — E1/E2 is session-scoped | architecture §1/§4, pages §0/§7, gates §1/E1-E2, #P0-3 |
| 2026-07-06 | Lint/format enforced from Phase 1 (Biome vs ESLint+Prettier decided at #P1-5 start); LICENSE + runtime pinning in Phase 0; GitHub labels/milestones/issue template scaffolded in Phase 0 | #P0-5, #P0-6, #P1-5 |
| 2026-07-06 | Full PR #5 review remediation: mockups carry MOCKUP disclaimers with shared chrome extracted to `specs/pages/_chrome.css/.js`; **pages spec wins over mockups on section presence** (6 known mockup gaps listed in the Phase 4 standing rules); gates doc disambiguates gate IDs from product versions; `.serena/project.yml` trimmed + populated; #P1-5 defaults to Biome; model ID strings in mockups (`claude-opus-4-8`, `claude-sonnet-5`, `claude-fable-5`) confirmed as real Claude Code model IDs | mockups, gates.md, plan Phase 4 rules, `.serena/` |
| 2026-07-06 | Delivery pipeline codified in root `CLAUDE.md`: specs decide what, issues track what, start-time skills (`/start-task` → `/plan-architecture` → `/generate-tasks` → `/implement`) decide how, this plan doc decides when; `/plan-requirements` runs **before filing** for fuzzy ad-hoc enhancements only | `CLAUDE.md` |
| 2026-07-06 | Issues are filed by the `/create-issue` skill (`.claude/skills/create-issue/`), not a static GitHub form template — issue shapes differ by work type (plan task, page, spike, bug, enhancement, chore) and content is sourced from the specs at filing time; the #P0-6 `phase-task.yml` template was removed before ever being committed. Labels + milestones from #P0-6 stay. Issues are drafted locally under `specs/issues/` (`status: draft → ready → filed`) and published to GitHub in one batch by the skill's `publish.sh` | #P0-6, `.claude/skills/create-issue/` |
| 2026-07-06 | Review findings **adjudicated and rejected** (recorded so they're not re-raised): M11 mid-file `---` rules (frontmatter is only parsed at byte 0 — a mid-file `---` is a plain horizontal rule to any compliant parser); L3 `[--no-open]` bracket notation (standard optional-flag convention); L12 constraints-table granularity (already a two-column constraint/consequence table) | — |
| 2026-07-06 | **Consciously skipped** (recorded so they're not re-litigated): CI OS/Node matrix (single OS/Node; cross-platform checked manually in Phase 5) · automated npx-tarball smoke in CI (manual in #P5-2) · npm provenance/OIDC + Dependabot · release automation (manual v0.1.0) · telemetry decision doc · global Definition-of-Done rule · a11y addon/audit · visual regression · Docker/staging · feature flags/i18n/APM · CONTRIBUTING/CODEOWNERS | — |

## Dependencies
- Depends on: P5-3
- Unblocks: none — last in phase

## References
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md)
- [specs/gates.md](../blob/main/specs/gates.md)
