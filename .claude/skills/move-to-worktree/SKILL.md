---
name: move-to-worktree
description: "After /start-task: park the current clean, pushed feature branch in its own issue-numbered nested worktree (.worktrees/<issue#>) and return the primary checkout to current main, so the next parallel lane can start. Writes the lane's port base and runs npm ci in the worktree. Use when the user says to move the branch or task to a worktree or open a parallel lane."
---

# Move-to-Worktree

Companion to `/start-task` for parallel Phase 4 lanes (see
`specs/claude-lens-phase4-parallelization.md`). `/start-task` leaves the primary
checkout *on* the new feature branch; this skill moves that branch into its own
worktree and puts the primary back on `main` — one worktree + one branch + one
Claude session per in-flight issue.

## Run (1 bash call)

```bash
bash {base_directory}/move-to-worktree.sh
```

No arguments — it operates on the branch currently checked out. The script:

1. Hard-stops unless run in the **primary checkout**, on a **task branch**
   (`{type}/{issue#}/{slug}`), with a **clean tree** and its matching `origin/` **upstream** set —
   i.e. exactly the state `/start-task` leaves behind.
2. Pushes any local-only commits, checks out and fast-forwards `main` (this must
   happen *before* the worktree is created — git refuses to check out a branch
   in two places).
3. `git worktree add .worktrees/<issue#> <branch>` — nested inside the repo root
   (gitignored), never a `../` sibling. The context file `specs/context/<issue#>.md`
   travels with the branch (it's committed).
4. Writes the lane's port block to `<worktree>/.env.local` (gitignored):
   `CLAUDE_LENS_PORT_BASE = 4128 + 10 × issue#` — backend = base, Vite = base+1,
   E2E = base+2, Storybook = base+3. Issue-derived, so lanes cannot collide.
5. Runs `npm ci` in the worktree (per-worktree `node_modules`; also wires
   the Husky pre-push hook so `npm run verify` gates pushes from this lane).

Non-zero exit → hard-stop, print stderr verbatim.

## Report

The script's summary block (worktree path, branch, ports), plus: *"Open a new
Claude session in the worktree and continue the pipeline there
(`/plan-architecture` / `/implement` → `/review` → `/commit` → PR with
`Closes #N`)."*

When the PR has squash-merged, `/finish-worktree <issue#>` (run back in the
primary) does the teardown.

## You Must NOT

- Run the underlying git commands yourself — the script owns all mutation.
- Stash, discard, or commit anything to satisfy the clean-tree check — hard-stop instead.
- Move a branch whose upstream is ahead or does not match `origin/<branch>`.
- Create the worktree while the primary is still on the feature branch.
