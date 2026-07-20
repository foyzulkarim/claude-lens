# Review Report

## Metadata

| Field | Value |
|-------|-------|
| **Review Mode** | PR #105 (general mode invocation; ARCH present, treated as pipeline-source) |
| **Target** | https://github.com/foyzulkarim/claude-lens/pull/105 |
| **Date** | 2026-07-20 |
| **Tech Stack** | TypeScript (strict) · Fastify server · React + wouter + TanStack Query client · MiniSearch (new client dep) · Vitest + Storybook |
| **Checks Run** | task-completion, code-quality, react-patterns, typescript-strictness, error-handling, performance, security, accessibility |
| **Checks Skipped** | migration, test-coverage (spot-checked as part of task-completion), express-patterns (uses Fastify), database-patterns (no DB), config-dependencies (no new deps outside `minisearch` which is already pinned), documentation (no public surface to update) |
| **Files Changed** | 21 |
| **Lines Changed** | +1856 / -32 |

## Review Process

- [x] Preflight checks passed
- [x] Diff gathered (21 files, 2139 lines)
- [x] Tech stack detected: TypeScript strict · Fastify · React + wouter + TanStack Query · MiniSearch · Vitest · Storybook
- [x] Context read (CLAUDE.md, PR description, issue #35, ARCH-p4-3-search-index.md)
- [x] Triage proposed and developer confirmed
- [x] 8 checks dispatched (sequentially on developer request)
- [x] Results collected and deduplicated
- [x] Report compiled
- [x] Verdict determined

## Verdict: ❌ REQUEST CHANGES

Two critical correctness/perf defects and four high-severity gaps need to land before this PR can merge. The architecture is sound, the acceptance criteria are satisfied, the implementation follows the ARCH's eight design decisions closely, and the test surface is broad — but the response-shape guard is unsound, the per-keystroke search is doing ~2.5M string comparisons it doesn't need to, the `?q=` URL state is silently wiped on every sibling-card interaction (the PR's headline feature), and three defense-in-depth guarantees the ARCH explicitly contracts are missing in the shipping code.

### Finding Counts

| Category | 🔴 | 🟠 | 🟡 | 💭 | ⚠️ |
|----------|----|-----|-----|-----|-----|
| task-completion | 0 | 0 | 4 | 1 | 0 |
| code-quality | 0 | 1 | 3 | 5 | 0 |
| react-patterns | 0 | 0 | 2 | 5 | 0 |
| typescript-strictness | 1 | 0 | 0 | 1 | 0 |
| error-handling | 0 | 2 | 2 | 2 | 0 |
| performance | 1 | 0 | 0 | 3 | 1 |
| security | 0 | 0 | 0 | 1 | 0 |
| accessibility | 0 | 1 | 3 | 2 | 1 |
| **Total** | **2** | **4** | **14** | **20** | **2** |

---

## task-completion

**Verdict: PASS WITH FINDINGS** — all 5 IRs verified, both acceptance criteria satisfied, all 8 ARCH decisions followed. Five documentation/coverage gaps.

### Findings

| # | Sev | File:Line | Issue |
|---|-----|-----------|-------|
| TC-1 | 🟡 | `specs/architecture/ARCH-p4-3-search-index.md` row "Modified: `server/ingest/pipeline.ts`" | The ARCH table says A8's emit lives in `server/ingest/pipeline.ts`. The diff instead edits `server/store/store.ts`'s `onFlush` callback and `applyRecords` (lines 106-122, 218-225). Functionally equivalent — Store's invalidator hook is the same integration point — but the table row is now stale. |
| TC-2 | 🟡 | (missing test) | ARCH §Risks says: "new test asserts that BOTH messages fire when prompts are appended" as a regression-guard. No server-side test covers `Store.applyRecords + debounce-flush` → both `session-updated` and `session-prompts-changed`. A future refactor that removes `pendingPromptChanges` would not break any test. |
| TC-3 | 🟡 | (missing test) | ARCH §Risks says: "new test asserts `?q=hello&view=page&range=7d` survives a write" as a regression-guard for `Sessions.tsx` URL parsing. No round-trip test for `q` (or for any of the other `PAGE_QUERY_KEYS`). |
| TC-4 | 🟡 | (PR scope) | `specs/architecture/ARCH-p4-3-search-index.md` (378 lines) is included in the implementation PR diff. Per the project pipeline (CLAUDE.md: "Specs decide what, issues track what, start-time skills decide how"), the ARCH is a Phase 1 artifact and should land in its own PR before implementation. Pre-existing on this branch (committed in `49d3954`). |
| TC-5 | 💭 | (comment drift) | `client/src/pages/sessions/state.ts:276-279` comment claims `q` is "preserved across reloads via the pageOwnedKeys round-trip." The round-trip actually strips it (see CQ-1). The comment is misleading and should be reworded regardless of how the underlying bug is fixed. |

### Coverage Checklist

- [x] Both acceptance criteria traced to `PromptSearchPanel.tsx:128-156` (search-as-you-type) and `:158-163` (deep-link) + matching RTL test
- [x] IR1–IR7: every requirement verified at file:line
- [x] A1–A8: every decision verified (one footnote on file location; see TC-1)
- [x] Change Footprint: 18 of 19 rows present, 1 deviation (TC-1)
- [x] Regression-guard tests: route test, fetcher test, component test, WS-handler test, dedupe fix all present
- [x] Missing regression-guard tests: TC-2, TC-3

---

## code-quality

**Verdict: REQUEST CHANGES** — one High-severity interaction bug, three structural cleanups, five low-priority polish.

### Findings

| # | Sev | File:Line | Issue |
|---|-----|-----------|-------|
| CQ-1 | 🟠 | `client/src/pages/sessions/state.ts:164` + `Sessions.tsx:43-49` | **`?q=` is wiped on every sibling card interaction.** `PAGE_QUERY_KEYS` includes `"q"` (state.ts:164), so `onStateChange`'s `for (const key of pageOwnedKeys()) params.delete(key)` (Sessions.tsx:44) deletes `q` on every state mutation. `serializeSessionsPageState` doesn't output `q` (it's not in `state`), so any sibling update — sort, page, scatter preset, compare toggle, tag add, pagination — discards the search query and the panel's `useEffect[search]` resets the input. End-to-end this breaks the permalink story the PR explicitly promises. The comment at state.ts:276-279 is wrong (see TC-5). |
| CQ-2 | 🟡 | `server/store/build-search-snapshot.ts:59-72, 91-96` | Two-pass build + in-place `doc.id` mutation. Safe here (no external aliasing) but the "provisional — disambiguated by the dedupe pass below" comment at line 60 reads as if the temporary id has external meaning. Single-pass with a `Map<string, number>` and inline id assignment would be cleaner. |
| CQ-3 | 🟡 | `client/src/pages/sessions/PromptSearchPanel.stories.tsx:14-49` | `withFetch` and `withSearchAndUrl` are near-duplicate decorator factories — only differ on `searchPath`. Collapse to one `withFetch(impl, opts?: { search?: string })`. |
| CQ-4 | 🟡 | `PromptSearchPanel.test.tsx:13-47` vs `.stories.tsx:51-85` | Three near-identical fixtures (`SAMPLE_INDEX`, `SAMPLE_DOCS`/`POPULATED`, `EMPTY_INDEX`/`EMPTY`). Extract a `promptSearchFixtures.ts`. |
| CQ-5 | 💭 | `PromptSearchPanel.tsx:255-258` | `formatRelativeTime` uses bare `60_000`/`3_600_000`/`86_400_000` thresholds; name them `MS_PER_MINUTE`/`MS_PER_HOUR`/`MS_PER_DAY` to match the existing `SEARCH_DEBOUNCE_MS`/`RESULT_DISPLAY_CAP` convention. |
| CQ-6 | 💭 | `PromptSearchPanel.test.tsx:69, 172` | `const tree = (...) as ReactElement` is a no-op — the JSX is already a `ReactElement`. Drop the cast. |
| CQ-7 | 💭 | `PromptSearchPanel.tsx:165-225` | 60-line `renderResults` declared inside the component. Extract to a top-level pure function (smaller change) or four small components. |
| CQ-8 | 💭 | `PromptSearchPanel.tsx:119-126` | The `latestSearchRef` indirection is justified but easy to mis-edit. The "do NOT add `search` to deps" warning comment is in place; this is borderline-acceptable as-is. |

### Conventions cross-check

- `SearchIndexApiError` / `SearchIndexResponseShapeError` naming consistent with `SessionsApiError` / `CacheLabApiError` ✅
- Pure-function split for `buildSearchSnapshot` mirrors `server/cache/analysis.ts` ✅
- Section-card chrome on `PromptSearchPanel` matches siblings ✅
- Fetcher pattern mirrors `client/src/api/cacheLab.ts` ✅
- Exhaustive switch with `never` guard retained in `ws.ts` ✅

---

## react-patterns

**Verdict: PASS WITH FINDINGS** — no critical or high-severity issues. Five lower-priority findings, one a documented React anti-pattern, one a test-isolation gap masking a real coverage concern.

### Findings

| # | Sev | File:Line | Issue |
|---|-----|-----------|-------|
| RP-1 | 🟡 | `PromptSearchPanel.tsx:102-110` | URL→input effect (`useEffect(() => setInput(readQueryFromUrl(search)), [search])`) is the "derived state from prop" anti-pattern React docs explicitly recommend against. Two-pass render: render N renders with stale `input`, then effect commits render N+1. Switch to the "store previous prop in state" pattern with `prevSearch`/`setInput`. |
| RP-2 | 🟡 | `PromptSearchPanel.tsx:119-126` + `:82-94` | Debounced `input → URL` effect has a narrow race window when the user navigates within `SEARCH_DEBOUNCE_MS` of the last keystroke: the dep is `[input]`, so if `search` changes without `input` changing, the old timeout survives. Capture `latestSearchRef.current` at *schedule* time and bail when it differs at *fire* time, or switch the dep to `[search, input]`. |
| RP-3 | 💭 | `PromptSearchPanel.tsx:102-103` | `const initialQuery = useMemo(() => readQueryFromUrl(search), [search])` is dead weight — `useState` only consumes the initial value once. Replace with `useState<string>(() => readQueryFromUrl(search))` and drop the line. |
| RP-4 | 💭 | `PromptSearchPanel.tsx:92-93` | `window.dispatchEvent(new PopStateEvent("popstate"))` after `pushState` is redundant — wouter's `use-browser-location.js` monkey-patches `pushState` and listens for `pushstate`/`replacestate`. The explicit popstate is a project-wide pattern (Sessions.tsx:52-53 does the same); if intentional, document why. |
| RP-5 | 💭 | `PromptSearchPanel.test.tsx:159-191` | Deep-link test types "refactor" but only asserts `history.at(-1)` *after the click*. It never verifies that typing updated the URL via `useSearch()`. Worse: this assertion *cannot fail* in `memoryLocation` because the test setup only intercepts wouter's `navigateImplementation`, not real history events. The click *does* appear (goes through wouter's `useLocation()`), so the test passes while the typing→URL flow goes unverified. |
| RP-6 | 💭 | `PromptSearchPanel.tsx:148-155` | `prompts.find(p => p.id === r.id)` is O(N) per hit. MiniSearch's `storeFields` already stores every doc field, so the `r` result carries `sessionId`/`promptId`/`turnNumber`/`text`/`timestamp`/`cwd`/`gitBranch` directly. Build a `Map<string, PromptSearchDoc>` once inside the index memo and look up by `r.id`. (See also **PF-1**, which is the more urgent expression of this finding.) |
| RP-7 | 💭 | `PromptSearchPanel.tsx:119-120` | `latestSearchRef.current = search` runs on every render. Either move into a `useEffect` for clarity or remove if RP-2 is fixed. |

### Convention cross-check

- `useSearch()` / `useLocation()` / `memoryLocation` usage matches `Sessions.tsx`, `FilterBar`, `GlobalActionsBar`, `ChartCard.test.tsx` etc. ✅
- `data-testid="prompt-search-slot"` preserved intentionally — `Sessions.test.tsx` and `cypress/e2e/sessions.cy.ts` depend on it ✅

---

## typescript-strictness

**Verdict: REQUEST CHANGES** — the response-shape guard is *demonstrably* unsound and breaks the contract its `asserts` signature promises.

### Findings

| # | Sev | File:Line | Issue |
|---|-----|-----------|-------|
| TS-1 | 🔴 | `client/src/api/search.ts:66` | **`assertSearchIndexResponse` is unsound.** The function's signature promises `asserts value is SearchIndexResponse`, but the runtime check (a) does not establish that `v.prompts[0]` is a non-null object — `v.prompts[0] as Partial<PromptSearchDoc>` casts through `null` to a structural type, so a payload with `prompts: [null]` throws a raw `TypeError: Cannot read properties of null (reading 'id')` from line 73; and (b) only validates the first document — `prompts: [validDoc, { text: "bad" }]` passes the guard and then crashes `MiniSearch.addAll` with `MiniSearch: document does not have ID field "id"`. Optional `cwd`/`gitBranch` fields are also unchecked. **Reproduced directly in the agent's environment.** |
| TS-2 | 💭 | `client/src/pages/sessions/PromptSearchPanel.stories.tsx:95` | `new Promise<Response>(() => {}) as unknown as Promise<Response>` — the expression is already a `Promise<Response>`. Drop the chain. Same for the two `window.fetch = impl as typeof window.fetch` assignments (lines 17, 40) — typing `impl` as `typeof window.fetch` lets the assignment stand without a cast. |

### Confirmed failure scenarios

| Input | Current behavior | Expected behavior |
|-------|------------------|---------------------|
| `{ prompts: [null], version: 1 }` | `TypeError: Cannot read properties of null (reading 'id')` thrown from `assertSearchIndexResponse` | `SearchIndexResponseShapeError` thrown |
| `{ prompts: [validDoc, { text: "bad" }], version: 1 }` | Accepted as `SearchIndexResponse`; later crashes in `MiniSearch.addAll` with `MiniSearch: document does not have ID field "id"` | `SearchIndexResponseShapeError` thrown |

### Confirmed-safe strictness choices

- `value as Record<string, unknown>` — justified, follows a non-null object check
- `useQuery<SearchIndexResponse>` — not `any`; generic correct
- Explicit `any` — none in reviewed scope
- Non-null assertions (`!`) — none
- `@ts-ignore` / `@ts-expect-error` — none
- `qk.searchIndex()` and `qk.prefixes.searchIndex` — both infer `readonly ["search-index"]`
- WS union exhaustiveness — `SessionPromptsChanged` in union, `actionsForMessage` switch + `never` guard complete, `searchIndex` action covered by `actionKey` and `applyInvalidationAction`
- `MiniSearch<PromptSearchDoc>` — correct generic constraint
- `buildIndex(prompts: readonly PromptSearchDoc[])` — readonly respected (see PF-2)

### `as unknown as X` inventory (4 occurrences)

1. `client/src/ws.ts:52` — pre-existing native `WebSocket` → testable `WsLike` adapter
2. `client/src/ws.test.ts:105, 127` — pre-existing test-only fabrication of unknown future protocol variants
3. `client/src/pages/sessions/PromptSearchPanel.stories.tsx:95` — newly introduced, redundant (TS-2)

---

## error-handling

**Verdict: REQUEST CHANGES** — two High-severity defense-in-depth gaps. Both are explicitly contracted in the ARCH §Risks matrix and missing from the shipping code.

### Findings

| # | Sev | File:Line | Issue |
|---|-----|-----------|-------|
| EH-1 | 🟠 | `client/src/pages/sessions/PromptSearchPanel.tsx:135-138` | **Missing defensive `useMemo` try per ARCH §Risks.** ARCH-p4-3-search-index.md:335 says: *"Index fetch resolves but `MiniSearch` library throws on `addAll` (pathological input) — The component catches inside its `useMemo` and renders `EmptyState`. Defense-in-depth."* The shipped `useMemo` calls `buildIndex(prompts)` with no try/catch. If MiniSearch throws (e.g. on a doc with a non-string field from a future server shape), React unmounts the section to its nearest error boundary — except there isn't one on `/sessions`. Whole Sessions page composition goes down, not just the search panel. |
| EH-2 | 🟠 | `server/store/store.ts:428-439` | **`buildSearchSnapshot()` lacks per-session error handling.** The `Array.from(this.sessions.entries()).map(...)` iterates every session, calling `recompute()` synchronously on each dirty entry. `deriveTurns` and `deriveSession` both contain `unreachable:` invariant throws that fire on a single session's corrupted state. One bad session aborts the iteration, returns 500, and search is broken across the whole app even though all other sessions are healthy. |
| EH-3 | 🟡 | `client/src/api/search.ts:101-108` | **Server's `{ error, cause }` body — `cause` dropped on the wire.** The server's `setErrorHandler` returns `{ error, cause }`, but the fetcher only pulls `body.error`. When the server returns 500 with `{ error: "internal server error", cause: "SearchIndexResponse: missing required field 'prompts'" }`, the user sees the generic message. Append `cause` to the error message. |
| EH-4 | 🟡 | `server/routes/search.ts:28` + ARCH §Errors | **ARCH drift.** ARCH states the route handler "wraps `buildSearchSnapshot()` in try/catch and lets the existing top-level `setErrorHandler`... produce the documented `{ error, cause }` 500 shape." The shipped handler does not wrap. Fastify's `setErrorHandler` does catch async throws and produces the right shape — so behavior is correct — but the ARCH contract and the code disagree. Either add the documented try/catch (logged via `app.log.error`, returning the documented shape) or update the ARCH §Errors paragraph. |
| EH-5 | 💭 | `PromptSearchPanel.tsx:92-93` | `writeQueryToUrl` has no guard around `pushState` / `dispatchEvent`. `window.history.pushState` can throw in sandboxed iframes (`SecurityError`) or quota cases. Wrap in `try/catch` and no-op on throw. |
| EH-6 | 💭 | `server/store/store.ts:115-122` | Flush ordering: a prompt-specific emit throw blocks the generic `session-updated` for that session in this batch. Acceptable for an invalidation bus (next event supersedes a missed one), but worth noting. |

### Confirmed-safe error paths

- Fastify `setErrorHandler` covers route-handler throws and produces `{ error, cause }` (caveat in EH-4)
- `SearchIndexApiError` constructor invoked consistently
- `response.json().catch(() => null)` correctly degrades to statusText
- `EmptyState`'s `error.message` interpolates the typed error's message correctly
- `AbortError` from `fetch` propagates through TanStack Query as `isError`

---

## performance

**Verdict: REQUEST CHANGES** — one Critical finding contradicts the ARCH's own "<50ms per keystroke at 50K prompts" budget.

### Findings

| # | Sev | File:Line | Issue |
|---|-----|-----------|-------|
| PF-1 | 🔴 | `client/src/pages/sessions/PromptSearchPanel.tsx:152` | `prompts.find(p => p.id === r.id)` per result is O(hits × N) per keystroke. With `storeFields` already configured to store every doc field on the index, the `r` result already carries `sessionId`/`promptId`/`turnNumber`/`text`/`timestamp`/`cwd`/`gitBranch` directly. The `find()` is fully redundant. At 50K prompts and `RESULT_DISPLAY_CAP=50`, that's ~2.5M string comparisons per keystroke — eating roughly half of the ARCH §8 budget. **Fix:** `.map((r) => ({ doc: r as PromptSearchDoc, score: r.score }))` (single cast; the consumer only reads the fields that `storeFields` guaranteed to be present). |
| PF-2 | 💭 | `PromptSearchPanel.tsx:60` | `index.addAll([...prompts])` spreads a readonly array. MiniSearch's `addAll` is typed `addAll(documents: readonly T[]): void`, so the spread is pure overhead. Replace with `index.addAll(prompts)`. |
| PF-3 | 💭 | `PromptSearchPanel.tsx:140-156` | After PF-1, `prompts` is no longer used in the `hits` memo; drop it from the deps (`[index, input]`). |
| PF-4 | ℹ️ | `server/store/store.ts:427-441` | `buildSearchSnapshot()` synchronously recomputes every dirty session. Pre-existing `listSessions` JSDoc already flags the cap/paginate option. Informational only at today's scale. |
| PF-5 | ℹ️ | `client/src/api/search.ts:110` | `await response.json()` buffers the entire 10-20 MB payload before parsing. ARCH §5.4 acknowledges this. Streaming would be better but not required. |

### Verified-safe

- `buildSearchSnapshot` in-place `doc.id` mutation — safe (no aliasing; sort-before-dedupe makes ordinals stable across calls → byte-stable wire payload)
- URL write `setTimeout` churn — correctly bounded by cleanup
- URL read `useEffect` `[search]` — React bails out on primitive equality
- Index memory on unmount — GC'd when component unmounts; `staleTime: Infinity` retains payload (acceptable for SPA)
- `RESULT_DISPLAY_CAP` footer condition — verified correct (only shows when `data.prompts.length > 50 && hits.length === 50`)

---

## security

**Verdict: APPROVE** — no exploitable surface; one low-severity robustness gap that overlaps with TS-1.

### Findings

| # | Sev | File:Line | Issue |
|---|-----|-----------|-------|
| SE-1 | 💭 | `client/src/api/search.ts:66-80` + `PromptSearchPanel.tsx:135-138` | `assertSearchIndexResponse` spot-checks only `v.prompts[0]`; the build-side comment (search.ts:63) explicitly defers recursive validation. The matching `useMemo` in `PromptSearchPanel.tsx:135-138` does not wrap `buildIndex` in a try/catch (EH-1), so a malformed `v.prompts[1..]` propagates as an uncaught React render error. Loopback-only server reduces this to "server bug surfaces as full-page crash" rather than "attacker poisons payload" — but the ARCH intent was for the guard to be defensive, and the in-component try is the documented pairing that's missing. |

### Verified-safe (per ARCH claims + protocol checklist)

| Item | Status |
|------|--------|
| Prompt text exposure | ✅ Same content already crosses via `Store.getSessionSnapshot.prompts[]` (session-detail.ts:39) — no new surface |
| WS `SessionPromptsChanged.sessionId` is unused on client | ✅ `client/src/ws.ts:117` only emits `[{ kind: "searchIndex" }]`; the index is global, per-session invalidation isn't useful |
| `encodeURIComponent(hit.doc.sessionId)` deep-link | ✅ `PromptSearchPanel.tsx:160`. `sessionId` is server-sourced from `~/.claude/projects/**/*.jsonl`, never user-controllable |
| `turnNumber` deep-link type | ✅ `number` in contract (shared/search-index-contract.ts:36) |
| `writeQueryToUrl` user input → URL | ✅ `URLSearchParams.toString()` escapes; React JSX text auto-escapes |
| `response.json().catch(() => null)` | ✅ Feeds into `assertSearchIndexResponse` (defense in depth) |
| Loopback-only binding | ✅ `cli.ts:103` calls `app.listen({ port, host: "127.0.0.1" })` |
| No new filesystem reads | ✅ |
| No new secrets / env vars | ✅ |
| WS origin guard | ✅ `app.ts:180-189` `isAllowedOrigin` covers the new union member |

### Manual / informational

- No CORS, no rate limiting — matches existing routes; would matter only if loopback-only contract is ever relaxed
- `version` field tampering — loopback-only means no real attacker model

---

## accessibility

**Verdict: REQUEST CHANGES** — one High-severity issue (silent state changes for screen-reader users), three Medium ARIA/UX gaps, two Low polish items, one Manual contrast check.

### Findings

| # | Sev | File:Line | Issue |
|---|-----|-----------|-------|
| A-1 | 🟠 | `PromptSearchPanel.tsx:165-225` | **No `aria-live` for state changes.** `renderResults()` swaps between loading / error / empty / idle / no-match / list branches, none announced. `EmptyState` renders `<p>`/`<div>` with no role. Project conventions: `SessionDetail.tsx` uses `role="status" aria-live="polite"` for loading and `role="alert"` for errors; `ChartCard.tsx` uses `aria-live="polite" aria-atomic="true" class="sr-only"`. Wrap the conditional return in a container with `role="status" aria-live="polite" aria-atomic="true"` (or extend `EmptyState` to accept a `role` prop and apply at call sites). |
| A-2 | 🟡 | `PromptSearchPanel.tsx:189-217` | Tab is the only keyboard path through the result list — at `RESULT_DISPLAY_CAP=50`, up to 51 Tab stops to reach the next interactive element. No arrow-key support, no `aria-activedescendant`, no roving tabindex. The project implements roving-tabindex in `LeaderboardsCard.tsx:199-214` — a deviation from the established pattern, not a project-wide decision. |
| A-3 | 🟡 | `PromptSearchPanel.tsx:233, 239` | The visible `<h2>Search prompts</h2>` and the input's `aria-label="Search prompts"` duplicate each other and can drift independently. Give the `<h2>` an `id` (`prompt-search-heading`), use `aria-labelledby="prompt-search-heading"` on the input, drop the redundant `aria-label`. |
| A-4 | 🟡 | `PromptSearchPanel.tsx:158-163` | `handleResultClick` calls `navigate(...)` and stops — focus is left on the unmounted `<button>`. Destination `SessionDetail` renders its own tree, but nothing moves focus to the new `<h1>`. Keyboard users land on `<body>` (or browser-restored focus). Add a `tabIndex={-1}` on the destination heading and `useEffect(() => headingRef.current?.focus(), [data])`. Worth either fixing here or documenting as a project-wide convention. |
| A-5 | 💭 | `PromptSearchPanel.tsx:234` | `<input type="search">` ships a native "clear" affordance in WebKit/Blink that does NOT round-trip through React state — clicking it leaves `input` out of sync with the URL. Either swap to `<input type="text" role="searchbox">` and provide an explicit `aria-label="Clear search"` button, or document the quirk in the component header. |
| A-6 | ⚠️ | `PromptSearchPanel.tsx:241` | Placeholder colors AA-failing for normal text: `placeholder:text-slate-400` (#94a3b8) on white ≈ 3.3:1, `dark:placeholder:text-[#5A6677]` on `#0B0F14` ≈ 3.3:1. WCAG 1.4.3 explicitly exempts placeholders, so this is informational — but verify with axe-core / Lighthouse in both themes. |
| A-7 | 💭 | `PromptSearchPanel.test.tsx` (whole file) | The keyboard interaction layer added by A-1, A-2, A-4 has zero test coverage. Existing tests use `user.click(...)` and `user.type(...)` only — no `user.keyboard(...)` for ArrowDown/Enter/Escape, no `getByRole('status')` / `getByRole('alert')` queries to verify live-region wiring. |

### Verified-safe

- Section/heading/result list semantic structure ✅
- Result-row color contrast (≈5.8:1 dark, ≈4.7:1 light — passes AA) ✅
- `<button type="button">` semantics ✅
- `<ul>`/`<li>`/`<button>` is correct for a deep-link widget; listbox/option combobox would actually be wrong here (combobox is for "select a value", not "navigate to detail") ✅
- `title` on truncated metadata provides native tooltip ✅

---

## Manual Checks Required

- [ ] A-6 — Placeholder color contrast verification via axe-core / Lighthouse in both themes
- [ ] `npm run verify` — confirm the latest local run covers all the new tests (PR body says 1376 tests green; re-run after fixes land)

## Prioritized Action Items

### Must Fix (🔴 Critical / 🟠 High)

1. **TS-1** — Make `assertSearchIndexResponse` sound: validate every doc, handle `null` elements, validate optional `cwd`/`gitBranch` types. Add adversarial tests.
2. **PF-1** — Drop the redundant `prompts.find()` in `PromptSearchPanel.tsx:152`. The `r` result already carries every doc field via `storeFields`. Use `r as PromptSearchDoc` directly. (This also lets `prompts` drop from the `hits` memo deps.)
3. **CQ-1 / TC-5** — Fix the `?q=` wipe. Easiest: remove `"q"` from `PAGE_QUERY_KEYS` so the `onStateChange` strip step leaves it alone, and reword the misleading comment in `state.ts:276-279`. Add a round-trip test for `?q=hello&view=page&range=7d` (TC-3).
4. **EH-1** — Add a `try/catch` around `buildIndex(prompts)` in the `useMemo` and surface the error as `<EmptyState>`. ARCH §Risks:335 explicitly contracts this.
5. **EH-2** — Wrap each `(sessionId, state) =>` map body in `store.buildSearchSnapshot()` in `try/catch`, log+skip on throw, `filter(Boolean)` after. One bad session must not take down the entire search panel.
6. **A-1** — Wrap the `renderResults()` conditional return in a container with `role="status" aria-live="polite" aria-atomic="true"` (or extend `EmptyState` to accept a `role` prop and apply at the call sites).

### Should Address (🟡 Medium)

7. **TC-2** — Add a server-side test asserting `applyRecords` + debounce-flush produces both `session-updated` and `session-prompts-changed` (and that `applyRecords` with empty prompts produces only `session-updated`).
8. **TC-4** — If the team accepts bundling Phase 1 ARCH into the impl PR, the precedent is set; otherwise split the ARCH into its own commit/PR.
9. **TC-1** — Update ARCH §Change Footprint to record that the A8 emit moved from `server/ingest/pipeline.ts` to `server/store/store.ts`'s `onFlush`. No code change needed.
10. **CQ-2** — Single-pass the `buildSearchSnapshot` build: while building docs, write the final disambiguated id inline using a `Map<string, number>`.
11. **CQ-3** — Collapse `withFetch` and `withSearchAndUrl` into one decorator.
12. **CQ-4** — Extract a shared `promptSearchFixtures.ts` for `SAMPLE_INDEX` / `EMPTY_INDEX` / `makeDoc()`.
13. **RP-1** — Replace the URL→input effect with the "store previous prop in state" pattern; drop the dead `useMemo` on `initialQuery` (RP-3).
14. **RP-2** — Either capture `latestSearchRef.current` at schedule time and bail when it differs at fire time, or switch the dep to `[search, input]`.
15. **EH-3** — Pull `body.cause` into the error message on the client.
16. **EH-4** — Reconcile the route-handler try/catch contract between ARCH §Errors and `server/routes/search.ts`. Either add the wrap (logged via `app.log.error`, returning `{ error, cause }`) or update the ARCH.
17. **A-2** — Adopt the project's roving-tabindex pattern for result-list keyboard navigation (`LeaderboardsCard.tsx:199-214` precedent).
18. **A-3** — Use `aria-labelledby` on the input instead of the duplicate `aria-label`.
19. **A-4** — Move focus to the destination page's top heading on deep-link click. Either fix here or document as a project-wide convention.

### Nice to Have (💭 Low)

20. **CQ-5** — Name the bare numeric constants in `formatRelativeTime`.
21. **CQ-6** — Drop the `as ReactElement` no-op cast in tests.
22. **CQ-7** — Extract `renderResults` to a top-level pure function.
23. **CQ-8** / **RP-7** — Move `latestSearchRef.current = search` into a `useEffect` (or remove if RP-2 is fixed).
24. **RP-4** — Drop the redundant `popstate` dispatch (or document why both fire).
25. **RP-5** — Add a `pushState` spy assertion in the deep-link test, or refactor `writeQueryToUrl` to use `navigate(\`?${params}\`)` so `memoryLocation` can observe typing.
26. **TS-2** — Drop the redundant `as unknown as Promise<Response>` and `as typeof window.fetch` chains in the stories file.
27. **EH-5** — Guard `pushState`/`dispatchEvent` against throws in `writeQueryToUrl`.
28. **PF-2** — Replace `index.addAll([...prompts])` with `index.addAll(prompts)`.
29. **PF-3** — Drop `prompts` from the `hits` memo deps after PF-1.
30. **SE-1** — Resolved by TS-1 + EH-1.
31. **A-5** — Either swap to `<input type="text" role="searchbox">` + explicit clear button, or document the WebKit clear-button quirk.
32. **A-7** — Add keyboard-interaction tests once A-1/A-2/A-4 are wired.

---

*Generated by Review — 2026-07-20*
