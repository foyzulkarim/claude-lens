# Issue artifact archive (wiki structure)

Companion to the delivery pipeline in root `CLAUDE.md`. This doc is the fifth process spec: it
governs where a finished issue's working artifacts go *after* the issue closes, so `specs/` stays
scoped to the four authoritative V2 docs, `gates.md`, the page mockups, and whatever issues/context/
requirements/architecture docs are still open. It does not change anything about how issues are
drafted or filed — see `.claude/skills/create-issue/` for that.

## Why

Each issue accumulates working documents as it moves through the pipeline: a context capture
(`specs/context/<N>.md`), sometimes a requirements doc (`specs/requirements/REQ-<slug>.md`) and an
architecture doc (`specs/architecture/ARCH-<slug>.md`), and a code review
(`specs/CODE-REVIEW-*.md`). Once the issue closes, GitHub is already the source of truth for its
scope and acceptance criteria — but the requirements/architecture/review documents contain design
reasoning (rejected alternatives, edge-case decisions, task breakdowns) that's worth keeping
findable without leaving it cluttering `specs/` indefinitely. The GitHub wiki is the destination;
this doc defines the file layout so the local mirror and the wiki repo are the same tree.

## The model

GitHub wiki pages are flat files — a git repo where `/` in a filename fakes a folder in the URL and
sidebar, but there's no real nesting. Structure it **issue-centric**, one hub page per issue with
its documents hanging off it:

```
Home.md                     ← index: every archived issue, linked
_Sidebar.md                 ← persistent nav

issue-013.md                 ← the 1:1 issue hub: short overview + links to its own docs
issue-013/requirements.md
issue-013/architecture.md
issue-013/review.md

issue-014.md
issue-014/...
```

Locally this is mirrored 1:1 under `docs/` (`docs/issue-013.md`, `docs/issue-013/requirements.md`,
…) — that tree is what gets pushed as the wiki repo's content. This doc does not prescribe how the
push happens (clone the `.wiki.git` remote, sync, commit, push); treat that as a manual step done by
whoever runs the archive, not something automated blindly.

## Rules that matter

- **Zero-pad issue numbers to three digits** (`issue-013`, not `issue-13`) so they sort correctly —
  the wiki won't sort for you, and GitHub issue numbers will pass 999 long before this project is
  done.
- **The `issue-NNN` page is the hub.** Short overview (what shipped, plan-task ID, closed date, link
  to the GitHub issue itself) plus links to its own sub-docs. It is the *only* page linked from
  `Home.md` — sub-docs hang off the hub, not off the sidebar or the index.
- **A page is "published" only when linked from its issue hub.** A file that exists in the wiki repo
  but isn't linked from anywhere is invisible except via exact-title search — don't leave orphans.
- **The issue body itself is not mirrored as a sub-page.** Once an issue is filed, GitHub is the
  source of truth for its scope/acceptance criteria (per the delivery-pipeline rule in `CLAUDE.md`);
  duplicating `specs/issues/<slug>.md` into the archive would fork that source of truth. The hub's
  overview + a link to the GitHub issue is enough.
- **The context capture is not mirrored either.** `specs/context/<N>.md` (written by `/start-task`)
  overlaps almost entirely with the issue body and the hub's overview — it's scratch input to the
  pipeline, not a document worth publishing. Delete it on archive rather than giving it a sub-page.
- **What *does* get a sub-page:** `specs/requirements/REQ-<slug>.md` → `issue-NNN/requirements.md`;
  `specs/architecture/ARCH-<slug>.md` → `issue-NNN/architecture.md`; any
  `specs/CODE-REVIEW-*.md` file for that issue's branch/PR → `issue-NNN/review.md`. Only add a
  sub-page for documents that actually exist for that issue — most issues (bugs, chores, small
  enhancements) never get a REQ/ARCH doc and so only ever have a hub page, no sub-pages.
- **Archive only after the issue closes.** This is a retirement step, not a drafting one — an issue
  still open keeps its artifacts in `specs/` where the active pipeline expects to find them.

## What stays in `specs/`

The four authoritative V2 docs (`claude-lens-architecture.md`, `claude-lens-pages.md`,
`claude-lens-data-model.md`, `claude-lens-field-definitions.md`), `claude-lens-plan.md`, `gates.md`,
`pages/*.html` mockups, and `issues/` / `context/` / `requirements/` / `architecture/` entries for
issues that are still open or in flight. Once an issue closes and gets archived, its entries in
those four subdirectories are removed — that's the "empty the specs directory" half of this
convention; `specs/` should only ever hold what the *current* pipeline needs, not project history.

## Worked example

Issue #13 (`#P1-1 — Scaffold three-root TS package`, closed 2026-07-10) is archived under
`docs/issue-013.md` / `docs/issue-013/{requirements,architecture,review}.md` as the reference
instance of this structure — see those files for the concrete shape. Its source files
(`specs/context/13.md`, `specs/requirements/REQ-scaffold-three-root-ts-package.md`,
`specs/architecture/ARCH-scaffold-three-root-ts-package.md`,
`specs/CODE-REVIEW-BRANCH-feat-13-scaffold-three-root-ts-package.md`, and
`specs/issues/P1-1-scaffold-three-root-ts-package.md`) were retired in the same pass.
