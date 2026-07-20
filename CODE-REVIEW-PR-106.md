# Review Report

## Metadata

| Field | Value |
|-------|-------|
| **Review Mode** | PR #106 (general PR mode) |
| **Target** | https://github.com/foyzulkarim/claude-lens/pull/106 — feat(44): Report Card UI and live gate feeds |
| **Date** | 2026-07-20 |
| **Tech Stack** | TypeScript 7, React 19, Fastify 5, ECharts 6, wouter, TanStack Query, Vitest 4, Biome |
| **Checks Run** | code-quality, typescript-strictness, react-patterns, security, performance, async-patterns, runtime-behavior, error-handling, test-coverage, migration, accessibility, express-patterns (12) |
| **Checks Skipped** | task-completion (general mode; ARCH read for context only), config-dependencies (no `package.json` changes), database-patterns (no DB ops), documentation (no README/API changes) |
| **Files Changed** | 37 |
| **Lines Changed** | +2294 / -97 |
| **Bias Areas** | Cold-cache fleet cost · WS invalidation correctness · `SessionListItem` contract drift |

## Review Process

- [x] Preflight checks passed (gh authenticated, repo confirmed)
- [x] Diff gathered (37 files, 3071 lines)
- [x] Tech stack detected: TypeScript 7 / React 19 / Fastify 5 / ECharts 6 / wouter / TanStack Query / Vitest 4 / Biome
- [x] Context read (CLAUDE.md, PR description, ARCH-p4-12)
- [x] Triage proposed and developer confirmed (12-check scope, 3 bias areas)
- [x] 12 checks dispatched (sequentially)
- [x] Results collected and deduplicated
- [x] Report compiled
- [x] Verdict determined

## Verdict: ❌ REQUEST CHANGES

The PR ships a substantial and well-structured feature — five UI surfaces, a clean cache module, and an additive contract — but **four High-severity bugs break the load-bearing claims of the PR title ("Report Card UI and **live gate feeds**")**, and two new components ship without any unit tests. Once those are addressed, the rest of the findings should fit in a follow-up cycle.

**Top reasons for the verdict:**
1. **WS invalidation wiring is broken** — `qk.prefixes.gates` is registered with a comment claiming `session-updated` invalidates it, but `actionsForMessage("session-updated")` does not include a `gates` action. Report Card + Dashboard gate-failures serve stale data through their full `staleTime` windows.
2. **Lazy mount is the opposite of lazy** — `useInView` initializes `inView = true` by default, so `enabled: inView` in `ReportCard` is true on the first render. The E1/E2 filesystem check fires on every Session Detail open, defeating the explicit "off first paint" goal.
3. **The Projects cell ships as a hardcoded em-dash** — the `gatePassRate` column accessor is `cell: () => "—"`; the value lands on the row but the renderer discards it.
4. **No tests for two new live components** — `GatePassRatePanel.tsx` and the data-wrapper `ReportCard.tsx` have no unit tests. ARCH §Change Footprint lists both as required files.

### Finding Counts

| Category | 🔴 | 🟠 | 🟡 | 💭 | ⚠️ |
|----------|-----|-----|-----|-----|-----|
| code-quality | 0 | 3 | 4 | 1 | 0 |
| typescript-strictness | 0 | 0 | 1 | 3 | 0 |
| react-patterns | 0 | 2 | 1 | 3 | 0 |
| security | 0 | 0 | 0 | 5 | 0 |
| performance | 0 | 3 | 3 | 4 | 0 |
| async-patterns | 0 | 0 | 0 | 4 | 0 |
| runtime-behavior | 0 | 0 | 1 | 4 | 0 |
| error-handling | 0 | 1 | 3 | 4 | 2 |
| test-coverage | 2 | 4 | 6 | 8 | 0 |
| migration | 0 | 1 | 2 | 0 | 2 |
| accessibility | 0 | 0 | 3 | 1 | 2 |
| express-patterns | 0 | 0 | 3 | 4 | 0 |
| **Total** | **2** | **14** | **29** | **41** | **6** |

(Counts are pre-dedup; cross-cutting findings are merged in the detailed sections below.)

---

## Top Findings (Most-Severe First)

### 🔴 #1 — `GatePassRatePanel.tsx` ships without tests (test-coverage)

`client/src/pages/trends/GatePassRatePanel.tsx` is brand-new live code with zero unit coverage. ARCH §Change Footprint explicitly lists `GatePassRatePanel.test.tsx` ("Render assertions + measure-presence test") as a required file; `GatePassRateStub.test.tsx` was deleted without a replacement. The component has 4 render branches (loading / error / data-loaded / chart-missing) and one query contract (`measures: ["gatePassRate"]`, `grain: "week"`). The measure-presence contract is not pinned anywhere.

**Recommendation:** add `GatePassRatePanel.test.tsx` mirroring `RollingEfficiencyPanel.test.tsx`: stub `Chart`, mock `postMetrics`, assert (a) request shape `{measures: ["gatePassRate"], grain: "week"}`, (b) `role="status"` on loading, (c) `role="alert"` on error with message, (d) `<section data-testid="gate-pass-rate-panel">` on success. Also add `GatePassRatePanel.stories.tsx` with the `loading/empty/series/error` set.

### 🔴 #2 — `ReportCard.tsx` (data wrapper) ships without tests (test-coverage)

Only `ReportCardView.test.tsx` exists (presentational view). The fetch + `useInView` lazy-mount + `EmptyState` error branches in `ReportCard.tsx` are entirely uncovered — the four unique behaviors (`!inView` placeholder, `isPending`, `isError`, success) are exactly the five stories ARCH §Change Footprint + CLAUDE.md require. ARCH also lists `ReportCard.test.tsx` as a required file.

**Recommendation:** add `ReportCard.test.tsx` covering the four render states; mock `getGateReport` and `useInView`. Also add `ReportCard.stories.tsx` with `loading/passing/warn/failing/error/no-data` per CLAUDE.md.

---

### 🟠 #3 — WS invalidation wiring gap (code-quality, migration)

`client/src/api/queryKeys.ts:102-108` documents: *"The session-updated WS message invalidates this prefix on transcript append, the same way it does for sessions/sessions."* But `client/src/ws.ts`'s `actionsForMessage("session-updated")` returns `[metrics, session, turnInspectorSession, sessions]` — **no `gates` action**. `InvalidationAction` has no `gates` variant. The server-side cache IS evicted (via `app.ts:141-145`), but no client refetch is triggered.

Net effect: **Report Card (`staleTime: 5 min`) and Dashboard `gateFailures` feed (`staleTime: 60 s`) keep serving stale gate scores/severity after transcript appends through their entire `staleTime` window.** This is the central claim of the PR title.

**Recommendation:** wire a `{kind: "gates"}` action into `actionsForMessage("session-updated")` and add `case "gates"` to `applyInvalidationAction`. Add a unit test pinning the prefix invalidation.

### 🟠 #4 — `useInView` default `fallbackInView=true` defeats lazy mount (react-patterns, runtime-behavior)

`client/src/hooks/useInView.ts:25` initializes `useState(fallbackInView)` with default `true`. `ReportCard.tsx:25` calls `useInView({rootMargin: "200px"})` without overriding the second arg, so `inView` is `true` from the first render. `useQuery({enabled: inView})` in `ReportCard.tsx:30` is `true` on mount → the `/api/sessions/:id/gates` fetch (E1/E2 filesystem check) fires immediately on every Session Detail open, **before any scroll/visibility check**.

ARCH §Tech Choices: *"Lazy mount keeps the E1/E2 filesystem check off the first Session Detail paint."* The doc comment in `useInView.ts` correctly states the intent (fall back only when `IntersectionObserver` is unavailable); the implementation makes it unconditionally true.

**Recommendation:** change `useState(fallbackInView)` to `useState(false)`, then `setInView(true)` only when the observer fires intersecting OR `typeof IntersectionObserver === "undefined"`. Drop the `fallbackInView` parameter, or keep it only as the IO-unavailable seam.

### 🟠 #5 — Projects `gatePassRate` cell hardcodes `"—"` (code-quality, react-patterns, migration)

`client/src/pages/projects/EfficiencyTable.tsx:228-232` — `columnHelper.accessor("gatePassRate", {cell: () => "—"})`. The cell ignores `info.getValue()` and renders a hardcoded em-dash. `EfficiencyRow.gatePassRate` IS computed correctly via `avgGatePassRate(projectSeries)`, but the cell never reads it.

ARCH §Modified files says: *"Replace `gatePassRate: null` row default with live aggregate"*; §Tech Choices: *"Cell flips to live aggregate"*. As shipped, every row shows `"—"` regardless of the now-de-nulled `gatePassRate` engine output. This is the most visible user-facing defect — the Projects page appears unchanged despite a server-side de-null.

**Recommendation:** `cell: (info) => formatPercentFraction(info.getValue())` (mirroring the `cacheHitPct` cell at line 221). `formatPercentFraction` already handles `null`/non-finite input.

### 🟠 #6 — `collectGateSummaries` runs unconditionally + over full fleet (performance, express-patterns)

`server/routes/metrics.ts:303-306` — `collectGateSummaries` runs **on every `/api/metrics` POST**, with no check whether `parsed.measures` includes `"gatePassRate"`. Every non-gate query (costComputed / turns / etc.) now pays a fleet-wide batch lookup + cold-cache misses.

Compounding: the call passes `sessions.map((s) => s.sessionId)` — the **entire fleet**, even when the query filters down to a single project/week. The engine filters via `sessionMatchesGroup` AFTER the cache has paid for evaluating out-of-scope sessions.

`routes/sessions.ts` correctly uses `getSummariesBatch` over the visible page (`page`/`visiblePage`) — no per-row awaits; this PR's headline improvement. But `routes/metrics.ts` uses the batch shape over the wrong set.

**Recommendations:**
- Guard with `if (parsed.measures.includes("gatePassRate"))` (perf finding).
- Resolve summaries only for in-scope ids (push summary construction inside the engine, or have `routes/metrics.ts` apply the filter before calling the cache).

On a 10M-session fleet filtered to one project: ~10M engine evals per request vs. ~100.

### 🟠 #7 — `getSummariesBatch` has no concurrency cap (performance)

`server/cache/gates-cache.ts:178-196` fires `Promise.all` over every id with no chunking. ARCH OQ1 explicitly flags this as the 10M-row follow-up, but the PR ships the unbounded form. On a cold-cache first load with 10K+ sessions, this launches N concurrent `evaluateSessionGates` calls; each awaits `resolveThresholds()` + filesystem checks.

**Recommendation:** chunk via `p-limit`-style worker pool (~32 in-flight). Per-id single-flight stays; in-flight ceiling bounded. At 10M sessions cold: ~10M concurrent async fns queued; OOM risk.

### 🟠 #8 — `gateStatus?: string` should be `GateStatus` (code-quality, typescript-strictness, migration)

`shared/sessions-contract.ts:153, 205` — `SessionListItem.gateStatus` and `SessionPageItem.gateStatus` are typed `string?`. The server already produces a typed `GateStatus` (`"pass" | "warn" | "fail"` from `gateSummary.status`) but the contract drops the type at the row boundary. The API guard `isStringOrUndefined` accepts any string; a wire-shape drift (server returns `"warning"`, malformed JSON, version skew) would silently pass the guard. `AnomalyFeed.tsx:132` then does `s.gateStatus === "pass"` against an unchecked string — `=== "pass"` is just runtime equality, no exhaustiveness.

**Recommendation:** tighten to `gateStatus?: GateStatus`, add an `isGateStatus` guard. ARCH IR9 mandates no shape change in *this* PR, so this is a tracked follow-up — but worth filing.

---

### 🟠 #9 — `letterFromScore` magic thresholds duplicated across four surfaces (code-quality, react-patterns)

`client/src/pages/sessions/SessionBrowser.tsx:25-31`, `client/src/pages/dashboard/AnomalyFeed.tsx:106-112, 98-104` duplicate `letterFromScore(0.9/0.75/0.5/0.25)`. `LETTER_TO_STATUS` in `GateStatusBadge.tsx` and `LETTER_SEVERITY` in `AnomalyFeed` add two more letter→value maps.

The engine emits `scoreLetter` deliberately so the UI "doesn't have to re-bucket" (gates-contract.ts:69-71) — but the row projection strips it, forcing every consumer to re-bucket. If `gates.md` ever shifts the thresholds, four files must update in lockstep.

**Recommendation:** either expose `scoreLetter?: ScoreLetter` on the row types (the engine already has it on `GateReportSummary`), or extract a single `letterFromScore` helper to `shared/gates-contract.ts` and import from all four surfaces.

---

### 🟡 Mid-Priority Findings (selection)

The remaining 14 Medium findings cluster around correctness and consistency. The most actionable:

| # | Category | File | Issue |
|---|----------|------|-------|
| 10 | runtime-behavior / test-coverage | useInView deps array | `[options.rootMargin, options.root, options.threshold, options]` includes whole `options` object alongside its primitives; caller passes inline literal → observer tears down/recreates every render. Drop `options`. |
| 11 | error-handling | `gates-cache.ts` + `routes/sessions.ts` | `getSummariesBatch` rejects the whole batch on first per-id rejection. One bad session 500s the entire page. Either return per-id error map or document partial-failure contract. |
| 12 | error-handling | `ReportCard.tsx` | No retry affordance on error; CLAUDE.md says "EmptyState-style error **with retry**." `EmptyState` already accepts `action: {label, onClick}`. |
| 13 | error-handling | `AnomalyFeed.tsx` | `isLoading`/`isError` only check `sessionsQuery`; `gateFailuresQuery` errors are silent. Either broaden or merge. |
| 14 | error-handling / migration | `app.ts:141` vs `gates.ts:97-103` | Inconsistent error envelopes: gates route returns `{error, cause, sessionId}`, top-level handler returns `{error, cause}`. Drift on session-scoped failures. |
| 15 | migration / express-patterns | `app.ts:141-145` | ARCH §Migrations claims *"one-line `app.unregister`"* rollback. `broadcaster.subscribe` return value is discarded; no `app.unregister` exists. Rollback requires `git revert`. Either expose unsubscribe or correct the ARCH. |
| 16 | typescript-strictness | `measures.ts:122`, `engine.ts:147`, `routes/metrics.ts:119,158`, `routes/sessions.ts:238,309` | Inline `{score: number; status: string}` repeated across ~6 sites; widens `GateStatus` to `string`. Introduce `type GateSummaryLite = Pick<GateReportSummary, "score" \| "status">` in `shared/gates-cache-contract.ts`. |
| 17 | test-coverage | `measures.test.ts:667` | Outdated assertion — `gatePassRate returns null` is now factually wrong relative to the new `mean(score)` semantics. Add positive test with seeded summaries. |
| 18 | test-coverage | `gates-cache.test.ts:199-205` | Single-flight test asserts both awaited values have right `sessionId`, never counts threshold resolver calls. ARCH §Stress demands "engine hit exactly once." Use `thresholdCalls` counter. |
| 19 | test-coverage | (integration) | No WS-invalidation integration test. ARCH rates cache+WS as Risk=M. Add a stub-broadcaster integration test that primes cache, fires `session-updated`, asserts re-eval. |
| 20 | test-coverage | `shared/sessions-contract.test.ts` | No companion assertion that `gateStatus/gateScore` can be **populated** (ARCH contract-drift). The two tests should pin both absent and populated halves. |
| 21 | accessibility | `ReportCardView.tsx` | `AnomalyFeed` drills to `/sessions/:id#report-card` (line 138) but no element has `id="report-card"`. Browser can't scroll, focus never moves. Add `id="report-card"` + `tabIndex={-1}` + hash-focus effect. |
| 22 | accessibility | `SessionsFilters.tsx` | `GateStatusControl` Pass/Warn/Fail toggles apply only `TOGGLE_CLASS` — selected state exposed only via `aria-pressed`, no visible difference. Mirror `ViewToggle`'s `TOGGLE_ACTIVE_CLASS`. |
| 23 | accessibility | `GateStatusBadge.tsx` | Letter-mode SR announcement is just the bare grade ("A"/"F"). Add `aria-label="Score: F"` / `"Gate status: fail"`. |
| 24 | performance | `gates-cache.ts:134` | `Map<sessionId, Promise<...>>` unbounded except per-session WS invalidation. Mirror `analysis.ts` LRU cap (~50K) or add TTL. Out of scope per OQ1; file follow-up. |
| 25 | performance | `EfficiencyTable.tsx:117-159` | `deriveRows` calls `avgGatePassRate(projectSeries)` per project where `projectSeries = serieses.filter(...)` — O(M²) total. Group serieses by label once. At M=200: 4×200² ≈ 160K iterations. |
| 26 | code-quality | `EfficiencyTable.tsx:51-101` | 5 near-duplicate measure helpers (`safeDivide`, `sumMeasure`, `sumMeasurePrev`, `avgGatePassRate`, `lastBucketTimestamp`). Comment says "kept inline until a third panel needs it." With Trends gate-pass-rate + projects + models, third panel arrived. |
| 27 | code-quality | `state.ts:26-36, 121-145` | `SCATTER_PRESETS` declared twice (full triples vs. `ALLOWED_SCATTER_PRESET` Set). Same hazard for `ALLOWED_PAGE_SORT` / `PAGE_SORT_KEYS`. Derive both from single source. |
| 28 | react-patterns | `AnomalyFeed.tsx:268-279` | `detectedItems` returns `[]` early when `sessionsQuery.data` undefined → resolved gate-failure items blocked behind slower anomaly fetch. |
| 29 | react-patterns | `AnomalyFeed.tsx:281-282` | `gateFailuresQuery` errors silently swallowed. Same root cause as #13. |

---

### 💭 Low / Observations (selected; full list deferred)

- **security** (5 💭): multi-valued CSV filters have no array-length cap (project-wide); `sessionId` interpolated unencoded into client `href` in `AnomalyFeed.tsx:138` + `SessionBrowser.tsx:228,364` (ReportCardView encodes — codebase inconsistent); cache key length validation absent; getSummariesBatch all-or-nothing (same as #11).
- **async-patterns** (4 💭): `cache.delete(sessionId)` inside `evaluate()` `.catch` can race with new in-flight entries on WS invalidation; `response.json()` in `gates.ts:77` not wrapped (codebase convention but inconsistent); `getSummariesBatch` documents all-or-nothing but doesn't surface it; `useInView` deps (same as #10).
- **runtime-behavior** (4 💭): subscribe unsubscribe discarded (same as #15); cache `Map` unbounded (same as #24); `getSummariesBatch` closure fan-out.
- **error-handling** (4 💭): `console.error` in broadcaster instead of pino; `TagsCell` mutation has no `onError`; cache `.catch` rethrows raw error (loses sessionId at this seam).
- **express-patterns** (4 💭): `defaultResolveThresholds` swallows all errors (catch without parameter); sync-fire subscriber semantics documented but fragile for heavier future subscribers; partial-batch failure (same as #11); projection drops `scoreLetter`/`passCount`/`evaluatedAt` (fine until second measure needs them).

### ⚠️ Manual Checks

- **Error message leakage**: `app.setErrorHandler` returns `cause: err.message` directly. Engine messages may contain absolute paths (`~/.claude/<project>/CLAUDE.md`). Confirm no path-leaking code path; strip if needed.
- **No timeout on gate fetch**: E1/E2 fs check on cold cache can stall past TanStack's default backoff. Combined with no retry (#12), a slow load yields a perpetual "Loading…" until something fails.
- **`gatePassRate` null rendering**: engine returns `null` per bucket when no summaries; verify charts render gaps (not flat 0). Engine is correct; pin with a test against `series-math.ts`.
- **ECharts text equivalent**: `GatePassRatePanel`'s `ariaLabel="Gate pass rate per week"` duplicates the `<h2>` and exposes no data equivalent. SR users get only the title. Convention-wide gap (not new in this PR).
- **Toggle focus ring**: `TOGGLE_CLASS` relies on UA default outline. Confirm a visible focus ring exists globally.

---

## Manual Checks Required

- [ ] **WS invalidation wiring (#3)** — verify `actionsForMessage` actually invalidates `qk.prefixes.gates` end-to-end after the fix lands.
- [ ] **Lazy mount (#4)** — open a Session Detail with cold cache and DevTools open; confirm `/api/sessions/:id/gates` does NOT fire on initial paint, only after the section scrolls into view.
- [ ] **Projects cell (#5)** — visit the Projects page; confirm the `gatePassRate` column shows real percentages (not `—`) once seeded data exists.
- [ ] **Error path leakage (⚠️ Manual above)** — run `npm run dev`, force a 500, inspect the response body for absolute paths.
- [ ] **E1/E2 slow load (⚠️ Manual above)** — open a session with a deeply-imported CLAUDE.md under simulated slow I/O.
- [ ] **Run `npm run verify`** — confirm typecheck, lint, format, and the full test suite still pass after fixes (this PR's own verify run passed; verify nothing regressed).

---

## Prioritized Action Items

### Must Fix (🔴 Critical / 🟠 High — blocks merge)

1. **#3 — Wire `gates` invalidation action into `actionsForMessage` and `applyInvalidationAction`.** This is the central claim of the PR.
2. **#4 — Change `useInView` default to `false`; only set `true` on IntersectionObserver fire or IO-unavailable fallback.**
3. **#5 — Fix `EfficiencyTable.gatePassRate` cell to render the live value.**
4. **#1 — Add `GatePassRatePanel.test.tsx`.**
5. **#2 — Add `ReportCard.test.tsx` (data wrapper).**
6. **#6 — Guard `collectGateSummaries` on `parsed.measures.includes("gatePassRate")` AND resolve summaries only for in-scope session ids.**
7. **#7 — Add concurrency cap to `getSummariesBatch` (~32 in-flight).**
8. **#8 — Tighten `gateStatus` to `GateStatus` (or file as a tracked follow-up).**
9. **#9 — De-duplicate `letterFromScore` / consolidate letter maps.**
10. **#17 — Update `measures.test.ts:667` to assert non-null when summaries are seeded.**
11. **#18 — Strengthen `gates-cache.test.ts` single-flight test to count threshold resolver calls.**
12. **#19 — Add WS-invalidation integration test.**

### Should Address (🟡 Medium)

13. **#10 — Drop `options` from `useInView` deps.**
14. **#11 — Make `getSummariesBatch` partial-batch tolerant (return per-id error map or absorb).**
15. **#12 — Add retry affordance on `ReportCard` error.**
16. **#13 — Surface `gateFailuresQuery` errors in `AnomalyFeed`.**
17. **#14 — Make `routes/sessions.ts` + `routes/metrics.ts` mirror the gates-route error envelope (`{error, cause, sessionId}`).**
18. **#15 — Either expose the broadcaster unsubscribe or correct the ARCH §Migrations.**
19. **#16 — Extract `GateSummaryLite` type; kill inline `{score, status: string}`.**
20. **#20 — Add `SessionListItem`/`SessionPageItem` populated-fields test.**
21. **#21 — Add `id="report-card"` anchor target + focus effect.**
22. **#22 — Add `TOGGLE_ACTIVE_CLASS` to `GateStatusControl`.**
23. **#23 — Add `aria-label` to `GateStatusBadge` in letter mode.**
24. **#24 — Add LRU/TTL cap to `gatesCache` Map.**
25. **#25 — Index `serieses` by label in `EfficiencyTable.deriveRows`.**
26. **#26 — Extract `sumPoints` helper to `client/src/charts/series-math.ts`.**
27. **#27 — Derive `ALLOWED_SCATTER_PRESET` and `ALLOWED_PAGE_SORT` from single sources.**
28. **#28 — Compute `anomalyItems` and `gateItems` independently; merge without the early-return gate.**
29. **#29 — Surface `gateFailuresQuery` errors (same root cause as #13).**

### Nice to Have (💭 Low)

- **TypeScript-strictness** — drop two redundant `as` casts in `GateStatusBadge.tsx:36-37`; replace inline `import("…").GatesCache` in `routes/metrics.ts:16,65` with top-level `import type`.
- **Code-quality** — replace `as never` cast in `SessionBrowser.tsx:173-185` with `qk.sessionsPage(listParams)`; switch `isGateReport` literal-OR chain to a `Set<ScoreLetter>` check.
- **Runtime-behavior** — register an `onClose` hook that unsubscribes the broadcaster; tag the cache `.catch` re-throw with sessionId (`throw new Error(\`gates cache: ${sessionId}: ${err.message}\`, {cause: err})`).
- **Error-handling** — thread a logger into `createBroadcaster({logger})`; add `onError` to the `TagsCell` mutation.
- **Async-patterns** — wrap `gates.ts:77` `response.json()` in try/catch → typed `GatesApiError`.
- **Accessibility** — wrap `GateStatusControl` button row in `role="group" aria-label="Gate status"`; consider visually-hidden data table for `GatePassRatePanel` ECharts.

---

*Generated by Review — 2026-07-20*
