# Requirements: Wiki archive structure — issue-centric, phase-grouped, correlation-anchored

> **Date:** 2026-07-11
> **Type:** infrastructure (process/documentation convention)
> **Source:** verbal brief — "take a step back and see how we structure the wiki according to the files we have and will have for each coming gh issue"; existing partial implementation in `specs/wiki-structure.md`, `.claude/skills/archive-issue/SKILL.md`, and `docs/issue-013*`
> **Phase:** 1 of 5 (Requirement Engineering)

## Summary

Each GitHub issue accumulates working documents as it moves through the delivery pipeline — an
issue record, a context capture, sometimes requirements/architecture docs, and one or more code
reviews — scattered across `specs/` subdirectories under **three different naming keys** (plan-task
ID + slug, issue number, and PR number). This REQ defines how those artifacts are *retired* from
`specs/` into a GitHub-wiki-mirrored `docs/` tree once an issue closes: an issue-centric hub page per
issue, grouped by phase for navigation, with an explicit **correlation model** so the archive step
can deterministically resolve every one of an issue's files from a single anchor. It hardens the
existing partial convention rather than inventing a new one.

## Problem & Motivation

The trigger is scale. There are ~46 planned plan-task issues plus ad-hoc bugs/chores/spikes; the
first (#13) has been archived and the convention "works," but it was validated against a single
happy-path issue. Three problems surface at volume:

1. **Scattered, multi-keyed bookkeeping.** A single issue's files live in different directories
   under incompatible names: the issue record is named by plan-task ID + slug
   (`specs/issues/P1-2-dev-build-toolchain.md`), the context by issue number
   (`specs/context/14.md`), REQ/ARCH by slug, and the review by *PR* number
   (`specs/CODE-REVIEW-PR-60.md`, where PR 60 ≠ issue 14). Archiving requires correlating all of
   these correctly; the current skill gestures at this but doesn't specify a complete, deterministic
   resolution.
2. **Flat navigation doesn't scale.** `Home.md`/`_Sidebar.md` list issues as one flat chronological
   line. Past ~15 issues that becomes an unstructured wall with no way to answer "what shipped in
   Phase 1?"
3. **Lossy retirement.** Archiving empties `specs/` of the issue's files. If the hub page doesn't
   preserve the correlation keys (plan-task ID, slug, PR numbers), the links between issue ↔ PR ↔
   task are lost the moment the sources are deleted.

If we don't fix this, archiving stays a manual, error-prone hunt, the wiki becomes unnavigable, and
historical traceability degrades as `specs/` is cleaned.

Who benefits: anyone (the maintainer, a future contributor, an AI agent running `/archive-issue`)
who needs to retire a closed issue correctly or later read back *why* something was built.

## Users & Consumers

- **The person/agent running `/archive-issue`** — needs a deterministic recipe to find every file
  belonging to a closing issue and place it correctly, without guessing.
- **A wiki reader (maintainer or future contributor)** — needs to navigate history by phase, land on
  an issue hub, and reach its reasoning docs; and to trace an archived issue back to its PR(s) and
  plan task.
- **`specs/wiki-structure.md` and `.claude/skills/archive-issue/SKILL.md`** — the two documents this
  REQ's output updates; they encode the convention and the executable steps respectively.

## Functional Requirements

| ID  | Requirement | Acceptance Criterion |
|-----|-------------|----------------------|
| R1  | The wiki is an **archive plus a thin navigation layer** — retired closed-issue artifacts plus hand-maintained index pages. Living V2 specs are NOT mirrored. | `docs/` contains only issue hubs, their sub-pages, `Home.md`, `_Sidebar.md`; no copy of `claude-lens-architecture.md`/`pages.md`/`plan.md`/`gates.md` exists under `docs/`. |
| R2  | Each closed issue gets one **hub page** `docs/issue-NNN.md` (issue number zero-padded to 3 digits) with sub-pages hanging off it. | Archiving issue 14 produces `docs/issue-014.md`; any sub-pages live under `docs/issue-014/`. |
| R3  | Issues are **grouped by phase** in `Home.md` and `_Sidebar.md`. Phase membership is derived from the issue's primary plan-task ID prefix (`P1-…` → Phase 1) and stored as hub metadata, never encoded in the filename. | `Home.md` shows `## Phase 1 …` headings with issues nested; renaming/moving an issue's phase requires no file rename. |
| R4  | The archive step **resolves all of an issue's source files deterministically from the issue record** (`specs/issues/<ID>-<slug>.md`), which carries every correlation key: plan-task ID + slug (filename) and issue number + URL (frontmatter `issue:`/`url:`). | Given only an issue number, the skill locates the issue record by scanning `specs/issues/*.md` frontmatter for `issue: N`, then derives context (`context/<N>.md`), REQ/ARCH (`*/…-<slug>.md`), and review paths without manual input. |
| R5  | Code-review files are matched to an issue by the **branch in their `Target` metadata row** (`feat/<N>/<slug>`), never by assuming PR number == issue number. | `CODE-REVIEW-PR-60.md` (Target branch `feat/14/…`) is attributed to issue 14, not issue 60. |
| R6  | **Multiple reviews per issue** are supported: one review → `review.md`; two or more → `review-pr-<PR>.md` per PR, each linked from the hub. | An issue with `CODE-REVIEW-PR-60.md` and `CODE-REVIEW-PR-72.md` archives to `issue-NNN/review-pr-60.md` and `issue-NNN/review-pr-72.md`, both linked. |
| R7  | The sub-page vocabulary is an **open, named set**: `requirements`, `architecture`, `review`(/`review-pr-N`), `findings` (spikes), `decisions` (ADRs), and `assets/` (images). Only sub-pages whose source doc actually exists are created — no placeholders. | A spike issue archives with `findings.md` and no `requirements`/`architecture` pages; the hub links only what exists. |
| R8  | The **hub page preserves the correlation keys** after the sources are deleted: primary plan-task ID, phase, closed date, GitHub issue link, and PR number(s). | Reading `docs/issue-014.md` alone reveals plan-task `#P1-2`, Phase 1, the issue URL, and the PR(s) whose reviews are archived — with `specs/` already emptied of issue 14. |
| R9  | Issues with **no plan-task ID** (bugs, chores, spikes, REQ-driven enhancements) archive into a trailing **"Unphased"** group. Every issue lands in exactly one group. | A bug issue with no `#PX-Y` appears under `## Unphased` in `Home.md`/`_Sidebar.md` and nowhere else. |
| R10 | An issue carrying **multiple plan-task IDs** (absorbing another task) is grouped by its **primary** plan-task (the one in its title); absorbed IDs are noted in the hub overview, not double-listed in the index. | Issue #13 (`#P1-1`, absorbing `#P0-5`) appears once under Phase 1; the hub overview mentions the absorbed `#P0-5`. |
| R11 | Within a phase group, issues **sort ascending by issue number**. | Phase 1 lists `issue-013`, `issue-060`, `issue-061` … in that order. |
| R12 | `Home.md` shows a **per-phase status marker** (✓ done / ◐ in progress) that reflects `plan.md`. | Each `## Phase N` heading in `Home.md` carries a ✓ or ◐ marker consistent with that phase's exit-criteria state in `plan.md`. |
| R13 | Archiving **empties `specs/` of the issue's files** — issue record, context, and whichever of requirements/architecture/review were mirrored are `git rm`'d. | After archiving issue 14, `grep -r "14"`-style search of `specs/issues|context|requirements|architecture` and `CODE-REVIEW` finds no file belonging to issue 14. |
| R14 | A page is **"published" only when linked from its issue hub**; the hub is the only page linked from `Home.md`/`_Sidebar.md`. No orphan files. | Every file under `docs/issue-NNN/` is reachable by a link from `docs/issue-NNN.md`, which is itself linked from both index files. |
| R15 | **Archive only after the issue is closed.** If the issue is still open, the step stops and reports, leaving artifacts in `specs/`. | Attempting to archive an open issue produces a refusal and makes no changes to `specs/` or `docs/`. |

## Non-Functional Requirements

| ID  | Requirement | Acceptance Criterion |
|-----|-------------|----------------------|
| N1  | **Single source of truth** — no living document is duplicated into the wiki. | The GitHub issue body, the four authoritative V2 specs, and `plan.md` exist in exactly one place (GitHub / `specs/`); the wiki links to them, never copies them. |
| N2  | **Self-describing archive** — a hub page is intelligible with `specs/` fully emptied. | No hub page relies on a `specs/` file to be understood; all needed keys are inline (see R8). |
| N3  | **Deterministic, low-ambiguity resolution** — the file-to-issue mapping is a documented table, not a heuristic. | `specs/wiki-structure.md` contains a correlation table mapping each source (directory, naming key) to its resolution path and destination sub-page. |
| N4  | **Sortable numbering** — issue numbers zero-padded to 3 digits so the flat wiki sorts correctly past #999. | `issue-013`, not `issue-13`, everywhere (filenames, links, headings). |

## Behaviors & Domain Rules

### The correlation model (the core of this REQ)

For issue `N` with primary plan-task `<ID>` and slug `<slug>`:

| Source file | Directory | Named by | How it's resolved from the issue record |
|-------------|-----------|----------|------------------------------------------|
| Issue record | `specs/issues/` | plan-task ID + slug | **The anchor.** Found by scanning frontmatter for `issue: N`. Gives `<ID>`, `<slug>`, URL. |
| Context | `specs/context/` | issue number | `specs/context/<N>.md` directly. |
| Requirements | `specs/requirements/` | slug | `specs/requirements/REQ-<slug>.md`. |
| Architecture | `specs/architecture/` | slug | `specs/architecture/ARCH-<slug>.md`. |
| Code review(s) | `specs/` | PR number | `specs/CODE-REVIEW-*.md` whose `Target` branch is `feat/<N>/…` — matched by branch, not PR number. |

Phase for grouping is derived from `<ID>`'s prefix (`P<phase>-<n>` → Phase `<phase>`); an issue with
no `<ID>` is Unphased.

### Destination mapping

| Source | Sub-page? | Destination |
|--------|-----------|-------------|
| Issue record | No | Folded into the hub overview; GitHub issue linked, body not duplicated. |
| Context | No | Deleted — overlaps the issue body; scratch input, not a publishable doc. |
| REQ | Yes (if exists) | `issue-NNN/requirements.md` |
| ARCH | Yes (if exists) | `issue-NNN/architecture.md` |
| Review (1) | Yes (if exists) | `issue-NNN/review.md` |
| Review (2+) | Yes | `issue-NNN/review-pr-<PR>.md` each |
| Spike findings | Yes (if exists) | `issue-NNN/findings.md` |
| ADR/decisions | Yes (if exists) | `issue-NNN/decisions.md` |
| Images | Yes (if exists) | `issue-NNN/assets/` |

**Why these rules matter:**
- **The issue record as anchor** is what makes archiving deterministic. Because it is the only file
  holding all three keys at once, resolving *from* it (rather than trying to correlate the scattered
  files pairwise) collapses a three-way join into a set of direct lookups.
- **Branch-based review matching** exists because PR numbers and issue numbers diverge (PR 60 =
  issue 14). Number-matching would silently misattribute reviews.
- **Key preservation on the hub** matters because archiving is destructive to `specs/`; the hub is
  the last place the issue↔PR↔task links can live, so they must be captured before deletion.
- **Phase-as-metadata, not filename** keeps files stable when the plan re-sequences work.

**Common mistakes:**
- Matching a `CODE-REVIEW-PR-60.md` to "issue 60" because the numbers look like they should align.
- Assuming exactly one review per issue and hard-coding `review.md`.
- Encoding the phase into the hub filename (`phase1-issue-013.md`), which breaks when the issue moves
  phases.
- Deleting `specs/` sources before the hub has captured the plan-task ID and PR number(s).
- Creating placeholder sub-pages for docs that never existed (most bugs/chores have only a hub).
- Leaving a sub-page file in the tree without linking it from the hub (an invisible orphan).

## Edge Cases & Failure Modes

| Scenario | Decision | Rationale |
|----------|----------|-----------|
| Issue has no plan-task ID (bug/chore/spike/enhancement) | Group under **Unphased** | Non-plan issues still need a home; every issue lands in exactly one group. |
| Issue carries multiple plan-task IDs (absorbs another task) | Group by **primary** task (title); note absorbed IDs in hub overview | One issue = one index entry; avoids double-listing (#13 absorbs #P0-5). |
| Absorbed task spans a different phase than the primary | Group by the **primary** task's phase only | The primary task defines where the work "belongs"; the overview preserves the cross-reference. |
| Issue has 2+ PRs / 2+ CODE-REVIEW files | One review → `review.md`; many → `review-pr-<PR>.md` each, all linked | Preserves every review without collision. |
| A CODE-REVIEW file's branch doesn't clearly match the issue slug | Check its `Target` row before attributing; if it belongs elsewhere, don't archive it here | Prevents cross-issue misattribution. |
| Reopened after archiving | Archive is a **snapshot, not a lock**: pipeline recreates working docs in `specs/` fresh; the `docs/issue-NNN/` archive stays and is overwritten on the next close | Avoids two live copies of the same doc fighting; no round-trip back into `specs/`. |
| First issue archived into a phase that has no heading yet | The archive step **creates** the `## Phase N` heading in both index files | Index must self-extend as new phases start shipping. |
| Issue number ≥ 1000 | 3-digit zero-pad still sorts (`issue-1000` > `issue-013` lexically holds for equal-width; document that 4-digit is fine once we cross 999) | Numbering must not silently mis-sort at the boundary. |
| Requested archive of a still-open issue | Stop, report, change nothing | Retirement step, not a drafting one. |
| REQ/ARCH doc has a stale "next step: run /plan-architecture" footer | Drop the stale footer on relocation; carry the substantive content as-is | The footer is pipeline-scaffolding, not archive content. |
| A phase's status in `plan.md` changes after issues are archived | The ✓/◐ marker in `Home.md` is updated to match; `plan.md` remains source of truth | The wiki reflects, never owns, phase state (accept manual-sync drift risk). |

## Decisions Log

| #  | Decision | Alternatives Considered | Chosen Because |
|----|----------|-------------------------|----------------|
| 1  | Archive + thin navigation layer | (a) Archive-only; (b) full knowledge base mirroring live specs | Full mirror forks source-of-truth (the convention already forbids mirroring the issue body); archive-only is unnavigable at scale. |
| 2  | Group by phase; phase is hub metadata, not in the filename | Flat chronological; group by area/topic | Mirrors `plan.md`'s native phase spine; area grouping fights issues that span subsystems; flat becomes a wall past ~15 issues. Metadata keeps filenames stable across re-sequencing. |
| 3  | Open, named sub-page vocabulary | Fixed three (req/arch/review) | Spikes/bugs produce docs (findings, decisions) that don't fit the three; a fixed set loses them. |
| 4  | Issue record is the correlation anchor; resolution is a documented table | Ad-hoc per-file hunt (status quo in the skill) | Collapses a three-key, three-directory join into direct lookups; removes ambiguity and misattribution. |
| 5  | Match reviews by `Target` branch, not PR number | Number-match PR to issue | PR numbers and issue numbers diverge (PR 60 = issue 14); number-matching silently misattributes. |
| 6  | Hub preserves plan-task ID + PR number(s) | Rely on `specs/` for traceback | Archiving deletes `specs/`; the hub is the last place the links can live. |
| 7  | Unphased bucket for non-plan issues; primary task decides multi-task grouping | Multiple index entries; a "misc-by-type" scheme | One issue = one entry keeps the index unambiguous. |
| 8  | Sort by issue number within a phase; Home shows ✓/◐ phase status | Sort by plan-task ID or closed date; pure link index | User's call — issue-number sort is a simple stable rule; per-phase status adds at-a-glance value (accepting manual sync with `plan.md`). |
| 9  | Snapshot-not-lock for reopened issues | Round-trip files back into `specs/` | Round-trip risks two live copies diverging. |
| 10 | Index stays hand-maintained; skill spells out the exact insertion point | Auto-generate `Home.md`/`_Sidebar.md` | Generation is over-engineering at this volume; explicit skill steps are enough. |

## Scope Boundaries

### In Scope
- Rewriting `specs/wiki-structure.md` to encode: the correlation model + resolution table, phase
  grouping (with Unphased + primary-task rules), the open sub-page vocabulary, multi-review handling,
  hub key-preservation, sort order, and per-phase status markers.
- Updating `.claude/skills/archive-issue/SKILL.md` so its steps execute the above deterministically
  (resolve-from-anchor in Step 2; branch-matched multi-review in Step 2/4; phase-grouped index
  insertion with heading auto-creation in Step 5; key-preserving hub in Step 3).
- Defining the `Home.md` and `_Sidebar.md` phase-grouped shapes and the hub-page shape (as
  conventions/examples, not code).

### Out of Scope
- **Pushing `docs/` to the actual `<repo>.wiki.git` remote** (reason: manual step outside this repo's
  history, per the existing convention — unchanged here).
- **Retroactively re-archiving issue #13** into the new grouped shape (reason: separate follow-up;
  this REQ defines the convention, not the backfill). Flag as a candidate follow-up task.
- **Automating/generating the index files** (reason: decided against — Decision 10).
- **Mirroring living V2 specs or the issue body into the wiki** (reason: violates single-source-of-
  truth, Decision 1 / N1).
- **Changing how issues are drafted or filed** (reason: owned by `/create-issue`; untouched).

## Open Questions

- Should the "Unphased" group be further subdivided by work type (bugs vs chores vs spikes) once it
  grows?
  - **Impact if unresolved:** a large flat Unphased list could itself become a wall.
  - **Suggested default:** keep it flat for now; revisit if Unphased exceeds ~10 issues.
- When a phase completes, is there value in a per-phase summary page (rollup of what shipped) beyond
  the grouped index?
  - **Impact if unresolved:** none immediately; the grouped `Home.md` already answers "what's in
    Phase N."
  - **Suggested default:** skip; add only if a reader need emerges.
