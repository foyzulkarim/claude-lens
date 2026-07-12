---
title: "#P1-6 — Wiki-archive maintenance: backfill issue-013 PR(s) field; archive #8/#18"
labels: phase-1, documentation
milestone: Phase 1 — Bootstrapping
status: filed
issue: 66
url: https://github.com/foyzulkarim/claude-lens/issues/66
---

Task **#P1-6** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 1.

## Summary
Backfill the wiki's `issue-013.md` hub with the mandatory `PR(s):` metadata field introduced by
#P0-8 (#65), and retire issues #8 (#P0-3) and #18 (#P2-1) — both closed, both still sitting in
`specs/` — out into the wiki per `specs/wiki-structure.md`.

## Scope
- `docs/issue-013.md`'s hub predates #P0-8's hardening, which made `PR(s):` mandatory on every hub's
  metadata line; #13's review was branch-mode (no PR) so the field was left out entirely (deliberately
  deferred as a named follow-up by #65's own ARCH decision A11 / REQ Out-of-Scope section).
  Backfill it to `**PR(s):** — (branch review)`.
- Archive #8 (closed `NOT_PLANNED`, no fixtures shipped — hub reflects that outcome, not a shipped
  deliverable) and #18 (closed via PR #67 — `shared/types.ts`/`metrics-contract.ts`/`ws-protocol.ts`,
  plus its `ARCH-shared-contracts.md` and `CODE-REVIEW-PR-67.md`) into `docs/issue-008.md` /
  `docs/issue-018.md`.
- Sweep any stray `CODE-REVIEW-*.md` files found sitting outside `specs/` during the pass (matched
  to their owning issue by `Target` branch, never by assuming PR# = issue#).

## Acceptance criteria
- The wiki's `issue-013.md` metadata line includes `**PR(s):** — (branch review)`; no other content
  in `issue-013.md` or its sub-pages changes.
- `docs/issue-008.md` and `docs/issue-018.md` hub pages exist in the wiki, linked from
  `Home.md`/`_Sidebar.md` under their respective phases.
- `specs/issues/P0-3-*.md`, `specs/issues/P2-1-*.md`, `specs/context/18.md`, and
  `specs/architecture/ARCH-shared-contracts.md` removed from the main repo; no stray
  `CODE-REVIEW-*.md` left outside `specs/`.

## Dependencies
- Depends on: #P0-8 (#65) for the hub key-line convention this backfills against
- Unblocks: none

## References
- `specs/wiki-structure.md` — mandatory hub key line + branch-mode fallback rule + correlation model
- `specs/architecture/ARCH-wiki-archive-structure.md` — decision A11 (re-slot #13 index only; hub
  content backfill is a named follow-up)
- Found via code review of PR #64 (`CODE-REVIEW-PR-64.md`, finding T1)
