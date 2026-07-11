# Architecture: Wiki archive structure — correlation-anchored, phase-grouped retirement

> **Date:** 2026-07-11
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** [Requirements](requirements)
> **Type:** infrastructure (process/documentation convention refactor)

## Architecture Summary

This is a convention refactor, not runtime code: the "system" is a pair of authoring documents plus
the shape of a mirrored `docs/` tree. The **spec** (`specs/wiki-structure.md`) defines *what* the
archive looks like — a correlation model, an issue-centric hub layout, and phase-grouped indexes; the
**skill** (`.claude/skills/archive-issue/SKILL.md`) defines *how* an issue is retired step-by-step.
The central new idea is an **anchor-first resolution algorithm**: the issue record
(`specs/issues/<ID>-<slug>.md`) is the one file carrying every correlation key (plan-task ID, slug,
issue number, URL), so every other artifact — context, REQ, ARCH, review(s) — is derived from it by
direct lookup rather than a three-way join across incompatible naming schemes. The index files
(`docs/Home.md`, `docs/_Sidebar.md`) move from a flat list to phase-grouped headings with ✓/◐ status
mirrored from `plan.md`. This preserves the existing spec/skill split and the single-source-of-truth
rule (living specs stay in `specs/`; only closed-issue artifacts are mirrored).

## High-Level Structure

```
INVOCATION            /archive-issue <N | #P?-?>
                              │
                              ▼
   ┌──────────────────────────────────────────────────────────┐
   │  SKILL (archive-issue/SKILL.md) — the executor            │
   │                                                           │
   │  1. resolve anchor  ── specs/issues/*.md (frontmatter     │
   │                         issue:N  OR filename prefix #P?-?)│
   │        │  yields: plan-task ID, slug, issue#, URL, phase  │
   │        ▼                                                  │
   │  2. derive sources (deterministic, from anchor):          │
   │        context/<N>.md                                     │
   │        requirements/REQ-<slug>.md                         │
   │        architecture/ARCH-<slug>.md                        │
   │        CODE-REVIEW-*.md  WHERE Target branch = feat/<N>/… │
   │        │                                                  │
   │        ▼                                                  │
   │  3. write hub      docs/issue-NNN.md   (keys preserved)   │
   │  4. write sub-pages docs/issue-NNN/<doc>.md (only if src) │
   │  5. index insert   Home.md + _Sidebar.md (phase-grouped)  │
   │  6. retire sources git rm from specs/                     │
   │  7. report                                                │
   └──────────────────────────────────────────────────────────┘
                              │
                              ▼  governed by
   ┌──────────────────────────────────────────────────────────┐
   │  SPEC (wiki-structure.md) — the layout authority          │
   │   · Correlation model + resolution table  (new)           │
   │   · Hub layout + mandatory key line        (expanded)     │
   │   · Open sub-page vocabulary               (new)          │
   │   · Phase grouping / Unphased / sort / status (new)       │
   │   · Multi-review naming                    (new)          │
   └──────────────────────────────────────────────────────────┘

MODIFIED, not replaced:  docs/Home.md, docs/_Sidebar.md (flat → phase-grouped)
REFERENCED:              CLAUDE.md L48/L53/L55, plan.md decisions log
```

**Added vs modified:** nothing is created from scratch; every file already exists. `wiki-structure.md`
and `SKILL.md` are substantially expanded; `Home.md`/`_Sidebar.md` are reshaped; `CLAUDE.md` and
`plan.md` get reference/decision-log edits.

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|------|----------|-------------------------|-----------|
| Resolution mechanism | Anchor-first: issue record → derive all | Ad-hoc per-file hunt (status quo); a generated manifest/index file | The issue record already holds all keys; deriving from it collapses a 3-key join into direct lookups (N3). A manifest would be a fourth thing to keep in sync. |
| Review→issue matching | Match by `Target` branch `feat/<N>/…` | Number-match PR# to issue# | PR# ≠ issue# (PR 60 = issue 14); number-matching silently misattributes (R5). |
| Index maintenance | Hand-edited, skill dictates exact insertion point | Auto-generate Home.md/_Sidebar.md from a scan | Generation is over-engineering at this volume (Decision 10); explicit deterministic skill steps suffice. |
| Phase status source | Mirror ✓/◐ from `plan.md` into Home.md | Compute from GitHub; omit status | `plan.md` is the sequencing source of truth; the wiki reflects, never owns, phase state (R12, accepted manual-sync drift). |
| Doc split | Keep spec (layout) vs skill (steps) separation | Fold everything into the skill | Mirrors the existing pattern; the spec is the durable contract, the skill the executor. |

## Patterns & Conventions

- **Single source of truth** (CLAUDE.md, N1) — living V2 specs and the GitHub issue body are never
  mirrored into `docs/`; the wiki links to them. The archive only ever holds retired reasoning docs.
- **Spec/skill mirror** — layout rules live in `wiki-structure.md`; imperative steps in
  `archive-issue/SKILL.md`. New rules land in the spec first, then the skill references them.
- **Zero-pad issue numbers to 3 digits** (`issue-013`) — existing convention, unchanged; sorts a flat
  wiki past #999 (N4).
- **Retire-on-close, snapshot-not-lock** — archiving only after close; a reopened issue gets fresh
  `specs/` docs and its archive is overwritten on the next close (no round-trip).

## Data Models

The "entities" here are file-naming conventions and their correlation keys — the design's core.

### Issue record (the anchor)

**Purpose:** the single file holding every correlation key for an issue.

**Key fields:**
| Field | Source in file | Notes |
|-------|----------------|-------|
| plan-task ID | filename prefix `P<phase>-<n>` | Yields the **phase** for grouping; absent → Unphased |
| slug | filename remainder | Resolves `REQ-<slug>.md`, `ARCH-<slug>.md` |
| issue number | frontmatter `issue: N` | Resolves `context/<N>.md`, review branch `feat/<N>/…` |
| URL | frontmatter `url:` | Linked from the hub |

**Lifecycle:** created by `/create-issue` (draft→ready→filed) → lives in `specs/issues/` while open →
`git rm` on archive (folded into hub, not mirrored).

### Correlation model (resolution table)

For issue `N`, primary plan-task `<ID>`, slug `<slug>`:

| Source file | Directory | Named by | Resolved from anchor | Sub-page? |
|-------------|-----------|----------|----------------------|-----------|
| Issue record | `specs/issues/` | plan-task ID + slug | *is the anchor* | No — fold into hub |
| Context | `specs/context/` | issue number | `context/<N>.md` | No — delete |
| Requirements | `specs/requirements/` | slug | `requirements/REQ-<slug>.md` | Yes → `requirements.md` |
| Architecture | `specs/architecture/` | slug | `architecture/ARCH-<slug>.md` | Yes → `architecture.md` |
| Review(s) | `specs/` | PR number | `CODE-REVIEW-*.md` WHERE `Target` = `feat/<N>/…` | Yes → `review.md` / `review-pr-<PR>.md` |
| Spike findings | `specs/` (as authored) | slug/issue | author-supplied | Yes → `findings.md` |
| ADR/decisions | `specs/` (as authored) | slug/issue | author-supplied | Yes → `decisions.md` |
| Images | — | — | referenced by other docs | Yes → `assets/` |

### Hub page (destination anchor)

**Purpose:** the self-describing archive record; survives `specs/` deletion.

**Mandatory key line:** `**Plan task:** #P1-2 · **Phase:** 1 · **PR(s):** #60 · **Closed:** YYYY-MM-DD · [GitHub issue #N](url)`
— PR number(s) now **required** (was implicit) so issue↔PR↔task traceability isn't lost when sources
are deleted (R8, N2).

## API Contracts / Interfaces

The "interface" is the skill's step contract — the executable procedure.

### archive-issue skill (executor)

**Boundary:** user-invoked skill (`disable-model-invocation` — only the user triggers it).

**Operations (revised steps):**

| Step | Signature | Purpose | Errors / Returns |
|------|-----------|---------|------------------|
| 1 | `resolve(N \| #P?-?) → anchor` | Confirm issue closed; load issue record | Open issue → stop, change nothing (R15) |
| 2 | `derive(anchor) → {context, req, arch, reviews[]}` | Compute all source paths deterministically | Review branch mismatch → skip that review, flag (R5) |
| 3 | `writeHub(anchor) → docs/issue-NNN.md` | Hub w/ mandatory key line + overview from issue Summary | — |
| 4 | `writeSubpages(sources) → docs/issue-NNN/*` | Only for sources that exist; multi-review naming | No placeholders for missing docs (R7) |
| 5 | `indexInsert(hub, phase) → Home.md, _Sidebar.md` | Find-or-create phase heading; insert in issue# order; refresh ✓/◐ | New phase → create heading (R3, R9, R11, R12) |
| 6 | `retire(sources) → git rm` | Empty `specs/` of the issue's files | — (R13) |
| 7 | `report()` | Source→dest summary for diff review | Wiki push stays manual (out of scope) |

**Auth requirements:** user-invoked only; no automated triggering.

## Module Boundaries

| Module / File | Responsibility | Allowed Dependencies |
|---------------|----------------|----------------------|
| `specs/wiki-structure.md` | Layout contract: correlation model, hub/sub-page shape, grouping rules | References `plan.md` (phases), CLAUDE.md (delivery pipeline) |
| `.claude/skills/archive-issue/SKILL.md` | Executable retirement procedure | Reads `wiki-structure.md` as authority; must not re-define layout |
| `docs/Home.md`, `docs/_Sidebar.md` | Phase-grouped navigation index | Link only hubs; never sub-pages directly |
| `docs/issue-NNN.md` + `issue-NNN/*` | Per-issue archive record | Self-contained; no dependency on `specs/` |

## Change Footprint

### New files / modules

_None._ Every target file already exists. (`docs/issue-NNN/findings.md`, `decisions.md`, `assets/`
are new *vocabulary* but are only created when a future issue actually has such a source.)

### Modified files / modules

| Path | What changes here |
|------|-------------------|
| `specs/wiki-structure.md` | Add "Correlation model" section w/ resolution table; expand "Rules that matter" for phase grouping, Unphased bucket, primary-task grouping, multi-review naming, mandatory hub key line; add open sub-page vocabulary; update ASCII example to phase-grouped `Home.md`; add sort-order + ✓/◐ status rules |
| `.claude/skills/archive-issue/SKILL.md` | Rewrite Step 1–2 as anchor-first resolve+derive; Step 2 branch-match reviews (`Target` row), support multiple; Step 3 mandatory `PR(s):` key line; Step 4 multi-review + open-vocabulary sub-page naming; Step 5 phase-grouped index insert with find-or-create heading + issue# sort + ✓/◐ refresh |
| `docs/Home.md` | Reshape flat "Issues" list → `## Phase N` headings (+ Unphased) with ✓/◐ status; re-slot existing issue-013 under `## Phase 1` |
| `docs/_Sidebar.md` | Reshape flat "Issues" list → phase-grouped headings; re-slot issue-013 under Phase 1 |
| `CLAUDE.md` (L48, L53, L55) | Update the three convention references to name phase grouping + open vocabulary (currently say "requirements/architecture/review" only) |
| `specs/claude-lens-plan.md` (~L260) | Add a decisions-log row recording the hardening (correlation model, phase grouping, key preservation) |

### Deleted / replaced

_None_ — this hardens existing files in place. (Per-issue source deletion under `specs/` is what the
*skill* does at archive time, not a change this refactor makes to the repo now.)

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|------|----------------|
| `docs/issue-013.md` | The one existing hub predates the mandatory `PR(s):` key line — it will be non-conformant after this lands. Re-slotting it in the index touches its *link* but not its *content*; the content backfill is a flagged follow-up, not this task. |
| `docs/issue-013/{requirements,architecture,review}.md` | Sub-pages of the worked example; unchanged, but their hub's format drift is the visible inconsistency. |
| `.claude/skills/create-issue/` | Upstream producer of issue records (the anchor). This refactor *depends on* the `issue: N` frontmatter + `<ID>-<slug>` filename it emits — if that format changes, resolution breaks. Not edited, but coupled. |

## Areas of Impact

| Area | Impact | Risk (L/M/H) | Why |
|------|--------|--------------|-----|
| `archive-issue` skill users | Must follow the new anchor-first procedure; more rules to get right | L | Deterministic steps *reduce* ambiguity vs today's hunt |
| Existing #13 archive | Left in the old hub format; index re-slots it | L | Cosmetic drift; backfill is a named follow-up, no functional breakage |
| `create-issue` coupling | Resolution relies on its filename/frontmatter contract | M | If `create-issue` ever renames the anchor format, resolution silently breaks — document the dependency |
| CLAUDE.md readers | Convention description changes shape | L | Doc-only; keeps the delivery-pipeline narrative accurate |
| GitHub wiki push | Unchanged manual step | L | Explicitly out of scope; `docs/` still mirrors 1:1 |

**Contract changes:** the **hub metadata line gains a mandatory `PR(s):` field** — a format change to
the archive "public contract." Only consumer is a human/agent reading the wiki; the one existing hub
(#13) becomes non-conformant until backfilled (accepted, flagged).

**Cross-cutting ripples:** none into runtime — no build, telemetry, auth, or migration surface. The
only ripple is documentation consistency across `wiki-structure.md` ↔ `SKILL.md` ↔ `CLAUDE.md` ↔
`plan.md`, which must all describe the same convention after this lands.

## Cross-Cutting Concerns

- **Errors:** the only "error" path is archiving an open issue → the skill stops and reports, changing
  nothing (R15). A review whose `Target` branch doesn't match is skipped and flagged, not force-filed.
- **Logging & metrics:** N/A (no runtime). Step 7's report is the audit trail (source→dest) for diff
  review before commit.
- **Auth / authz:** the skill is user-invoked only (`disable-model-invocation`); agents suggest it,
  never trigger it.
- **Performance:** N/A — a handful of files per archive.
- **Security:** N/A — local docs, no secrets, no external calls (the wiki push is a separate manual
  step outside this scope).
- **Migrations / rollout:** land the spec + skill + index reshape together so the docs stay internally
  consistent. Backward-compat concern is the single #13 hub — handled by scoping its content backfill
  out (index re-slot only).

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies REQs |
|---|----------|--------------|----------------|----------------|
| A1 | Anchor-first resolution: derive all sources from the issue record | Per-file hunt; generated manifest | Anchor holds all keys; direct lookups beat a 3-way join; no 4th sync target | R4, N3 |
| A2 | Match reviews by `Target` branch, not PR number | Number-match | PR# ≠ issue# → misattribution | R5 |
| A3 | Correlation table lives in the spec; steps in the skill | Fold into skill only | Preserves durable-contract vs executor split | N3 |
| A4 | Phase grouping in index; phase derived from plan-task prefix, not filename | Flat list; area grouping; phase in filename | Mirrors `plan.md` spine; filenames stay stable across re-sequencing | R3, R10 |
| A5 | Unphased bucket for non-plan issues; primary task decides multi-task grouping | Multiple index entries; type-based scheme | One issue = one entry keeps index unambiguous | R9, R10 |
| A6 | Mandatory `PR(s):` on hub key line | Rely on `specs/` for traceback | Archiving deletes `specs/`; hub is the last place links can live | R8, N2 |
| A7 | Multi-review naming: `review.md` (1) / `review-pr-<PR>.md` (2+) | Single `review.md`; concatenate | Preserves every review without collision | R6 |
| A8 | Open, named sub-page vocabulary | Fixed three | Spikes/bugs produce findings/decisions that don't fit the three | R7 |
| A9 | Sort by issue# within phase; ✓/◐ status mirrored from `plan.md` | Sort by task ID/date; pure index | Simple stable rule; status adds at-a-glance value | R11, R12 |
| A10 | Hand-edited index, skill dictates insertion point | Auto-generate | Over-engineering at this volume | Decision 10 |
| A11 | Re-slot #13 in index only; hub content backfill is a follow-up | Full #13 backfill in scope | Keeps this change scoped to the convention, not a migration | REQ out-of-scope |

## Risk & Stress-Test Scenarios

### Forward — convention-robustness scenarios

| Scenario | How the Design Handles It |
|----------|---------------------------|
| Issue absorbs a second task from another phase | Group by primary task's phase; resolution anchors on primary slug; absorbed ID noted in hub overview (A5) |
| Issue has 2+ PRs / 2+ CODE-REVIEW files | `review-pr-<PR>.md` per PR, each resolved by its own `Target` branch, all linked (A7) |
| First issue archived into a phase with no heading yet | Step 5 find-or-create the `## Phase N` heading in both index files (A4) |
| Issue with no plan-task ID (bug/chore/spike) | Falls to Unphased bucket; resolution still works (context by issue#, no phase derived) (A5) |
| Review's `Target` branch matches no known slug | Skip + flag for manual judgment; never force-archive a foreign review (A2) |
| Issue reopened after archiving | Snapshot-not-lock: pipeline recreates `specs/` docs fresh; archive overwritten on next close (pattern) |

### Backward — regression risk per touched area

| Touched area | What could regress | How we'd know / mitigation |
|--------------|--------------------|-----------------------------|
| `docs/issue-013.md` | Non-conformant to new mandatory `PR(s):` line | Visible on read; scoped out as named follow-up, not silently edited |
| `docs/Home.md` / `_Sidebar.md` reshape | Broken/duplicated #13 link during flat→grouped move | Single existing entry — verify the one link resolves post-reshape |
| `create-issue` filename/frontmatter contract | If it later changes the anchor format, resolution breaks silently | Document the coupling in `wiki-structure.md`'s correlation section as an explicit dependency |
| `CLAUDE.md` ↔ `wiki-structure.md` ↔ `SKILL.md` drift | Three docs describing the convention diverge | Land all edits in one change; cross-reference each other |

## Open Questions

- Should the correlation section explicitly version the `create-issue` anchor contract (e.g. "requires
  `issue:` frontmatter + `<ID>-<slug>` filename") so a future `create-issue` change flags the break?
  - **Impact if unresolved:** a silent resolution break if the anchor format ever changes.
  - **Suggested default:** yes — add a one-line "depends on the create-issue anchor format" note; cheap
    insurance.
- When "Unphased" grows large, subdivide by work type (bug/chore/spike)?
  - **Impact if unresolved:** a long flat Unphased list.
  - **Suggested default:** keep flat until it exceeds ~10 (carried from REQ open questions).

## Out of Scope

- **Backfilling `docs/issue-013.md`'s hub content** to the new key-preserving format (reason: named
  follow-up task; this change re-slots its index link only — A11).
- **Pushing `docs/` to `<repo>.wiki.git`** (reason: manual step outside this repo's history; unchanged).
- **Auto-generating the index files** (reason: decided against — A10).
- **Mirroring living V2 specs / the issue body into the wiki** (reason: violates single-source-of-truth
  — N1).
- **Changing how issues are drafted/filed** in `create-issue` (reason: upstream producer; only a
  documented dependency, not an edit).

---

# Tasks

_Generated 2026-07-11. Three tasks, all `checklist` mode (docs/convention refactor — no runtime
code). Order: **T1 → T2, T3**. T2 and T3 both depend on T1's defined layout; landed all three in one
commit for cross-doc consistency (ARCH cross-cutting ripple)._

## Task T1: Expand the layout spec — correlation model + phase grouping

> **Status:** done — `specs/wiki-structure.md` expanded with Correlation model, phase grouping/Unphased/primary-task, multi-review naming, open vocabulary, mandatory branch-mode-aware hub key line, sort/status rules, updated ASCII example, and the `create-issue` dependency note. All checklist items verified (`grep -in "flat"` shows no contradicting flat-list language).
> **Verification:** checklist
> **Effort:** m
> **Priority:** critical
> **Depends on:** None
> **Satisfies REQs:** R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, N1, N2, N3, N4
> **Footprint slice:** Modified: `specs/wiki-structure.md`
> **High-risk areas touched:** `create-issue` coupling (M) — the resolution table depends on its filename/frontmatter contract

## Task T2: Rewrite the archive-issue skill as an anchor-first executor

> **Status:** done — `.claude/skills/archive-issue/SKILL.md` Steps 1–5 rewritten anchor-first with branch-matched multi-review, mandatory `PR(s):` hub line, open-vocabulary sub-pages, and phase-grouped index insert. Dry-run against #13's real (already-archived) inputs confirmed the naming rules match its actual `docs/issue-013/{architecture,requirements,review}.md` output (single branch-mode review → `review.md`, no PR suffix — consistent).
> **Verification:** checklist
> **Effort:** m
> **Priority:** high
> **Depends on:** T1
> **Satisfies REQs:** R4, R5, R6, R7, R8, R13, R15
> **Footprint slice:** Modified: `.claude/skills/archive-issue/SKILL.md`
> **High-risk areas touched:** `create-issue` coupling (M) — resolution relies on the anchor format

## Task T3: Reshape indexes to phase-grouped + align the convention docs

> **Status:** done — `docs/Home.md`/`_Sidebar.md` reshaped to phase-grouped (lazy-created headings, per T2's own rule — only `## Phase 1` exists since #13 is the only archived issue), #13 re-slotted with `git diff --stat docs/issue-013.md docs/issue-013/` confirming zero content change. `CLAUDE.md` L48/L55 and `plan.md` decisions log updated; cross-doc `grep -rin "flat"` swept all four docs + indexes — no surviving flat-list description.
> **Verification:** checklist
> **Effort:** s
> **Priority:** high
> **Depends on:** T1
> **Satisfies REQs:** R3, R11, R12, R14
> **Footprint slice:** Modified: `docs/Home.md`, `docs/_Sidebar.md`, `CLAUDE.md` (L48/L53/L55), `specs/claude-lens-plan.md`
> **High-risk areas touched:** Existing #13 archive (L) — re-slot its index link without touching its hub content
