---
title: "chore: backfill the wiki's issue-013 hub with mandatory PR(s) key line"
labels: documentation
status: filed
issue: 66
url: https://github.com/foyzulkarim/claude-lens/issues/66
---

## What & why

#P0-8 (#65) hardened the closed-issue wiki archive convention, adding a **mandatory** `PR(s):`
field to every hub page's metadata line so issue↔PR↔task traceability survives `specs/` being
emptied on archive (REQ R8/N2). The wiki's `issue-013` hub — the one issue archived before this
hardening — predates the rule: its review was **branch-mode** (no PR), so its hub is missing the
field entirely. This was deliberately left untouched by #65 (ARCH-wiki-archive-structure.md's
decision A11 and the REQ's Out-of-Scope section both call it out as a separate follow-up, not part
of introducing the convention).

Note: the archive convention moved off `docs/` in this repo onto a wiki-only model shortly after
#65 landed — `issue-013.md` now lives only on the wiki (edit it via a local `.wiki/` clone per
`specs/wiki-structure.md`), not under `docs/` in this repo.

## Acceptance

- The wiki's `issue-013.md` metadata line includes `**PR(s):** — (branch review)`, matching the
  branch-mode fallback format specified in `specs/wiki-structure.md`.
- No other content in `issue-013.md` or its sub-pages changes.
- No files in this repo are touched (the fix lands as a wiki-repo commit only).

## References

- `specs/wiki-structure.md` — mandatory hub key line + branch-mode fallback rule
- `specs/architecture/ARCH-wiki-archive-structure.md` — decision A11 (re-slot #13 index only;
  hub content backfill is a named follow-up)
- `specs/requirements/REQ-wiki-archive-structure.md` — Out of Scope section
- Found via code review of PR #64 (`CODE-REVIEW-PR-64.md`, finding T1)
