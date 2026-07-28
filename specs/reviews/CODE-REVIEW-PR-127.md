# Review Report

## Metadata

| Field | Value |
|-------|-------|
| **Review Mode** | PR #127 |
| **Target** | https://github.com/foyzulkarim/claude-lens/pull/127 (`feat/126/explain-gate-jargon` → `main`) |
| **Date** | 2026-07-29 |
| **Tech Stack** | React + TypeScript client (strict TS project), Tailwind CSS, Biome (lint/format), Vitest + React Testing Library + @testing-library/user-event |
| **Checks Run** | accessibility, react-patterns, code-quality, typescript-strictness, test-coverage |
| **Checks Skipped** | security (no user-facing input/API surface), performance (trivial UI, no algorithms), error-handling (no fallible/async paths added), documentation (internal UI copy only), config-dependencies (explicitly dependency-free, no new deps), database-patterns/express-patterns/migration (no backend touched), async-patterns (no async logic introduced), runtime-behavior (folded into react-patterns tracing), task-completion (general PR mode — verified acceptance criteria manually instead, see below) |
| **Files Changed** | 14 |
| **Lines Changed** | +803 / -29 |

## Review Process

- [x] Preflight checks passed
- [x] Diff gathered (14 files, 1018-line diff)
- [x] Tech stack detected: React/TS client, Tailwind, Biome, Vitest/RTL
- [x] Context read (CLAUDE.md, AGENTS.md, PR description, linked issue #126)
- [x] Triage proposed and developer confirmed (added test-coverage to the initial 4-check proposal)
- [x] 5 checks dispatched: accessibility, react-patterns, code-quality, typescript-strictness, test-coverage
- [x] Results collected and deduplicated
- [x] Report compiled
- [x] Verdict determined
- [x] Report saved to specs/reviews/

## Verdict: ⚠️ APPROVE WITH COMMENTS

Solid, well-scoped PR: two new dependency-free, well-tested `InfoModal`/`InfoButton` primitives, and glossary content whose quoted formulas/thresholds I independently cross-checked against `specs/gates.md` and confirmed accurate verbatim. TypeScript strictness is clean (exhaustiveness on `GateId`/`WasteEventKind` verified empirically via an induced compiler error, not just inspection). No Critical or High findings. Two real Medium-severity issues are worth addressing before or shortly after merge: background content isn't made inert/scroll-locked while the modal is open, and `InfoButton`'s `handleClose` isn't memoized (currently harmless, but will silently steal focus the first time this reusable component is used with interactive modal content). The rest are test-coverage gaps around edge cases the issue's own acceptance criteria call out, plus one DRY loose end from #124 that this PR's stated intent (but not its diff) implicates.

### Finding Counts

| Category | 🔴 | 🟠 | 🟡 | 💭 | ⚠️ |
|----------|-----|-----|-----|-----|-----|
| accessibility | 0 | 0 | 1 | 1 | 0 |
| react-patterns | 0 | 0 | 1 | 0 | 0 |
| code-quality | 0 | 0 | 1 | 0 | 0 |
| typescript-strictness | 0 | 0 | 0 | 0 | 0 |
| test-coverage | 0 | 0 | 4 | 1 (merged into accessibility Low below) | 0 |
| **Total (deduplicated)** | **0** | **0** | **7** | **2** | **0** |

*One finding (focus not returning to trigger on backdrop/close-button paths) was raised independently by both the accessibility and test-coverage checks; it's merged into a single Low item below.*

---

## react-patterns

### Findings

| # | Severity | File | Line | Issue | Recommendation |
|---|----------|------|------|-------|----------------|
| 1 | 🟡 Medium | `client/src/components/InfoButton.tsx` (root cause) / `InfoModal.tsx` (effect) | `InfoButton.tsx:24-29`, `InfoModal.tsx:29-56` | `handleClose` in `InfoButton` is a fresh closure on every render (not `useCallback`-wrapped), and `InfoModal`'s focus/keydown effect correctly lists it as a dependency — so any re-render of the modal's parent while open (e.g. `client/src/ws.ts` invalidates `qk.prefixes.gates`/`qk.prefixes.scorecard` on live-session WS updates, re-rendering `GateRow`/`Metric`) tears down and re-runs the effect, re-focusing the close button. Harmless today because every current modal body is plain `<p>` text (close button is the only focusable element), but `InfoButton`'s own doc comment states it's meant for reuse elsewhere, and the first caller that adds a link/button to modal content will get focus silently yanked back on a background data refresh. | Wrap in `useCallback`: `const handleClose = useCallback(() => { setOpen(false); triggerRef.current?.focus(); }, []);` — `setOpen` and the ref are both stable, so `[]` is correct and removes the churn at the source. |

### Tracing Notes

- **`InfoModal`'s `useEffect`** — caller: `InfoButton` (only caller, passes `onClose={handleClose}`). Frequency: occasional-to-frequent while open, since `ws.ts` invalidation of gate/scorecard queries is a normal event during live-session viewing, not an edge case. The `document.addEventListener`/`removeEventListener` pairing itself does not leak — React guarantees cleanup runs before the next effect invocation — so this is effect *churn*, not a leak.
- Confirmed no perf/architecture concern from N portaled `InfoButton`+`InfoModal` instances (one per gate/metric row): `InfoModal` returns `null` before `createPortal` when closed, so closed instances contribute zero DOM nodes.
- `GradeBadge`'s new `<span>` wrapper (badge + `InfoButton`) doesn't break anything — grepped `cypress/e2e/*.cy.ts`, neither test asserts on the badge's parent structure.
- No SSR entry point in this codebase (Vite SPA) — `createPortal`/`document` access in `InfoModal` is safe as written.

---

## accessibility

### Findings

| # | Severity | File | Line | Issue | WCAG | Recommendation |
|---|----------|------|------|-------|------|----------------|
| 1 | 🟡 Medium | `InfoModal.tsx` | 60-95 (no scroll-lock effect) | Background content isn't made inert while the modal is open — body scroll isn't locked, nothing marks the rest of the DOM `aria-hidden`/`inert`. A wheel scroll over the backdrop still scrolls the page behind it; the only thing standing between AT browse-mode and background content is `aria-modal="true"`, whose support for suppressing background content varies across screen-reader/browser combos. | SC 4.1.2 Name, Role, Value (indirect); WAI-ARIA APG Dialog Pattern guidance | Lock body scroll for the `open` duration (`document.body.style.overflow = "hidden"`, restored on cleanup) in the existing effect, and/or mark the app root `aria-hidden`/`inert` while open. |
| 2 | 💭 Low | `InfoModal.tsx` | 29-31 | Initial focus lands on the Close (✕) button rather than the panel/heading, so an immediate Enter/Space after opening dismisses the dialog before content is read. Not a WCAG violation (focus does move inside the dialog), just a deviation from the more common APG recommendation. | SC 2.4.3 Focus Order (indirect) | Consider focusing the panel (`tabIndex={-1}`) or heading instead. |
| 3 | 💭 Low | `InfoButton.test.tsx` | 48-58, 72-82 (merged with test-coverage's identical finding) | Only the Escape-close path asserts `trigger.toHaveFocus()`. Backdrop-click and Close-button-click tests both stop at "dialog is gone." `handleClose` is shared code across all three paths so this is almost certainly correct at runtime, but it leaves the PR's own stated acceptance criteria ("focus returns to the trigger on close") unverified by automation for two of three close paths. | — | Add `expect(trigger).toHaveFocus()` to the backdrop-click and close-button-click tests (one line each). |

### Verified, no finding

- `role="dialog"` + `aria-modal="true"` + `aria-labelledby` correctly wired, confirmed via `InfoModal.test.tsx` passing `getByRole("dialog", { name: ... })`.
- Focus trap correctly handles the single-focusable-element case (`first === last === closeButton` when content has no links/buttons) — traced, no dead zone.
- Color contrast: `text-slate-500` on white (~4.75:1) and `dark:text-[#8A96A5]` on `dark:bg-[#151A21]` (~5.8:1) both clear AA; both are pre-existing tokens already used elsewhere, so no new risk.
- The `biome-ignore` comments on the backdrop's mouse-only `onClick` are correctly justified (Escape is the documented keyboard equivalent) — satisfies SC 2.1.1 Keyboard, not an oversight.

---

## code-quality

### Findings

| # | Severity | File | Line | Issue | Recommendation |
|---|----------|------|------|-------|----------------|
| 1 | 🟡 Medium | `client/src/pages/dashboard/BiggestLeverCard.tsx` (outside this PR's diff, from #124) | 17-22 | `scorecardGlossary.ts`'s docstring frames the `KIND_LABEL` move out of `Scorecard.tsx` as being specifically so "the label and its explanation can't drift apart" — but `BiggestLeverCard.tsx` still carries its own private, byte-for-byte identical `KIND_LABEL` map, untouched by this PR. There are now two live copies of the same map instead of one canonical one — exactly the drift risk the move's own docstring calls out. | Point `BiggestLeverCard.tsx` at the new `content/scorecardGlossary.js` export and delete its local copy, either in this PR or as an immediate fast-follow. |

### Verification performed

Checked out the PR branch and independently ran `tsc --noEmit -p client/tsconfig.json` (clean), `biome lint`/`biome format` on all changed files (clean), and the six affected Vitest files (59/59 passing) — not just read the diff.

### Focus-area answers

- `describeThreshold` (switch, 7-member union, 4 real cases) vs. `describeGradeBands` (ternary, 2-way discriminant on `bands.source`): different arities call for different constructs — not an inconsistency worth flagging.
- `GateGlossaryEntry`/`GATE_GLOSSARY` typing: appropriately strict — `Record<GateId, GateGlossaryEntry>` plus a test asserting key-set equality against `GATE_IDS` means a missing entry fails both `tsc` and the test suite. `METRIC_GLOSSARY`'s looser `as const` shape is fine since it's only ever accessed by static property, never indexed dynamically.
- `GateRow`/`Metric` prop threading: single-level, one new prop each — no complexity concern.
- The `Scorecard.tsx`-local half of the `KIND_LABEL` move is clean (old const removed, unused `WasteEventKind` type import dropped, no dead code) — the gap is cross-file (Finding #1 above), not local.

---

## typescript-strictness

**Result:** ✅ No findings.

**Files reviewed:** all 12 in-scope `.ts`/`.tsx` files.

Verified empirically (not just by inspection): temporarily added an 8th synthetic `GateId` to `shared/gates-contract.ts` and re-ran `tsc -p client/tsconfig.json --noEmit` (change discarded, `git diff` clean afterward). Confirmed it produces **compile errors**, not silent fallthrough — both in `GATE_GLOSSARY`'s `Record<GateId, ...>` (TS2741, missing key) and in `describeThreshold`'s switch (TS2366, function falls off the end since its declared return type excludes `undefined`). A future `GateId` addition will break the build in two places rather than silently misbehaving at runtime. No `any`, unsafe assertions, non-null assertions, or `@ts-ignore`/`@ts-expect-error` found anywhere in scope.

---

## test-coverage

### Findings

| # | Severity | File | Line | Issue | Recommendation |
|---|----------|------|------|-------|----------------|
| 1 | 🟡 Medium | `InfoModal.test.tsx` | 202-220 | The only focus-trap test uses a two-element panel (Close + link), but every real call site in this PR renders plain-text-only children — so in production the panel almost always has exactly one focusable node. The self-wrap branch is correct by inspection, but untested. | Add a case with non-focusable-only children asserting Tab and Shift+Tab both leave focus on Close. |
| 2 | 🟡 Medium | `InfoButton.test.tsx` | — | No test covers two `InfoButton` instances (one per gate row in real usage) both attempting to open. Likely unreachable in the browser (backdrop + focus trap both block it), but that's exactly the kind of CSS/layout invariant that regresses silently. | Add a regression test locking in the invariant (e.g. only one `dialog` role present after opening a second trigger). |
| 3 | 🟡 Medium | `ReportCardView.test.tsx` | 103-120 | `describeThreshold`'s `null` return for V1/P3/E1 is unit-tested, but no component test opens a threshold-free gate's modal and confirms the `{thresholdNote !== null ? ... : null}` branch actually suppresses the "Currently: ..." line in rendered output. | Open V1's modal and assert `queryByText(/Currently:/)` is null. |
| 4 | 🟡 Medium | `Scorecard.test.tsx` | 291-294 | Good negative test exists for "cache reads" having no info button, but no equivalent negative test that individual waste-event *rows* don't get their own button — exactly what the issue's acceptance criteria calls out (one shared button on the heading, not one per row). | Mirror the "cache reads" pattern on a waste-event row: `within(row).queryByRole("button")` should be null. |
| 5 | 💭 Low | (merged into accessibility Finding #3 above) | — | — | — |

### Additional checks performed (no findings)

- No portal/DOM leak risk: `createPortal(..., document.body)`'s host node is owned by the calling component's React fiber tree, so RTL's `afterEach(cleanup)` unmounts it correctly even mid-open.
- `getByTestId("info-modal-backdrop")` in `InfoModal.test.tsx` is a justified exception to the project's role-before-test-id convention (AGENTS.md) — the backdrop deliberately has no accessible role (per its own `biome-ignore` comments), so there's no role/name to query by.

---

## Manual Checks Required

- [ ] Manually open a session's Report Card + Cache Scorecard in the browser, click through each new "?" in both light and dark mode, confirm Escape/backdrop-click closes and focus returns to the trigger (already noted as unchecked in the PR's own test plan).
- [ ] Confirm actual screen-reader browse-mode behavior across NVDA/JAWS/VoiceOver for the background-content-reachable concern (accessibility Finding #1) — `aria-modal` support for suppressing background content varies by AT/browser combo.

## Prioritized Action Items

### Must Fix (🔴 Critical / 🟠 High)
None.

### Should Address (🟡 Medium)
1. Memoize `InfoButton`'s `handleClose` with `useCallback(..., [])` to stop effect churn on WS-triggered re-renders (react-patterns #1).
2. Lock body scroll / mark background inert while the modal is open (accessibility #1).
3. Point `BiggestLeverCard.tsx`'s `KIND_LABEL` at the new `content/scorecardGlossary.js` export instead of leaving a second copy (code-quality #1).
4. Add the four missing test-coverage cases: single-focusable-element trap wrap, two-`InfoButton`-instances invariant, threshold-suppression assertion for V1, and the per-row negative test for waste-event info buttons (test-coverage #1-4).

### Nice to Have (💭 Low)
1. Focus the panel/heading instead of the Close button on open, so the first keypress doesn't dismiss (accessibility #2).
2. Add `expect(trigger).toHaveFocus()` to the backdrop-click and close-button-click tests, not just the Escape test (accessibility #3 / test-coverage #5, merged).

---
*Generated by Review — 2026-07-29*
