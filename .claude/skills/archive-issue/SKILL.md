---
name: archive-issue
model: inherit
description: Retire a closed issue's working artifacts out of specs/ into the GitHub wiki — use when the user asks to archive a finished issue, empty out specs/ for a done task, or move an issue's requirements/architecture/review docs to the wiki.
---

# Archive Issue

Once an issue closes, GitHub is the source of truth for its scope — but its requirements,
architecture, and code-review docs under `specs/` still hold reasoning worth keeping. This skill
retires them out of `specs/` straight into the GitHub wiki (`specs/wiki-structure.md` is the
authoritative layout spec — read it before doing anything else if you haven't already; the
**Correlation model** section there is what Steps 1–2 below execute). **Nothing archived is ever
committed to the main repo** — the wiki is the only place this content lives.

## Step 0 — Ensure the local wiki clone is current

Work happens in a local working clone of the wiki repo, conventionally at `.wiki/` in the main repo
root (gitignored — never part of this repo's history):

- If `.wiki/` doesn't exist: `git clone <repo>.wiki.git .wiki`.
- If it exists: `git -C .wiki pull --ff-only` before making any changes, so you're not archiving on
  top of a stale copy.

All of Steps 3–5 write into this clone, not into the main repo.

## Step 1 — Resolve the anchor, confirm closed

Take the issue number (or plan-task ID, e.g. `#P1-1`) from the user — pass it explicitly
(`/archive-issue 70`, or "archive issue 70") whenever you know it; this pins Step 2's resolution to
that one issue's artifacts instead of leaving them to be found by scanning, which is where
cross-issue mix-ups come from. The **issue record** (`specs/issues/<ID>-<slug>.md`) is the normal
anchor for everything that follows — find it by scanning `specs/issues/*.md` frontmatter for
`issue: N` (if given a number) or by its filename prefix (if given a plan-task ID). From that one
file, read off: primary plan-task `<ID>`, slug `<slug>`, issue number `N`, GitHub URL, and phase
(derived from `<ID>`'s prefix `P<phase>-<n>`; no ID → Unphased).

**If the issue record is already gone but other artifacts for that `N` still linger** (a partial or
interrupted prior archive can leave `specs/context/<N>.md`, a `specs/requirements/`/
`specs/architecture/` file, or a `CODE-REVIEW-*.md` behind without the issue record) — don't treat
the missing record as "nothing to archive." Derive `<ID>`/`<slug>` from whatever's left instead:
`specs/context/<N>.md`'s frontmatter `description:` carries `#P<phase>-<n> — <title>`; a surviving
`REQ-<slug>.md`/`ARCH-<slug>.md` filename carries `<slug>` directly; `gh issue view N` gives the
title, URL, and closed state regardless. Confirm closed via `gh issue view N` in this case since
there's no issue record to have already recorded it.

Confirm the issue's GitHub state is `closed`. If it's still open, **stop and say so** — this is a
retirement step, not a drafting one; open-issue artifacts stay in `specs/` where the active pipeline
expects them. Make no changes to `specs/` or `.wiki/`.

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
| `specs/requirements/REQ-<slug>.md` | direct path, if it exists | Yes → `issue-NNN/REQ-<slug>.md` — **same filename**, only the directory changes |
| `specs/architecture/ARCH-<slug>.md` | direct path, if it exists | Yes → `issue-NNN/ARCH-<slug>.md` — same filename |
| `CODE-REVIEW-*.md` (location varies — `/review` has landed these at both the repo root and `specs/review/`; search both, e.g. `find . -maxdepth 2 -iname 'CODE-REVIEW-*.md'`, don't assume one fixed spot) | **every** file whose `Target` metadata row's branch is `feat/<N>/…` — matched by branch, **never** by assuming the PR number equals the issue number, and never by directory | Yes, one per matching file, each keeping its original filename (`CODE-REVIEW-PR-60.md` stays `CODE-REVIEW-PR-60.md`) |

Most issues (bugs, chores, small enhancements) never had a REQ/ARCH/review doc — only add the
sub-pages that actually exist. Don't invent placeholder pages for missing docs.

**Never rename a file on archive.** Only its directory changes (`specs/requirements/` →
`issue-NNN/`, etc.) — the filename itself is untouched. This is deliberate (see
`wiki-structure.md`'s Rules): generic names like `requirements.md`/`review.md` were tried once and
reverted the same day because they break recognition against the `specs/` names these documents are
already known by.

**Multiple reviews:** if more than one `CODE-REVIEW-*.md` file's `Target` branch matches `feat/<N>/…`
(multiple PRs against the same issue), every one gets its own sub-page under its own original name —
`CODE-REVIEW-PR-60.md` and `CODE-REVIEW-PR-72.md` both land in `issue-NNN/` unchanged, no renaming
needed since their own filenames already disambiguate them. A **branch-mode** review (no PR — its
`Target` names a branch/commit rather than a PR URL) archives the same way under its own name (e.g.
`CODE-REVIEW-BRANCH-feat-13-…md`); the branch-mode nature doesn't block sub-page creation, only
affects the hub's `PR(s):` line (Step 3).

If a `CODE-REVIEW-*.md` file's branch doesn't obviously match the issue slug, check its `Target`
metadata row before attributing it — don't archive a review that belongs to a different issue. If it
genuinely can't be matched, leave it out and flag it to the user rather than guessing.

## Step 3 — Write the hub page

`.wiki/issue-NNN.md` (zero-padded to 3 digits). The metadata line is **mandatory** and must preserve
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
acceptance criteria / review verdict. Follow the shape of the wiki's existing `issue-013.md` (the
worked example referenced in `specs/wiki-structure.md`) for the overview/Outcome prose style.

## Step 4 — Write the sub-pages

Carry the REQ/ARCH/review content over largely as-is — these are already well-formed docs; don't
rewrite them, just relocate them into `.wiki/issue-NNN/` **under their original filenames** and drop
anything that's now stale (e.g. a REQ doc's "next step: run /plan-architecture" footer no longer
applies once archived). The sub-page vocabulary is open — REQ/ARCH/CODE-REVIEW cover the common case,
spike findings and ADR/decisions docs (whatever they're actually named) cover the rest — but every
one keeps its `specs/` filename verbatim. Never invent a placeholder for a document that doesn't
exist, and never rename one that does.

## Step 5 — Update the index

Both `.wiki/Home.md` and `.wiki/_Sidebar.md` use the same phase-grouped structure
(`specs/wiki-structure.md`'s "The model" section):

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
  changed since the marker was last set — this can catch drift beyond just the issue being archived
  right now (e.g. stale checkboxes elsewhere in `plan.md`); fix `plan.md` too if you find it.
- Create `.wiki/Home.md` / `.wiki/_Sidebar.md` (with a one-line header, phase-grouped) if this is the
  first archived issue overall.

## Step 6 — Retire the sources from the main repo

Remove the archived files from the main repo (`git rm`, in the **main repo**, not `.wiki/`) —
`specs/issues/<ID>-<slug>.md`, `specs/context/<N>.md`, whichever of `specs/requirements/`/
`specs/architecture/` were mirrored, and every matching `CODE-REVIEW-*.md` **wherever Step 2 found
it** (repo root, `specs/review/`, or elsewhere) — remove from its actual location, not an assumed one.
This is the "leave nothing behind" half of the convention: once an issue is archived, nothing about it
should remain anywhere in the main repo — not just `specs/`. Commit this to the main repo separately
from the wiki push in Step 7 — they're two different repos with two different histories.

## Step 7 — Commit and push the wiki, with confirmation

Inside `.wiki/`: `git add`, commit (batch multiple issues archived in one pass into one commit if
convenient), then push to `origin`. Pushing to the wiki repo is a push to shared external state —
**confirm with the user before pushing**, same as any other push, even though the commit itself is
harmless to make locally. Report what moved where (source path → wiki page) so the user can review
before/after the push.
