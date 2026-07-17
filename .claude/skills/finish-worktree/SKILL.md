---
name: finish-worktree
description: "After an issue's PR has squash-merged on GitHub and its issue has closed: fast-forward main, remove the issue-numbered sibling worktree, and delete the local feature branch. Use when the user says to finish, tear down, or clean up a lane or worktree for a merged issue."
---

# Finish-Worktree

Teardown counterpart to `/move-to-worktree`. Run it **in the primary checkout,
on `main`**, after you squash-and-merge the issue's PR on github.com. The script
uses GitHub's PR and issue state as the authoritative merge guard; remote branch
deletion is an additional safety check, not proof of merge by itself.

## Run (1 bash call)

```bash
bash {base_directory}/finish-worktree.sh <issue-number>
```

The script:

1. Hard-stops unless run in the clean primary checkout on `main`.
2. Finds exactly one local branch `{type}/<issue#>/{slug}` and its matching
   worktree.
3. Uses `gh` to verify a PR for that exact head branch is **merged**, its recorded
   head commit matches the local branch tip, and issue `<issue#>` is **closed**.
   It also requires the remote feature branch to be gone.
4. `git pull --ff-only` on `main` (brings the squashed work in) +
   `git fetch --prune` (clears the stale tracking ref).
5. `git worktree remove ../claude-lens-<issue#>` — **never `--force`**: if the
   worktree has uncommitted work it prints the leftovers and stops.
6. `git branch -D <branch>` — capital `-D` is deliberate: squash-merge means git
   can't prove the branch merged, so `-d` always refuses; step 3 already
   verified the work landed.

Non-zero exit → hard-stop, print stderr verbatim.

## Report

What was removed (worktree path, branch), then the standing post-merge hygiene
reminders: flip the task's checkbox in `specs/claude-lens-plan.md`, run
`/archive-issue <issue#>` promptly, and commit that hygiene so the primary is
clean for the next `/start-task`. After any merge, in-flight lanes should sync
with `origin/main` only when they need the merged work; for an already
pushed/shared lane, merge `origin/main` rather than rewriting its history.

## You Must NOT

- Use `git worktree remove --force` or otherwise discard uncommitted work — surface it and stop.
- Delete the branch when any merge guard fails.
- Flip plan checkboxes or archive the issue yourself unless asked — remind, don't perform.
