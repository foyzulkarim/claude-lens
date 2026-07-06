# AGENTS.md — claude-lens

> **Transitional repo**: V1 (runnable) at root, V2 (specs only) under `specs/`. See `CLAUDE.md` for the full map. V1 moves to `legacy/` in #P0-2 — not yet done.

## Hard rules

1. **Don't extend V1** beyond keep-it-running fixes. No refactors for "future V2".
2. **Don't scaffold V2 pieces** outside their plan tasks. The TS roots `shared/` / `server/` / `client/` appear in #P1-1 — not before.
3. **No tests, lint, build, or CI exist yet.** `npm test` / `npm run lint` / `npm run build` will fail. V2 tooling lands in Phase 1 (#P1-3, #P1-5).
4. **Specs win on conflict.** `claude-lens-pages.md` per-page section tables are **binding over** `pages/*.html` mockups. On code/doc/spec conflict, trust the spec.

## Commands (V1 — the runnable app)

```bash
cp .env.example .env                       # set CLAUDE_DIR + rates
npm install                                # local dev only
node server.js                             # http://localhost:3456
npm run dev                                # nodemon reload
npx github:foyzulkarim/claude-lens         # zero-install run
```

- `server.js` **exits 1** if `CLAUDE_DIR` is missing — fix env first.
- Pricing is env-only: `RATE_INPUT` / `RATE_OUTPUT` / `RATE_CACHE_READ` / `RATE_CACHE_CREATE` (USD per 1M tokens). Defaults = Bedrock ap-southeast-2.
- No build step. `index.html` is served as-is by Express.
- Data source: `~/.claude/projects/**/*.jsonl` (re-parsed per request in V1).

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
   /start-task <#issue> → /plan-architecture → /generate-tasks → /implement → /review → /commit
```

- **`specs/claude-lens-plan.md` owns sequencing.** Phases 0–3 strict, Phase 4 ordered. Checkboxes flip when issues **close**, not when filed.
- **Every issue cites a settled requirements source** (a spec, or a REQ doc). Issues never invent requirements.
- **For plan tasks, specs are the requirements** — no requirements interview. `/plan-requirements` happens *before* filing, only for fuzzy ad-hoc enhancements.
- **Phase 0 must finish before Phase 1** — labels (`phase-0`…`phase-5`) and milestones must exist before `/create-issue` runs (see #P0-6).

## Skills — split by location, never auto-invoke the user-level ones

- **`/create-issue`** — **project-local** at `.claude/skills/create-issue/`. Use for any "file an issue / log a bug / track this / scaffold a phase" request.
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
