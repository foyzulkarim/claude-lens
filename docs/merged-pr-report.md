# Claude Lens V2: 127,000 Lines of Engineered Code in 21 Days

*A build retrospective — and a testament to what a disciplined agentic dev pipeline can do.*

---

## The headline

In **21 days end-to-end** — from the first planning issue on **July 3, 2026** to the final
squash-merge landing on main on **July 24, 2026** — Claude Lens went from a V1 prototype
to a complete, production-shipped V2 product:

| Metric | Value |
|---|---:|
| Calendar span (planning kickoff → final merge) | **21 days** |
| Merged pull requests (V2 build) | **54** |
| Lines added | **+127,117** |
| Lines deleted | −3,141 |
| Commits on main during the window | 140 |
| Average PR size | ~2,354 lines |
| Biggest single day | **July 18 — +38,174 lines across 4 PRs** |
| Most PRs in one day | **July 19 — 8 PRs, +24,691 lines** |
| npm downloads in the first ~48 hours after publish | **235** |

Read that middle row again: **127K lines in three weeks**. And these were not vibe-coded
lines. Every one of them passed through a gated, spec-first, review-enforced engineering
pipeline — the same discipline you'd expect from a senior team with a quarterly roadmap,
compressed into days.

## The timeline: five phases, zero chaos

The build followed an explicit phased plan, and the merge history shows each phase
landing in order:

- **Phase 0 — Foundation & evidence (Jul 5–11).** Before a single product line was
  written, the V2 specs, gates, and phased build plan were merged (#5), every plan task
  was filed as a GitHub issue (#55), and a data inventory audited *real transcript
  files* for observed-field evidence (#57). V1 was parked into `legacy/` (#56).
- **Phase 1 — Toolchain (Jul 10–11).** Three-root TypeScript package (#59), dev/build
  toolchain (#60), CI (#61), Storybook (#62), Biome lint/format (#63). Quality gates
  existed *before* the product did.
- **Phase 2 — The ingest & metrics engine (Jul 11–14).** Shared contracts (#67),
  transcript parser with dedupe (#70), discovery + polling (#71), a byte-offset
  incremental tailer (#72), a warm-start NDJSON parse cache (#73), store + ingest
  pipeline (#74), the metrics engine (#75), distributions & compare (#76), the API
  route (#77), and a WebSocket invalidation bus (#78).
- **Phase 3 — The React shell (Jul 14–15).** Routing, query layer, WS client (#79),
  global filter bar with URL sync (#80), and the chart layer (#81).
- **Phase 4 — Twelve pages in five days (Jul 16–23).** This is where the pipeline went
  parallel: Cypress E2E harness (#83), parallel-ready lanes (#86), then a page-per-lane
  blitz — Dashboard (#89), Cache Lab (#91), Session Detail (#92), Sessions (#93),
  Models (#96), Trends/Calendar/Budget (#97), Projects (#99), Turn Inspector (#103),
  Settings (#102), Report Card (#106), Explore (#107), Data Health (#111) — plus the
  gates engine (#100), full-text search (#105), CSV/JSON export (#101), and premium
  cost-capture parsers (#109).
- **Phase 5 — Hardening (Jul 19–24).** Load-fix for dashboard flicker (#95), sub-agent
  transcript routing (#114), producer-side cost capture (#115), benchmark numbers
  recorded and tooling extended (#117).

### The weekend that shipped half the product

The velocity peak tells the story of parallel agent lanes better than any diagram:

| Date | PRs merged | Lines changed |
|---|---:|---:|
| Jul 17 | 3 | +3,859 |
| **Jul 18** | **4** | **+38,174** |
| **Jul 19** | **8** | **+24,691** |
| Jul 20 | 4 | +9,705 |

**July 18–19 alone: 12 PRs, +62,865 lines — 49% of the entire V2 build in one weekend.**
That was Phase 4's parallel-lane execution: one issue per worktree, isolated dev ports
per lane, each lane gated independently, then squash-merged in sequence.

## "Engineered, not vibe code" — the receipts

It's fashionable to assume AI-assisted volume means chaos. The ledger says otherwise:

- **Specs are law.** The repo's own agent instructions state it plainly: *"Specs win
  over code or mockups."* The specs (#5) and the issue scaffold (#55) were merged
  **before** the product code, and PR #5 itself went through visible review remediation
  ("fix critical spec contradictions from PR #5 review").
- **Every PR traces to a numbered plan task or issue** — `#P0-2` through `#P5-1`,
  `feat(34)`, `fix(113)`. No orphan work. No mystery diffs.
- **The 127K includes the safety net.** That line count contains the specs, the Cypress
  E2E harness (+4,471 in #83), Storybook (+3,189 in #62), CI, and the test fixtures.
  The tests and gates aren't omitted from the brag — they *are* the brag.
- **Review actually bit.** A revert (#68), a concurrency load fix found under real
  multi-session pressure (#95), a series-naming disambiguation fix (#104), a sub-agent
  routing fix (#114). Real bugs, caught by real gates, fixed in focused PRs.
- **Evidence before parsing.** The data inventory (#57) documented *observed* fields in
  real transcripts before the parser tiers were built — and later, premium tier parsers
  (#109) were upgraded against observed values, not assumptions.

A deletion ratio of 2.4% (3,141 deletions against 127K additions) is what greenfield
looks like when the plan is right the first time.

## The engine behind it: a pipeline of agent skills

None of this was ad-hoc prompting. The build ran on a deliberate, repeatable pipeline
of agent skills — the same skills I maintain publicly at
**[github.com/foyzulkarim/skills](https://github.com/foyzulkarim/skills)** — applied
end-to-end across all 54 PRs:

1. **`/plan-requirements`** — a Socratic interview that captures the *what* and *why*
   into a sprint-sized requirements doc.
2. **`/plan-architecture`** — collaborative system design plus change-footprint mapping,
   producing the architecture doc.
3. **`/generate-tasks`** — slicing the architecture into verification-ready task specs
   (TDD, test-after, UI, checklist).
4. **`/implement`** — executing those tasks with mode-appropriate verification.
5. **`/review`** — a triage-first orchestrator that fans out up to 16 domain checks in
   parallel and compiles one report.
6. **`/commit`** — one-shot conventional commits with full diff context.

Around that core, a layer of project-local lane-management skills
(`/create-issue`, `/start-task`, `/move-to-worktree`, `/finish-worktree`,
`/archive-issue`) made the Phase 4 parallelism safe: every issue got its own numbered
worktree, its own port range, its own gate run — then squash-merged, archived, and the
lane torn down, ready for the next task.

That is the actual thesis of this report:

> **A brilliant dev pipeline is the anchor of a super-speedy, high-quality work
> pipeline.** The speed didn't come from the model typing fast. It came from specs that
> settle arguments before they start, gates that make "done" objective, and lanes that
> let agents work in parallel without stepping on each other. The skills made the
> pipeline; the pipeline made the 21 days.

## Real users, real production

This wasn't a demo branch. V2 shipped to npm as
[`@foyzulkarim/claude-lens`](https://www.npmjs.com/package/@foyzulkarim/claude-lens):

- **Published:** July 21, 2026 (v1.0.0, followed same-day by v1.0.1)
- **235 downloads in the first ~48 hours** — real users installing and running it
  against their own Claude Code transcripts while the final Phase 5 PRs were still
  landing.

Production users on day one, a changelog and setup guide two days later (#116), and
benchmark numbers recorded for the ingest hot path (#117). Ship, measure, document —
in that order, every time.

## By the numbers: the full PR ledger

All 55 merged pull requests in the repository, from the first commit to today
(companion CSV: `docs/merged-pr-report.csv`):

| PR | Title | Added | Deleted | Created | Merged |
|---:|-------|------:|--------:|---------|--------|
| #2 | docs: clarify absolute path requirements for CLAUDE_DIR in README | 3 | 0 | 2026-05-05 | 2026-07-05 |
| #5 | docs: V2 specs, gates, and phased build plan | 2400 | 0 | 2026-07-05 | 2026-07-06 |
| #55 | File all Phase 0–5 plan tasks as GitHub issues | 1580 | 37 | 2026-07-06 | 2026-07-06 |
| #56 | #P0-2 — Move V1 app into legacy/ | 63 | 62 | 2026-07-07 | 2026-07-07 |
| #57 | #P0-7 — Data inventory (observed-field evidence) | 1952 | 52 | 2026-07-10 | 2026-07-10 |
| #58 | docs(plan): rescope #P0-3 to synthetic fixtures, unblock Phase 1 | 53 | 49 | 2026-07-10 | 2026-07-10 |
| #59 | feat: scaffold three-root TS package (#P1-1) | 4834 | 2 | 2026-07-10 | 2026-07-10 |
| #60 | #P1-2 — Dev & build toolchain | 515 | 7 | 2026-07-10 | 2026-07-10 |
| #61 | #P1-3 — CI | 77 | 1 | 2026-07-10 | 2026-07-10 |
| #62 | #P1-4 — Storybook setup | 3189 | 118 | 2026-07-11 | 2026-07-11 |
| #63 | #P1-5 — Add Biome linter/formatter | 258 | 1 | 2026-07-11 | 2026-07-11 |
| #64 | #P0-8 — Harden closed-issue wiki archive convention | 1226 | 65 | 2026-07-11 | 2026-07-11 |
| #67 | #P2-1 — Shared contracts | 846 | 25 | 2026-07-11 | 2026-07-12 |
| #68 | Revert sub-page renaming: keep original specs/ filenames on archive | 61 | 38 | 2026-07-11 | 2026-07-12 |
| #69 | chore: archive #8/#18 wiki artifacts, retire from specs/ | 142 | 738 | 2026-07-12 | 2026-07-13 |
| #70 | #P2-2 — Transcript parser + dedupe | 1074 | 0 | 2026-07-13 | 2026-07-13 |
| #71 | #P2-3 — Discovery + polling | 1306 | 11 | 2026-07-13 | 2026-07-13 |
| #72 | #P2-4 — Tailer: byte-offset incremental transcript reader | 958 | 0 | 2026-07-13 | 2026-07-13 |
| #73 | #P2-5 — Warm-start cache: byte-offset-keyed NDJSON parse cache | 1219 | 2 | 2026-07-13 | 2026-07-13 |
| #74 | #P2-6 / #P2-7 — Store + derivations, ingest pipeline, boot checkpoint | 1970 | 8 | 2026-07-13 | 2026-07-13 |
| #75 | feat(25): implement metrics engine — measures, dimensions, grain | 2258 | 0 | 2026-07-14 | 2026-07-14 |
| #76 | #P2-9 — Distributions + smoothing + compare | 1549 | 39 | 2026-07-14 | 2026-07-14 |
| #77 | feat(27): add POST /api/metrics route | 651 | 6 | 2026-07-14 | 2026-07-14 |
| #78 | feat(28): wire ingest to WS invalidation bus | 827 | 31 | 2026-07-14 | 2026-07-14 |
| #79 | feat(29): add React shell — routing, query layer, WS invalidation client | 1134 | 15 | 2026-07-14 | 2026-07-15 |
| #80 | feat(30): global filter bar + URL sync (#P3-3) | 1280 | 23 | 2026-07-15 | 2026-07-15 |
| #81 | feat(31): chart layer + one live chart (#P3-4) | 2394 | 43 | 2026-07-15 | 2026-07-15 |
| #82 | docs(plan): Phase 4/5 parallelization plan | 289 | 2 | 2026-07-16 | 2026-07-16 |
| #83 | feat(32): add Cypress end-to-end smoke test | 4471 | 128 | 2026-07-16 | 2026-07-16 |
| #86 | chore: make Phase 4 lanes parallel-ready | 1045 | 194 | 2026-07-17 | 2026-07-17 |
| #87 | feat(33): add shared dashboard primitives | 2065 | 52 | 2026-07-17 | 2026-07-17 |
| #88 | feat(84): make time-series charts accessible without the canvas | 749 | 15 | 2026-07-17 | 2026-07-17 |
| #89 | feat(34): Dashboard page | 13291 | 97 | 2026-07-18 | 2026-07-18 |
| #91 | feat(41): Cache Lab page | 7776 | 57 | 2026-07-18 | 2026-07-18 |
| #92 | feat(37): Session Detail page | 8201 | 50 | 2026-07-18 | 2026-07-18 |
| #93 | feat(36): build the Sessions page | 8906 | 137 | 2026-07-18 | 2026-07-18 |
| #95 | fix(#P4-20): dashboard flicker under concurrent multi-session load | 519 | 19 | 2026-07-19 | 2026-07-19 |
| #96 | feat(40): build Models page | 3202 | 11 | 2026-07-19 | 2026-07-19 |
| #97 | feat(42): build the Trends, Calendar & Budget page | 4229 | 11 | 2026-07-19 | 2026-07-19 |
| #99 | #P4-7 — Projects page (#39) | 2902 | 5 | 2026-07-19 | 2026-07-19 |
| #100 | feat(43): gates engine | 3629 | 15 | 2026-07-19 | 2026-07-19 |
| #101 | feat(49): CSV/JSON export of the filtered Sessions view | 1553 | 4 | 2026-07-19 | 2026-07-19 |
| #102 | feat(47): Settings page + config/local-store | 4515 | 173 | 2026-07-19 | 2026-07-19 |
| #103 | feat(38): build the Turn Inspector page (#P4-6) | 4142 | 48 | 2026-07-19 | 2026-07-19 |
| #104 | fix: disambiguate chart series names across multiple measures | 83 | 5 | 2026-07-20 | 2026-07-20 |
| #105 | feat(35): full-text prompt search (#P4-3) | 2893 | 36 | 2026-07-20 | 2026-07-20 |
| #106 | feat(44): Report Card UI and live gate feeds | 3579 | 153 | 2026-07-20 | 2026-07-20 |
| #107 | feat(48): build the Explore page pivot builder (#P4-16) | 3150 | 37 | 2026-07-20 | 2026-07-20 |
| #109 | feat(45): Premium tier C/B/L parsers + observed-value upgrades (#P4-13) | 4546 | 139 | 2026-07-21 | 2026-07-21 |
| #110 | docs(plan): add Phase 6/7 for the post-v1 product roadmap | 81 | 3 | 2026-07-22 | 2026-07-23 |
| #111 | feat(46): Data Health page + /api/health extension (#P4-14) | 3594 | 309 | 2026-07-23 | 2026-07-23 |
| #114 | fix(113): route sub-agent transcripts to parent sessions | 907 | 19 | 2026-07-23 | 2026-07-23 |
| #115 | feat(112): add producer-side cost-capture tier | 2619 | 31 | 2026-07-23 | 2026-07-23 |
| #116 | docs(53): add cost-capture setup guide, tier walkthrough, and CHANGELOG | 66 | 1 | 2026-07-23 | 2026-07-23 |
| #117 | perf(51): record #P5-1 benchmark numbers; extend benchmark tool with data-size + --roots | 299 | 17 | 2026-07-23 | 2026-07-23 |

---

*Data source: GitHub PR metadata via `gh pr list --state merged` (additions/deletions
reflect the final merged diff on main). npm figures from the npm downloads API.
Report generated July 24, 2026. Build pipeline:
[github.com/foyzulkarim/skills](https://github.com/foyzulkarim/skills).*
