#!/usr/bin/env bash
# finish-worktree — after the issue's PR has squash-merged on GitHub: sync main,
# remove the issue's worktree, and delete the local branch.
#
# Usage: finish-worktree.sh <issue-number>
set -euo pipefail

ISSUE_NUM="${1:?Usage: finish-worktree.sh <issue-number>}"

if [[ ! "$ISSUE_NUM" =~ ^[0-9]+$ ]]; then
  echo "Error: issue number must contain digits only." >&2
  exit 1
fi

# ── Must run in the clean primary checkout, on the default branch ────────────
if [[ "$(git rev-parse --git-dir)" != "$(git rev-parse --git-common-dir)" ]]; then
  echo "Error: run this from the primary checkout, not from a worktree." >&2
  exit 1
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

DEFAULT_BRANCH="$(git remote show origin 2>/dev/null | grep 'HEAD branch' | sed 's/.*: //' || true)"
DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"

CURRENT="$(git branch --show-current)"
if [[ "$CURRENT" != "$DEFAULT_BRANCH" ]]; then
  echo "Error: primary checkout must be on ${DEFAULT_BRANCH} (currently on ${CURRENT})." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: primary checkout must be clean before teardown." >&2
  git status --short >&2
  exit 1
fi

# ── Find exactly one issue branch and its expected worktree ──────────────────
BRANCHES="$(git for-each-ref --format='%(refname:short)' refs/heads | grep -E "^[a-z][a-z0-9-]*/${ISSUE_NUM}/" || true)"
BRANCH_COUNT="$(printf '%s\n' "$BRANCHES" | sed '/^$/d' | wc -l | tr -d ' ')"
if [[ "$BRANCH_COUNT" == "0" ]]; then
  echo "Error: no local branch found for issue #${ISSUE_NUM} ({type}/${ISSUE_NUM}/{slug})." >&2
  exit 1
fi
if [[ "$BRANCH_COUNT" != "1" ]]; then
  echo "Error: multiple local branches found for issue #${ISSUE_NUM}:" >&2
  printf '%s\n' "$BRANCHES" >&2
  exit 1
fi
BRANCH="$BRANCHES"

WORKTREE_DIR="$(dirname "$ROOT")/$(basename "$ROOT")-${ISSUE_NUM}"
if [[ -d "$WORKTREE_DIR" && -n "$(git -C "$WORKTREE_DIR" status --porcelain)" ]]; then
  echo "Error: worktree at ${WORKTREE_DIR} has uncommitted work:" >&2
  git -C "$WORKTREE_DIR" status --short >&2
  exit 1
fi

# ── Guard: the exact PR must be merged and the issue closed ──────────────────
if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh is required to verify the merged PR and closed issue." >&2
  exit 1
fi

MERGED_HEAD="$(gh pr list --head "$BRANCH" --state merged --limit 1 --json headRefOid --jq '.[0].headRefOid // empty')"
if [[ -z "$MERGED_HEAD" ]]; then
  echo "Error: GitHub has no merged PR whose head branch is '${BRANCH}'." >&2
  exit 1
fi

LOCAL_HEAD="$(git rev-parse "$BRANCH")"
if [[ "$LOCAL_HEAD" != "$MERGED_HEAD" ]]; then
  echo "Error: local '${BRANCH}' is not the exact head commit recorded on the merged PR." >&2
  echo "Local:  ${LOCAL_HEAD}" >&2
  echo "Merged: ${MERGED_HEAD}" >&2
  echo "Preserving the worktree and branch so no post-merge commits are lost." >&2
  exit 1
fi

ISSUE_STATE="$(gh issue view "$ISSUE_NUM" --json state --jq '.state')"
if [[ "$ISSUE_STATE" != "CLOSED" ]]; then
  echo "Error: issue #${ISSUE_NUM} is ${ISSUE_STATE:-unknown}, not CLOSED." >&2
  exit 1
fi

# A missing remote branch is not proof of merge, but a live one means automatic
# branch cleanup has not happened and local teardown should wait.
if ! REMOTE_HEAD="$(git ls-remote --heads origin "$BRANCH")"; then
  echo "Error: could not query origin to verify remote branch deletion." >&2
  exit 1
fi
if [[ -n "$REMOTE_HEAD" ]]; then
  echo "Error: origin still has '${BRANCH}' — wait for remote branch deletion." >&2
  exit 1
fi

# ── Sync main and prune the stale tracking ref ───────────────────────────────
echo "Syncing ${DEFAULT_BRANCH}..."
git fetch --prune --quiet origin
git pull --ff-only --quiet origin "$DEFAULT_BRANCH"

# ── Remove the worktree (never --force: surface leftovers instead) ───────────
if [[ -d "$WORKTREE_DIR" ]]; then
  if ! git worktree remove "$WORKTREE_DIR" 2>/dev/null; then
    echo "Error: could not safely remove worktree at ${WORKTREE_DIR}:" >&2
    git -C "$WORKTREE_DIR" status --short >&2
    echo "Resolve the reported state and re-run; do not force removal." >&2
    exit 1
  fi
  echo "Removed worktree: $WORKTREE_DIR"
else
  echo "No worktree at ${WORKTREE_DIR} — skipping removal."
fi

# ── Delete the local branch ──────────────────────────────────────────────────
# Squash-merge means git can't prove the branch merged, so -d always refuses;
# -D here is deliberate because the GitHub guards above verified it landed.
git branch -D "$BRANCH" >/dev/null
echo "Deleted local branch: $BRANCH"

echo ""
echo "Done. Next: flip the task checkbox in specs/claude-lens-plan.md, then /archive-issue ${ISSUE_NUM}."
