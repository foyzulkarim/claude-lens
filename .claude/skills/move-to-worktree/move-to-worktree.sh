#!/usr/bin/env bash
# move-to-worktree — after /start-task: park the current feature branch in its
# own worktree and return the primary checkout to the default branch, freeing
# it to start the next parallel lane.
#
# Usage: move-to-worktree.sh   (no args — operates on the current branch)
set -euo pipefail

# ── Must run in the primary checkout, not a linked worktree ──────────────────
if [[ "$(git rev-parse --git-dir)" != "$(git rev-parse --git-common-dir)" ]]; then
  echo "Error: run this from the primary checkout, not from a worktree." >&2
  exit 1
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# ── Preconditions: task branch, clean tree, upstream set ─────────────────────
BRANCH="$(git branch --show-current)"
if [[ ! "$BRANCH" =~ ^[a-z][a-z0-9-]*/([0-9]+)/ ]]; then
  echo "Error: current branch '$BRANCH' is not a task branch ({type}/{issue}/{slug})." >&2
  echo "Run /start-task first." >&2
  exit 1
fi
ISSUE_NUM="${BASH_REMATCH[1]}"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit or stash before moving to a worktree." >&2
  exit 1
fi

if ! UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"; then
  echo "Error: '$BRANCH' has no upstream. Push it first: git push -u origin $BRANCH" >&2
  exit 1
fi
if [[ "$UPSTREAM" != "origin/$BRANCH" ]]; then
  echo "Error: '$BRANCH' must track 'origin/$BRANCH' (currently '$UPSTREAM')." >&2
  exit 1
fi

read -r BEHIND AHEAD < <(git rev-list --left-right --count '@{u}...HEAD')
if (( BEHIND > 0 )); then
  echo "Error: '$BRANCH' is behind '$UPSTREAM'. Synchronize it before moving." >&2
  exit 1
fi
if (( AHEAD > 0 )); then
  echo "Pushing ${AHEAD} local commit(s) before moving the branch..."
  git push origin "$BRANCH"
fi

DEFAULT_BRANCH="$(git remote show origin 2>/dev/null | grep 'HEAD branch' | sed 's/.*: //' || true)"
DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"

WORKTREE_DIR="$(dirname "$ROOT")/$(basename "$ROOT")-${ISSUE_NUM}"
if [[ -e "$WORKTREE_DIR" ]]; then
  echo "Error: $WORKTREE_DIR already exists." >&2
  exit 1
fi

PORT_BASE=$((4128 + 10 * ISSUE_NUM))
if (( PORT_BASE > 65533 )); then
  echo "Error: issue #${ISSUE_NUM} produces an invalid port block starting at ${PORT_BASE}." >&2
  exit 1
fi

# ── Free the branch, then check it out in its own worktree ───────────────────
git checkout "$DEFAULT_BRANCH" --quiet
git pull --ff-only origin "$DEFAULT_BRANCH" --quiet
git worktree add "$WORKTREE_DIR" "$BRANCH"

# ── Per-lane port block (issue-derived — unique per issue, no bookkeeping) ───
# backend = base, vite dev = base+1, e2e = base+2. Gitignored via .env.local.
cat > "$WORKTREE_DIR/.env.local" <<EOF
# Lane ports for issue #${ISSUE_NUM} — written by /move-to-worktree (gitignored)
CLAUDE_LENS_PORT_BASE=${PORT_BASE}
EOF

# ── Install dependencies (node_modules is per-worktree; wires Husky pre-push) ─
echo "Installing dependencies in the worktree (this takes a moment)..."
if ! (cd "$WORKTREE_DIR" && npm ci --no-audit --no-fund >/dev/null); then
  echo "Error: npm ci failed in ${WORKTREE_DIR}; the worktree remains available for inspection." >&2
  exit 1
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "Worktree: $WORKTREE_DIR"
echo "Branch:   $BRANCH (issue #${ISSUE_NUM})"
echo "Ports:    backend ${PORT_BASE} · vite $((PORT_BASE + 1)) · e2e $((PORT_BASE + 2))"
echo "Primary checkout is back on ${DEFAULT_BRANCH}."
echo ""
echo "Next: open a new Claude session in ${WORKTREE_DIR} and continue the pipeline there."
