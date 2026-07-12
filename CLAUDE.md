# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo state: transitional (V1 app + V2 specs)

The root currently holds two generations at once: the **V1 dashboard** (runnable Express app) and the **V2 design specs** (`specs/`). Task #P0-2 moves every V1 file into `legacy/`; V2 code does not exist yet — Phases 1–5 build it from the specs. Don't extend V1 beyond keep-it-running fixes, and don't scaffold V2 pieces outside their plan tasks.

## Commands (V1 — the currently runnable app)

- `node server.js` — dashboard at http://localhost:3456 (`npm run dev` for nodemon reload)
- Config via `.env` (`cp .env.example .env`): `CLAUDE_DIR` (defaults to `~/.claude`), `RATE_INPUT`/`RATE_OUTPUT`/`RATE_CACHE_READ`/`RATE_CACHE_CREATE` pricing per 1M tokens
- There are **no tests, lint, or build** yet. V2 tooling lands in Phase 1: vitest + CI (#P1-3), Storybook (#P1-4), Biome (#P1-5), Cypress (#P3-5)

## Architecture

**V1** (root, destined for `legacy/`): one ~640-line `server.js` — Express serving the static single-file `index.html`, with `/api/*` endpoints that re-scan and parse `~/.claude/projects/**/*.jsonl` transcripts on each request. No build step, no framework, pricing from env.

**V2** (specs only — the four docs under `specs/` are authoritative; this is just the map):

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
planned work:  specs/claude-lens-plan.md ──► /create-issue ─► /start-task <issue#> ─► (/plan-architecture ─► /generate-tasks) ─► /implement ─► /review ─► /commit
new ideas:     /plan-requirements ─► specs/requirements/REQ-<slug>.md ─► /create-issue ─► same as above
```

- **`specs/claude-lens-plan.md` is the orchestrator.** It owns sequencing (phases 0–3 strict, Phase 4 ordered), per-phase exit criteria, go/no-go checkpoints (#P2-7, #P3-4), and the decisions log. Consult it to answer "what's next, and can it start yet?" Checkboxes flip when issues **close**, not when they're filed.
- **Issues are lean contracts** — scope, acceptance criteria verbatim from their requirements source, dependencies. Never design docs. Created via the project skill `.claude/skills/create-issue/` (`/create-issue`), which picks the right shape per work type (plan-task, page, spike, bug, enhancement, chore).
- **Draft locally, publish in one batch.** `/create-issue` writes drafts to `specs/issues/*.md` (frontmatter: `status: draft → ready → filed`), the user edits them until happy, then `.claude/skills/create-issue/scripts/publish.sh` files all `ready` drafts to GitHub in one sequential `gh` run and stamps each with its issue number/URL. Never file issues one-by-one during drafting.
- **Every issue cites an already-settled requirements source** — the plan/architecture/pages/gates specs for plan tasks, a REQ doc for interviewed enhancements. Issues never invent requirements.
- **Depth at start-time is architectural, not requirements.** For plan tasks the specs already are the requirements; `/plan-architecture` and `/generate-tasks` produce the *how* against the current code. Requirements interviews (`/plan-requirements`) happen *before filing*, and only for fuzzy ad-hoc enhancements.

## Skill locations

- `/create-issue` — project-local, `.claude/skills/create-issue/`.
- `/archive-issue` — project-local, `.claude/skills/archive-issue/`. Retires a closed issue's `specs/` artifacts into the `docs/issue-NNN/` wiki-mirror structure, resolving every source file from the issue record anchor — see `specs/wiki-structure.md`.
- `/start-task`, `/plan-requirements`, `/plan-architecture`, `/generate-tasks`, `/implement`, `/review`, `/commit` — user-level (`~/.claude/skills/`), all `disable-model-invocation: true`: only the user can invoke them; suggest them by name, never attempt to trigger them.

## Specs layout

`specs/claude-lens-plan.md` (phases/tasks) · `claude-lens-architecture.md` (how) · `claude-lens-pages.md` (page section tables — binding over mockups) · `gates.md` (Report Card gates) · `pages/*.html` (visual mockups) · `issues/` (local issue drafts + filed records from `/create-issue`, open issues only) · `context/` (per-task context written by `/start-task`, open issues only) · `requirements/` (REQ docs from `/plan-requirements`, open issues only) · `architecture/` (ARCH docs from `/plan-architecture`, open issues only) · `wiki-structure.md` (archive layout + correlation model for closed issues).

**Archiving finished issues:** once an issue closes, its `issues/`/`context/`/`requirements/`/`architecture/`/`CODE-REVIEW-*.md` entries move out of `specs/` into `docs/issue-NNN/` — one hub page per issue, wiki-flat sub-pages for whichever of requirements/architecture/review/findings/decisions/assets actually exist. Navigation (`docs/Home.md`, `docs/_Sidebar.md`) groups archived issues by phase (derived from the primary plan-task ID, with an Unphased bucket for issues without one), sorted by issue number, each phase marked ✓/◐ from `plan.md`. `specs/wiki-structure.md` has the layout rules and the correlation model (how every source file resolves from the issue record anchor); `.claude/skills/archive-issue/` does the retirement. `docs/` mirrors the GitHub wiki 1:1; pushing it to the wiki repo is a manual step, not part of this repo's history.
