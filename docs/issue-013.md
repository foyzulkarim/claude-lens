# Issue #13 — Scaffold three-root TS package

**Plan task:** #P1-1 · **Phase:** 1 — Bootstrapping · **Closed:** 2026-07-10 · [GitHub issue #13](https://github.com/foyzulkarim/claude-lens/issues/13)

Scaffolded the V2 skeleton: one npm package with `shared/`, `server/`, `client/` strict-TS roots,
the architecture §2 dependency lists, the root `package.json` runtime pins, and (absorbed from
#P0-5) the MIT LICENSE. First task with a root `package.json` since V1 moved to `legacy/` (#P0-2) —
everything in Phase 1+ builds on it.

## Docs

- [Requirements](issue-013/requirements) — functional/non-functional requirements, edge cases,
  decisions log (Mode B gap-fill against architecture §1–§3, §12)
- [Architecture](issue-013/architecture) — tech choices, module boundaries, task breakdown (T1–T3),
  including the A2/A3 project-references resolution recorded during implementation
- [Review](issue-013/review) — code review of `feat/13/scaffold-three-root-ts-package`: ✅ approve,
  four Low findings, none blocking

## Outcome

`tsc --noEmit` passes across all three roots; production dependencies match architecture §2 exactly
(no extras); `engines`/`packageManager`/`license` pinned as specified; MIT LICENSE at repo root.
Node floor raised ≥18→≥22 with the required companion edit to `claude-lens-architecture.md` §1/§12
and a plan decisions-log row. Unblocked #P1-2 (dev/build toolchain).
