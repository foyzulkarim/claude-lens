# Review Report

## Metadata

| Field | Value |
|-------|-------|
| **Review Mode** | Pipeline: ARCH-122-fix-dashboard-tokens-chart |
| **Target** | `specs/architecture/ARCH-122-fix-dashboard-tokens-chart.md` |
| **Date** | 2026-07-26 07:35 AEST |
| **Tech Stack** | Strict TypeScript, React 19, Vite 8, TanStack Query/Table, ECharts 6, Wouter, Vitest/RTL |
| **Checks Run** | Task completion, code quality, test coverage, TypeScript strictness, React patterns, accessibility, runtime behavior |
| **Checks Skipped** | Performance (bounded linear projections); security, error handling, async, Express, database, migration, config/dependencies (no relevant boundary changed); documentation (internal implementation, no public API) |
| **Files Changed** | 10 implementation/test files |
| **Lines Changed** | +701 / -44 |

`specs/context/122.md` and the ARCH are review inputs and are excluded from the implementation-file count.

## Review Process

- [x] Preflight checks passed
- [x] Diff gathered (10 implementation/test files, 745 changed lines)
- [x] Tech stack detected: TypeScript/React/Vite/TanStack/ECharts/Vitest
- [x] Context read (`AGENTS.md`, global `CLAUDE.md`, ARCH-122, issue context)
- [x] Triage proposed and developer confirmed
- [x] 7 checks dispatched: task completion, code quality, test coverage, TypeScript strictness, React patterns, accessibility, runtime behavior
- [x] Results collected and deduplicated
- [x] Report compiled
- [x] Verdict determined
- [x] Report saved to `specs/reviews/`

## Verdict: ⚠️ PASS WITH FINDINGS

The production implementation satisfies R1–R6, T1–T4, and decisions A1–A7. Targeted tests, the complete repository verification gate, and live browser checks pass. Four medium test-evidence gaps and three low maintainability issues remain; none indicates a reproduced production defect.

### Finding Counts

| Category | 🔴 | 🟠 | 🟡 | 💭 | ⚠️ |
|----------|-----|-----|-----|-----|-----|
| Task Completion | 0 | 0 | 0 | 0 | 0 |
| Code Quality | 0 | 0 | 0 | 1 | 0 |
| Test Coverage & Quality | 0 | 0 | 4 | 0 | 0 |
| TypeScript Strictness | 0 | 0 | 0 | 2 | 0 |
| React Patterns | 0 | 0 | 0 | 0 | 0 |
| Accessibility | 0 | 0 | 0 | 0 | 0 |
| Runtime Behavior | 0 | 0 | 0 | 0 | 0 |
| **Total** | **0** | **0** | **4** | **3** | **0** |

## Task Completion

| Task | Production behavior | Permanent evidence | Result |
|------|---------------------|--------------------|--------|
| T1 — four token measures and filled-area stacking | Mapping order, canonical naming export, area/bar stacking, line exclusion, ghost suppression implemented | Core scenarios covered and passing | ✅ Complete |
| T2 — Dashboard stack and table identity | Tokens-only stacking and canonical bucket/column keys implemented | Core behavior covered; single-measure toggle query assertions and exact all-series aria total need strengthening | ✅ Implemented; see Test #1–2 |
| T3 — all-series calendar aggregation | Every finite series point folds by day; summed max and aggregate name implemented | Aggregation covered; aggregate-name assertion is weak | ✅ Implemented; see Test #3 |
| T4 — cache-read explanation | Guarded whole-percent share, visible `sub`, and synchronized link name implemented | Core behavior covered; previous-period delta/sparkline branch lacks permanent evidence | ✅ Implemented; see Test #4 |

A1–A7 are followed. No server/shared-contract/dependency/storage/auth/migration change exists. `ModelMixOverTime` retains its explicit output-token override; the expected stories, Cypress files, server engine, shared contract, and `StatCard` remain untouched.

## Code Quality

| # | Severity | File | Line | Issue | Recommendation |
|---|----------|------|------|-------|----------------|
| CQ1 | 💭 Low | `client/src/charts/units.ts` | 75–76 | The `MEASURE_LABELS` comment still describes the tokens unit as an `inputTokens + outputTokens` pair, contradicting the new four-measure contract immediately above it. | Update the example to say the four token measures. |

Otherwise the implementation reuses existing projections, avoids a second abstraction, preserves module boundaries, and introduces no dependency or server-contract churn.

## Test Coverage & Quality

| # | Severity | File | Line | Issue | Recommendation |
|---|----------|------|------|-------|----------------|
| TST1 | 🟡 Medium | `client/src/charts/ChartCard.test.tsx` | 446–459 | T2 requires UI-level proof that `$` and `calls` each query exactly one mapped measure. The control test asserts only the tokens query; another test clicks `calls` but inspects stacking, not its request. | Select `$` and `calls` and assert `['costComputed']` and `['apiCalls']` respectively. |
| TST2 | 🟡 Medium | `client/src/charts/ChartCard.test.tsx` | 436–443 | The aria-total fixture is lossy: the full four-series sum and cache-read-only sum both compact-format to `4.5M`, so dropping three measures could still pass. | Use balanced values with distinguishable compact output and assert the complete accessible label exactly. |
| TST3 | 🟡 Medium | `client/src/charts/calendar.test.ts` | 129–133 | `toContain('tokens')` also accepts a regressed one-measure name such as `Input tokens`; it does not pin the aggregate identity required by R4/T3. | Assert `Total (tokens)` exactly. |
| TST4 | 🟡 Medium | `client/src/pages/dashboard/StatCardsRow.test.tsx` | 166–181 | The regression fixture has no `compareGhost`, so it never exercises the delta-bearing `DrillStatCard` branch or verifies the Total-tokens sparkline required by T4. | Add previous-period data and assert the cache-share text/name, expected delta, sparkline, total, and `/models` link together. |

The tests otherwise cover the original defect, four-measure order, family-specific stacking, compare suppression, null/empty behavior, table collisions, sparse rows, calendar sums/max/range, zero-total guard, denominator separation, and accessible naming. No flakiness or inappropriate boundary mocking was found.

## TypeScript Strictness

| # | Severity | File | Line | Issue | Recommendation |
|---|----------|------|------|-------|----------------|
| TS1 | 💭 Low | `client/src/charts/units.ts` | 28–32 | `Record<Unit, Measure[]>` exposes the now load-bearing measure order as mutable arrays. No current caller mutates them, but the type does not protect composition/order. | Prefer readonly literal tuples with `as const satisfies Readonly<Record<Unit, readonly Measure[]>>`; copy only at an API boundary that requires mutation. |
| TS2 | 💭 Low | `client/src/charts/calendar.ts` | 58–62 | Tuple inference widens `data`, then `value as number` repairs the lost type even though `Map<string, number>` already establishes it. | Type `data` or the map callback as `[string, number]` and remove the assertion. |

The proposed `seriesName(series, distinctMeasureCount)` signature exactly matches the ARCH contract; its current callers derive the count from the same collection. No unsafe public `any`, non-null assertion, ignored diagnostic, or missing exported return type was introduced. Full strict typechecking passed.

## React Patterns

**Result:** ✅ No findings.

Stacking is derived from live unit state, memo dependencies are complete, family remains display-only, query keys isolate rapid selections, and the new `sub` prop reaches both delta/no-delta render branches without adding a query.

## Accessibility

**Result:** ✅ No findings.

Canonical series names drive both the canvas legend and keyboard-operable data table. The visible cache-read share and explicit Total-tokens link name derive from the same string. Live accessibility-tree inspection confirmed:

- `Total tokens: 20M — 97% cache reads — view in Models`;
- chart image name `Cost over time chart; 4 series; total 20M`;
- four table headers: Input, Output, Cache create, Cache read tokens;
- keyboard-addressable `View sessions for <bucket>` actions;
- Trends chart name `Calendar heatmap of tokens per day`.

## Runtime Behavior

**Result:** ✅ No findings.

The changed projections are pure and bounded. Empty, sparse, duplicate-date, non-finite, compare, grouped naming, and rapid-toggle paths preserve the existing `Series` contract. No response mutation, extra request, stale stacking state, or material avoidable work was found.

## Verification Evidence

- Targeted Vitest: **5 files, 95 tests passed**.
- `npm run verify`: typecheck, Biome lint, format check, and **144 files / 1,704 tests passed**.
- Live Dashboard (`CLAUDE_LENS_PORT_BASE=4250`, `?range=1d`): Total-tokens tile and chart summary both showed **20M**; sub-line showed **97% cache reads**; tokens table exposed all four measures with values `1.5K`, `118K`, `508K`, `19M` for the populated bucket.
- Live Trends request: ordered measures were `inputTokens`, `outputTokens`, `cacheCreateTokens`, `cacheReadTokens`; returned totals were 1,536, 118,454, 508,076, and 19,481,142.

## Manual Checks Required

None outstanding. The Dashboard visual, accessible tree, token table, and Trends token request were exercised in a real browser during this review.

## Prioritized Action Items

### Must Fix (🔴 Critical / 🟠 High)

None.

### Should Address (🟡 Medium)

1. Add the four missing/stronger permanent assertions in TST1–TST4.

### Nice to Have (💭 Low)

1. Correct the stale two-measure comment in `units.ts`.
2. Make `UNIT_MEASURES` readonly at the type level.
3. Preserve the calendar tuple type without `as number`.

---
*Generated by Review — 2026-07-26 07:35 AEST*
