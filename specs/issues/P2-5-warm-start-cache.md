---
title: "#P2-5 — Warm-start cache"
labels: phase-2
milestone: Phase 2 — Data engine (the risk phase)
status: draft
---

Task **#P2-5** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 2.

## Summary
Warm-start cache

## Scope
- `warm-cache.ts`: `(path,size,mtime)`-keyed NDJSON compact-record cache under `~/.claude-lens/cache/`; best-effort writes; deleting the dir is always safe.

## Acceptance criteria
- second boot on unchanged files skips parsing (observable via log/health counters); corrupted cache entries fall back to parse.

## Dependencies
- Depends on: P2-4
- Unblocks: P2-6

## References
- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md)
