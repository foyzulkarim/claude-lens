# Issue artifact archive (wiki structure)

Companion to the delivery pipeline in root `CLAUDE.md`. This doc is the fifth process spec: it
governs where a finished issue's working artifacts go *after* the issue closes, so `specs/` stays
scoped to the four authoritative V2 docs, `gates.md`, the page mockups, and whatever issues/context/
requirements/architecture docs are still open. It does not change anything about how issues are
drafted or filed — see `.claude/skills/create-issue/` for that.

## Why

Each issue accumulates working documents as it moves through the pipeline: an issue record
(`specs/issues/<ID>-<slug>.md`), a context capture (`specs/context/<N>.md`), sometimes a requirements
doc (`specs/requirements/REQ-<slug>.md`) and an architecture doc (`specs/architecture/ARCH-<slug>.md`),
and one or more code reviews (`specs/CODE-REVIEW-*.md`). Once the issue closes, GitHub is already the
source of truth for its scope and acceptance criteria — but the requirements/architecture/review
documents contain design reasoning (rejected alternatives, edge-case decisions, task breakdowns)
that's worth keeping findable without leaving it cluttering `specs/` indefinitely. The GitHub wiki is
the destination; this doc defines the file layout so the local mirror and the wiki repo are the same
tree.

At volume (dozens of plan-task issues plus ad-hoc bugs/chores/spikes across phases 0–4), two more
problems show up beyond simple retirement: the files belonging to one issue are scattered across
`specs/` under three incompatible naming keys, and a flat chronological index stops being navigable.
The **Correlation model** and **Phase grouping** sections below address those.

## Correlation model

A single issue's artifacts live in different directories, each named by a *different* key — this is
the source of most archiving mistakes if done ad hoc. **The issue record is the anchor**: it is the
one file that carries every correlation key at once (plan-task ID + slug in its filename; issue
number + URL in its frontmatter), so every other artifact is resolved *from* it by direct lookup
rather than by correlating the scattered files pairwise.

For issue `N`, primary plan-task `<ID>`, slug `<slug>`:

| Source file | Directory | Named by | How it's resolved from the anchor | Sub-page destination |
|-------------|-----------|----------|-------------------------------------|-----------------------|
| **Issue record** (the anchor) | `specs/issues/` | plan-task ID + slug (filename); issue number + URL (frontmatter `issue:`/`url:`) | Found by scanning frontmatter for `issue: N`, or by filename prefix `<ID>-` | None — folded into the hub overview |
| Context | `specs/context/` | issue number | `specs/context/<N>.md` directly | None — deleted, not mirrored |
| Requirements | `specs/requirements/` | slug | `specs/requirements/REQ-<slug>.md` | `issue-NNN/requirements.md` |
| Architecture | `specs/architecture/` | slug | `specs/architecture/ARCH-<slug>.md` | `issue-NNN/architecture.md` |
| Code review(s) | `specs/` | PR number | `specs/CODE-REVIEW-*.md` whose `Target` row branch is `feat/<N>/…` — **matched by branch, never by PR number** | `issue-NNN/review.md` (one) or `issue-NNN/review-pr-<PR>.md` (each, if more than one) |
| Spike findings | `specs/` (as authored) | slug/issue, author-supplied | Located alongside the issue's other working docs | `issue-NNN/findings.md`, if it exists |
| ADR / decisions | `specs/` (as authored) | slug/issue, author-supplied | Located alongside the issue's other working docs | `issue-NNN/decisions.md`, if it exists |
| Images / captures | — | referenced by other docs | Found via links in the docs above | `issue-NNN/assets/`, if any exist |

Phase for grouping is derived from `<ID>`'s prefix (`P<phase>-<n>` → Phase `<phase>`); an issue with
no plan-task ID has no phase (see **Unphased**, below).

**Why branch-matching, not PR-number matching:** PR numbers and issue numbers are independent
sequences — PR #60 can be issue #14's review. Assuming they align silently misattributes reviews to
the wrong issue. The `Target` metadata row (e.g. `feat/14/dev-build-toolchain` → `main`) is the only
reliable link back to the issue number.

**Why the issue record is the anchor, not a generated manifest:** it already exists as the one file
holding every key; deriving from it collapses what would otherwise be a three-way join (plan-task ID
↔ issue number ↔ PR number) into direct lookups, with no fourth file to keep in sync.

**Dependency on `create-issue`:** this resolution only works while `.claude/skills/create-issue/`
keeps emitting issue records with `issue: N` frontmatter and `<ID>-<slug>` (or `<type>-<slug>` for
ad-hoc issues) filenames. If that contract ever changes, this correlation model needs a matching
update.

## The model

GitHub wiki pages are flat files — a git repo where `/` in a filename fakes a folder in the URL and
sidebar, but there's no real nesting. Structure it **issue-centric**, one hub page per issue with its
documents hanging off it, and group the *index* (not the files themselves) by phase:

```
Home.md                     ← index: archived issues grouped by phase, each phase ✓/◐
_Sidebar.md                 ← persistent nav, same phase grouping

## Phase 1 — Bootstrapping ✓ done
issue-013.md                 ← the 1:1 issue hub: short overview + links to its own docs
issue-013/requirements.md
issue-013/architecture.md
issue-013/review.md

issue-060.md
issue-060/...

## Phase 2 — Ingest ◐ in progress
issue-0NN.md
issue-0NN/...

## Unphased
issue-0MM.md                 ← bug/chore/spike/enhancement with no plan-task ID
```

Locally this is mirrored 1:1 under `docs/` (`docs/issue-013.md`, `docs/issue-013/requirements.md`,
…) — that tree is what gets pushed as the wiki repo's content. This doc does not prescribe how the
push happens (clone the `.wiki.git` remote, sync, commit, push); treat that as a manual step done by
whoever runs the archive, not something automated blindly.

## Rules that matter

- **Zero-pad issue numbers to three digits** (`issue-013`, not `issue-13`) so they sort correctly —
  the wiki won't sort for you, and GitHub issue numbers will pass 999 long before this project is
  done.
- **The `issue-NNN` page is the hub.** Short overview (what shipped, plan-task ID, phase, closed date,
  link to the GitHub issue itself) plus links to its own sub-docs. It is the *only* page linked from
  `Home.md`/`_Sidebar.md` — sub-docs hang off the hub, not off the sidebar or the index.
- **The hub's metadata line is mandatory and preserves the correlation keys.** Once `specs/` is
  emptied on archive, the hub is the only remaining record of how the issue ties back to its
  plan-task and PR(s). Every hub carries: `**Plan task:** #P<X>-<Y> · **Phase:** <X> · **PR(s):** #NN
  [, #MM…] · **Closed:** YYYY-MM-DD · [GitHub issue #N](url)`. If the issue had a **branch-mode**
  review (no PR — e.g. a direct-branch review rather than a PR review), write `**PR(s):** —
  (branch review)` rather than omitting the field. If the issue has no plan-task ID, write
  `**Plan task:** — (unphased)`.
- **A page is "published" only when linked from its issue hub.** A file that exists in the wiki repo
  but isn't linked from anywhere is invisible except via exact-title search — don't leave orphans.
- **The issue body itself is not mirrored as a sub-page.** Once an issue is filed, GitHub is the
  source of truth for its scope/acceptance criteria (per the delivery-pipeline rule in `CLAUDE.md`);
  duplicating `specs/issues/<slug>.md` into the archive would fork that source of truth. The hub's
  overview + a link to the GitHub issue is enough.
- **The context capture is not mirrored either.** `specs/context/<N>.md` (written by `/start-task`)
  overlaps almost entirely with the issue body and the hub's overview — it's scratch input to the
  pipeline, not a document worth publishing. Delete it on archive rather than giving it a sub-page.
- **The sub-page vocabulary is open, not fixed to three.** `requirements`, `architecture`, `review`
  (or `review-pr-<PR>` when there's more than one) cover the common plan-task case; `findings`
  (spikes), `decisions` (ADRs), and `assets/` (images) cover the rest. Only add a sub-page for a
  document that actually exists for that issue — most issues (bugs, chores, small enhancements) never
  get a REQ/ARCH doc and so only ever have a hub page, no sub-pages. A genuinely novel artifact type
  not in this list is the archiver's call — add it to this vocabulary when it recurs.
- **Multiple reviews get multiple sub-pages.** One `CODE-REVIEW-*.md` for the issue → `review.md`.
  Two or more (multiple PRs against the same issue) → `review-pr-<PR>.md` per PR, each resolved by its
  own `Target` branch and all linked from the hub. Never concatenate multiple reviews into one page.
- **Every issue lands in exactly one phase group, or Unphased.** Phase is derived from the issue's
  **primary** plan-task ID prefix (the one in its title) — never from the filename, which stays
  stable if the issue's phase assignment is later revisited. An issue with no plan-task ID (bug,
  chore, spike, REQ-driven enhancement) goes in a trailing **`## Unphased`** group instead of being
  forced into a phase it doesn't belong to.
- **An issue absorbing another task is grouped by its primary task only.** If an issue's title carries
  one plan-task ID but it also absorbed work from another (noted in its hub overview, e.g. "#13
  absorbs #P0-5"), it is grouped and listed under the **primary** task's phase — never listed twice.
- **Within a phase group, issues sort ascending by issue number.** A simple, stable rule; it won't
  always match plan-task sequence (issues get filed out of order), but it's unambiguous.
- **`Home.md` shows a ✓/◐ status marker per phase**, mirrored from that phase's exit-criteria state in
  `specs/claude-lens-plan.md`. The wiki *reflects* phase status; `plan.md` remains the source of
  truth — update the marker by hand when a phase's status changes there, and accept that the two can
  drift briefly rather than building sync tooling for a docs tree.
- **Archive only after the issue closes.** This is a retirement step, not a drafting one — an issue
  still open keeps its artifacts in `specs/` where the active pipeline expects to find them.
- **Archiving is a snapshot, not a lock.** If a closed-and-archived issue reopens, the active pipeline
  recreates its working docs fresh in `specs/`; don't round-trip files back out of `docs/`. The
  `docs/issue-NNN/` archive is overwritten (not merged) the next time that issue closes and is
  re-archived.

## What stays in `specs/`

The four authoritative V2 docs (`claude-lens-architecture.md`, `claude-lens-pages.md`,
`claude-lens-data-model.md`, `claude-lens-field-definitions.md`), `claude-lens-plan.md`, `gates.md`,
`pages/*.html` mockups, and `issues/` / `context/` / `requirements/` / `architecture/` entries for
issues that are still open or in flight. Once an issue closes and gets archived, its entries in
those four subdirectories are removed — that's the "empty the specs directory" half of this
convention; `specs/` should only ever hold what the *current* pipeline needs, not project history.
None of these living documents are ever mirrored into `docs/` — the wiki holds retired issue
artifacts and a thin navigation layer over them, never a copy of the current specs.

## Worked example

Issue #13 (`#P1-1 — Scaffold three-root TS package`, closed 2026-07-10) is archived under
`docs/issue-013.md` / `docs/issue-013/{requirements,architecture,review}.md` as the reference
instance of this structure — see those files for the concrete shape. Its source files
(`specs/context/13.md`, `specs/requirements/REQ-scaffold-three-root-ts-package.md`,
`specs/architecture/ARCH-scaffold-three-root-ts-package.md`,
`specs/CODE-REVIEW-BRANCH-feat-13-scaffold-three-root-ts-package.md`, and
`specs/issues/P1-1-scaffold-three-root-ts-package.md`) were retired in the same pass. Its review was
**branch-mode** (no PR), predating the mandatory `PR(s):` key line introduced above — its hub content
is left as-is; only its index entry is re-slotted under the `## Phase 1` heading (see #P0-8's
Change Footprint — backfilling its hub to the new format is a separate follow-up, not part of this
convention's introduction).
