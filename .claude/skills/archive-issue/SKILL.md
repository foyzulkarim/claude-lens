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
you haven't already; the **Correlation model** section there is what Steps 1–2 below execute).

## Step 1 — Resolve the anchor, confirm closed

Take the issue number (or plan-task ID, e.g. `#P1-1`) from the user. The **issue record**
(`specs/issues/<ID>-<slug>.md`) is the anchor for everything that follows — find it by scanning
`specs/issues/*.md` frontmatter for `issue: N` (if given a number) or by its filename prefix (if
given a plan-task ID). From that one file, read off: primary plan-task `<ID>`, slug `<slug>`, issue
number `N`, GitHub URL, and phase (derived from `<ID>`'s prefix `P<phase>-<n>`; no ID → Unphased).

Confirm the issue's GitHub state is `closed`. If it's still open, **stop and say so** — this is a
retirement step, not a drafting one; open-issue artifacts stay in `specs/` where the active pipeline
expects them. Make no changes to `specs/` or `docs/`.

If the issue's title notes it absorbed another plan-task (e.g. "#13 absorbs #P0-5"), the absorbed ID
is noted in the hub overview later — it does not change which phase this issue is grouped under (the
**primary** task's phase always wins).

## Step 2 — Derive the source artifacts from the anchor

Using `<ID>`, `<slug>`, and `N` from Step 1, resolve each source directly (no searching required —
this is the point of the anchor):

| Source | Resolved as | Sub-page? |
|---|---|---|
| `specs/issues/<ID>-<slug>.md` | *is the anchor* | No — fold its Summary into the hub; link the GitHub issue instead of duplicating the body |
| `specs/context/<N>.md` | direct path | No — overlaps the issue body; delete, don't mirror |
| `specs/requirements/REQ-<slug>.md` | direct path, if it exists | Yes → `issue-NNN/requirements.md` |
| `specs/architecture/ARCH-<slug>.md` | direct path, if it exists | Yes → `issue-NNN/architecture.md` |
| `specs/CODE-REVIEW-*.md` | **every** file whose `Target` metadata row's branch is `feat/<N>/…` — matched by branch, **never** by assuming the PR number equals the issue number | Yes, one per matching file — see naming rule below |

Most issues (bugs, chores, small enhancements) never had a REQ/ARCH/review doc — only add the
sub-pages that actually exist. Don't invent placeholder pages for missing docs.

**Multiple reviews:** if more than one `CODE-REVIEW-*.md` file's `Target` branch matches `feat/<N>/…`
(multiple PRs against the same issue), every one gets its own sub-page: `issue-NNN/review-pr-<PR>.md`.
If exactly one matches, name it `issue-NNN/review.md`. If a review is **branch-mode** (no PR — its
`Target` names a branch/commit rather than a PR URL), it still resolves to `review.md`/
`review-pr-<...>.md` as appropriate; note the branch-mode nature doesn't block sub-page creation, only
affects the hub's `PR(s):` line (Step 3).

If a `CODE-REVIEW-*.md` file's branch doesn't obviously match the issue slug, check its `Target`
metadata row before attributing it — don't archive a review that belongs to a different issue. If it
genuinely can't be matched, leave it out and flag it to the user rather than guessing.

## Step 3 — Write the hub page

`docs/issue-NNN.md` (zero-padded to 3 digits). The metadata line is **mandatory** and must preserve
every correlation key, since `specs/` is about to be emptied of them:

```
**Plan task:** #P<X>-<Y> · **Phase:** <X> · **PR(s):** #NN[, #MM…] · **Closed:** YYYY-MM-DD · [GitHub issue #N](url)
```

- No plan-task ID → `**Plan task:** — (unphased)`, and this issue's index entry goes under
  `## Unphased` in Step 5, not a phase heading.
- No PR (branch-mode review, or no review at all) → `**PR(s):** — (branch review)` or
  `**PR(s):** —` respectively; never omit the field.
- Absorbed another task → note it in the overview paragraph below the metadata line (e.g. "absorbs
  #P0-5"), not as a second metadata field or a second index entry.

Below the metadata line: a paragraph of what shipped (pull from the issue body's Summary — don't
re-derive it), a bullet list linking each sub-page that exists, and a one-line Outcome pulled from the
acceptance criteria / review verdict. Follow the shape of `docs/issue-013.md` (the worked example
referenced in `specs/wiki-structure.md`) for the overview/Outcome prose style.

## Step 4 — Write the sub-pages

Carry the REQ/ARCH/review content over largely as-is — these are already well-formed docs; don't
rewrite them, just relocate them and drop anything that's now stale (e.g. a REQ doc's "next step:
run /plan-architecture" footer no longer applies once archived). Use the open vocabulary from
`wiki-structure.md`'s Rules — `requirements`, `architecture`, `review`/`review-pr-<PR>`, and (when a
source exists) `findings`, `decisions`, `assets/` — never a placeholder for a document that doesn't
exist.

## Step 5 — Update the index

Both files use the same phase-grouped structure (`specs/wiki-structure.md`'s "The model" section):

- **Determine the group:** the phase from Step 1 (`## Phase <X> — <name>`), or `## Unphased` if the
  issue has no plan-task ID.
- **Find or create the heading.** If this is the first issue archived into that phase in either
  index file, create the `## Phase <X> — <name>` (or `## Unphased`) heading — append new phase
  headings in phase order, with `## Unphased` last. On `Home.md`, a newly created phase heading gets
  a ✓/◐ status marker read from that phase's current exit-criteria state in
  `specs/claude-lens-plan.md`.
- **Insert in issue-number order** within the group — find the correct ascending position among that
  group's existing entries, not just appended at the end.
- **Refresh the phase's ✓/◐ marker** on `Home.md` if `plan.md`'s exit criteria for that phase have
  changed since the marker was last set.
- Create `docs/Home.md` / `docs/_Sidebar.md` (with a one-line header, phase-grouped) if this is the
  first archived issue overall.

## Step 6 — Retire the sources

Remove the archived files from `specs/` (`git rm`) — `specs/issues/<ID>-<slug>.md`,
`specs/context/<N>.md`, and whichever of `requirements/`/`architecture/`/the CODE-REVIEW file(s) were
mirrored. This is the "empty the specs directory" half of the convention: once an issue is archived,
nothing about it should remain in `specs/`.

## Step 7 — Report

Summarize what moved where (source path → destination) so the user can review the diff before it's
pushed. Pushing `docs/` to the actual GitHub wiki repo (a separate git remote,
`<repo>.wiki.git`) is **not** part of this skill — that's a manual step outside the main repo's
history.
