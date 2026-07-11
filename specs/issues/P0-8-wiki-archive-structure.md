---
title: "#P0-8 — Harden closed-issue wiki archive convention"
labels: phase-0, enhancement
milestone: Phase 0 — Spec closure & repo prep
status: filed
issue: 65
url: https://github.com/foyzulkarim/claude-lens/issues/65
---

## What & why

The closed-issue archive convention (`specs/wiki-structure.md` + `/archive-issue`, introduced
2026-07-10 and validated against a single issue, #13) doesn't hold up at scale. Three gaps: (1) an
issue's working docs are scattered across `specs/` under **three incompatible naming keys** —
plan-task ID + slug (`issues/`), issue number (`context/`), and PR number (`CODE-REVIEW-PR-*`, where
PR# ≠ issue#) — with no deterministic way to correlate them; (2) the wiki index is a flat
chronological list that becomes an unnavigable wall past ~15 issues; (3) archiving empties `specs/`,
so any issue↔PR↔task link not captured on the hub page is lost forever.

This hardens the convention: an **anchor-first correlation model** (the issue record is the single
file holding every key, so all other artifacts derive from it by direct lookup), **phase-grouped
navigation** with an Unphased bucket and ✓/◐ status, an **open sub-page vocabulary**
(requirements/architecture/review/findings/decisions/assets), **branch-matched multi-review**
support, and a **mandatory hub key line** so traceability survives the `specs/` cleanup.

Requirements and design are settled in the linked REQ/ARCH; work is sliced into three `checklist`
tasks (T1 spec → T2 skill → T3 indexes + doc consistency) in the ARCH's Tasks section.

## Acceptance

Full verifiable criteria are in the REQ (R1–R15, N1–N4). Headline done-signals:

- `specs/wiki-structure.md` documents a **correlation/resolution table** mapping each source
  (directory, naming key) → resolution path → sub-page destination; reviews matched by `Target`
  branch `feat/<N>/…`, never by PR number _(R4, R5, N3)_.
- Navigation in `docs/Home.md` / `docs/_Sidebar.md` is **phase-grouped** (Phase 0–4 + Unphased),
  issues sorted by number, each phase carrying a ✓/◐ status mirrored from `plan.md` _(R3, R9, R11,
  R12)_.
- Sub-page vocabulary is **open** (req/arch/review + findings/decisions/assets); only sources that
  exist get a page; **multiple reviews** archive as `review-pr-<PR>.md` _(R6, R7)_.
- The hub metadata line **preserves plan-task ID + PR number(s)** (branch-mode aware — #13's own
  review has no PR) so the archive is self-describing after `specs/` is emptied _(R8, N2)_.
- `/archive-issue` resolves every source **from the issue record anchor** and empties `specs/` of the
  archived issue's files _(R4, R13)_; open issues are refused _(R15)_.
- The convention reads consistently across `wiki-structure.md` ↔ `archive-issue/SKILL.md` ↔
  `CLAUDE.md` ↔ `plan.md` (no surviving flat-list description).

Out of scope: backfilling #13's existing hub to the new key line (index re-slot only); pushing
`docs/` to the live wiki repo (manual step).

## References

- `specs/requirements/REQ-wiki-archive-structure.md` — requirements (R1–R15, N1–N4, edge cases,
  decisions log)
- `specs/architecture/ARCH-wiki-archive-structure.md` — design + Change Footprint + tasks T1–T3
- Branch: `claude/wiki-issue-artifact-structure-hyvus2`
- Supersedes/hardens the 2026-07-10 archive convention (`specs/wiki-structure.md`,
  `.claude/skills/archive-issue/`, `docs/issue-013*`)
