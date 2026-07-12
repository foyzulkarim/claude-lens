# Review Report

## Metadata

| Field | Value |
|-------|-------|
| **Review Mode** | PR #67 |
| **Target** | https://github.com/foyzulkarim/claude-lens/pull/67 |
| **Date** | 2026-07-12 |
| **Tech Stack** | TypeScript (strict, NodeNext) across three roots (`shared/`, `server/`, `client/`), Fastify, React (untouched beyond one stub), Biome |
| **Checks Run** | task-completion, code-quality, typescript-strictness |
| **Checks Skipped** | security (no auth/input-handling logic; origin gate untouched), performance/error-handling/runtime-behavior/async-patterns (no runtime logic of consequence), react-patterns/express-patterns/database-patterns/accessibility/migration (no matching surface), test-coverage (checklist-mode task; developer explicitly declined type-level tests), documentation/config-dependencies (internal task docs only; no dependency changes) |
| **Files Changed** | 9 (705 additions / 5 deletions) — see note below |
| **Lines Changed** | +705 / -5 (PR total); +606 / -5 across the 8 files that implement #P2-1 |

> **Out-of-scope inclusion:** the PR diff contains `CODE-REVIEW-PR-63.md` (99 lines), a review report for the already-merged, unrelated PR #63. It arrived via a separate commit (`de03fc6`) on top of this branch's real commit (`26766e2`), made outside this review session. Per the developer's instruction, it was excluded from all three checks below and is called out here rather than silently reviewed or silently ignored.

## Review Process

- [x] Preflight checks passed
- [x] Diff gathered (9 files, 705/-5; 8 files relevant to #P2-1)
- [x] Tech stack detected: TypeScript/strict, Fastify, React, Biome
- [x] Context read (root CLAUDE.md; PR description; `specs/architecture/ARCH-shared-contracts.md`)
- [x] Triage proposed and developer confirmed
- [x] 3 checks dispatched: task-completion, code-quality, typescript-strictness
- [x] Results collected and deduplicated
- [x] Report compiled
- [x] Verdict determined

## Verdict: ✅ APPROVE

The three shared contracts are well-derived from the field evidence, match architecture §7/§8 verbatim, and pass a live re-verification of all 8 items in Task T1's checklist (typecheck, lint, format, both stub imports, placeholder removal, field traceability, §7/§8 conformance). No Critical or High findings from any check. One should-fix: two of the "stub" wires in `server/app.ts` and `client/src/placeholder.ts` carry real (if harmless, uncalled) runtime logic, which the task's own Scope Boundaries said not to add — worth a conscious accept-or-trim decision before merge, not a blocker.

### Finding Counts

| Category | 🔴 | 🟠 | 🟡 | 💭 | ⚠️ |
|----------|-----|-----|-----|-----|-----|
| task-completion | 0 | 0 | 1 | 0 | 0 |
| code-quality | 0 | 0 | 0 | 0 | 0 |
| typescript-strictness | 0 | 0 | 0 | 2 | 0 |
| **Total** | **0** | **0** | **1** | **2** | **0** |

## Task Completion

**Scope reviewed:** `shared/types.ts`, `shared/metrics-contract.ts`, `shared/ws-protocol.ts` (new), `server/app.ts`, `client/src/placeholder.ts` (modified), `shared/placeholder.ts` (deleted), `specs/architecture/ARCH-shared-contracts.md`, `specs/context/18.md`.

**Inferred REQs (Mode B, no linked REQ doc):** 5/5 verified — R1 (compiles + imported by both stubs), R2 (field traceability), R3 (§7/§8 conformance), R4 (no tool-result bodies), R5 (tier-aware cost). All confirmed against the diff and re-run commands, not just the PR description's checkboxes.

**Verification Checklist V1–V8:** 8/8 independently re-verified — `npm run typecheck` (exit 0, all 3 projects), `npm run lint` / `format:check` (clean), both stub imports present and the server independently re-booted (`/api/ping` → 200, `/ws` loopback handshake → 101, non-loopback origin → 403), placeholder deletion clean, and field-set/§7/§8 conformance confirmed line-by-line against `field-definitions.md`/`data-model.md`.

**Change Footprint:** every row (3 new, 2 modified, 1 deleted, 5 touched-not-changed configs) present and accounted for; the untouched `tsconfig.json`×3/`package.json`/`biome.json` confirmed genuinely untouched.

**Architecture Decisions (A1–A7):** all followed correctly in the code (assistant-only `CompactCall`, literal unions not enums, relative `.js` `import type`, etc).

### Findings

| # | Severity | File | Line | Issue | Recommendation |
|---|----------|------|------|-------|----------------|
| 1 | 🟡 Medium | `server/app.ts:34-43`, `client/src/placeholder.ts:15-17` | — | Task T1's own Scope Boundaries state "Do NOT add runtime helpers... (developer decision: checklist-only, `tsc` is the done-signal)" and Files Expected calls for a "minimal" stub import. The PR instead adds two exported functions with real logic — `sendInvalidation` (`JSON.stringify` + `.send()`) and `describeQuery` (`.join()` + template formatting) — neither called anywhere (`grep` confirms only their own definitions match). A bare type-only reference (verified to pass `tsc`/`biome` cleanly) would have satisfied V1/V2/V4/V5 without the extra logic. | Trim both to a bare typed reference, or explicitly accept this as a deliberate deviation (both are well-commented, additive, and don't touch the real `/ws` outbound path yet) and note it in the PR. |

### Coverage Checklist
- [x] All 3 new `shared/*.ts` files — field/§7/§8 traceability ✅ → no issues
- [x] `server/app.ts` / `client/src/placeholder.ts` — imports present, server boots, origin gate intact ✅; scope ⚠️ → Finding #1
- [x] `shared/placeholder.ts` deletion — no stray refs ✅ → no issues
- [x] Must-NOT-modify configs — confirmed untouched ✅
- [x] `CODE-REVIEW-PR-63.md` — out of scope, flagged as not belonging on this branch (informational only)

## Code Quality & Conventions

**Verification performed:** `npm run typecheck` and `biome check` re-run clean on all 5 changed files. Cross-referenced the three new `shared/*.ts` files against `claude-lens-architecture.md` §7/§8 and the field-evidence docs — both match. Confirmed `shared/` has zero imports (pure types, no runtime/I/O, no cross-layer imports) and the deleted placeholder has no dangling references.

### Result: No findings.

### Observations (low confidence, not standalone findings)
- `SeriesPoint.t: string` — single-letter field name; common in time-series/charting shapes (matches the ECharts direction this project is heading), so not flagged, but `timestamp` would read more consistently with `Turn.startedAt`/`endedAt` elsewhere in the same file.
- `sendInvalidation` in `server/app.ts` architecturally belongs in a future `server/store/invalidation.ts` per the §3 module map; the PR's own comment already marks it as temporary staging ahead of #P2-2/#P2-3 — a marker for whoever picks that up, not an issue now.

### Coverage Checklist
- [x] `shared/types.ts` / `metrics-contract.ts` / `ws-protocol.ts` — naming, shape-vs-evidence, layer boundaries ✅ → no issues
- [x] `shared/placeholder.ts` (deleted) — no dangling references ✅ → no issues
- [x] `server/app.ts` / `client/src/placeholder.ts` — layer boundaries, import correctness ✅ → no issues (see observations above)

## TypeScript Strictness

**Verification performed:** `npm run typecheck` re-run clean (strict mode, all 3 projects). No `any`, `as`, `!`, or `@ts-ignore`/`@ts-expect-error` anywhere in the diff. Both new functions have explicit return types; both traced to zero current callers, matching the PR's stated intent.

### Findings

| # | Severity | File | Line | Issue | Recommendation |
|---|----------|------|------|-------|----------------|
| 1 | 💭 Low | `shared/types.ts:32` | 32 | `CompactCall.stopReason?: string` is a bare string despite `field-definitions.md:157,159` documenting a confirmed closed set (`end_turn`, `tool_use`, `max_tokens`, `stop_sequence`, `refusal`). Every other enumerable field touched in this PR was tightened to a literal union; this one has no comment marking it as deliberately left open. | Tighten to a literal union, or add a comment if intentionally left loose for forward-compat. |
| 2 | 💭 Low | `shared/types.ts`, `shared/metrics-contract.ts` | 62 / 66 | The `"computed" \| "observed"` union is duplicated independently in `TierFlags.costBasis` and `Series.basis` rather than a single named/exported type. | Extract `export type CostBasis = "computed" \| "observed";` in `shared/types.ts` and reuse it. |

### Observations (low confidence)
- `MetricsQuery.range` and `Distribution.histogram`'s bucket shape are anonymous inline object types. Fine today (nothing outside the file references them yet); naming them (`DateRange`, `HistogramBucket`) would make them independently reusable as the contract layer grows.
- `OutboundSocket` in `server/app.ts` is a minimal structural interface rather than importing `ws`'s real type — clearly intentional (comment references #P2-2/#P2-3) and structurally compatible; not flagged.

### Coverage Checklist
- [x] All 5 files — `any`/`as`/`!`/`@ts-ignore` ✅ none found; optionality reviewed against evidence ✅ → Findings #1, #2 (both low)
- [x] `shared/ws-protocol.ts` — discriminated union correctly modeled ✅ → no issues

## Manual Checks Required

- [ ] None — all checklist items were independently re-verified by the checks above rather than left as manual items.

## Prioritized Action Items

### Must Fix (🔴 Critical / 🟠 High)
None.

### Should Address (🟡 Medium)
- Trim `sendInvalidation`/`describeQuery` to bare typed stubs, or explicitly accept the scope deviation (task-completion #1).

### Nice to Have (💭 Low)
- Tighten `CompactCall.stopReason` to a literal union or comment why it's left open (typescript-strictness #1).
- Extract a shared `CostBasis` type instead of duplicating the union (typescript-strictness #2).
- Consider `SeriesPoint.timestamp` over `.t` for consistency (code-quality observation).
- Name the inline `range`/`histogram` bucket shapes as exported types (typescript-strictness observation).

---
*Generated by Review — 2026-07-12*
