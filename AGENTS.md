# AGENTS.md — claude-lens

> **V2 is active**: Phases 0–3 are complete and Phase 4 is next. V1 is preserved under `legacy/` only. See `CLAUDE.md` for the full map.

## Hard rules

1. **Don't extend V1** under `legacy/` beyond keep-it-running fixes.
2. **Don't build outside the active plan task.** Phase 4 scope and start gates come from the plan and its parallelization companion.
3. **Run `npm run verify` before pushing.** Husky enforces the same typecheck → lint → format → test gate.
4. **Specs win on conflict.** `claude-lens-pages.md` per-page section tables are **binding over** `pages/*.html` mockups. On code/doc/spec conflict, trust the spec.

## Commands (V2 — active app)

```bash
npm ci                                     # locked install; use in every worktree
npm run dev                                # backend 4128 + Vite 4129 by default
npm run verify                             # CI/pre-push gate
npm run build                              # production bundle in dist/
npm run test:e2e                           # build + isolated Cypress harness
npm start                                  # run the built dist/cli.js
```

- Set `CLAUDE_LENS_PORT_BASE` to isolate a checkout: backend = base, Vite = base + 1, E2E = base + 2. `/move-to-worktree` writes it to `.env.local` automatically.
- V1 remains runnable from `legacy/`; its instructions are in `legacy/README.md`.

## V2 delivery pipeline (spec-driven, batch issues)

```
plan-requirements → specs/requirements/REQ-<slug>.md     (ad-hoc enhancements only)
                              │
                              ▼
                  /create-issue  (project skill)
                              │  drafts → specs/issues/*.md  (status: draft → ready → filed)
                              │  publish.sh files all "ready" drafts in one batch
                              │  never file issues one-by-one during drafting
                              ▼
   /start-task <#issue> → /move-to-worktree → /plan-architecture → /generate-tasks
       → /implement → /review → /commit → PR merge → /finish-worktree → /archive-issue
```

- **`specs/claude-lens-plan.md` owns sequencing.** Phases 0–3 were strict; Phase 4 follows the hard start gates in `claude-lens-phase4-parallelization.md`. Checkboxes flip when issues **close**, not when filed.
- **Every issue cites a settled requirements source** (a spec, or a REQ doc). Issues never invent requirements.
- **For plan tasks, specs are the requirements** — no requirements interview. `/plan-requirements` happens *before* filing, only for fuzzy ad-hoc enhancements.
- **Phase 0 must finish before Phase 1** — labels (`phase-0`…`phase-5`) and milestones must exist before `/create-issue` runs (see #P0-6).

## Skills — split by location, never auto-invoke the user-level ones

- **`/create-issue`** — **project-local** at `.claude/skills/create-issue/`. Use for any "file an issue / log a bug / track this / scaffold a phase" request.
- **`/move-to-worktree`, `/finish-worktree`** — **project-local** worktree lane lifecycle. Move runs immediately after `/start-task`; finish runs in the primary checkout only after GitHub reports the PR merged and issue closed. See `specs/claude-lens-phase4-parallelization.md`.
- **`/start-task`, `/plan-requirements`, `/plan-architecture`, `/generate-tasks`, `/implement`, `/review`, `/commit`** — **user-level** at `~/.claude/skills/`, all `disable-model-invocation: true`. **Suggest by name only; never auto-invoke.**

## Specs map (one-line per file)

- `claude-lens-plan.md` — phases, tasks, decisions log (**when**)
- `claude-lens-architecture.md` — how: ingest pipeline, WS invalidation bus, metrics engine, tier system
- `claude-lens-pages.md` — what: per-page section tables, **binding over** `pages/*.html`
- `gates.md` — Report Card gate IDs and thresholds
- `pages/*.html` — visual mockups
- `issues/` — local drafts (`status: draft|ready|filed`) + filed records
- `context/` — per-task context written by `/start-task`
- `requirements/` — REQ docs from `/plan-requirements`
