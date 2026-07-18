# Review Report — Cache Lab Page (#41 / #P4-9)

## Metadata

| Field | Value |
|---|---|
| **Review Mode** | Pipeline — `specs/architecture/ARCH-cache-lab-page.md` (T1–T9) |
| **Target** | PR #91 — Branch `feat/41/cache-lab-page` vs `main` |
| **Date** | 2026-07-19 |
| **Tech Stack** | TypeScript (strict), Fastify, React + TanStack Query, ECharts (hand-rolled wrapper), Vitest, Cypress, Biome |
| **Checks Run** | task-completion, code-quality, typescript-strictness, security, performance, error-handling, react-patterns, accessibility, express-patterns |
| **Checks Skipped** | database-patterns (no DB), config-dependencies (no `package.json` change), documentation (one-line fixture-README addition only), migration (additive-only), async-patterns / runtime-behavior (folded into performance) |
| **Files Changed** | 36 |
| **Lines Changed** | +7225 / -57 |

## Review Process

- [x] Preflight checks passed
- [x] Diff gathered (36 files, 7225/-57 lines)
- [x] Tech stack detected: TS/Fastify/React/TanStack Query/ECharts/Vitest/Cypress/Biome
- [x] Context read: ARCH-cache-lab-page.md, issue #P4-9/#41, specs/context/41.md
- [x] Triage proposed and developer confirmed
- [x] 9 checks dispatched (2 hit a session-limit interruption mid-run and were resumed from transcript, not restarted)
- [x] Results collected and deduplicated
- [x] Report compiled
- [x] Verdict determined

## Verdict: ❌ FAIL

The classifier/analysis engine and route wiring are well-built (security and express-patterns checks came back clean, K2 precedence matches `gates.md` exactly, honest-nullability semantics are mostly right). But three things block merge as-is: **T6–T8's required Storybook state matrix doesn't exist at all** (an explicit Definition-of-Done item and acceptance criterion for three tasks), **the section-owned failure-isolation pattern the architecture promises isn't actually wired up** (a real `/api/cache-lab` outage would show "Loading…"/"No data" instead of an error in six sections), and **a genuine correctness bug in `pricingComplete`** (computed over the whole fleet instead of the scoped/filtered call set, so an unrelated unpriced model anywhere in history would incorrectly null out every economics panel). Accessibility also has a Critical (keyboard-unreachable chart drill-down) plus two related High findings. None of these require architectural rework — all are localized fixes.

### Finding Counts

| Category | 🔴 | 🟠 | 🟡 | 💭 | ⚠️ |
|---|---|---|---|---|---|
| Task Completion | 0 | 2 | 1 | 1 | 1 |
| Code Quality | 0 | 0 | 0 | 3 | 0 |
| TypeScript Strictness | 1 | 0 | 0 | 1 | 0 |
| Security | 0 | 0 | 0 | 0 | 0 |
| Performance | 1 | 0 | 1 | 0 | 0 |
| Error Handling / React Patterns (merged) | 0 | 1 | 1 | 1 | 0 |
| Accessibility | 1 | 2 | 1 | 1 | 0 |
| Express/Fastify Patterns | 0 | 0 | 0 | 0 | 0 |
| **Total** | **3** | **5** | **4** | **7** | **1** |

---

## Findings

### 🔴 Critical

**1. Unsafe double type assertion masks the route's error-response shape**
`server/routes/cache-lab.ts:114` — `return { error: parsed } as unknown as CacheLabAnalysis;` forces an `{ error: string }` object through a handler typed `Promise<CacheLabAnalysis>`. Any future code trusting the declared return type would treat the error object as a real analysis result and silently misbehave (e.g. destructuring `.economics` off `undefined`). *(typescript-strictness; express-patterns independently flagged the same line as a cosmetic type-cast but judged it runtime-harmless since Fastify serializes regardless of the TS annotation — the type-safety hole is still real for any caller that trusts the signature.)*
**Fix:** widen the handler's return type to `Promise<CacheLabAnalysis | { error: string }>`; no cast needed once the signature is honest.

**2. Chart drill-down is keyboard-unreachable**
`client/src/pages/cache-lab/HitRatePanel.tsx:133-144` — the line-chart's click-to-drill navigates via `onPointClick` on the ECharts canvas only. `Chart.tsx` correctly renders the canvas as a non-interactive `role="img"` div (out of tab order), so keyboard and screen-reader users have **no path at all** to this navigation — not degraded, absent. `ChartCard.tsx` already solved this exact problem elsewhere with a `DataTable` row wired to the identical `sessionsHrefForBucket` target. *(accessibility; WCAG 2.1.1 Keyboard)*
**Fix:** reuse `ChartCard.tsx`'s data-table toggle pattern here.

**3. `findCall` does a full linear scan per classified event**
`server/cache/analysis.ts:650, 792-797` — `findCall(input.calls, event)` re-scans the entire `calls` array for every spike event to re-find its originating `ApiCall`, i.e. O(events × calls). The code *already* builds a `Map<string, ApiCall>` two steps later (line 695-698) for the turn-index join — this earlier lookup just doesn't reuse it. This is the one pattern in the diff that actually threatens the ARCH's stated "<250ms for 100k calls" budget and degrades toward O(n²) as spike density grows. *(performance)*
**Fix:** build the `callIndexByUuid` map once before step 3 and reuse it in both places.

### 🟠 High

**4. Section-owned failure isolation isn't actually implemented**
`client/src/pages/CacheLab.tsx:63-91` passes only `analysis?.X ?? []`/`data` down to each panel — never `isError`/`error`. Since `data` is `undefined` both while loading and after a permanent fetch failure, six panels (`BustEconomicsPanel`, `MissAttributionPanel`, `TtlMixPanel`, `InvalidationGallery`, `BaselineWeightPanel`, `InvalidationCostPanel`, `ContextGrowthPanel`) can't distinguish "still loading" from "the query failed" from "genuinely zero results" — they render "Loading…" forever or a false empty-state ("No baseline samples in range.") during a real `/api/cache-lab` outage. Only the single page-level banner shows the real error. This directly contradicts the architecture's A11 decision ("a dedicated endpoint outage cannot erase generic fleet panels... each section renders its own... error state") and risks a false "everything's healthy" read during an actual failure. *(error-handling + react-patterns, independently found from different angles — react-patterns additionally notes `BaselineWeightPanel`/`InvalidationCostPanel` collapsing loading/empty causes a visible flicker on every normal page load, not just outages.)*
**Fix:** thread `isError`/`error` (or the whole query object) down to each panel so loading/empty/error render as three distinct states.

**5. Required Storybook state matrix does not exist**
`client/src/pages/cache-lab/CacheLab.stories.tsx` is listed as a New file in T6 and Modified in T7/T8's "Files Expected," is required by the issue's own Definition of Done ("Component states covered in Storybook (not Cypress)"), and is the explicit acceptance evidence for every T6/T7/T8 verification checklist item (populated/empty/loading/error/unknown/unpriced/net-negative states, responsive viewports). It is absent from the diff and the working tree. *(task-completion)*
**Fix:** add the stories file covering the state matrix the three UI-mode tasks require before this can be considered "ui-verified."

**6. `pricingComplete` scoped to the full fleet instead of the query's filtered/in-range calls**
`server/cache/analysis.ts:667, 799-804` — `computePricingComplete(input.calls, input.pricing)` runs over the entire unfiltered fleet, not the scoped call set used everywhere else in the analysis. ARCH explicitly requires "if any **scoped** model needed for an economic claim is unpriced, counterfactual and net fields are null" — as written, any historical/unpriced model anywhere in the fleet (even outside the requested date range or filtered out by project/model) would incorrectly null every economics panel for a fully-priced, in-scope result. No existing test exercises an out-of-scope unpriced model, so this gap isn't caught by the current suite. *(task-completion; performance independently flagged the same unscoped iteration as a minor efficiency note, which a scoping fix also resolves.)*
**Fix:** scope `computePricingComplete` to the same filtered/in-range call set as `computeEconomics`, and add a regression test with an out-of-scope unpriced model.

**7. Dead response-validation code kept alive via lint suppression**
`client/src/api/cacheLab.ts:52-131` — five type-guard helpers (`isFiniteOrNull`, `isFiniteNumberOrNull`, `isNonNegativeNumber`, `isStringOrUndefined`, `isStringArrayOrUndefined`) are defined, never called by `assertCacheLabAnalysis` (which only checks top-level key presence), and then explicitly `void`'d to silence the unused-variable lint. Two of the five are byte-for-byte identical. Net effect: the "response-shape guard" the code implies exists does no per-field validation — a malformed nested value (`NaN` bustLoss, wrong type) sails through to the panels. *(code-quality + typescript-strictness, same finding from both checks.)*
**Fix:** either wire the helpers into `assertCacheLabAnalysis` or delete them along with the `void` lines — don't ship dead code disguised as a safety net.

**8. Five chart panels have no data-table alternative to the canvas**
`HitRatePanel.tsx`, `BaselineWeightPanel.tsx`, `InvalidationCostPanel.tsx`, `ContextGrowthPanel.tsx` (+ HitRate's histogram view) render only a canvas with a static `aria-label` summary — no structured table twin of the underlying data, despite `ChartCard.tsx` already having a working `DataTable`/`showDataTable` reference implementation in this same codebase. This is exactly the "keyboard-operable data-table alternative" T6/T7's acceptance criteria call for. *(accessibility; WCAG 1.1.1)*

**9. Same five chart panels never announce chart updates**
Same files — switching line/histogram or trend/totals, or a filter-triggered refetch, is silent to screen-reader users. `ChartCard.tsx` already has a `role="status" aria-live="polite"` pattern for exactly this that these panels don't reuse. *(accessibility; WCAG 4.1.3)*

### 🟡 Medium

**10. `CacheMissAttribution` import kept alive via a dead type alias**
`server/cache/analysis.ts:959-961` — `type _AttributionRef = CacheMissAttribution;` exists solely to dodge the unused-import lint, same anti-pattern as Finding #7 in a different file. *(code-quality + typescript-strictness)* **Fix:** delete the import.

**11. `analyzeCacheLab` is oversized with the same filter predicate repeated 4-5 times**
`server/cache/analysis.ts:622-760` — one ~140-line function owns 9 distinct concerns inline, and `callInRange(c, fromMs, toMs) && callMatchesFilters(c, query.filters)` is re-evaluated as a fresh `.filter()` pass (fresh O(n) scan + allocation) in five separate places (ttlMix, baseline, economics, contextGrowth, session-nets). At 100k calls that's ~500k redundant comparisons plus 5 discarded arrays per request, on top of the readability cost. *(code-quality flagged the duplication/complexity angle; performance flagged the same code as a redundant-scan cost — merged.)* **Fix:** compute the scoped call array once and thread it into each `compute*` helper; split the 9 steps into named private functions.

**12. Gallery and context-curve caps are enforced by sort-then-slice, not bounded selection**
`buildGallery` (analysis.ts:462-477) and `computeContextGrowth` (analysis.ts:596-604) both fully sort the entire filtered population before slicing to the 50/24 cap — the ARCH note specifically asks to distinguish "bounded early" from "build-then-slice." Not quadratic, but scales with fleet size rather than the stated cap; `computeContextGrowth`'s comparator also recomputes each candidate's peak-token value on every comparison rather than once. *(performance)* **Fix:** lower priority than #3 — a partial/top-K selection (or at minimum precomputing peaks before sorting) would remove the redundant work.

**13. `useCacheLabAnalysis`'s query-key memo doesn't actually stabilize identity**
`client/src/pages/cache-lab/useCacheLabAnalysis.ts:49-59` — `useMemo` depends on the raw `filters` object, but `useFilters()` returns a new object reference every render regardless of URL change, so the memo is invalidated every render (TanStack still dedupes the actual request by hashed value, so this isn't a fetch-loop, just a wasted memo). Separately, a `filtersToQuery(...) as {...filters?: ...}` cast asserts `filters` can be `undefined` when the real return type never is, making the `!== undefined` branch always true and defeating the apparent intent of omitting empty filters. `CacheLab.tsx` solved the identical stale-identity problem one file away with a `serializeFilters`-derived key — this hook doesn't reuse that fix. *(react-patterns + typescript-strictness, same file/root cause from two angles)* **Fix:** depend on `serializeFilters(filters)` instead of the raw object; drop the cast and check `Object.keys(chipFilters).length > 0` instead.

**14. Page section order deviates from the binding spec**
`client/src/pages/CacheLab.tsx:73-89` — hit-rate chart is separated from `FleetOverview`'s hit-rate stat by the Bust/Attribution/TTL row (spec groups them as one leading section), and `InvalidationCostPanel` renders before `InvalidationGallery`, reversing spec §7's documented order. T8's checklist explicitly requires the approved hierarchy. *(task-completion)*

**15. 7 of 9 panel sections missing `aria-labelledby`**
Only `FleetOverview` and `BustEconomicsPanel` wire their `<h2>` to the enclosing `<section>` via `aria-labelledby`; the other seven (`MissAttributionPanel`, `TtlMixPanel`, `HitRatePanel`, `BaselineWeightPanel`, `InvalidationCostPanel`, `InvalidationGallery`, `ContextGrowthPanel`) don't, despite an otherwise identical shape. *(accessibility; WCAG 1.3.1)*

### 💭 Low

- **16.** `HitRatePanel.tsx:72-91` — `linePoints` is rebuilt unmemoized every render, defeating the two downstream `useMemo`s that depend on it. *(react-patterns)*
- **17.** Dead exports: `BustEconomicsPanelWithHook` (`BustEconomicsPanel.tsx:108-115`, zero callers, hardcodes `"day"` independent of the shared `GRAIN` constant) and `eventCount` (`chart-options.ts:254-256`, no callers). *(react-patterns + code-quality)*
- **18.** Duplicate/split import statement from `./classifier.js` in `server/cache/analysis.ts:40-41` — should be one statement. *(code-quality)*
- **19.** Inline dynamic type-only import (`import("../../../../shared/metrics-contract.js").Grain`) in `HitRatePanel.tsx:95` instead of a top-level `import type`. *(code-quality)*
- **20.** `InvalidationCostPanel.tsx:27-47` — three near-identical `.reduce` blocks duplicate the `sum(key)` helper `chart-options.ts` already has. *(code-quality)*
- **21.** `server/routes/cache-lab.ts:16` — `as Grain[]` cast is unnecessary; verified `tsc --noEmit` still passes without it. *(typescript-strictness)*
- **22.** `chart-options.ts:63-81` — tooltip `valueFormatter`'s two branches are identical (`String(value)` either way), so the hit-rate histogram tooltip shows an unlabeled raw count instead of "N sessions". *(accessibility)*
- **23.** `server/ingest/discovery.test.ts` was modified (transcript count 4→5) as a legitimate consequence of the new fixture, but isn't listed in any task's Files Expected or ARCH's Change Footprint. *(task-completion)*

### ⚠️ Manual

- **24.** T9's Cypress journey and the full `npm run verify && npm run build && npm run test:e2e` gate were not run in this review (only the targeted Vitest subset — 101/101 passing — was executed). Run the full gate before merge to close out T9's evidence requirement.

---

## Checks with no findings

- **Security** — no significant issues. Validated: no prompt/tool-content leakage in any response field, filter-key validation is a fixed enum (no prototype-pollution vector), no ReDoS surface, and validation test coverage matches the full rejection surface.
- **Express/Fastify Patterns** — route registration order, async-handler safety, and the runtime-pricing injection seam all correctly mirror the existing `metrics.ts` pattern.

## Manual Checks Required

- [ ] Run `npm run verify && npm run build && npm run test:e2e` (Finding #24)
- [ ] Manual visual sign-off against `specs/pages/cache-lab.html` (T8 requirement — not verifiable from static review)

## Prioritized Action Items

### Must Fix (🔴 Critical / 🟠 High)
1. Fix the unsafe type assertion in `cache-lab.ts:114` (#1)
2. Add keyboard access to the hit-rate chart drill-down (#2)
3. Fix the `findCall` linear scan (#3)
4. Wire real error/loading/empty states through to all Cache Lab panels (#4)
5. Add `CacheLab.stories.tsx` with the required state matrix (#5)
6. Scope `pricingComplete` to the filtered/in-range call set (#6)
7. Delete or wire in the dead response-validation helpers in `cacheLab.ts` (#7)
8. Add data-table alternatives (#8) and `aria-live` announcements (#9) to the five chart panels

### Should Address (🟡 Medium)
9–15. Dead type alias, `analyzeCacheLab` extraction/dedup, bounded top-K for gallery/context caps, stable query key in `useCacheLabAnalysis`, section order vs. spec §7, missing `aria-labelledby` on 7 sections

### Nice to Have (💭 Low)
16–23. Memoization nit, dead exports, import style, inline type import, reduce duplication, unnecessary cast, tooltip formatter, undocumented fixture-count test touch

---
*Generated by Review — 2026-07-19*
