# Issue artifact archive (wiki structure)

Companion to the delivery pipeline in root `CLAUDE.md`. This doc is the fifth process spec: it
governs where a finished issue's working artifacts go *after* the issue closes, so `specs/` stays
scoped to the four authoritative V2 docs, `gates.md`, the page mockups, and whatever issues/context/
requirements/architecture docs are still open. It does not change anything about how issues are
drafted or filed — see `.claude/skills/create-issue/` for that.

**The archive lives only in the GitHub wiki, never in this repo.** Retired artifacts move straight
from `specs/` into the `<repo>.wiki.git` repo; nothing under `docs/` (or any other path) is committed
to `main`. This keeps the main repo's working tree lean — archiving isn't worth anything if it just
relocates the bulk from `specs/` to another directory in the same clone.

## Why

Each issue accumulates working documents as it moves through the pipeline: an issue record
(`specs/issues/<ID>-<slug>.md`), a context capture (`specs/context/<N>.md`), sometimes a requirements
doc (`specs/requirements/REQ-<slug>.md`) and an architecture doc (`specs/architecture/ARCH-<slug>.md`),
and one or more code reviews — `/review`'s current convention saves these as `specs/reviews/REV-PR-<N>.md`
/ `REV-BRANCH-<name>.md` / `REV-STAGED-*.md` / `REV-DIFF-*.md` (per `~/.claude/skills/review/SKILL.md`);
older reviews may still be found as `CODE-REVIEW-*.md` at the **repo root** or `specs/review/`, a prior
convention. Once the issue closes, GitHub is already the source of truth for its scope and
acceptance criteria — but the requirements/architecture/review documents contain design reasoning
(rejected alternatives, edge-case decisions, task breakdowns) that's worth keeping findable without
leaving it cluttering the repo indefinitely. The GitHub wiki is
the sole destination; this doc defines the file layout that the wiki repo holds directly — there is no
second copy anywhere in the main repo.

At volume (dozens of plan-task issues plus ad-hoc bugs/chores/spikes across phases 0–4), two more
problems show up beyond simple retirement: the files belonging to one issue are scattered across
`specs/` under three incompatible naming keys, and a flat chronological index stops being navigable.
The **Correlation model** section below addresses the first; the phase-grouping rules under **The
model** and **Rules that matter** address the second.

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
| Requirements | `specs/requirements/` | slug | `specs/requirements/REQ-<slug>.md` | `issue-NNN/REQ-<slug>.md` — **original filename kept, only the directory changes** |
| Architecture | `specs/architecture/` | slug | `specs/architecture/ARCH-<slug>.md` | `issue-NNN/ARCH-<slug>.md` — original filename kept |
| Code review(s) | `specs/reviews/` (current `/review` convention); repo root or `specs/review/` for older reviews predating that convention | PR number / branch name | `REV-PR-<N>.md` / `REV-BRANCH-<name>.md` / `REV-STAGED-*.md` / `REV-DIFF-*.md` (or legacy `CODE-REVIEW-*.md`) whose `Target` row branch is `feat/<N>/…` — **matched by branch, never by PR number** | `issue-NNN/<original filename>` — original filename kept (its own name already disambiguates multiple reviews: `REV-PR-60.md`, `REV-PR-72.md`, `CODE-REVIEW-BRANCH-feat-13-…md`) |
| Spike findings | `specs/` (as authored) | slug/issue, author-supplied | Located alongside the issue's other working docs | `issue-NNN/<original filename>`, if it exists |
| ADR / decisions | `specs/` (as authored) | slug/issue, author-supplied | Located alongside the issue's other working docs | `issue-NNN/<original filename>`, if it exists |
| Images / captures | — | referenced by other docs | Found via links in the docs above | `issue-NNN/assets/<original filename>`, if any exist |

**Filenames are never renamed on archive** — only relocated (from a `specs/` subdirectory into
`issue-NNN/`). `REQ-<slug>.md` stays `REQ-<slug>.md`, `CODE-REVIEW-PR-60.md` stays
`CODE-REVIEW-PR-60.md`. This was tried the other way first (normalizing to generic
`requirements.md`/`architecture.md`/`review.md` names) and reverted (2026-07-11, fixing #65's own
archive) — the original filenames are how the author already recognizes these documents; renaming
them on archive breaks that recognition for no real navigational gain (the `issue-NNN/` directory
already scopes them to the issue; the filename doesn't need to repeat that).

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
issue-013/REQ-scaffold-three-root-ts-package.md
issue-013/ARCH-scaffold-three-root-ts-package.md
issue-013/CODE-REVIEW-BRANCH-feat-13-scaffold-three-root-ts-package.md

issue-060.md
issue-060/...

## Phase 2 — Ingest ◐ in progress
issue-0NN.md
issue-0NN/...

## Unphased
issue-0MM.md                 ← bug/chore/spike/enhancement with no plan-task ID
```

The archive step works directly in a **local working clone of the wiki repo**, conventionally checked
out at `.wiki/` in the main repo root (`git clone <repo>.wiki.git .wiki`) and gitignored — it is
scratch state for running the archive, not part of this repo's history. Pages are written, committed,
and pushed from inside `.wiki/`; nothing under that path is ever added to the main repo's git index.
Pushing the commit to the live wiki remote is a deliberate, confirmed step (not something to run
blindly at the end of every small edit) — batch several issues into one wiki commit when archiving
a group, same as any other push to shared state.

## Rules that matter

- **Run `/archive-issue` promptly once an issue closes — treat PR-merge as the trigger, not a periodic sweep.** Review reports land at `specs/reviews/` (or, for older reviews, the repo root — see Correlation model above), so a closed issue's review report sits there, untouched, until someone archives it. This has already caused drift multiple times in this repo: #8/#18's `specs/` files, a stray `CODE-REVIEW-PR-63.md` for #17, and #26's `specs/reviews/REV-PR-76.md` (missed by `/archive-issue` because the skill's search only knew the older `CODE-REVIEW-*.md`/repo-root convention, not `/review`'s current `specs/reviews/REV-*.md` output — fixed 2026-07-14) all sat past their issue's closure until caught separately. Don't wait for `specs/` to "look cluttered" — archive as each issue closes.
- **Zero-pad issue numbers to three digits** (`issue-013`, not `issue-13`) so they sort correctly —
  the wiki won't sort for you, and GitHub issue numbers will pass 999 long before this project is
  done.
- **The `issue-NNN` page is the hub.** Short overview (what shipped, plan-task ID, phase, closed date,
  link to the GitHub issue itself) plus links to its own sub-docs. It is the *only* page linked from
  `Home.md`/`_Sidebar.md` — sub-docs hang off the hub, not off the sidebar or the index.
- **Sub-page links use bare basename — no `issue-NNN/` prefix, no `.md` extension.** Even though the
  file is physically nested at `issue-NNN/<file>.md`, link to it from the hub as `[Label](<file>)`
  (e.g. `[Review](CODE-REVIEW-PR-63)`), never `[Label](issue-NNN/<file>.md)`. GitHub's wiki (Gollum)
  renders a link written with the `.md` extension as a raw-file link
  (`raw.githubusercontent.com/wiki/...`) instead of resolving it to the wiki page — confirmed working
  vs. broken by direct comparison: bare-basename links (piloted on #17 in `.wiki` commit `0518efd`,
  rolled out to #13–#19 in `e95f981`, both 2026-07-13) resolve correctly, while the full-path
  `.md`-suffixed form used for #20–#26 (archived 2026-07-13 through 2026-07-14) does not. The fix was
  only ever applied by hand in the wiki repo and never written down here, which is why later archive
  passes regressed to the broken form — this bullet is that write-down. The directory nesting stays,
  for organizing the wiki's git tree; only the link text drops it.
- **The hub's metadata line is mandatory and preserves the correlation keys.** Once `specs/` is
  emptied on archive, the hub is the only remaining record of how the issue ties back to its
  plan-task and PR(s). Every hub carries: `**Plan task:** #P<X>-<Y> · **Phase:** <X> · **PR(s):** #NN
  [, #MM…] · **Closed:** YYYY-MM-DD · [GitHub issue #N](url)`. If the issue had a **branch-mode**
  review (no PR — e.g. a direct-branch review rather than a PR review), write `**PR(s):** —
  (branch review)` rather than omitting the field. If the issue had no review at all, write
  `**PR(s):** —` (no parenthetical — that's reserved for the branch-mode case). If the issue has no
  plan-task ID, write `**Plan task:** — (unphased)`.
- **A page is "published" only when linked from its issue hub.** A file that exists in the wiki repo
  but isn't linked from anywhere is invisible except via exact-title search — don't leave orphans.
- **The issue body itself is not mirrored as a sub-page.** Once an issue is filed, GitHub is the
  source of truth for its scope/acceptance criteria (per the delivery-pipeline rule in `CLAUDE.md`);
  duplicating `specs/issues/<slug>.md` into the archive would fork that source of truth. The hub's
  overview + a link to the GitHub issue is enough.
- **The context capture is not mirrored either.** `specs/context/<N>.md` (written by `/start-task`)
  overlaps almost entirely with the issue body and the hub's overview — it's scratch input to the
  pipeline, not a document worth publishing. Delete it on archive rather than giving it a sub-page.
- **The sub-page vocabulary is open, not fixed to three.** REQ/ARCH/CODE-REVIEW docs cover the common
  plan-task case; spike findings and ADR/decisions docs (whatever their original filename is) cover
  the rest. Only add a sub-page for a document that actually exists for that issue — most issues
  (bugs, chores, small enhancements) never get a REQ/ARCH doc and so only ever have a hub page, no
  sub-pages. A genuinely novel artifact type is the archiver's call — carry its original filename over
  unchanged, same as everything else.
- **Multiple reviews get multiple sub-pages, one per file, under their own original names.** Each
  `CODE-REVIEW-*.md` whose `Target` branch matches the issue moves to `issue-NNN/` unchanged
  (`CODE-REVIEW-PR-60.md`, `CODE-REVIEW-PR-72.md`, …), all linked from the hub. Never concatenate
  multiple reviews into one page — their original filenames already keep them distinct, so there's no
  separate one-vs-many naming rule to apply.
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
  recreates its working docs fresh in `specs/`; don't round-trip files back out of the wiki. The
  `issue-NNN` wiki page (and its sub-pages) is overwritten (not merged) the next time that issue
  closes and is re-archived.

## What stays active

`docs/claude-lens-architecture.md` is the one reader-facing design document — it's what `README.md`
points newcomers at, so it lives in `docs/` rather than among the pipeline specs. That placement is
about audience, not permanence: it is **not** a rule that living documents move out of `specs/`.

Everything else the active pipeline reads stays in `specs/`: the remaining authoritative V2 specs
(`claude-lens-pages.md`, `claude-lens-data-model.md`, `claude-lens-field-definitions.md`,
`claude-lens-plan.md`, `claude-lens-phase4-parallelization.md`, `gates.md`), the `pages/*.html`
mockups, and `issues/` / `context/` / `requirements/` / `architecture/` entries for issues that are
still open or in flight. Once an issue closes and gets archived, its entries in those four
subdirectories are removed — that's the "empty the specs directory" half of this convention;
`specs/` should only ever hold what the *current* pipeline needs, not project history.
None of these living documents are ever mirrored into the wiki — it holds retired issue artifacts and
a thin navigation layer over them, never a copy of the current specs.

## Worked example

Issue #13 (`#P1-1 — Scaffold three-root TS package`, closed 2026-07-10) is archived as `issue-013.md`
plus `issue-013/REQ-scaffold-three-root-ts-package.md`,
`issue-013/ARCH-scaffold-three-root-ts-package.md`, and
`issue-013/CODE-REVIEW-BRANCH-feat-13-scaffold-three-root-ts-package.md` on the wiki — see those
pages for the concrete shape (view them via the live wiki, or in a local `.wiki/` clone). Its source
files (`specs/context/13.md` plus the three above, from `specs/requirements/`, `specs/architecture/`,
and `specs/` respectively, and `specs/issues/P1-1-scaffold-three-root-ts-package.md`) were retired in
the same pass — filenames unchanged end to end, only their directory moved. Its review was
**branch-mode** (no PR), predating the mandatory `PR(s):` key line introduced later — its hub content
is left as-is; only its index entry was re-slotted under the `## Phase 1` heading when #P0-8 hardened
the convention (backfilling its hub to the new format is a separate follow-up, tracked as issue #66).

Nine further issues (#7, #9, #11, #12, #14–17, #65) were archived the same way in the 2026-07-11
batch that also moved the archive off `docs/` and onto the wiki-only convention this doc now
describes — see the wiki's `Home.md` for the full current index. That same batch briefly generalized
sub-page filenames to `requirements.md`/`architecture.md`/`review.md`; this was reverted the same day
(see the Rules above) once it was clear that broke recognizability against the `specs/` filenames
these documents are known by throughout their working life.
