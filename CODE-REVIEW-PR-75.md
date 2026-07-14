# Review Report

## Metadata

| Field | Value |
|-------|-------|
| **Review Mode** | Pipeline: `specs/architecture/ARCH-metrics-engine.md` (code files only) |
| **Target** | PR #75 — `feat/25/metrics-engine-measures-dimensions` → `main` |
| **Date** | 2026-07-14 |
| **Tech Stack** | TypeScript (strict), Node.js, Vitest — no HTTP/DB/React in this diff |
| **Checks Run** | task-completion, code-quality, test-coverage, typescript-strictness, error-handling |
| **Checks Skipped** | security (no auth/user-input surface), performance (no DB/network, budget already reasoned in ARCH), documentation (internal module, no public API yet), config-dependencies (no new deps/config), runtime-behavior/async-patterns/react-patterns/express-patterns/database-patterns/migration/accessibility (none apply — no async/React/Express/DB files, no breaking API) |
| **Files Changed** | 8 code files (`server/metrics/{grain,dimensions,measures,engine}.ts` + 4 `.test.ts`), scoped out: `specs/architecture/ARCH-metrics-engine.md`, `specs/claude-lens-plan.md`, `specs/context/25.md` |
| **Lines Changed** | +1900 / -0 (code files: ~1321 of that) |

## Review Process

- [x] Preflight checks passed
- [x] Diff gathered (11 files, 1900 lines; scoped to 8 code files)
- [x] Tech stack detected: TypeScript strict, Node.js, Vitest
- [x] Context read (CLAUDE.md, `ARCH-metrics-engine.md`)
- [x] Triage proposed and developer confirmed
- [x] 5 checks dispatched in parallel
- [x] Results collected, deduplicated, 2 High findings independently re-verified against source
- [x] Report compiled
- [x] Verdict determined

## Verdict: ❌ FAIL

The design and task-completion story are genuinely solid — all 51 tests are real (non-tautological, matching their scenario names), all 4 tasks' scope boundaries and ARCH decisions are respected, and `npm run verify` is clean. But two High-severity correctness bugs slipped through: malformed timestamps (a real, reachable shape per `parse-transcript.ts`'s own `toStr()` fallback) produce `NaN` that either poisons `wallMinutes` (contradicting its own "never null, real number" contract) or silently *bypasses* range filtering entirely instead of excluding the record. Both are must-fix before merge — the rest is solid, mostly test-coverage gaps and low-severity polish.

### Finding Counts

| Category | 🔴 | 🟠 | 🟡 | 💭 | ⚠️ |
|----------|-----|-----|-----|-----|-----|
| task-completion | 0 | 0 | 0 | 0 | 2 |
| code-quality | 0 | 0 | 0 | 2 | 1 |
| test-coverage | 0 | 0 | 4 | 2 | 0 |
| typescript-strictness | 0 | 0 | 1 | 2 | 0 |
| error-handling | 0 | 2 | 0 | 1 | 0 |
| **Total** | **0** | **2** | **5** | **5** | **3** |

---

## task-completion

**Result:** ✅ All 5 requirements (R1–R5) verified with evidence; all 4 tasks' Test Plans, Scope Boundaries, and Files Expected confirmed against the actual code; both mid-session ARCH corrections (`wallMinutes` real-not-null, `apiMs` no-invented-proxy) confirmed reflected in code; `npm run verify` re-run directly (not trusted from prior claims) — clean.

| # | Sev | Finding |
|---|---|---|
| O1 | ⚠️ | R5's dense-output guarantee doesn't extend to breakdown-dimension groups with zero matching calls (`buildGroups` in `engine.ts` returns `[]` rather than a dense zero-point series when `breakdownDims.length > 0` and no calls match). Documented in-code as an intentional "nothing to enumerate" choice, but only the no-breakdown-dims case is test-covered. Worth your explicit confirmation this matches intended R5 scope. |
| O2 | ⚠️ | `measures.ts` imports `Measure` from `shared/metrics-contract.ts`, which the ARCH's Module Boundaries table doesn't list for that file (only `shared/types.ts`). Type-only import, no runtime coupling — reads as an ARCH-table omission, not a code defect. |

---

## code-quality

**Result:** Module-boundary rule (`metrics/` imports only `shared/*` + siblings) verified clean across all four files, no violations.

| # | Sev | File | Finding |
|---|---|---|---|
| L1 | 💭 | `engine.ts` | Re-declares the `"unknown"` string literal ~6 times (in `sessionValueForDim` and elsewhere) instead of reusing `dimensions.ts`'s `UNKNOWN` convention — that constant isn't currently exported, so this would need exporting it too. Cosmetic DRY note, not a behavior risk (both sides agree on the literal value). |
| L2 | 💭 | `engine.ts` | `scopeFor` rescans the full `input.turns`/`input.sessions` arrays from scratch for every (measure × group × bucket) cell rather than pre-indexing once — O(measures × groups × buckets × turns) instead of O(turns). Not a bug; ARCH's own perf budget reasoning already covers today's scale. Revisit only if profiling shows it matters. |
| O3 | ⚠️ | `engine.ts` | Session-dimension resolution (`sessionValueForDim`) silently defaults unmapped dimensions to `["unknown"]` — explicitly documented in-code as intentional (sessions don't carry tool/sidechain/gateStatus info), low-confidence design note only. |

*(A duplicated range/bucket conditional block flagged informally by the reviewing agent was on inspection the same pattern intentionally repeated for calls/turns/sessions with different field names — not true duplication warranting a fix; not carried forward as a finding.)*

---

## test-coverage

**Result:** All existing assertions are non-tautological (hand-computed literals, not re-derived from production code). Gaps are in what's *not* tested, not in the quality of what is.

| # | Sev | File | Finding |
|---|---|---|---|
| M1 | 🟡 | `engine.test.ts` | Session-grain grouping (`sessionValueForDim`/`sessionMatchesGroup`) has zero test coverage despite dedicated production logic implementing it. |
| M2 | 🟡 | `engine.test.ts` | `gateStatus` as a breakdown dimension (crossed with any measure) has zero test coverage — the `turnMatchesGroup`/`valuesForCallDim` gateStatus branches are exercised only indirectly via `dimensions.test.ts`'s unit tests, never through the full engine pipeline. |
| M3 | 🟡 | `engine.test.ts` | Turn/session range-exclusion in `scopeFor` is untested — directly relevant, since a test here would likely have caught error-handling finding H2 below. |
| M4 | 🟡 | `engine.test.ts` | The "breakdown dims requested + zero matching calls → empty `Series[]`" path (task-completion's O1) is untested. |
| L3 | 💭 | `dimensions.test.ts` | `matchesFilter`'s numeric-coercion path (`allowed: number[]`) and empty-allowed-list (`[]`, distinct from `undefined`) edge cases are untested. |
| L4 | 💭 | `grain.test.ts` | `enumerateBuckets` is never exercised with `grain: "week"` — only `bucketStart`'s week-truncation is tested; the Test Plan named coverage across "every grain" for enumeration specifically. |

---

## typescript-strictness

**Result:** `npx tsc --noEmit -p server/tsconfig.json` — clean, re-verified directly. No `any`, no non-null assertions, no `@ts-ignore` anywhere in the 8 files. The two `as CallDimension` assertions (`engine.ts`) were traced against the full call graph and assessed as sound today — not flagged as findings, but noted as assumption-dependent.

| # | Sev | File | Finding |
|---|---|---|---|
| M5 | 🟡 | `grain.ts` | `nextBucket`'s switch over `Grain` uses `break` + external mutation rather than per-case `return` like its siblings (`bucketStart`/`bucketLabel` in the same file) — so it isn't compiler-enforced-exhaustive. If `Grain` ever grows a 5th member, `enumerateBuckets`'s `while (cursor <= lastBucket)` loop would spin forever silently instead of failing to compile. |
| L5 | 💭 | `engine.ts` | `sessionValueForDim`'s switch uses an explicit `default: return ["unknown"]` (per its own comment, deliberately catching 4 dims), breaking the no-`default` exhaustiveness pattern every other switch in this changeset follows — a new `Dimension` member would silently fall into `"unknown"` with no compile signal. |
| L6 | 💭 | `engine.ts` | `Object.keys(filters) as Dimension[]` (the standard `Object.keys` widening limitation) is safe today since nothing yet feeds `MetricsQuery.filters` from unvalidated external input — flagged as a forward-looking reminder for whoever wires this to an HTTP route (#P2-10) to validate keys first. |

---

## error-handling

**Result:** 3 of the module's 5 stated never-throw/never-NaN invariants hold cleanly; two do not, in the same failure family (unguarded `Date.parse`). Independently re-verified both by tracing `parse-transcript.ts`'s `toStr()` — a malformed/missing `timestamp` field coerces to `""`, and `Date.parse("")` is `NaN` in JS — so this is reachable production behavior, not a hypothetical.

| # | Sev | File | Finding | Failure scenario |
|---|---|---|---|---|
| **H1** | 🟠 | `measures.ts`, `wallMinutes` case | `scope.turns.reduce((sum, turn) => sum + (Date.parse(turn.endedAt) - Date.parse(turn.startedAt)) / 60_000, 0)` has no NaN guard. | A single turn in scope with an empty-string `startedAt`/`endedAt` (a real shape per `derive-turns.ts`'s lexicographic min/max over `call.timestamp`, itself `toStr()`-coerced) poisons the *entire* bucket's `wallMinutes` to `NaN` — directly contradicting the "real number, never `null`" contract this measure was specifically corrected to guarantee this session. |
| **H2** | 🟠 | `engine.ts`, range filtering (calls ~225-229, turns ~194-199, sessions ~201-206) | `if (ts < rangeFromMs \|\| ts > rangeToMs) return false;` where `ts = Date.parse(...)`. `NaN < x` and `NaN > x` are both `false` in JS, so a record with an unparseable timestamp **passes** the range filter instead of being excluded. | A record with a malformed timestamp is silently included in every non-time-bucketed query (e.g. an "efficiency table" shape, decision A2) regardless of the selected date range, while simultaneously being *excluded* from any time-bucketed view (the `bucketStart(...) === bucketStartMs` check correctly returns `false` for `NaN`). Totals and time-series views can silently disagree with no signal it happened. |
| O4 | ⚠️ | `dimensions.ts`, `turnDimensionValue` | Uses `turn[dim] ?? UNKNOWN` (catches only `null`/`undefined`), not `orUnknown()` like every scalar dimension in `callDimensionValue` (this file's own stated convention). Dormant today since `gateStatus` is always `undefined` (nothing populates it until #P4-11) — will silently under-bucket (`""` instead of `"unknown"`) if it's ever populated with an empty string rather than left unset. | Low-severity, forward-looking only — folded in as a minor note rather than a numbered Low finding since it's currently unreachable. |

---

## Manual Checks Required

- [ ] Confirm whether R5's dense-output guarantee is meant to extend to breakdown-dimension groups with zero matches (task-completion O1) — if yes, this becomes a design gap, not just a doc-vs-test mismatch.

## Prioritized Action Items

### Must Fix (🔴 Critical / 🟠 High)
- **H1** — Guard `wallMinutes`' per-turn delta with `Number.isFinite(...)`, treating a non-finite delta as `0` rather than letting it poison the whole bucket's sum.
- **H2** — Add `Number.isFinite(ts)` to all three range-filter sites (calls, turns, sessions) in `engine.ts`; treat non-finite timestamps as excluded, not included.

### Should Address (🟡 Medium)
- M1–M4: add `engine.test.ts` coverage for session-grain grouping, `gateStatus` breakdown, turn/session range-exclusion (would have caught H2), and the zero-match-breakdown-dims empty-`Series[]` path.
- M5: rewrite `grain.ts`'s `nextBucket` to return per-case (matching `bucketStart`/`bucketLabel`'s pattern) so a future `Grain` addition fails to compile instead of hanging `enumerateBuckets` at runtime.

### Nice to Have (💭 Low)
- L1–L6: DRY the `"unknown"` literal, add explicit cases instead of `default` in `sessionValueForDim`, parametrize the empty-string→unknown test across all scalar dims, cover `matchesFilter`'s numeric/empty-list edge cases, exercise `enumerateBuckets` at `grain: "week"`, note the `Object.keys` cast for whoever wires filters to HTTP later.

---
*Generated by Review — 2026-07-14*
