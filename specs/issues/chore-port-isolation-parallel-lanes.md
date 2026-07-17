---
title: "chore: parallel worktree execution infrastructure"
labels: phase-4
milestone: Phase 4 — Pages & features
status: filed
issue: 85
url: https://github.com/foyzulkarim/claude-lens/issues/85
---

## What & why

Make the Phase 4 scheduling contract executable: add deterministic open/finish worktree skills,
align the issue dependency records with the hard start-condition graph, and isolate every lane's
dev/e2e ports behind one `CLAUDE_LENS_PORT_BASE` value.

Verified hazard motivating this: `server/cli.ts` silently bumps to the next free port when its
`--port` is busy, while `client/vite.config.ts` hardcodes the proxy target to `4128` and Vite's own
port auto-bumps too. Two lanes running `npm run dev` therefore don't fail — lane B's UI silently
proxies into lane A's backend and shows the wrong lane's data. Convention can't prevent this;
collisions cross-wire instead of crashing.

Scope:

- Add project-local `/move-to-worktree` and `/finish-worktree` skills for the exact
  `/start-task` → worktree → squash-merge → cleanup lifecycle. Both fail closed on dirty or
  ambiguous state; finish verifies a merged PR and closed issue before destructive branch cleanup.
- Replace the old serial `Depends on`/`Unblocks` links in Phase 4 issue records and GitHub issue
  bodies with the hard start conditions in the parallelization companion.
- Integrate #P4-19 into the serial spine before #P4-2 and make the terminal #P4-18 dependency
  explicit.
- `CLAUDE_LENS_PORT_BASE` (default `4128`): backend = base, Vite dev = base + 1, e2e = base + 2
  (fold into the existing `CLAUDE_LENS_E2E_PORT` handling in `scripts/e2e.ts`, which keeps working
  as an explicit override).
- `client/vite.config.ts` reads the base for the `/api` + `/ws` proxy targets and sets
  `server.port = base + 1` with `strictPort: true`, so a port collision fails loudly instead of
  bumping into another lane.
- The `dev` npm script stops hardcoding `--port 4128`: a small `scripts/dev.ts` wrapper (same
  pattern as `scripts/build.ts` / `scripts/e2e.ts`) reads the env and spawns server + Vite with
  matching ports. `/move-to-worktree` writes each lane's base to `.env.local`
  (`4128 + 10 × issue#`); the wrapper reads it.
- `server/cli.ts`'s auto-bump behavior is deliberately **unchanged** — it's friendly for `npx`
  end-users, and unique per-lane bases make it moot in dev.

## Acceptance

- With `CLAUDE_LENS_PORT_BASE` unset, `npm run dev` behaves as a single-checkout setup: backend on
  4128, Vite on 4129, proxy wired between them.
- Two checkouts with different bases run `npm run dev` concurrently and each UI reaches **its own**
  backend (verify via `/api/health` or distinct fixture roots) — no cross-wiring.
- A deliberate port collision (second lane reusing the first lane's base) fails loudly at startup
  (Vite `strictPort`), rather than silently proxying across lanes.
- `npm run test:e2e` honors base + 2 when `CLAUDE_LENS_PORT_BASE` is set and `CLAUDE_LENS_E2E_PORT`
  is not.
- `npm run verify` passes.
- `/move-to-worktree` creates an issue worktree from the clean, pushed task branch, leaves the
  primary checkout clean on current `main`, installs with `npm ci`, and reports non-overlapping
  ports.
- `/finish-worktree` refuses cleanup unless GitHub reports a merged PR and closed issue, refuses
  dirty worktrees, fast-forwards `main`, then removes the worktree and squash-merged local branch.
- Local filed records and GitHub bodies for #33–#50 express the same hard dependency graph, and
  P4-19 is filed and scheduled between #33 and #34.

## Dependencies

- Depends on: none functionally; must merge **before `/start-task #33`** so the worktree lifecycle
  is available from the first Phase 4 issue and before parallel lanes open after #34/#P4-2.
- Unblocks: concurrent `npm run dev`/Cypress across Phase 4 worktree lanes.

## References

- `specs/claude-lens-phase4-parallelization.md` — "Port isolation" + "Lane lifecycle" sections
- `.claude/skills/move-to-worktree/` — writes the per-lane `.env.local` this chore consumes
