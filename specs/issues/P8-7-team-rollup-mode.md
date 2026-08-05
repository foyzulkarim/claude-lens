---
title: "#P8-7 — Team roll-up mode"
labels: phase-8
milestone: Phase 8 — Growth
status: draft
---

Task **#P8-7** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 8.

## Summary

Point claude-lens at a directory of #P8-6 exports and get a fleet view across contributors — one extra ingest source, no server, no auth, no database.

## Scope

- A configured roll-up directory becomes an additional ingest source alongside transcript roots.
- Contributor becomes a filterable dimension alongside project / model / branch / host.
- Mixed schema versions are either migrated or rejected with a clear, surfaced error — never silently partially-loaded.
- The single-user path is completely unaffected when no roll-up directory is configured.
- Explicitly **not** in scope: authentication, a hosted service, a database, non-loopback binding. Those contradict `AGENTS.md`'s standing constraints and the local-first product claim.

## Acceptance criteria

- A directory of redacted exports loads into a roll-up view with contributor as a filterable dimension.
- Mixed schema versions are handled or rejected with a clear error.
- The single-user path is unaffected when no roll-up directory is configured.

## Dependencies

- Depends on: #P8-6.

## References

- `specs/claude-lens-pages.md` §0 (dimensions) and §10 (Settings — labelled scan roots, the closest existing precedent for a configured extra source).
- `AGENTS.md` — no database; loopback only; ingest is the only writer to the Store.
