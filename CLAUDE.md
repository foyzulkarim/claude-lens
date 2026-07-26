# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read `AGENTS.md` too.** The two files split deliberately: **CLAUDE.md = process** (repo state, phase sequencing, the issue/worktree/archive pipeline), **`AGENTS.md` = code** (module direction, DI conventions, naming, untrusted-input rules, testing conventions, and a file-by-file map of the important modules). Anything about *how to write code here* lives in `AGENTS.md`, not below.

## Repo state: V2 shipped; Phase 6 is next

Phases 0–5 are complete and `@foyzulkarim/claude-lens` is published on npm (v1.1.1 as of 2026-07-26). All 21 Phase 4 tasks and all 4 Phase 5 tasks are `[x]` in `specs/claude-lens-plan.md`, and there are **no open GitHub issues** — verify with `gh issue list` rather than assuming, since this line goes stale.

Active roadmap is **Phase 6** (`#P6-1`…`#P6-8` — comprehension, differentiation, distribution) and **Phase 7** (`#P7-1`/`#P7-2` — MCP surface). Two things to know before filing anything there:

- The `phase-6` and `phase-7` **labels and milestones don't exist yet** and must be created before the first issue is filed (the #P0-6 precedent).
- `#P6-1` (release cut including #109's premium parsers) and `#P6-7` (branded chart export) both have unresolved scope questions recorded in the plan — read their `*Dependencies:*` lines before treating them as ready.

The old Express dashboard is preserved under `legacy/`; don't extend it beyond keep-it-running fixes.

## Commands

- `npm ci` — locked install (Node `>=22`, npm `10.9.2`); run separately in each worktree.
- `npm run dev` — Fastify on 4128 + Vite on 4129. `CLAUDE_LENS_PORT_BASE=N` derives backend `N`, Vite `N+1`, E2E `N+2`, Storybook `N+3` (so `npm run storybook` defaults to 4131, not Storybook's stock 6006). `dev:server` / `dev:client` run one half.
- `npm run verify` — typecheck → lint → format:check → test. See "Before pushing".
- `npm run build` — production CLI + SPA + capture assets under `dist/`; `npm start` runs the built app.
- `npm run test:e2e` — isolated fixture copy + built server + Cypress.
- `npm run storybook` — manual state workbench (populated/empty/loading/error/tier variants). Not a behavior test; no visual regression.
- `npm run bench:ingest` — ingest + wide-range query benchmark; results get recorded in the plan's benchmark log.
- V1 instructions are in `legacy/README.md`.

## Testing

Tests are colocated `*.test.ts(x)` under `{shared,server,client,cypress,scripts,capture}` (`legacy/` and `dist/` excluded — see `vitest.config.ts`). `test/fixtures/` and `test/fixtures-premium/` hold data, not test source.

- Single file: `npx vitest run server/metrics/engine.test.ts`
- Single test: `npx vitest run <file> -t "partial name"`
- Watch while iterating: `npx vitest`

Server routes are tested through `app.inject`, not a live socket. Fixtures are hand-authored and synthetic — never copy real `~/.claude` prompts, paths, or identifiers into them. `AGENTS.md` has the full testing conventions (fixed timestamps, injected clocks, roles-before-test-IDs, when to reach for Cypress vs. Vitest).

## Before pushing

`npm run verify` is the `typecheck-test` CI job exactly — `typecheck` → `lint` → `format:check` → `test`, in that order. A Husky `pre-push` hook (`.husky/pre-push`, wired via `prepare`) runs it on every `git push`, so it's enforced mechanically; don't `--no-verify` without a specific reason. `lint` and `format:check` are separate Biome checks (code-quality rules vs. whitespace/wrapping) — passing one says nothing about the other.

**`verify` is not all of CI.** `.github/workflows/ci.yml` has a **second blocking job** running `npm run test:e2e`, which neither `verify` nor the pre-push hook covers, so a green push can still fail CI. Run E2E yourself when the change touches the packaged runtime, cross-page flows, persistence, or live-update behavior. (`build-storybook` also runs in CI but is `continue-on-error` — advisory only.)

## Architecture

**V1** (`legacy/`, maintenance only): one ~640-line `server.js` — Express serving a static single-file `index.html`, with `/api/*` endpoints that re-scan and parse `~/.claude/projects/**/*.jsonl` on each request. No build step, no framework, pricing from env.

**V2** (active — the specs remain authoritative; this is just the map; `AGENTS.md` has the module-level rules):

- **One npm package, one port**: Fastify serves the built SPA, `/api/*`, and a `/ws` upgrade. Strict-TS projects are `shared/` (contracts), `server/`, `client/`, `cypress/`, and `capture/` — one `tsconfig.json` each, all extending `tsconfig.base.json` (architecture §3; deps are pinned by §2 — deviating requires editing the doc first). Note `capture/`'s project covers only its `*.test.ts` (the producers themselves are `.cjs`), and **`scripts/*.ts` belongs to no project, so `npm run typecheck` never sees it** — it's run by `tsx`, linted by Biome, and covered by its own Vitest tests, but type errors there surface only at runtime.
- **Ingest pipeline** (§5): discovery (fast-glob over roots) → poller (fast stat loop + slow re-glob) → tailer (byte-offset incremental reads, partial-line safe) → parser (JSONL line → `ApiCall`, `message.id` dedupe, malformed lines counted never thrown) → in-memory columnar store → derived turns/sessions → debounced per-session invalidation. `server/ingest/` is the only production writer to the Store; routes read snapshots.
- **WS is an invalidation bus only** (§7): three message types, never data; the client refetches mounted queries by key prefix.
- **Metrics engine** (§8): a single `metrics(query) → Series[]` function (measure × dimension × grain, distributions, compare, smoothing) operating on plain arrays, independent of the Store. Every page is preset queries + layout over this engine — pages are deliberately cheap.
- **Tier system** (§4): transcript files alone give computed/estimated values (🟢 exact, 🟡 estimated); optional premium capture files (`<uuid>.cost.jsonl`, `<uuid>.turn-boundaries.jsonl`, `~/.claude/cost-log.jsonl`) upgrade to observed values per session; 🔴 = unavailable without them. Never substitute `0` for an unavailable observed value.
- **`capture/` is the producer side of that tier** (#P4-21): synchronous, failure-tolerant **CommonJS** statusline/Stop-hook scripts that run inside the user's own Claude Code session, plus an idempotent `install.sh`. Do not apply the server's async conventions there — a logging failure must never break someone's statusline. Its field names are load-bearing: any change must be made in lockstep with `server/ingest/parse-premium.ts`.
- **Client** (§11): React + wouter + TanStack Query; ECharts via a hand-rolled ~50-line wrapper (no `echarts-for-react`); global filter state lives in the URL query string (permalinks are a spec requirement).

## Authoritative documents

Authority is domain-specific — when two docs disagree, the domain owner wins:

| Doc | Owns |
|---|---|
| `docs/claude-lens-architecture.md` | implementation mechanics (the **how**) |
| `specs/claude-lens-pages.md` | per-page section tables and data semantics — **binding over the HTML mockups** in `specs/pages/*.html` |
| `specs/claude-lens-data-model.md` | observed-field evidence across T/C/B/L (regenerated by `scripts/survey-fields.py`) — pure evidence, no interpretation |
| `specs/claude-lens-field-definitions.md` | what those fields **mean**, with ✅/🔶/❓ confidence marks — kept separate so a re-survey never clobbers prose |
| `specs/gates.md` | Report Card gate algorithms and evidence contracts |
| `specs/claude-lens-plan.md` | phases, tasks, exit criteria, benchmark log, decisions log (the **when**) |
| `specs/wiki-structure.md` | archive layout + correlation model for closed issues |
| `specs/claude-lens-phase4-parallelization.md` | *historical* — Phase 4's parallel-lane orchestration, now complete. Read it only for worktree/port mechanics or precedent. |

Working directories that exist **only while an issue is open**, then get archived: `specs/issues/` (drafts + filed records from `/create-issue`), `specs/context/` (`/start-task`), `specs/requirements/` (`/plan-requirements`), `specs/architecture/` (`/plan-architecture`), `specs/reviews/` (`/review`). They're currently absent — that's the correct steady state with zero open issues, not a missing directory.

## The delivery pipeline

**Specs decide what, issues track what, start-time skills decide how, and the plan doc decides when.**

```
planned work:  specs/claude-lens-plan.md ──► /create-issue ─► /start-task <issue#> ─► /move-to-worktree ─► (/plan-architecture ─► /generate-tasks) ─► /implement ─► /review ─► /commit ─► PR merges, issue closes ─► /finish-worktree ─► /archive-issue
new ideas:     /plan-requirements ─► specs/requirements/REQ-<slug>.md ─► /create-issue ─► same as above
```

- **Every PR body must carry `Closes #N`** (or `Fixes`/`Resolves`) — nothing in `/commit` or any other skill does this automatically (`/commit`'s trailer is `Refs: {task-number}`, which does not auto-close). Skip it only when there's no issue, or when the issue should close manually (`NOT_PLANNED`/re-gated rather than shipped, as with #8) — and then close it explicitly before moving on, since `/archive-issue` refuses to touch an open issue.
- **`/archive-issue` runs promptly once its issue closes — don't let it batch up.** `/review` writes its report to **`specs/reviews/CODE-REVIEW-*.md`** (`PIPELINE-<N>-<slug>`, `PR-<n>`, `BRANCH-<name>`, `STAGED-<ts>`, or `DIFF-<name>`; older reports predating `specs/reviews/` linger at the repo root — `/archive-issue` searches both). Deferred archiving leaves those plus the issue's other `specs/` files sitting around for already-closed work; this has drifted three times here (#8/#18's files, a stray `CODE-REVIEW-PR-63.md` for #17, and #26's `REV-PR-76.md`). The trigger is "PR merged, issue closed," not "I noticed `specs/` looks cluttered."
- **Issues are lean contracts** — scope, acceptance criteria verbatim from an already-settled requirements source (plan/architecture/pages/gates for plan tasks, a REQ doc for interviewed enhancements), dependencies. Never design docs, never invented requirements.
- **Draft locally, publish in one batch.** `/create-issue` writes `specs/issues/*.md` (`status: draft → ready → filed`); the user edits until happy, then `.claude/skills/create-issue/scripts/publish.sh` files every `ready` draft in one sequential `gh` run and stamps each with its number/URL. Never file one-by-one during drafting.
- **Plan checkboxes flip when issues *close*, not when they're filed.** The plan's own decisions log records several rounds of checkbox drift — live `gh` state is the truth.
- **Depth at start-time is architectural, not requirements.** For plan tasks the specs already are the requirements; `/plan-architecture` and `/generate-tasks` produce the *how* against current code. `/plan-requirements` runs *before filing*, and only for fuzzy ad-hoc enhancements.

## Skills

Project-local, in `.claude/skills/` — **these three exist because the plugin equivalents deliberately don't do this project's work.** Don't "dedupe" them against the plugin without reading the next paragraph.

- **`/create-issue`** — picks the right issue shape per work type (plan-task, page, spike, bug, enhancement, chore). No plugin counterpart.
- **`/move-to-worktree`** — parks the clean, pushed `/start-task` branch in an issue-numbered nested worktree (`.worktrees/<issue#>`, inside the repo root — never a `../` sibling), writes its isolated port block (`CLAUDE_LENS_PORT_BASE = 4128 + 10 × issue#` into `<worktree>/.env.local`), runs `npm ci` (which also wires the worktree's Husky pre-push hook), and returns the primary checkout to current `main`. **`dev-pipeline:move-to-worktree` refuses the last two on purpose** ("do not install dependencies, write port configuration, or otherwise touch the project's toolchain") — swapping to it makes both manual per lane.
- **`/archive-issue`** — retires a closed issue's `specs/` artifacts into the GitHub wiki (never into this repo), resolving every source file from the `specs/issues/<ID>-<slug>.md` anchor, writing the `**Plan task:** / **Phase:**` hub metadata line and the **phase-grouped** `Home.md`/`_Sidebar.md` with ✓/◐ markers read from `plan.md`. **`dev-pipeline:archive-issue` uses a flat, ungrouped index and no plan-task metadata** — it would produce pages inconsistent with the 100+ already on this wiki.

From the `dev-pipeline` plugin (not project-local): `/start-task`, `/plan-requirements`, `/plan-architecture`, `/generate-tasks`, `/implement`, `/review`, `/commit`, `/finish-worktree`, `/release-notes`. The last two were project-local until 2026-07-26, when the plugin versions became strict supersets and the local copies were deleted — the only thing lost was `/finish-worktree`'s reminder to flip the plan checkbox (which the pipeline section above already states). Plugin 5.0.0 dropped `disable-model-invocation` from all of them, so Claude may invoke them directly. A bare `/commit` resolves to the user-level `~/.claude/skills/commit/`. Plugin skills are namespaced — if a bare `/finish-worktree` or `/release-notes` doesn't resolve now that the local copies are gone, use `dev-pipeline:<name>`. The pipeline diagram above uses bare names for readability.

**Invocable is not the same as automatic.** Each skill's description still says "use only when the user asks" — invoke one when the user asks for that work in whatever words ("commit this" → `/commit`, "review PR 123" → `/review`), and never fire one off a bare coding request. Prefer the skill over hand-rolling its job: the conventions (commit trailers, branch naming, worktree ports) live inside its scripts.

## Archiving finished issues

Once an issue closes, its `specs/issues/`, `specs/context/`, `specs/requirements/`, `specs/architecture/` entries and every matching review report (`specs/reviews/CODE-REVIEW-*.md`, or legacy copies at the repo root — **matched by the report's `Target` branch, never by assuming PR number = issue number**) move out of this repo into the GitHub wiki as `issue-NNN` — one hub page per issue, wiki-flat sub-pages for whichever of requirements/architecture/review/findings/decisions/assets exist. Wiki navigation (`Home.md`, `_Sidebar.md`) groups issues by phase, derived from the primary plan-task ID (Unphased bucket for issues without one), sorted by number, each phase marked ✓/◐ from `plan.md`.

`specs/wiki-structure.md` has the layout rules and the correlation model; `/archive-issue` does the work in a gitignored local clone (`.wiki/`, never committed to `main`) and pushes to the live wiki as a confirmed step. **No archived content stays in this repo — the wiki is the only copy.**
