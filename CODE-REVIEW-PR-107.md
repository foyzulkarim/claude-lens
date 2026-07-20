# Review Report

## Metadata

| Field | Value |
|-------|-------|
| **Review Mode** | PR #107 (general) |
| **Target** | https://github.com/foyzulkarim/claude-lens/pull/107 — `feat/48/explore-page` → `main` |
| **Date** | 2026-07-20 |
| **Tech Stack** | TypeScript strict (shared/server/client/cypress tsconfigs), React 19, Fastify 5, wouter, TanStack Query v5, ECharts 6, Vitest, Cypress, Storybook, Biome, clsx |
| **Checks Run** | task-completion, code-quality, test-coverage, react-patterns, typescript-strictness, accessibility |
| **Checks Skipped** | performance (no heavy computation surface), security (no auth surface; URL-param parsing already validated), error-handling (folded into code-quality via `EmptyNameError` review), documentation (ARCH doc is the deliverable; no public API surface), config-dependencies (zero new deps), runtime-behavior (standard React lifecycle), async-patterns (TanStack Query owns cancellation), express-patterns (only `server/routes/views.ts` touched, 11 lines), database-patterns (no DB changes), migration (`pinned` is additive optional, back-compat handled) |
| **Files Changed** | 17 |
| **Lines Changed** | +2127 / −27 |

## Review Process

- [x] Preflight checks passed
- [x] Diff gathered (17 files, 2331 lines)
- [x] Tech stack detected
- [x] Context read (CLAUDE.md, PR body, ARCH doc, issue spec)
- [x] Triage proposed and developer confirmed (six checks)
- [x] Six checks dispatched sequentially (classifier unavailable for parallel dispatch)
- [x] Results collected and deduplicated (54 raw findings collapsed to 30 unique issues)
- [x] Report compiled
- [x] Verdict determined

## Verdict: ❌ FAIL

Three Critical findings block merge. The Explore page meets the page-contract *shape* (three binding sections render, automated suites pass), but the top-level acceptance criterion — *"any curated chart is reproducible as an Explore query"* — is not met because `Grain` has no effect (time dimension is excluded), and R4 drill-anywhere is entirely unimplemented (no chart point/bar/cell drill, no Cypress drill assertion). A silent-data-loss bug also makes the **branch chip invisible to scatter queries** at runtime due to a `gitBranch`/`branch` rename that the new helper forgot. Strong *scaffolding* and clean *layer boundaries* (the saved-view pin contract and the URL-state triad are particularly well done), but the page cannot ship as-is.

### Finding Counts

| Category | 🔴 | 🟠 | 🟡 | 💭 | ⚠️ |
|----------|-----|-----|-----|-----|-----|
| task-completion | 2 | 3 | 3 | 1 | 1 |
| code-quality | 0 | 1 | 5 | 5 | 0 |
| test-coverage | 0 | 3 | 4 | 0 | 0 |
| react-patterns | 0 | 1 | 1 | 3 | 0 |
| typescript-strictness | 1 | 1 | 2 | 3 | 0 |
| accessibility | 0 | 2 | 4 | 2 | 1 |
| **Total** | **3** | **11** | **19** | **14** | **2** |

## 🔴 Critical Findings

### C1 — `Grain` has no effect for any selectable dimension; "any curated chart reproducible" is unmet
- **Files:** `client/src/pages/explore/PivotBuilder.tsx:158`, `client/src/pages/explore/state.ts:252,264`
- **Source:** task-completion #1
- **What:** The Dimension `<select>` filters `time` out of its options (`d !== "time"`), but `parsePivotState` still accepts `xp.dim=time` and `buildPivotQuery` happily builds `dimensions: [state.dim]`. The metrics engine only time-buckets when `dimensions` includes `"time"` (`server/metrics/engine.ts:303-304`). **Every selectable dimension yields one aggregate point and Grain is decorative.** Time-plus-breakdown queries like model-mix-over-time cannot be constructed.
- **Fix:** Represent temporal bucketing independently from an optional breakdown dimension, producing `["time"]` or `["time", selectedDimension]`. Add tests that round-trip representative curated presets.

### C2 — Drill-anywhere (R4) entirely unimplemented
- **Files:** `client/src/pages/explore/PivotResult.tsx:132-187`, `cypress/e2e/explore.cy.ts:19-58`
- **Source:** task-completion #2, test-coverage #1
- **What:** No chart receives `onPointClick`; table cells are plain values; scatter points do not navigate to their session. Cypress contains no drill assertion. The Phase 4 standing rule *"one drill-link lands filtered"* and inferred requirement R4 are both unmet, even though the PR test plan checks the rule off.
- **Fix:** Add filtered Sessions links for series/bar/table/distribution slices and session-detail navigation for scatter points, preserving global filters. Add the required Cypress drill test.

### C3 — Branch chip silently ignored on scatter queries
- **Files:** `client/src/pages/explore/state.ts:281-291` (`filtersToStringCriteria`), assigned at `:244` to `sessionPopulation: SessionPopulationCriteria`; `server/metrics/session-population.ts:49` reads `criteria.branch`
- **Source:** typescript-strictness #1 (independently verified against `client/src/filters/state.ts:28,187`)
- **What:** `filtersToStringCriteria` returns `Partial<Record<Dimension, string[]>>` where `Dimension` includes `"gitBranch"`. The function does **not** remap `gitBranch → branch`. But `sessionPopulation` (read by `server/metrics/session-population.ts:49` as `criteria.branch`) expects the `branch` key. TS permits the assignment via weak-type compatibility (both `Partial<Record<...>>` all-optional shapes sharing several common keys). Runtime: any Explore scatter query with the branch chip set sends `sessionPopulation.gitBranch = [...]`; the engine reads `sessionPopulation.branch` and finds `undefined` → the filter is **silently dropped**. This is data loss for one of the four global chips, on the scatter mode that the page most prominently advertises.
- **Fix:** Either return `SessionPopulationCriteria` directly and remap `gitBranch → branch` in the helper, or drop the helper and mirror `client/src/pages/sessions/state.ts:456-472`'s `buildSessionPopulation` pattern.

## 🟠 High Findings

### H1 — `useStableNow` not used; preset ranges freeze at mount
- **Files:** `client/src/pages/explore/usePivotState.ts:52`
- **Source:** code-quality #1
- **What:** `filtersToQuery(filters, new Date())` runs inside `useMemo` with a fresh `Date` each call. Every other page that resolves filter ranges (CacheLab, Models, Sessions, Projects, dashboard `StatCardsRow`) goes through `useStableNow()` first — `client/src/pages/dashboard/useStableNow.ts:5-13` literally warns about this. **Preset ranges (`7d`/`30d`/`90d`) freeze at mount and never roll forward** — the dashboard's "rolling window" affordance is broken for the Explore page.
- **Fix:** Call `useStableNow()` and pass it to `filtersToQuery(filters, now)`; add `now` to the deps. Matches `CacheLab.tsx:36-37`.

### H2 — Dimension `<select>` excludes `"time"` but `state.dim="time"` is parseable
- **Files:** `client/src/pages/explore/PivotBuilder.tsx:158`, `state.ts` parse logic
- **Source:** react-patterns #1
- **What:** Companion to C1 from the UI side: when a saved-view URL contains `xp.dim=time`, the page renders a **controlled `<select>` whose `value` matches no `<option>`** — React logs the controlled-without-matching-option warning and the native select displays nothing selected.
- **Fix:** Either exclude `"time"` from `parsePivotState`'s `dimRaw` validation, or include `"time"` in the rendered options.

### H3 — Line and Area render identically
- **Files:** `client/src/pages/explore/PivotResult.tsx:132-140`
- **Source:** task-completion #3
- **What:** Both are passed to `buildTimeseriesOption` with `family: "area"`, which always adds `areaStyle`. A plain line chart is therefore not implemented — violates the five-chart page contract and ARCH A2.
- **Fix:** Add a real line rendering family (`"lines"`) or otherwise ensure Line omits the area fill. Pin the ECharts option shape in a unit test.

### H4 — Distribution mode doesn't render histogram or percentile markers
- **Files:** `client/src/pages/explore/PivotResult.tsx:153-206`, `PivotBuilder.tsx:198-219`
- **Source:** task-completion #3
- **What:** Distribution queries return series whose `points` arrays are empty, so the selected chart renders blank. `DistributionOverlay` only prints the histogram bucket count and three p50/p90/p99 values — never renders the returned histogram or markers. Distribution is also disabled for scatter, contradicting ARCH wording that it is orthogonal to chart type. R3 partially unmet.
- **Fix:** Render the returned histogram buckets and percentile markers using the existing distribution pattern, define behavior for every dimension group, and either support distribution with every chart type or reconcile the ARCH/spec before merge.

### H5 — Scatter Size picker has no visual effect
- **Files:** `client/src/pages/explore/PivotResult.tsx:180-187`, `client/src/charts/scatterOption.ts:23-29`
- **Source:** task-completion #4
- **What:** Selecting Size reaches the API and changes the heading, but `buildScatterOption` drops `point.size` and uses constant `symbolSize: 8` for every point. The picker is visually inert.
- **Fix:** Extend the scatter option builder to encode the requested size measure, with bounded scaling and coverage for sized and unsized points.

### H6 — Misleading JSDoc on `filtersToStringCriteria`
- **Files:** `client/src/pages/explore/state.ts:273-280`
- **Source:** typescript-strictness #2
- **What:** The doc claims the function "narrows ... down to `SessionPopulationCriteria`'s `string[]`-only fields" and "lets TypeScript prove the assignment without `as`". Neither claim is true — the function preserves Dimension keys (including `gitBranch`) and the assignment is permitted only by weak-type compatibility. The doc actively misleads readers (this is what hid C3).
- **Fix:** Update the comment to match the actual contract, and fix per C3.

### H7 — Save button accessible name doesn't contain visible label (WCAG 2.5.3)
- **Files:** `client/src/pages/explore/Explore.tsx:70-79`
- **Source:** accessibility #1
- **What:** Visible text is `★ Save view`; `aria-label="Save this view (pinned to dashboard)"`. Voice-control users saying "click Save view" won't match, and assistive tech announces a different name than sighted users see.
- **Fix:** Use `aria-label="Save view (pins to dashboard)"` (or move the parenthetical to a `title`).

### H8 — Focus lost after Delete (WCAG 2.4.3)
- **Files:** `client/src/pages/explore/SavedViewsGrid.tsx:88-107`
- **Source:** accessibility #2
- **What:** After Delete, the Delete `<button>` is unmounted; nothing moves focus, so keyboard users lose their place (focus falls back to `document.body`).
- **Fix:** Capture a ref to the sibling Open button (or the deleted tile's index) before mutating; on success move focus to the next/previous tile's Open button.

### H9 — Result success branches untested
- **Files:** `client/src/pages/explore/Explore.test.tsx:111-178`
- **Source:** test-coverage #2
- **What:** No test renders a non-empty series chart, table output, distribution statistics, or populated scatter result. Distribution is only tested as a builder toggle; the `seriesWithDist` branch and the missing-distribution fallback are not exercised. Most of `PivotResult`'s rendering logic is unprotected.
- **Fix:** Add tests for one successful data path per renderer, including a non-default distribution measure and scatter results with and without size.

### H10 — Saved-view coverage incomplete
- **Files:** `client/src/pages/explore/Explore.test.tsx:180-225`, `cypress/e2e/explore.cy.ts`
- **Source:** test-coverage #3
- **What:** Loading, error, explicit empty state, create failure, whitespace-only names, save-to-visible round-trip, opening a tile, and deleting a tile are untested. Cypress performs no saved-view round trip despite this being one of the three binding sections.
- **Fix:** Add the boundary scenarios and one user-level save/open journey.

### H11 — No drill test, no drill handler
- **Files:** `cypress/e2e/explore.cy.ts`, `client/src/pages/explore/PivotResult.tsx`
- **Source:** test-coverage #1 (and C2)
- **What:** Phase 4 DoD requires one drill link to land on filtered Sessions. The Cypress spec only checks section visibility and `xp.*` control changes. The result component exposes no drill target.
- **Fix:** Add a deterministic fixture-result test that clicks a visible drill control and asserts `/sessions` plus the exact slice and retained global filters.

## 🟡 Medium Findings

### M1 — Several measures rendered with incorrect units
- **Files:** `client/src/pages/explore/PivotResult.tsx:60-76, 211-219`
- **Source:** task-completion #6
- **What:** `cacheSavingsComputed` and `routingSavingsComputed` fall through to token formatting rather than currency; cache/gate percentages are formatted as token counts; all distribution percentiles are hard-coded to count formatting. A valid query can display the wrong unit.
- **Fix:** Map every `Measure` to one formatter and use the selected measure's formatter in distribution statistics.

### M2 — `setSize(undefined)` cannot clear a prior Size
- **Files:** `client/src/pages/explore/usePivotState.ts:74`
- **Source:** task-completion #7, test-coverage #5
- **What:** `{ ...state, ...(size ? { size } : {}) }` retains `state.size` when `size === undefined`. Choosing the blank Size option leaves `xp.size` and `sizeMeasure` stale. This weakens R1 permalink accuracy.
- **Fix:** Explicitly remove `size` when undefined (`if (size) { next.size = size } else { delete next.size }`); add a regression test that selects a size, clears it, and asserts both URL and query.

### M3 — Verification evidence incomplete vs ARCH plan
- **Files:** `client/src/pages/explore/PivotBuilder.stories.tsx:67-89`, `cypress/e2e/explore.cy.ts:20-57`
- **Source:** task-completion #8
- **What:** ARCH promises empty/with-data/loading/error/distribution/scatter Storybook states; the story file only covers six control configurations. Cypress asserts only shell visibility and toggles — no fixture-derived non-empty content, no save/pin behavior, no drill destination.
- **Fix:** Add result/saved-view stories for empty/data/loading/error. Strengthen Cypress to prove fixture content and the required filtered drill.

### M4 — `useStableNow` refactor + `useMemo` deps lie
- **Files:** `client/src/pages/explore/usePivotState.ts:49-62`
- **Source:** code-quality #12, react-patterns #3
- **What:** `useMemo` for `query` lists `[state, filters]` as deps, but `useFilters()` re-parses the URL on every render → fresh object every render → memo recomputes anyway. Cache provides no value.
- **Fix:** Either inline the call (memo of an object that lives for one render isn't earning the call) or `useMemo` upstream so the deps become meaningful.

### M5 — `EmptyNameError` reinvents a simpler pattern
- **Files:** `client/src/pages/explore/Explore.tsx:45-59, 97-104, 113-118`
- **Source:** code-quality #6, typescript-strictness #7
- **What:** The class + `Promise.reject` + `instanceof` filter is invented to distinguish "user cancelled prompt" from server errors. The sibling `SaveViewButton` in `client/src/filters/FilterBar.tsx:103-107` (just merged in #47 for `pinned`) handles the same case with a plain early-return before calling `mutate()`. The Explore version bypasses TanStack Query's natural lifecycle.
- **Fix:** Mirror `FilterBar.tsx`'s early-return pattern; drop the class, the `Promise.reject`, and the `instanceof` filter.

### M6 — Label maps duplicated across files
- **Files:** `client/src/pages/explore/PivotBuilder.tsx:33-58`, `client/src/pages/explore/PivotResult.tsx:34-59`, `client/src/pages/sessions/EfficiencyScatterCard.tsx:25-46`
- **Source:** code-quality #2, typescript-strictness #4
- **What:** `MEASURE_LABEL` and `SCATTER_MEASURE_LABEL` are defined verbatim in three sites. When a new `Measure` is added, all three literals must be updated together.
- **Fix:** Extract to `client/src/charts/measureLabels.ts` (or alongside `MEASURES` in `shared/metrics-contract.ts`) and import from all three callers.

### M7 — `DistributionEntity` lacks a shared runtime array
- **Files:** `shared/metrics-contract.ts`, `client/src/pages/explore/state.ts:45`, `client/src/pages/explore/PivotBuilder.tsx:233`
- **Source:** code-quality #3
- **What:** `DistributionEntity` is the only string-literal union in the contract without an `exhaustiveArray<T>()(...)` constant. `state.ts` privately does `new Set(["session", "turn", "call"])`, and `PivotBuilder` falls back to `Object.keys(ENTITY_LABEL) as DistributionEntity[]`. Two sources of truth.
- **Fix:** Add `DISTRIBUTION_ENTITIES = exhaustiveArray<DistributionEntity>()([...])` to the shared contract; drop both local copies.

### M8 — `unitForMeasure` placement
- **Files:** `client/src/pages/explore/PivotResult.tsx:61-78`
- **Source:** code-quality #4
- **What:** Forward `Measure → Unit` mapping belongs in `client/src/charts/units.ts` (which already owns the reverse `UNIT_MEASURES` and `formatUnitValue`). Any future caller that needs to format a measure by its unit shouldn't reinvent it.
- **Fix:** Move into `units.ts` and export.

### M9 — `summarize()` hardcodes `"xp."` prefix
- **Files:** `client/src/pages/explore/SavedViewsGrid.tsx:118-125`
- **Source:** code-quality #5
- **What:** Reads `params.get("xp.measure")` etc. as literal strings while `state.ts:35` exports `PIVOT_KEY_PREFIX` for exactly this. If the prefix ever changes, this silently breaks and no test catches it.
- **Fix:** Import `PIVOT_KEY_PREFIX` and concatenate, or expose a `summarizePivotSearch(search)` helper from `state.ts`.

### M10 — `(error as Error).message` repeated, cast assumes Error
- **Files:** `client/src/pages/explore/PivotResult.tsx:112, 169`; `SavedViewsGrid.tsx:52`; `Explore.tsx:102`
- **Source:** typescript-strictness #3
- **What:** TanStack Query v5 types `error` as `unknown`; the cast assumes `Error` without proving it. The dashboard pages already use `error instanceof Error ? error.message : "..."`.
- **Fix:** Replace each cast with the `instanceof` narrowing form (consistent with `StatCardsRow.tsx:373` / `RecentSessionCard.tsx:204`).

### M11 — Permalink codec lacks a full round-trip test
- **Files:** `client/src/pages/explore/state.test.ts:10-74`
- **Source:** test-coverage #4
- **What:** `parse(serialize(state)) === state` is never asserted for a fully populated state. The "unknown key" case uses `foo` plus a default-valued measure, not an unknown `xp.*` key. Partial non-default URLs and `mergePivotState` removal of every old/unknown `xp.*` key are not covered. The RTL test named "changes the URL key" only checks another metrics call, not the URL.
- **Fix:** Round-trip a state containing every non-default field including `size`; parse a single non-default key and assert defaults; cover invalid dim/chart/mode/entity/x/y/size; inspect `memory-location` history after a control click.

### M12 — `toMatchObject` assertions allow loose checks
- **Files:** `client/src/pages/explore/state.test.ts:79-100`
- **Source:** test-coverage #6
- **What:** `buildPivotQuery` assertions use partial `toMatchObject` checks; they pass with extra measures/dimensions, missing grain/range/filters/sessionPopulation, or stale `sizeMeasure`.
- **Fix:** Use exact assertions for series, distribution, scatter-with-size, and scatter-without-size including all fields and explicit presence/absence of `sizeMeasure`.

### M13 — Pinned `false` and explicit property absence not asserted
- **Files:** `server/routes/views.test.ts:78-85`
- **Source:** test-coverage #7
- **What:** The omission case asserts only `view.pinned` is `undefined`; it doesn't assert the property is absent or re-read the stored record. `pinned: false` persistence isn't tested.
- **Fix:** Assert `not.toHaveProperty("pinned")` on both POST and subsequent GET results; add a `pinned: false` POST→GET persistence case.

### M14 — Chart scatter→bar fallback relies on a comment invariant
- **Files:** `client/src/pages/explore/PivotResult.tsx:92`
- **Source:** react-patterns #2
- **What:** `const chart: ... = state.chart === "scatter" ? "bar" : state.chart;` silently coerces scatter into bar. If `buildPivotQuery`'s dispatch rules ever change (e.g. a fourth query mode without revisiting `PivotResult`'s narrowing), the page renders a bar chart instead of crashing, silently masking the bug.
- **Fix:** Make `buildPivotQuery` + `PivotResult` share a single dispatch helper so the narrowing is exhaustive; or replace the fallback with a runtime `throw` / `console.error`.

### M15 — `text-slate-400` fails WCAG AA on white at 10px
- **Files:** `client/src/pages/explore/PivotResult.tsx:204, 215`; `client/src/pages/explore/SavedViewsGrid.tsx:94`
- **Source:** accessibility #3
- **What:** Used for histogram summary, percentile labels, and per-tile pivot summary; reads at ~2.4–2.5:1 — below WCAG AA (4.5:1 for normal text).
- **Fix:** Bump to `text-slate-500`. ⚠️ Manual axe DevTools verification recommended against the rendered UI.

### M16 — Saved-view tile click target split
- **Files:** `client/src/pages/explore/SavedViewsGrid.tsx:86-110`
- **Source:** accessibility #4
- **What:** Sighted users see a continuous clickable card; keyboard users must Tab to the name-button explicitly, and the Delete button is a separate tab stop. Each tile occupies ≥ 2 tab stops.
- **Fix:** Either wrap the Open button around the summary (Delete remains a sibling) to make the card one tab stop, or document the two-action intent visually (a separator + visible "Open"/"View" label).

### M17 — Focus not moved to new tile after Save; no save announcement
- **Files:** `client/src/pages/explore/Explore.tsx:56-59, 70-79`
- **Source:** accessibility #5
- **What:** After save, focus stays on the Save button (which can scroll off-screen as the grid grows). No `aria-live` announcement of the save.
- **Fix:** Move focus to the new tile's Open button on success, and render a `role="status"` "View saved" notification.

### M18 — A11y ARIA state + keyboard nav untested
- **Files:** `client/src/pages/explore/Explore.test.tsx`, `cypress/e2e/explore.cy.ts`
- **Source:** accessibility #6
- **What:** Neither spec verifies `aria-pressed` on the segmented buttons, focus restoration after Delete, or keyboard-only activation. `aria-pressed` is an ARIA state, not a visual one — it belongs in RTL.
- **Fix:** In `Explore.test.tsx`, assert `toHaveAttribute("aria-pressed", "true")` after a click. Add one Cypress keyboard-only pass.

### M19 — Footprint stale; Explore delete is undocumented scope expansion
- **Files:** `specs/architecture/ARCH-explore-page.md:180-224`; `client/src/pages/explore/SavedViewsGrid.tsx:28-30, 65, 98-105`
- **Source:** task-completion #9
- **What:** Implementation split state into new files and added tests not reflected in the Change Footprint, while the listed `FilterBar.tsx` change did not occur. The Explore grid also added a Delete action even though the ARCH assigns saved-view management to Settings.
- **Fix:** Reconcile the footprint with the actual split and tests. Either document the Explore delete action or remove it to retain the intended list/open boundary.

## 💭 Low Findings

- **L1 — `summarizePivotSearch` field subset is display-only, no tests** — `SavedViewsGrid.tsx:118-125`. Cover with a small unit test alongside `state.test.ts`.
- **L2 — `Object.keys(ENTITY_LABEL)` ordering coupling** — `PivotBuilder.tsx:233`. Same fix as M7 — consume `DISTRIBUTION_ENTITIES`.
- **L3 — In-place `views.sort` mutation** — `SavedViewsGrid.tsx:34-37`. Use `[...views].sort(...)` or `views.toSorted(...)`.
- **L4 — Misleading "stops propagation" comment** — `SavedViewsGrid.tsx:83-85`. The Delete button is a sibling, not nested; the comment is incorrect.
- **L5 — ARCH shim-pattern wording is inaccurate** — `ARCH-explore-page.md:78` claims "Models/Trends/CacheLab pattern", but only `Models.tsx` is a shim; Trends and CacheLab are the page shells themselves. Reword to "Models pattern".
- **L6 — `resetPivot()` is declared but unused** — `usePivotState.ts:41, 76`. Either wire to a "Reset pivot" button or drop it.
- **L7 — `useCallback(commit)` chain broken by inline setters** — `usePivotState.ts:64-77`. The setters are fresh inline closures each render, defeating a future `React.memo(PivotBuilder)`. Pick one — match `useFilters`'s plain function declaration or wrap setters in `useCallback`.
- **L8 — Duplicate `useMutation` import** — `SavedViewsGrid.tsx:1, 6`. Lint will catch.
- **L9 — Dead defensive `Array.isArray` guard** — `state.ts:287`. After the cast, `values` is statically `(string | number)[]`. Remove or comment.
- **L10 — Comment density** — `state.ts` 22-line file header overlaps with per-function JSDoc. Taste call; could tighten ~20%.
- **L11 — Decorative `★` glyph** — `Explore.tsx:78` and `SavedViewsGrid.tsx:57`. Wrap in `<span aria-hidden="true">`. Project-wide convention worth aligning (FilterBar has a similar `☆`).
- **L12 — `<fieldset>` visible-label / aria-label mismatch** — `PivotBuilder.tsx:183-221`. The visible "Chart" / "Mode" span is not associated with the fieldset. Use `aria-labelledby` on the fieldset pointing to the span id.
- **L13 — `e.target.value as Measure` casts in `<select>` `onChange`** — multiple sites. Acceptable per project convention (matches `RANGE_PRESETS.has(value as RangePreset)` in `filters/state.ts:16`); flagging for completeness only.
- **L14 — `EmptyNameError` widens `useMutation` `TData`** — `Explore.tsx:48`. Either explicitly type the mutationFn return or extract the throw to a real `throw` site.

## ⚠️ Manual Checks

- [ ] **Visual sign-off vs `specs/pages/explore.html` on real data** — claimed in PR body but cannot be verified from code. Worth running the page locally with real transcripts, especially the hierarchy, the line-vs-area difference, the histogram/distribution rendering, and the saved-view layout. (`task-completion #10`)
- [ ] **Color contrast in rendered UI** — `text-slate-500` on white sits at the WCAG AA edge (~4.5:1). Borderline pass but worth re-verifying with axe DevTools in both light and dark themes. The Save button uses `TOGGLE_CLASS` whose contrast is also worth a manual check. (`accessibility #9`)

## Prioritized Action Items

### Must Fix (🔴 Critical / 🟠 High)

1. **C1** — Make `Grain` actually work (re-enable `time` dimension or restructure query shape to express temporal bucketing).
2. **C2 + H11** — Implement drill-anywhere on every chart type and table cell; add the Phase 4 drill assertion to the Cypress spec.
3. **C3 + H6** — Fix `filtersToStringCriteria` to return `SessionPopulationCriteria` (remap `gitBranch → branch`); update the misleading JSDoc.
4. **H1** — Wire `useStableNow()` into `usePivotState` so preset ranges roll.
5. **H2** — Reconcile the Dimension `<select>` options with what `parsePivotState` accepts.
6. **H3** — Make Line a real line (`family: "lines"` or equivalent) and pin in a test.
7. **H4** — Render the returned histogram + percentile markers; reconcile distribution-vs-scatter against the ARCH.
8. **H5** — Make `buildScatterOption` honor `point.size` with bounded scaling.
9. **H7** — Save button `aria-label` should contain the visible "Save view" text.
10. **H8** — Move focus after Delete (to next/previous tile).
11. **H9 + H10** — Add successful-data tests and saved-view boundary tests; Cypress should prove one fixture-derived value.
12. **M19** — Reconcile ARCH footprint and clarify whether Explore owns saved-view deletion.

### Should Address (🟡 Medium)

M1 (units), M2 (size clear), M3 (verification states), M4 (memo deps), M5 (EmptyNameError → early return), M6 (label extraction), M7 (DistributionEntity array), M8 (unitForMeasure placement), M9 (PIVOT_KEY_PREFIX), M10 (error narrowing), M11 (round-trip test), M12 (exact query assertions), M13 (pinned false/absent), M14 (chart narrowing), M15 (slate-400 contrast), M16 (tile click target), M17 (focus after save), M18 (a11y test coverage).

### Nice to Have (💭 Low)

L1–L14 — taste/style/duplication cleanups; fold into a follow-up PR.

---

*Generated by Review — 2026-07-20*
