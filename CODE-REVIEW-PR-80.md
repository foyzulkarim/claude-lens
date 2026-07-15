# Review Report

## Metadata

| Field | Value |
|-------|-------|
| **Review Mode** | Pipeline: ARCH-filter-bar-url-sync |
| **Target** | PR #80 — feat/30/filter-bar-url-sync (issue #30, #P3-3) |
| **Date** | 2026-07-15 |
| **Tech Stack** | TypeScript (strict), React 19, wouter, TanStack Query, Vite, Tailwind + clsx, Biome, Vitest |
| **Checks Run** | task-completion, code-quality, react-patterns, typescript-strictness, test-coverage |
| **Checks Skipped** | security (no server changes), database-patterns (no DB), express-patterns (no server changes), performance (simple/reasoned in ARCH), error-handling (covered by task-completion), documentation (internal feature), config-dependencies (no new deps), migration (additive only), accessibility (developer opted to skip), async-patterns (no complex async), runtime-behavior (no concerns) |
| **Files Changed** | 10 |
| **Lines Changed** | +1125 / -23 |

## Review Process

- [x] Preflight checks passed
- [x] Diff gathered (10 files, +1125/-23)
- [x] Tech stack detected: TypeScript/React/wouter/TanStack Query
- [x] Context read (ARCH-filter-bar-url-sync.md, specs/context/30.md, CLAUDE.md)
- [x] Triage proposed and developer confirmed (accessibility skipped, rest run)
- [x] 5 checks dispatched: task-completion, code-quality, react-patterns, typescript-strictness, test-coverage
- [x] Results collected and deduplicated
- [x] Report compiled
- [x] Verdict determined

## Verdict: ⚠️ PASS WITH FINDINGS

Both tasks are functionally complete and well-built: T1's pure state module has thorough TDD coverage (18 scenarios, independently re-run and green), and T2's live Playwright pass this session confirmed 8 of 11 UI checklist items. No must-fix issues. Two things are worth closing before calling this fully done: a real cache-key canonicalization gap (chip selection order isn't sorted, undermining `qk.metrics` dedupe — the exact hotspot this PR's own ARCH doc flags), and two unverified checklist items from T2's own verification plan (WS regression guard — the task's explicitly named high-risk callout — and the Back-button/A5 behavior), which are code-correct but not behaviorally exercised this session.

### Finding Counts

| Category | 🔴 | 🟠 | 🟡 | 💭 | ⚠️ |
|----------|-----|-----|-----|-----|-----|
| task-completion | 0 | 0 | 0 | 0 | 3 |
| code-quality | 0 | 0 | 2 | 1 | 0 |
| react-patterns | 0 | 0 | 0 | 0 | 0 |
| typescript-strictness | 0 | 0 | 0 | 2 | 0 |
| test-coverage | 0 | 0 | 1 | 2 | 0 |
| **Total** | **0** | **0** | **3** | **5** | **3** |

---

## Task Completion

Independently re-ran `npm run typecheck`/`lint`/`format:check`/`test` — all green, 266/266 tests. Every REQ (R1–R7) and decision (A4, A5) has code + test/manual evidence. Change Footprint matches ARCH exactly; all three "Must NOT modify" files (`queryKeys.ts`, `ws.ts`, `server/routes/metrics.ts`) confirmed untouched via `git diff`. Scope boundaries respected (no facets endpoint, no calendar picker, no other pages wired).

| # | Item | Status | Notes |
|---|------|--------|-------|
| ⚠️ | T2 checklist item 9 — WS regression guard | Not verified | The task's own explicit High-Risk Callout; code path looks correct (same `metrics` key prefix, `ws.ts` untouched) but wasn't behaviorally exercised this session |
| ⚠️ | T2 checklist item 10 — Back button restores prior filters (A5) | Not verified | `useFilters.commit()` confirmed (by react-patterns agent, tracing into wouter source) to use non-replace `pushState`, so the code is correct; the live behavior wasn't manually re-checked |
| ⚠️ | T2 checklist item 3 — Storybook chip loading/empty states | Partial | Story file's own comment admits only the `isError` branch is exercised without a live backend; `isPending`/empty-options branches exist in code but aren't demonstrated by the stories as the checklist claims |

**Low-confidence observation (not a finding):** resetting all filters navigates to `"?"` rather than a bare path, leaving a trailing `?` in the URL — cosmetic only, doesn't affect any REQ.

## Code Quality

| # | Severity | File | Line | Issue |
|---|----------|------|------|-------|
| 1 | 🟡 Medium | `client/src/filters/FilterBar.tsx` | 43-45 | Chip arrays are ordered by click sequence, not canonicalized. `qk.metrics` dedupe depends on canonical array order (per its own doc comment and this PR's ARCH "Touched but not changed" table) — `TanStack`'s `hashKey` sorts object keys but not array contents, so `project=[a,b]` vs `[b,a]` (same logical filter) produces two cache entries and an avoidable refetch. **Recommendation:** sort chip values before committing (e.g. in `useFilters.setChip` or `filtersToQuery`). |
| 2 | 🟡 Medium | `state.ts` / `useFacets.ts` | 101-106 / 8-15 | `Chip`/`FacetDimension` and their `→ Dimension` remap tables (including the A4 `branch→gitBranch` rule) are independently duplicated across two files. A future dimension add/rename only needs one updated to compile, silently leaving the other stale. **Recommendation:** hoist the union type + remap table into `state.ts` (already an allowed import for `useFacets.ts` per Module Boundaries) and import it from both places. |
| 3 | 💭 Low | `FilterBar.tsx` | 89-90 | `"from" in range` re-evaluated independently for `customFrom`/`customTo` instead of destructured once. Stylistic only. |

## React / Next.js Patterns

✅ No findings. The reviewer traced `useFacets`'s reduced-dependency `useMemo`, `Dashboard`'s `filtersKey`-keyed `useMemo`, wouter's `navigate`/`pushState` behavior (confirming A5's Back-button support is genuine, not accidental), and `AppShell`'s `useSearch` sanitization (ruling out a double-`?` URL bug) — all confirmed correctly implemented per ARCH's stability requirements.

## TypeScript Strictness

`npm run typecheck` passes clean. No `any`, non-null assertions, `@ts-ignore`, or loose generics found.

| # | Severity | File | Line | Issue |
|---|----------|------|------|-------|
| 1 | 💭 Low | `FilterBar.tsx` | 48 | `(e.target as HTMLDetailsElement).open` cast is avoidable — `e.currentTarget` is already typed as `HTMLDetailsElement` by React's `ToggleEvent`. |
| 2 | 💭 Low | `state.ts` | 50 | `preset as RangePreset` cast after a `Set.has()` check could be a type-predicate guard instead, so a future `RANGE_PRESETS`/`RangePreset` drift would be caught at compile time. |

## Test Coverage

`state.test.ts` matches ARCH's Task T1 test plan almost 1:1 (14/14 documented scenarios + 1 bonus), all with specific `toEqual` assertions, no flakiness risk. Gaps found are additive edge cases beyond the documented plan, not deviations from it.

| # | Severity | File | Line | Issue |
|---|----------|------|------|-------|
| 1 | 🟡 Medium | `state.ts` | 243-250 (`parseRange`) | No test covers a partial custom range (only `from` or only `to` present) — this real branch silently falls back to default, discarding the lone param, and is untested. |
| 2 | 💭 Low | `state.ts` | 246 | The `from === to` boundary for custom-range validity (uses `<=`) is untested. |
| 3 | 💭 Low | `state.ts` | 233-240 (`parseChip`) | Whitespace/empty-segment handling in CSV chip parsing is only exercised implicitly, never asserted directly. |

---

## Manual Checks Required

- [ ] Re-verify T2 checklist item 9 (WS regression guard) — append a line to a watched fixture JSONL with a filter active, confirm the filtered Dashboard query refetches over `/ws`
- [ ] Re-verify T2 checklist item 10 (Back button) — make two consecutive filter changes, press Back once, confirm it returns to the first change's state
- [ ] Optionally re-check T2 checklist item 3 in an actual running Storybook (not static story review) to see the `isPending`/empty-options chip states

## Prioritized Action Items

### Must Fix (🔴 Critical / 🟠 High)
None.

### Should Address (🟡 Medium)
- Canonicalize chip-value array order before it hits the query key (code-quality #1) — closes the exact cache-dedupe hotspot this PR's own ARCH doc names.
- Deduplicate the `Chip`/`FacetDimension` type + remap table into `state.ts` (code-quality #2).
- Add a test for `parseRange`'s partial-custom-range fallback branch (test-coverage #1).
- Close the two unverified T2 checklist items (WS guard, Back button) with a quick manual pass.

### Nice to Have (💭 Low)
- `FilterBar.tsx:48` — use `e.currentTarget` instead of casting `e.target`.
- `state.ts:50` — type-predicate guard instead of `as RangePreset`.
- `FilterBar.tsx:89-90` — destructure `range` once instead of twice.
- Add tests for the `from === to` boundary and CSV chip whitespace/empty-segment trimming.

---
*Generated by Review — 2026-07-15*
