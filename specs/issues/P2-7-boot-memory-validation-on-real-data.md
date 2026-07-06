---
title: "#P2-7 — Boot & memory validation on real data"
labels: phase-2
milestone: Phase 2 — Data engine
status: filed
issue: 24
url: https://github.com/foyzulkarim/claude-lens/issues/24
---

Task **#P2-7** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 2.

## Summary
Checkpoint: assemble the ingest pipeline end-to-end and validate boot time + memory on the real `~/.claude/projects` before Phase 3 builds on it.

## Scope
- *(checkpoint task)* Assemble the Phase 2 modules (discovery → poller → tailer → parser → store) into a runnable ingest entry point — that wiring is in scope here, not implicit; #P3-1's `app.ts` reuses it. Run ingest against the real `~/.claude/projects`. Measure cold boot, warm boot, RSS.

## Acceptance criteria
- cold boot, warm boot, RSS, and data size recorded in the benchmark log below; memory in the expected "low hundreds of MB" band or a paging decision is escalated **before** Phase 3. This is the only assumption in the architecture that can force a redesign — fail fast here.

## Benchmark log
| Date | Cold boot | Warm boot | RSS | Data size | Notes |
|---|---|---|---|---|---|
| — | | | | | |

## Dependencies
- Depends on: P2-6
- Unblocks: P2-8

## References
- [specs/claude-lens-architecture.md](../blob/main/specs/claude-lens-architecture.md) §5 (ingest pipeline wiring), §6 (memory discipline), §5.7 (single-threaded-until-proven-otherwise checkpoint)
