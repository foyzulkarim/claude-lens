# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo state: V2 active (Phase 4)

Phases 0–3 are complete: the V2 TypeScript app lives in `shared/`, `server/`, and `client/`, and Phase 4 page/feature work is next. The old Express dashboard is preserved under `legacy/`; don't extend it beyond keep-it-running fixes. Keep V2 work inside the active plan task and its settled specs.

## Commands (V2 — active app)

- `npm ci` — locked install; run separately in each worktree.
- `npm run dev` — backend on 4128 and Vite on 4129 by default; `CLAUDE_LENS_PORT_BASE=N` derives backend `N`, Vite `N+1`, and E2E `N+2`.
- `npm run verify` — complete typecheck, lint, format, and unit/integration test gate.
- `npm run build` — production CLI and SPA bundle under `dist/`.
- `npm run test:e2e` — isolated fixture copy + built server + Cypress.
- `npm start` — run the built app. V1 instructions are in `legacy/README.md`.

## Before pushing (V2)

`npm run verify` runs the exact CI gate from `.github/workflows/ci.yml` — `typecheck` → `lint` → `format:check` → `test`, in that order. A Husky `pre-push` hook (`.husky/pre-push`, wired via the `prepare` script) runs it automatically on every `git push`, so this is enforced mechanically rather than by remembering — don't bypass it with `--no-verify` without a specific reason. `lint` and `format:check` are separate Biome checks (one is code-quality rules, the other is whitespace/wrapping); passing one says nothing about the other.

## Architecture

**V1** (`legacy/`, maintenance only): one ~640-line `server.js` — Express serving the static single-file `index.html`, with `/api/*` endpoints that re-scan and parse `~/.claude/projects/**/*.jsonl` transcripts on each request. No build step, no framework, pricing from env.

**V2** (active — the specs remain authoritative; this is just the map):

- **One npm package, one port**: Fastify serves the built SPA, `/api/*`, and a `/ws` upgrade. Three strict-TS roots: `shared/` (contracts), `server/`, `client/` (architecture §3; deps are pinned by §2 — deviating requires editing the doc first).
- **Ingest pipeline** (§5): discovery (fast-glob over roots) → poller (fast stat loop + slow re-glob) → tailer (byte-offset incremental reads, partial-line safe) → parser (JSONL line → `ApiCall`, `message.id` dedupe, malformed lines counted never thrown) → in-memory columnar store → derived turns/sessions → debounced per-session invalidation.
- **WS is an invalidation bus only** (§7): three message types, never data; the client refetches mounted queries by key prefix.
- **Metrics engine** (§8): a single `metrics(query) → Series[]` function (measure × dimension × grain, distributions, compare, smoothing). Every page is preset queries + layout over this engine — pages are deliberately cheap.
- **Tier system** (§4): transcript files alone give computed/estimated values (🟢 exact, 🟡 estimated); optional premium capture files (`<uuid>.cost.jsonl`, `<uuid>.turn-boundaries.jsonl`, `~/.claude/cost-log.jsonl`) upgrade to observed values per session; 🔴 = unavailable without them.
- **Client** (§11): React + wouter + TanStack Query; ECharts via a hand-rolled ~50-line wrapper (no `echarts-for-react`); global filter state lives in the URL query string (permalinks are a spec requirement).

Which doc for what: `claude-lens-architecture.md` (how) · `claude-lens-pages.md` (what — its per-page section tables are **binding over the HTML mockups**) · `gates.md` (Report Card gates) · `claude-lens-plan.md` (when — phases, tasks, decisions log).

## The delivery pipeline

**Specs decide what, issues track what, start-time skills decide how, and the plan doc decides when.**

```
planned work:  specs/claude-lens-plan.md ──► /create-issue ─► /start-task <issue#> ─► /move-to-worktree ─► (/plan-architecture ─► /generate-tasks) ─► /implement ─► /review ─► /commit ─► PR merges, issue closes ─► /finish-worktree ─► /archive-issue
new ideas:     /plan-requirements ─► specs/requirements/REQ-<slug>.md ─► /create-issue ─► same as above
```

- **Every PR body must carry `Closes #N`** (or `Fixes`/`Resolves`) for its issue, so merging the PR actually closes it — nothing in `/commit` or any other skill does this automatically (`/commit`'s trailer is `Refs: {task-number}`, which does not auto-close). Skip it only when the PR has no associated issue, or when there's a specific reason to close manually (e.g. `NOT_PLANNED`/re-gated instead of shipped, as with #8) — but then close it explicitly before moving on, since `/archive-issue` refuses to touch an open issue and a forgotten close is exactly what leaves stale files behind (see next bullet).
- **`/archive-issue` runs promptly once its issue closes — don't let it batch up.** `/review`'s `CODE-REVIEW-PR-<N>.md` reports land at the **repo root**, not `specs/`; if archiving is deferred, these (plus the issue's `specs/issues/`/`context/` files) sit untouched at root for issues that are already closed. This has already happened twice (#8/#18's files, and a stray review report for #17, all found stale during an unrelated cleanup pass) — treat "PR merged, issue closed" as the trigger, not "I happened to notice `specs/` looks cluttered."
- **`specs/claude-lens-plan.md` is the orchestrator.** It owns sequencing (phases 0–3 strict, Phase 4 ordered), per-phase exit criteria, go/no-go checkpoints (#P2-7, #P3-4), and the decisions log. Consult it to answer "what's next, and can it start yet?" Checkboxes flip when issues **close**, not when they're filed.
- **Issues are lean contracts** — scope, acceptance criteria verbatim from their requirements source, dependencies. Never design docs. Created via the project skill `.claude/skills/create-issue/` (`/create-issue`), which picks the right shape per work type (plan-task, page, spike, bug, enhancement, chore).
- **Draft locally, publish in one batch.** `/create-issue` writes drafts to `specs/issues/*.md` (frontmatter: `status: draft → ready → filed`), the user edits them until happy, then `.claude/skills/create-issue/scripts/publish.sh` files all `ready` drafts to GitHub in one sequential `gh` run and stamps each with its issue number/URL. Never file issues one-by-one during drafting.
- **Every issue cites an already-settled requirements source** — the plan/architecture/pages/gates specs for plan tasks, a REQ doc for interviewed enhancements. Issues never invent requirements.
- **Depth at start-time is architectural, not requirements.** For plan tasks the specs already are the requirements; `/plan-architecture` and `/generate-tasks` produce the *how* against the current code. Requirements interviews (`/plan-requirements`) happen *before filing*, and only for fuzzy ad-hoc enhancements.

## Skill locations

- `/create-issue` — project-local, `.claude/skills/create-issue/`.
- `/move-to-worktree` — project-local, `.claude/skills/move-to-worktree/`. Moves the clean, pushed `/start-task` branch into an issue-numbered sibling worktree, writes its isolated port block, and returns the primary checkout to current `main`.
- `/finish-worktree` — project-local, `.claude/skills/finish-worktree/`. After squash-merge, verifies the exact merged PR head and closed issue, fast-forwards `main`, and safely removes the clean worktree and local branch.
- `/archive-issue` — project-local, `.claude/skills/archive-issue/`. Retires a closed issue's `specs/` artifacts straight into the GitHub wiki (never into this repo), resolving every source file from the issue record anchor — see `specs/wiki-structure.md`.
- `/start-task`, `/plan-requirements`, `/plan-architecture`, `/generate-tasks`, `/implement`, `/review`, `/commit` — user-level (`~/.claude/skills/`), all `disable-model-invocation: true`: only the user can invoke them; suggest them by name, never attempt to trigger them.

## Specs layout

`specs/claude-lens-plan.md` (phases/tasks) · `claude-lens-architecture.md` (how) · `claude-lens-pages.md` (page section tables — binding over mockups) · `gates.md` (Report Card gates) · `pages/*.html` (visual mockups) · `issues/` (local issue drafts + filed records from `/create-issue`, open issues only) · `context/` (per-task context written by `/start-task`, open issues only) · `requirements/` (REQ docs from `/plan-requirements`, open issues only) · `architecture/` (ARCH docs from `/plan-architecture`, open issues only) · `wiki-structure.md` (archive layout + correlation model for closed issues).

**Archiving finished issues:** once an issue closes, its `issues/`/`context/`/`requirements/`/`architecture/` entries (under `specs/`) and any matching `CODE-REVIEW-*.md` (at the **repo root**, where `/review` writes them, not `specs/`) move out of the main repo straight into the GitHub wiki as `issue-NNN` — one hub page per issue, wiki-flat sub-pages for whichever of requirements/architecture/review/findings/decisions/assets actually exist. Navigation (`Home.md`, `_Sidebar.md` on the wiki) groups archived issues by phase (derived from the primary plan-task ID, with an Unphased bucket for issues without one), sorted by issue number, each phase marked ✓/◐ from `plan.md`. `specs/wiki-structure.md` has the layout rules and the correlation model (how every source file resolves from the issue record anchor); `.claude/skills/archive-issue/` does the retirement, working in a gitignored local clone of the wiki repo (`.wiki/`, never committed to `main`) and pushing to the live wiki as a confirmed step. No archived content is ever kept in this repo — the wiki is the only copy.
