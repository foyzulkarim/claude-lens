---
name: archive-issue
model: inherit
description: Retire a closed issue's working artifacts out of specs/ into the docs/issue-NNN/ wiki-mirror structure — use when the user asks to archive a finished issue, empty out specs/ for a done task, or move an issue's requirements/architecture/review docs to the wiki.
---

# Archive Issue

Once an issue closes, GitHub is the source of truth for its scope — but its requirements,
architecture, and code-review docs under `specs/` still hold reasoning worth keeping. This skill
retires them out of `specs/` into `docs/`, mirroring the GitHub wiki's flat-file structure
(`specs/wiki-structure.md` is the authoritative layout spec — read it before doing anything else if
you haven't already).

## Step 1 — Confirm the issue is actually closed

Take the issue number (or plan-task ID, e.g. `#P1-1`) from the user. Look it up (`specs/issues/*.md`
frontmatter has `issue: N`) and confirm its GitHub state is `closed`. If it's still open, stop and
say so — this is a retirement step, not a drafting one; open-issue artifacts stay in `specs/` where
the active pipeline expects them.

## Step 2 — Gather the source artifacts

For issue N with plan-task slug `<slug>` (from its `specs/issues/` filename):

| Source | Sub-page? |
|---|---|
| `specs/issues/<ID>-<slug>.md` | No — fold its Summary into the hub; link the GitHub issue instead of duplicating the body |
| `specs/context/<N>.md` | No — overlaps the issue body; delete, don't mirror |
| `specs/requirements/REQ-<slug>.md` | Yes → `issue-NNN/requirements.md`, if it exists |
| `specs/architecture/ARCH-<slug>.md` | Yes → `issue-NNN/architecture.md`, if it exists |
| `specs/CODE-REVIEW-*.md` for this issue's branch/PR | Yes → `issue-NNN/review.md`, if one exists |

Most issues (bugs, chores, small enhancements) never had a REQ/ARCH/review doc — only add the
sub-pages that actually exist. Don't invent placeholder pages for missing docs.

If a `CODE-REVIEW-PR-*.md` file's branch doesn't obviously match the issue slug, check its `Target`
metadata row (PR URL/branch name) before attributing it — don't archive a review that belongs to a
different issue.

## Step 3 — Write the hub page

`docs/issue-NNN.md` (zero-padded to 3 digits), short: plan-task ID, phase, closed date, GitHub issue
link, a paragraph of what shipped (pull from the issue body's Summary — don't re-derive it), a
bullet list linking each sub-page that exists, and a one-line Outcome pulled from the acceptance
criteria / review verdict. Follow the shape of `docs/issue-013.md` (the worked example referenced in
`specs/wiki-structure.md`).

## Step 4 — Write the sub-pages

Carry the REQ/ARCH/review content over largely as-is — these are already well-formed docs; don't
rewrite them, just relocate them and drop anything that's now stale (e.g. a REQ doc's "next step:
run /plan-architecture" footer no longer applies once archived).

## Step 5 — Update the index

- `docs/Home.md` — add one line linking the new `issue-NNN` hub. Create the file (with a one-line
  header) if this is the first archived issue.
- `docs/_Sidebar.md` — add the hub under an "Issues" list. Create it the same way if it doesn't
  exist yet.

## Step 6 — Retire the sources

Remove the archived files from `specs/` (`git rm`) — `specs/issues/<ID>-<slug>.md`,
`specs/context/<N>.md`, and whichever of `requirements/`/`architecture/`/the CODE-REVIEW file were
mirrored. This is the "empty the specs directory" half of the convention: once an issue is archived,
nothing about it should remain in `specs/`.

## Step 7 — Report

Summarize what moved where (source path → destination) so the user can review the diff before it's
pushed. Pushing `docs/` to the actual GitHub wiki repo (a separate git remote,
`<repo>.wiki.git`) is **not** part of this skill — that's a manual step outside the main repo's
history.
