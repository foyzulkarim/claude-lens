# Issue #65 — Harden closed-issue wiki archive convention

**Plan task:** #P0-8 · **Phase:** 0 · **PR(s):** #64 · **Closed:** 2026-07-11 · [GitHub issue #65](https://github.com/foyzulkarim/claude-lens/issues/65)

The closed-issue archive convention (`specs/wiki-structure.md` + `/archive-issue`, introduced
2026-07-10 and validated against a single issue, #13) didn't hold up at scale. This hardened it with
an **anchor-first correlation model** (the issue record is the one file holding every correlation
key, so all other artifacts derive from it by direct lookup), **phase-grouped navigation** with an
Unphased bucket and ✓/◐ status, an **open sub-page vocabulary**
(requirements/architecture/review/findings/decisions/assets), **branch-matched multi-review**
support, and a **mandatory hub key line** so issue↔PR↔task traceability survives `specs/` being
emptied on archive. This very issue is archived under that hardened convention — the first real test
of it beyond the single-issue #13 baseline.

## Docs

- [Requirements](issue-065/requirements) — correlation model, phase grouping, open sub-page
  vocabulary, mandatory hub key line (R1–R15, N1–N4), edge cases, decisions log
- [Architecture](issue-065/architecture) — anchor-first resolution design, module boundaries, task
  breakdown (T1 spec → T2 skill → T3 indexes + doc consistency)
- [Review](issue-065/review) — code review of PR #64: ✅ approve, all 19 REQs and 31 task-checklist
  items independently verified, three documentation findings fixed in follow-up commits

## Outcome

`specs/wiki-structure.md` now documents the correlation/resolution table and phase-grouped rules;
`.claude/skills/archive-issue/SKILL.md` executes them anchor-first; `docs/Home.md`/`_Sidebar.md`
moved from a flat list to phase-grouped navigation; `CLAUDE.md` and `plan.md` updated to match. Issue
#13's existing hub was deliberately left content-unchanged (only re-slotted in the index) — its
`PR(s):` backfill is tracked separately as issue #66. One review finding (T1) confirmed the #66
tracking issue; the other (T2, Unphased/multi-entry behavior unexercised) is retired by this very
archive pass.
