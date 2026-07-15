# Review Report

## Metadata

| Field | Value |
|-------|-------|
| **Review Mode** | Pipeline: `specs/architecture/ARCH-chart-layer-live-chart.md` |
| **Target** | PR #81 — `feat/31/chart-layer-live-chart` → `main` |
| **PR Title** | feat(31): chart layer + one live chart (#P3-4) |
| **Issue** | Closes #31 (#P3-4 — Phase 3 go/no-go checkpoint for Phase 4) |
| **Date** | 2026-07-16 |
| **Tech Stack** | TypeScript (strict), React 19, Vitest, ECharts (`echarts/core`), wouter, TanStack Query, Storybook |
| **Checks Run** | task-completion, code-quality, react-patterns, test-coverage, performance, typescript-strictness |
| **Checks Skipped** | security (no auth/endpoint surface — client-only, same-origin unauthenticated `/api/metrics`), database-patterns (no DB code touched), express-patterns (no server changes), migration (additive only, no contract changes), documentation (no public API surface), config-dependencies (folded into task-completion's Change Footprint verification), error-handling (thin surface, folded into task-completion/code-quality), accessibility (folded one checklist item into react-patterns rather than a full pass), async-patterns (folded into performance), runtime-behavior (folded into performance) |
| **Files Changed** | 17 |
| **Lines Changed** | +2028 / -38 |

## Review Process

- [x] Preflight checks passed (git repo confirmed, `gh` authenticated, PR branch `feat/31/chart-layer-live-chart` checked out locally and confirmed identical to PR head `bc67b1d`)
- [x] Diff gathered (17 files, +2028/-38)
- [x] Tech stack detected: TypeScript, React 19, Vitest, ECharts via `echarts/core`, wouter, TanStack Query, Storybook
- [x] Context read: `specs/architecture/ARCH-chart-layer-live-chart.md` (full ARCH + 3 embedded task specs), `specs/context/31.md` (linked issue), `CLAUDE.md`
- [x] Triage proposed and developer confirmed
- [x] 6 checks dispatched in parallel: task-completion, code-quality, react-patterns, test-coverage, performance, typescript-strictness
- [x] Results collected and deduplicated (one finding — click-handler churn — was raised independently by 3 checks and merged into one)
- [x] Report compiled
- [x] Verdict determined

## Verdict: ❌ FAIL

Task completion is genuinely strong: all 3 REQs (R1 full control set, R2 click-to-drill, R3 dumb/smart split) are verified against real code, every ARCH-mandated test scenario is present and asserts real behavior (not just file presence), module boundaries and the architecture's decision log (A1–A5) are followed exactly, and the "must NOT modify" list (`queryKeys.ts`, `ws.ts`, `filters/*`, `shared/metrics-contract.ts`) is confirmed untouched. `npx vitest run` passes 28/28, typecheck and lint are clean.

Two things block merge:

1. **The two regression-guard tests ARCH specifically mandated to protect against known pitfalls are vacuous.** ARCH's Task T3 spec calls out "stable filters+controls do not requery" and "query key matches the shared factory exactly" by name as guards against a documented refetch-loop pitfall and a documented WS-invalidation-breaking pitfall (ARCH lines 461–462). As written, neither test would fail if those exact regressions were reintroduced — one never triggers a second render to test stability against, the other checks a tautology (`qk.metrics(x) === qk.metrics(x)`) instead of the actual registered query key.
2. **The chart visibly unmounts and reinitializes on every control toggle.** `ChartCard`'s `useQuery` has no `placeholderData: keepPreviousData`, so TanStack Query v5 clears `data` to `undefined` on every query-key change (switching unit/grain/compare/smoothing to an uncached combination). Since `<Chart>` is only rendered when `data` is truthy, this unmounts the ECharts instance and forces a full `dispose()`/`init()` cycle instead of the cheap `setOption` update the entire dumb/smart component split was built to enable — the opposite of what a "live chart" control panel should feel like.

Both are narrow, well-understood fixes (not a design problem), and everything else in the PR — the module boundaries, the pure/stateful split, the memoization guard that *is* correctly implemented, the bundle-size discipline — is high quality. Recommend: fix the three High findings below, then re-review just those files.

### Finding Counts

| Category | 🔴 Critical | 🟠 High | 🟡 Medium | 💭 Low | ⚠️ Manual |
|----------|:---:|:---:|:---:|:---:|:---:|
| task-completion | 0 | 0 | 1 | 1 | 2 |
| code-quality | 0 | 0 | 2 | 2 | 0 |
| react-patterns | 0 | 1 | 0 | 0 | 2 |
| test-coverage | 0 | 2 | 1 | 0 | 2 |
| performance | 0 | 0 | 2 | 0 | 2 |
| typescript-strictness | 0 | 0 | 0 | 0 | 3 |
| **Total (deduplicated)** | **0** | **3** | **6** | **3** | **11** |

*(The click-handler-churn finding was raised independently by performance, react-patterns, and code-quality reviewers against the same file:line — counted once in the total, presented under react-patterns below with cross-references from the other two sections.)*

---

## task-completion

**REQ Verification:**

| REQ | Status | Evidence |
|-----|--------|----------|
| R1 (full control set) | ✅ Verified | `timeseries.test.ts` (family/unit/ghost scenarios), `ChartCard.test.tsx` ("unit toggle requeries…", "grain toggle requeries…", "compare toggle adds/removes…", "smoothing toggle adds/removes…") |
| R2 (click-to-drill) | ✅ Verified | `ChartCard.test.tsx` "click-to-drill navigates with the clicked bucket's range" — asserts exact `/sessions?from=…&to=…` path via `wouter` `memoryLocation` history |
| R3 (dumb/smart split) | ✅ Verified | `Chart.tsx` (61 lines, no `api`/`filters` imports) vs `ChartCard.tsx` (owns state/fetch/nav); `Chart.test.tsx` mocks `echarts/core` only |

**Task Verification Plans:**
- **T1 (tdd)** — 8/8 scenarios verified in `timeseries.test.ts`: area/bars family, null-as-gap, empty input, compare-ghost dashed series, $/tokens/calls formatting, unit→measure mapping, multi-series preservation. All assertions match the described GIVEN/WHEN/THEN exactly.
- **T2 (ui)** — 5/5 component-test items verified in `Chart.test.tsx`: init-once, `setOption(option, {notMerge:true})`, click wiring on/off, resize→`chart.resize()` (not `setOption`), dispose+observer disconnect. Storybook states present for human verification (⚠️ Manual, as ARCH itself designates).
- **T3 (ui)** — all listed component tests plus both regression guards are *present* in `ChartCard.test.tsx` (28/28 tests pass), though see test-coverage findings #1/#2 below regarding whether the regression guards actually assert what they claim to.

**Change Footprint Adherence:**

| ARCH Footprint Row | In Diff? | Notes |
|---|---|---|
| New: `charts/Chart.tsx`, `timeseries.ts`, `units.ts`, `ChartCard.tsx` + all test/story files | ✅ | Matches exactly |
| Modified: `client/src/pages/Dashboard.tsx` | ✅ | Old inline `useMemo`/`useQuery` logic removed, not duplicated |
| "No dependency change expected" (package.json) | ❌ | See Finding #1 below |
| `client/tsconfig.json` subpath tweak | ✅ | Anticipated by ARCH T2 note; adds `vitest.setup.ts` to `include` |
| Must-NOT-modify: `queryKeys.ts`, `ws.ts`, `filters/state.ts`, `filters/useFilters.ts`, `shared/metrics-contract.ts` | ✅ untouched | Confirmed via `git diff main...HEAD` — empty diffs on all five |

**Areas of Impact (M/H risk):** `charts/` foundation (M risk) — both regression-guard tests exist and currently pass (see test-coverage section for why that's not the same as them being effective). Bundle size (L risk) — `Chart.tsx` registers exactly `LineChart, BarChart, GridComponent, TooltipComponent, CanvasRenderer`, matching the bundle-hygiene checklist item verbatim.

**Scope & Decisions:** ✅ Respected — Dashboard mounts exactly one `ChartCard`; no other Dashboard sections or chart families added; no Sessions-page rendering added. Decisions A1–A5 all traceable in code.

### Findings Table

| # | Severity | File | Line | Issue | Recommendation |
|---|----------|------|------|-------|----------------|
| 1 | 🟡 Medium | `package.json` | 47-48, 58 | ARCH's Out-of-Scope and Change Footprint both state "no new dependency expected" (echarts is pre-existing). This PR adds three new devDependencies (`@testing-library/jest-dom`, `@testing-library/react`, `jsdom`) plus a fourth used-but-undeclared one (`@testing-library/user-event`, imported directly in `ChartCard.test.tsx:5` but absent from `package.json` — present only via `node_modules`/lockfile as a transitive dep of `storybook`). The first three are a legitimate, unavoidable consequence of the ARCH itself mandating jsdom-based RTL component tests for T2/T3 (a gap in the ARCH's dependency assumption, not developer overreach), so not a blocker — but `@testing-library/user-event` should be declared explicitly. | Add `@testing-library/user-event` as an explicit devDependency; if `storybook` drops or version-bumps that transitive dep, this test file currently breaks with no direct manifest signal why. |
| 2 | 💭 Low | `package-lock.json` | — | 543 lines added, all insertions (no removals) — consistent with adding the three new leaf devDependencies plus their own transitive trees, not unrelated churn. | No action beyond fixing #1 (declaring `user-event` explicitly would also make its lockfile entry direct rather than incidental). |

⚠️ **Manual:** Live-update acceptance criterion ("with Claude Code running a real session, the chart updates within a few seconds without reload") and Storybook visual states — both are ⚠️ Manual per the ARCH's own designated verification mode, not failures of this review.

---

## code-quality

Module boundaries from ARCH's Module Boundaries table were checked against every file — `Chart.tsx` never imports from `api/` or `filters/`; `timeseries.ts`/`units.ts` depend only on `shared/metrics-contract.ts` types; `ChartCard.tsx`'s imports stay within its allowed-dependency list; query keys are sourced from `qk.metrics`, never hand-rolled. No boundary violations found.

### Findings Table

| # | Severity | File | Line | Issue | Recommendation |
|---|----------|------|------|-------|----------------|
| 1 | 🟡 Medium | `client/src/charts/ChartCard.tsx` | 102–109 (consumed by `Chart.tsx` L51–58) | `handlePointClick` is a fresh closure every render (no `useCallback`), so `Chart`'s third `useEffect` (keyed on `onPointClick` identity) tears down and re-registers the ECharts `click` listener on *every* `ChartCard` render — including renders that don't touch `grain`/data (e.g. toggling `family`, which the code elsewhere carefully keeps render-only via the query `useMemo`'s deps). This is the same "control-only re-render shouldn't cause churn" concern the query-memo comment (L73-79) explicitly guards against, just not applied to the click handler. **Independently flagged by react-patterns (finding #2) and performance (finding #1) — counted once in the total.** | Wrap `handlePointClick` in `useCallback(..., [grain, navigate])` so `Chart`'s click-listener effect only re-subscribes when the drill-down target actually changes. |
| 2 | 🟡 Medium | `client/src/charts/ChartCard.tsx` | 116–127 vs 128–139 | The unit-toggle and family-toggle button groups are near-identical copy-pasted JSX (map over an array of values, render a `<button>` with the same `TOGGLE_CLASS`/`TOGGLE_ACTIVE_CLASS` pattern, differing only in data source and setter). `ChartCard` is documented as the foundation ~10 Phase 4 chart cards will build on, so this in-file duplication is likely to be copied again as more toggle-style controls are added. | Extract a small local `ToggleGroup<T>` helper (`options`, `value`, `onChange`) to collapse both blocks into one reusable piece within this file. |
| 3 | 💭 Low | `client/src/charts/ChartCard.tsx` | 28–29 vs `client/src/filters/FilterBar.tsx` | `TOGGLE_CLASS`/`TOGGLE_ACTIVE_CLASS` are byte-for-byte identical Tailwind class strings duplicated across `FilterBar.tsx` and `ChartCard.tsx`. Not yet at the 3+ occurrence DRY threshold, but exact duplication of a non-trivial style string across two files in the same client app is a natural candidate for a shared constant now that a second consumer exists, especially before Phase 4 adds more chart cards using the same toggle look. | Hoist to a small shared module (e.g. `client/src/ui/toggleStyles.ts`) imported by both `FilterBar.tsx` and `ChartCard.tsx`. |
| 4 | 💭 Low | `client/src/charts/ChartCard.tsx` | 124 | `{u === "$" ? "$" : u}` is a no-op ternary — when `u === "$"` it returns `"$"`, otherwise `u`; equivalent to `{u}` in all cases for the current `UNITS` array. Reads as leftover/confused code (possibly intended to show a different label for `$`, e.g. "Cost"). | Simplify to `{u}`, or if a distinct label was intended for `$`, implement that mapping explicitly. |

### Observations (non-blocking)

- `Chart.tsx` combines a type-only import and a namespace import from the same module (`echarts/core`) as two separate `import` statements (L3–4) — purely stylistic.
- `ChartCard.tsx`'s function body (control state → query → toolbar JSX) runs ~115 lines, over the ~40-line guideline, but it's flat JSX with no deep branching/nesting; a senior reviewer would likely let this pass given finding #2 already addresses the concrete duplication driving the length.

### Coverage Checklist

- [x] `client/src/charts/Chart.tsx` — dumb-wrapper boundary (no api/filters imports) ✅, lifecycle effect ordering (init before setOption/click) ✅, click-handler churn from caller ⚠️ (Finding #1), naming/readability ✅
- [x] `client/src/charts/ChartCard.tsx` — query memoization on serialized identity ✅, `qk.metrics` usage (not hand-rolled) ✅, exhaustive switch in `bucketEnd` ✅, toolbar JSX duplication ⚠️ (Finding #2), style-constant duplication vs `FilterBar.tsx` ⚠️ (Finding #3), redundant ternary ⚠️ (Finding #4), module-boundary imports ✅
- [x] `client/src/charts/timeseries.ts` — pure, no DOM/React ✅, depends only on shared contract + `units.ts` ✅, null-as-gap handling ✅, exhaustive family/unit handling ✅ → no issues
- [x] `client/src/charts/units.ts` — depends only on shared contract types ✅, cached `Intl.NumberFormat` instances (no per-call construction) ✅, exhaustive switch with never-check ✅ → no issues
- [x] `client/src/pages/Dashboard.tsx` — inline query logic fully removed (not duplicated) ✅, only imports `charts/ChartCard.tsx` + `pages/PageStub.tsx` per module boundary ✅ → no issues

---

## react-patterns

### Findings Table

| # | Severity | File | Line | Issue | Recommendation |
|---|----------|------|------|-------|----------------|
| 1 | 🟠 High | `client/src/charts/ChartCard.tsx` | 171–173 | `<Chart>` is only rendered when `data` is truthy: `{data && <Chart option={option} ... />}`. TanStack Query v5 does **not** retain previous `data` across a `queryKey` change unless `placeholderData: keepPreviousData` (or similar) is configured — the `useQuery` call at line 92-95 has no such option. So every query-affecting control change (`unit`, `grain`, `compare`, `smoothing`) or filter change to a not-yet-cached combination sets `data` back to `undefined` while refetching, which unmounts `<Chart>` entirely. That forces `Chart.tsx`'s mount effect (line 28-45) to `echarts.dispose()` and re-`echarts.init()` from scratch on the next render, instead of exercising the `setOption({notMerge: true})` update path the component was built for. Net effect: every grain/unit/compare/smoothing toggle blanks the visible chart to a "Loading…" message and pays a full re-init cost, rather than smoothly transitioning — the opposite of what a "live chart" control panel should feel like. | Add `placeholderData: keepPreviousData` (from `@tanstack/react-query`) to the `useQuery` call, and render `<Chart>` unconditionally (let `buildTimeseriesOption([], ...)` handle the empty/undefined case, which its own doc comment already says is safe: "never throws... empty `series` returns a valid option"). Reserve the `isPending`/`isError` UI for an overlay rather than a full replacement. |
| 2 | 🟡 Medium | `client/src/charts/ChartCard.tsx` | 102-109 (used at 172) | Same as code-quality Finding #1 / performance Finding #1 — `handlePointClick` recreated every render causes ECharts click-listener churn on every `ChartCard` render, including render-only `family` toggles. Not a correctness bug (closure is always fresh, no staleness), but undermines the "family changes are render-only" invariant the codebase otherwise preserves for the query layer. | `useCallback(handlePointClick, [grain, navigate])`. |

### Coverage Checklist

- [x] `client/src/charts/Chart.tsx` — hooks-rules ✅, init-once-per-mount ✅, resize handler calls `resize()` only (not `setOption`) ✅, `setOption` uses `{notMerge:true}` on option-prop change ✅, dispose+`observer.disconnect()` on unmount ✅, click-listener effect deps ✅ (no staleness, but see Finding #2 upstream) → no issues in this file itself
- [x] `client/src/charts/ChartCard.tsx` — hooks-rules ✅, query-memo deps correctly split (family excluded, unit/grain/compare/smoothing included) ✅, toolbar uses real `<button>`/`<select>` (a11y) ✅, click-handler stale-closure check ✅ (fresh every render, no staleness) but unstable-reference-as-prop ⚠️ (Finding #2), conditional Chart mount on `data` truthiness ⚠️ (Finding #1)
- [x] `client/src/pages/Dashboard.tsx` — trivial mount, no hooks/logic → no issues

### Observations (non-blocking)

- Toggle buttons (`unit`, `family`, `compare`, `smoothing`) don't set `aria-pressed` to reflect their active state — real `<button>` elements satisfy the interaction-correctness bar, but screen-reader users won't hear "pressed" state. Outside the "not a full a11y audit" scope, flagged as an observation only.
- `filtersToQuery(filters, new Date())` inside the query `useMemo` (ChartCard.tsx:85) bakes in a `now` timestamp at memo-recompute time; relative date ranges won't advance just from time passing, only when another dependency changes. Pre-existing behavior from the filters module (#P3-3), not introduced by this PR.

---

## test-coverage

Test isolation is solid across all three test files: `vi.clearAllMocks()`/`mockReset()` and `cleanup()`/`unstubAllGlobals()` run consistently in `beforeEach`/`afterEach`, `FakeResizeObserver.instances` is reset per test, and mocks are placed at the correct boundaries (`echarts/core` in `Chart.test.tsx`; `./Chart.js` + `../api/metrics.js` in `ChartCard.test.tsx`, leaving `wouter`, `@tanstack/react-query`, and `filters/` real) — no shared-mutable-state leakage found.

### Findings Table

| # | Severity | File | Line | Issue | Recommendation |
|---|----------|------|------|-------|----------------|
| 1 | 🟠 High | `client/src/charts/ChartCard.test.tsx` | 188-194 | The "stable filters+controls do not requery" regression guard never actually forces a re-render between its two `waitFor` calls — `renderCard()` is called once and both assertions check the same steady state after the initial fetch settles. This test would pass identically even if the `useMemo` guard in `ChartCard.tsx:80-90` were deleted entirely, because nothing in the test causes a second render pass. It doesn't guard the refetch-loop pitfall it's named for and documented against (ARCH line 461). | Force an actual extra render with the same props/filters, e.g. capture `rerender` from `render()` in `renderCard()` and call `rerender(<ChartCard title="Cost over time" defaultUnit="$" />)` after the first fetch settles, then assert `postMetricsMock` is still called exactly once. |
| 2 | 🟠 High | `client/src/charts/ChartCard.test.tsx` | 196-201 | "query key matches the shared factory exactly" is tautological: it takes the query object already captured from `postMetricsMock`'s `queryFn` argument and feeds it back into `qk.metrics`, then checks the identity `qk.metrics(x)` equals `["metrics", x]` — which is true for *any* `x` given `qk.metrics`'s implementation (`queryKeys.ts:18`, `(query) => ["metrics", query]`). It never inspects the actual `queryKey` TanStack Query used internally, so it would pass unchanged even if `ChartCard.tsx:93` used a hand-rolled key like `["metrics", query.measures]` instead of `qk.metrics(query)` — exactly the regression it claims to guard (ARCH line 462, "WS invalidation only reaches this query if the key shape matches exactly"). | Assert against the real cache key instead: return the `QueryClient` from `renderCard()`, then after the fetch settles do `const [entry] = queryClient.getQueryCache().getAll(); expect(entry.queryKey).toEqual(qk.metrics(sentQuery))` — this actually observes what `useQuery` registered, not a self-reference. |
| 3 | 🟡 Medium | `client/src/charts/Chart.test.tsx` | 97 | `expect(chartInstance.setOption).not.toHaveBeenCalledTimes(2)` is a weaker check than intended — it would silently pass if `resize()` triggered `setOption` a 3rd time or more (e.g. a future regression that calls `setOption` twice per resize). The test's real intent (per ARCH T2 "resizes on container resize": resize should call `chart.resize()`, not re-apply the option) is better captured by pinning the exact count. | Change to `expect(chartInstance.setOption).toHaveBeenCalledTimes(1)` to assert the option was applied only at mount and never again on resize. |

### Coverage Checklist

- [x] `timeseries.test.ts` — area/bars family ✅, null→gap ✅, empty series ✅, `compareGhost` distinct styling ✅ (loose name assertion, see observations), unit formatting ($/tokens/calls) ✅, unit→measure mapping ✅, multi-series label/dimensionKey preservation ✅ → all T1 scenarios present and meaningfully assert real `buildTimeseriesOption`/`formatUnitValue` output
- [x] `Chart.test.tsx` — init-once-on-mount ✅, `setOption(notMerge)` on mount+option-change ✅, click handler wired/omitted ✅, resize→`chart.resize()` ✅ (weak count assertion, Finding #3), dispose+observer-disconnect on unmount ✅ → all T2 scenarios present
- [x] `ChartCard.test.tsx` — loading/error/loaded ✅, unit/grain/compare/smoothing requery ✅, family render-only-no-refetch ✅, click-to-drill navigation ✅, regression guard "stable filters+controls" ⚠️ (Finding #1, vacuous), regression guard "query key matches factory" ⚠️ (Finding #2, tautological), range/filters fragment ✅

### Observations (non-blocking)

- `timeseries.test.ts:67` — the `compareGhost` test only asserts `ghost.name).not.toBe(input.label)`, not the actual expected name (`"Cost (previous period)"` per `timeseries.ts:56`). Satisfies ARCH's "distinguishable from the primary series" wording literally, but a tighter `toBe("Cost (previous period)")` would catch a naming-format regression the current assertion can't.
- No test in `timeseries.test.ts` covers a malformed/partial `Series` (e.g. `points: undefined` or a point missing `value`), and no test in `ChartCard.test.tsx` covers a rapid sequence of control toggles before the first fetch settles. Neither is an ARCH-listed scenario, so not a spec gap — just a cheap, high-value addition given T1's "tdd" mode and T3's foundational risk level.

**Note:** Findings #1 and #2 are the two tests the ARCH spec calls out by name as protecting against previously-documented failure modes (refetch loops, query-key drift) — as written, neither would actually fail if those regressions were reintroduced, which is the most consequential gap in this PR's test suite.

---

## performance

Guards verified correct: ResizeObserver calls `resize()` only (never `setOption`); query memoized on serialized/primitive identity (not fresh objects or `new Date()`); `echarts/core` subset-only imports (`LineChart`, `BarChart`, `GridComponent`, `TooltipComponent`, `CanvasRenderer` — repo-wide grep confirms no full `echarts` barrel or `echarts-for-react` import anywhere); dispose/disconnect correctly scoped to the empty-deps mount effect; TanStack dedup correctly handles same-key requests.

### Findings Table

| # | Severity | File | Line | Issue | Impact | Recommendation |
|---|----------|------|------|-------|--------|-----------------|
| 1 | 🟡 Medium | `client/src/charts/ChartCard.tsx:102-109` / `client/src/charts/Chart.tsx:51-58` | ChartCard 102, Chart 51 | Same as code-quality Finding #1 / react-patterns Finding #2 — `handlePointClick`'s unstable identity causes the ECharts `"click"` listener to be torn down and re-registered on every `ChartCard` render. | Currently ~5-6 pieces of state can trigger this per interaction; with more controls or a busier page (WS-driven refetches invalidating other queries and re-rendering this component) this becomes a steady stream of listener churn — not visually harmful but pure waste. | `useCallback(handlePointClick, [grain, navigate])`. |
| 2 | 🟡 Medium | `client/src/api/metrics.ts:5` (called from `client/src/charts/ChartCard.tsx:94`) | metrics.ts 5, ChartCard 94 | `queryFn: () => postMetrics(query)` ignores the `{ signal }` TanStack Query passes to every `queryFn`, and `postMetrics`'s `fetch()` call never receives an `AbortSignal`. When rapid control toggling changes the query key before the previous request resolves, TanStack Query abandons the old query client-side but the underlying `fetch` keeps running server-side and consumes a same-origin connection slot until it completes. | Old results are correctly discarded via key-based dedup, so this isn't a literal "pile-up," but under the browser's ~6-connection-per-origin limit, a burst of toggles can transiently starve the connection the *current* (wanted) request needs, adding visible latency to the chart the user is actually looking at. | Thread the query context through: `queryFn: ({ signal }) => postMetrics(query, signal)`, and pass `signal` into the `fetch(...)` call in `metrics.ts` so stale requests are aborted immediately on key change. |

### Observations (non-blocking)

- `Chart.tsx:48` — `chart.setOption(option, { notMerge: true })` forces a full rebuild (vs. merge) on every option change, more expensive than a merge-based update, but very likely intentional: with `notMerge: false`, shrinking the series array (e.g., toggling `compare` off, which removes the ghost-line series) would leave the old series lingering since ECharts merges by index rather than truncating. Flagging only as a documented trade-off, not a defect.
- `ChartCard.tsx:85` — `filtersToQuery(filters, new Date())` recomputes `now` only when the memo's listed deps change, which is correct for the memoization guarantee — noted only because it's adjacent to the memo logic under review, not a bug.

### Coverage Checklist

- [x] `client/src/charts/Chart.tsx` — ResizeObserver calls `resize()` only ✅, `echarts/core` subset-only import ✅, dispose/disconnect on unmount ✅, click-handler effect deps ⚠️ (Finding #1)
- [x] `client/src/charts/ChartCard.tsx` — query memoization identity ✅, rapid-toggle request handling ⚠️ (Finding #2), `handlePointClick` re-creation ⚠️ (Finding #1), `option` memoization deps ✅
- [x] `client/src/charts/timeseries.ts` — pure function, no loop/complexity issues ✅
- [x] `client/src/pages/Dashboard.tsx` — trivial composition, no issues ✅

---

## typescript-strictness

**Result:** ✅ No findings.

No `any`, unnecessary type assertions, non-null assertions, or `@ts-ignore`/`@ts-expect-error` found in any reviewed file. `tsconfig.json` diffed against `main`: the only change is adding `vitest.setup.ts` to `include` — no compiler-option changes, `strict: true` unchanged, no subpath-import type shim was needed (`echarts/core`/`echarts/charts`/`echarts/components` type-check cleanly under existing `NodeNext` resolution).

### Coverage Checklist

- [x] `client/src/charts/Chart.tsx` — no `any`, no assertions, no `!`, no ts-ignore; `ChartProps`/`echarts.use` typed via real ECharts types (`ECElementEvent`, `echarts.ECharts`) → no issues
- [x] `client/src/charts/Chart.test.tsx` — one `as unknown as ResizeObserver` (line 46) → see observations
- [x] `client/src/charts/ChartCard.tsx` — no `any`, no ts-ignore; one narrow assertion `e.target.value as Grain` (line 143) → see observations; exhaustive `never` check in `bucketEnd` ✅
- [x] `client/src/charts/ChartCard.test.tsx` — inline `as {...}` casts on mock call args and one `as never` (line 25) → test-file scope only, acceptable
- [x] `client/src/charts/timeseries.ts` — no `any`, typing via `ComposeOption`/`LineSeriesOption`/`BarSeriesOption` (legitimate for wrapping ECharts), explicit return types, exhaustive union handling for family → no issues
- [x] `client/src/charts/timeseries.test.ts` — `option.series as {...}[]` casts to narrow the `ComposeOption` union for assertions → acceptable (test-only)
- [x] `client/src/charts/units.ts` — exhaustive `never` check for `Unit` switch, `Record<Unit, Measure[]>` fully typed → no issues
- [x] `client/src/pages/Dashboard.tsx` — trivial wiring, fully typed via `ChartCardProps` → no issues
- [x] `client/tsconfig.json` — diffed against `main`, only `include` addition, no strictness weakening → no issues

### Observations (non-blocking)

- `ChartCard.tsx:143` — `onChange={(e) => setGrain(e.target.value as Grain)}`: a real cast from the native `string` of `HTMLSelectElement.value` to the `Grain` union. Safe in practice because the `<option>` values are rendered exclusively from the typed `GRAINS` array (line 18), so no out-of-union string can reach it today — but it's not statically enforced. A `GRAINS.find(g => g.value === e.target.value)` guard (or a small `isGrain` type guard) would close this without much ceremony. Minor hardening opportunity, not a live bug.
- `Chart.test.tsx:46` and `ChartCard.test.tsx:25` — `as unknown as ResizeObserver` and `as never` are both confined to test doubles standing in for objects the real code never fully implements (a partial `ResizeObserver` fake, a minimal `ECElementEvent` literal). Idiomatic test-double typing, not a strictness hole in shipped code.
- No exported component (`Chart`, `ChartCard`) has an explicit JSX return type annotation — consistent with the rest of the codebase's React convention, correctly inferred, not `any`.

---

## Manual Checks Required

- [ ] Live-update acceptance: with `npm run dev` open and a real Claude Code session running in a watched root, confirm the cost-over-time chart updates within a few seconds without a page reload (issue #31's go/no-go criterion)
- [ ] Storybook visual states for `Chart.stories.tsx` / `ChartCard.stories.tsx` (area, bars, ghost, empty, loading, error) render correctly
- [ ] Manual control sweep confirming toggle behavior once react-patterns Finding #1 is fixed (should go from flash-to-blank to a smooth transition)

## Prioritized Action Items

### Must Fix (🟠 High)
1. **`ChartCard.tsx:171-173`** — add `placeholderData: keepPreviousData` to the `useQuery` call and render `<Chart>` unconditionally, so control toggles update smoothly instead of unmounting/reinitializing the chart on every change.
2. **`ChartCard.test.tsx:188-194`** — make the "stable filters+controls do not requery" regression guard actually trigger a re-render (via `rerender`) and verify no extra fetch occurs.
3. **`ChartCard.test.tsx:196-201`** — make the "query key matches factory" regression guard inspect the real registered `queryKey` from the `QueryClient` cache, not a self-referential tautology.

### Should Address (🟡 Medium)
- `ChartCard.tsx:102-109` — wrap `handlePointClick` in `useCallback([grain, navigate])` to stop ECharts click-listener churn on every render (flagged independently by 3 reviewers — highest-consensus finding in this review).
- `api/metrics.ts:5` / `ChartCard.tsx:94` — thread `AbortSignal` through `postMetrics`/`queryFn` to cancel stale in-flight requests during rapid control toggling.
- `package.json` — declare `@testing-library/user-event` as an explicit devDependency instead of relying on it riding in transitively via `storybook`.
- `ChartCard.tsx:116-139` — extract a `ToggleGroup` helper to de-duplicate the unit/family button JSX (this file is the foundation ~10 Phase 4 chart cards will build on).
- `Chart.test.tsx:97` — pin the exact `setOption` call count (`toHaveBeenCalledTimes(1)`) instead of the weaker `.not.toHaveBeenCalledTimes(2)`.

### Nice to Have (💭 Low)
- Hoist `TOGGLE_CLASS`/`TOGGLE_ACTIVE_CLASS` to a shared module (`client/src/ui/toggleStyles.ts`) — now duplicated with `FilterBar.tsx`.
- Simplify the no-op ternary `{u === "$" ? "$" : u}` to `{u}` in `ChartCard.tsx:124`.
- Guard the `e.target.value as Grain` cast in `ChartCard.tsx:143` with a lookup against `GRAINS` rather than a bare assertion.
- Tighten the `compareGhost` test assertion in `timeseries.test.ts:67` to check the exact expected series name, not just inequality.
- Add edge-case tests for malformed `Series` input and rapid sequential control toggles (not ARCH-mandated, but cheap given T1's tdd mode and T3's foundational risk).
- Add `aria-pressed` to the toggle buttons in `ChartCard.tsx` to reflect active state for screen readers.

---

## Re-review Report

**Original report:** this document, 2026-07-16
**Findings addressed:** 12 of 12 (all Must Fix, Should Address, and Nice to Have items)

| # | Original Finding | Severity | Status | Notes |
|---|-------------------|----------|--------|-------|
| 1 | Chart unmounts/reinits on every control toggle (no `keepPreviousData`) | 🟠 High | ✅ Resolved | `ChartCard.tsx`: added `placeholderData: keepPreviousData` to `useQuery`; `<Chart>` now renders unconditionally (gated only on `!isPending`), with loading/error rendered as an overlay above it rather than replacing it |
| 2 | "Stable filters+controls do not requery" regression guard never re-renders | 🟠 High | ✅ Resolved | `ChartCard.test.tsx`: `renderCard()` now returns `rerenderUnchanged()`, which re-renders the identical element tree (same `queryClient`/`hook`/`searchHook`); the test now forces a genuine second render and asserts `postMetricsMock` is still called exactly once |
| 3 | "Query key matches factory" regression guard is tautological | 🟠 High | ✅ Resolved | `ChartCard.test.tsx`: now reads the actual registered key via `queryClient.getQueryCache().getAll()[0].queryKey` and compares it against `qk.metrics(sentQuery)`, instead of feeding the sent query back into `qk.metrics` and comparing it to itself |
| 4 | `handlePointClick` unstable identity churns the ECharts click listener | 🟡 Medium | ✅ Resolved | `ChartCard.tsx`: wrapped in `useCallback([grain, navigate])` |
| 5 | Missing `AbortSignal` threading — stale in-flight requests aren't cancelled | 🟡 Medium | ✅ Resolved | `api/metrics.ts`: `postMetrics` now accepts an optional `signal` and passes it to `fetch`; `ChartCard.tsx`'s `queryFn` forwards TanStack Query's `{ signal }` |
| 6 | `@testing-library/user-event` used but undeclared | 🟡 Medium | ✅ Resolved | `package.json`: added `"@testing-library/user-event": "^14.6.1"` as an explicit devDependency (matches the version already resolved in `package-lock.json`); `npm install` re-run to confirm no lockfile churn beyond making the existing transitive entry direct |
| 7 | Duplicated unit/family toggle-button JSX | 🟡 Medium | ✅ Resolved | `ChartCard.tsx`: extracted a local generic `ToggleGroup<T>` component; both button groups now render via `<ToggleGroup options={UNITS} .../>` and `<ToggleGroup options={FAMILIES} .../>` |
| 8 | `Chart.test.tsx` weak resize assertion (`.not.toHaveBeenCalledTimes(2)`) | 🟡 Medium | ✅ Resolved | Changed to `expect(chartInstance.setOption).toHaveBeenCalledTimes(1)`, pinning the exact count |
| 9 | `TOGGLE_CLASS`/`TOGGLE_ACTIVE_CLASS` duplicated across `FilterBar.tsx`/`ChartCard.tsx` | 💭 Low | ✅ Resolved | Hoisted to new `client/src/ui/toggleStyles.ts`, imported by both files; local copies removed |
| 10 | No-op ternary `{u === "$" ? "$" : u}` | 💭 Low | ✅ Resolved | Superseded by the `ToggleGroup` extraction (fix #7), which renders `{option}` directly |
| 11 | Unguarded `e.target.value as Grain` cast | 💭 Low | ✅ Resolved | Added an `isGrain` type guard; the `<select>`'s `onChange` now only calls `setGrain` when the value passes the guard, closing the unenforced-cast gap |
| 12 | Missing malformed-input / rapid-toggle edge case tests + loose `compareGhost` name assertion | 💭 Low | ✅ Resolved | `timeseries.test.ts`: added an empty-`points` malformed-input case and tightened the `compareGhost` assertion to check the exact expected name (`"Cost (previous period)"`) instead of just inequality; `ChartCard.test.tsx`: added a rapid unit+grain toggle test asserting the query settles on the last selection |

**Regressions introduced:** None found — full CI gate re-run after all fixes.

**Verification:**
```
npm run verify
  typecheck  ✅ clean (shared/server/client tsconfig)
  lint       ✅ Biome, 95 files, no issues
  format     ✅ Biome, 94 files, no issues
  test       ✅ 302/302 passing (300 pre-existing + 2 new edge-case tests added in this pass)
```

**Updated Verdict:** ✅ **PASS** — all Must Fix and Should Address findings resolved with passing tests; no regressions detected. Manual checks (live-update acceptance, Storybook visual states) remain outstanding as ⚠️ Manual per the original ARCH verification plan — unchanged by this re-review, not blockers.

---
*Generated by Review — 2026-07-16*
