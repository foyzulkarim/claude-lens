# Architecture: Global filter bar + URL sync (#P3-3)

> **Date:** 2026-07-15
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Standalone brief (plan task #P3-3, issue #30) — see Inferred Requirements
> **Type:** feature

## Architecture Summary

A client-only `client/src/filters/` module renders one `<FilterBar/>` mounted once
in `AppShell` above `<main>`, so it appears on every page. All filter state — date
range (preset or custom from/to) plus project/model/branch/host multi-selects — lives
**only** in the URL query string; there is no parallel React state. wouter's
`useSearch()` provides reactive reads and `useLocation()[1]` (navigate) provides the
sole write path. Pages build a `MetricsQuery` from the parsed filter state through the
existing `qk` key factory, so changing a filter changes the query key and TanStack
Query refetches; navigating between pages preserves the query string and thus the
filters, for free. Chip option lists are fetched lazily via one metrics breakdown
query per dimension when a dropdown opens.

## Inferred Requirements (Standalone brief)

| ID  | Inferred Requirement | Source |
|-----|----------------------|--------|
| R1  | Filter bar offers date-range presets 1D/7D/30D/90D and a custom from/to range | pages §0; issue #30 scope |
| R2  | Filter bar offers project, model, branch, host chips (multi-select) | pages §0; issue #30 scope |
| R3  | All filter state is encoded in the URL query string (not hash) | arch §11; decisions log 2026-07-06 |
| R4  | Copy-pasting a URL reproduces the filtered view | issue #30 acceptance |
| R5  | Filters persist across page navigation | issue #30 acceptance; arch §11 |
| R6  | Chip option values come from actual data, not a hardcoded list | pages §0 (🟢 T-tier) |
| R7  | Dashboard's provisional hardcoded range is replaced by the filter bar's range | Dashboard.tsx smokeQuery comment |

## High-Level Structure

```
URL query string  ◄─────────────  navigate(`?${serializeFilters(next)}`)
      │                                        ▲
      │ useSearch() (wouter, reactive)         │ setChip / setRange / reset
      ▼                                        │
parseFilters(search) → FilterState ──► useFilters() hook ──► <FilterBar/>  (in AppShell)
      │                                        │
      │ filtersToQuery(state)                  │ same hook consumed by pages
      ▼                                        ▼
{ range, filters } ──► MetricsQuery ──► qk.metrics(q) ──► TanStack Query ──► POST /api/metrics
```

Added: the whole `filters/` module. Modified: `AppShell` (mount the bar),
`Dashboard` (consume the hook instead of a hardcoded range). Server untouched.

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|------|----------|-------------------------|-----------|
| State source | URL query string only, via wouter `useSearch`/`useLocation` | React context + effect sync to URL | One copy of state can't desync; §11 asks for URL persistence and this is the least machinery |
| Router API | wouter `useSearch()` + `useLocation()` | react-router `useSearchParams` | wouter is the project router (§11); no new dep |
| Chip options | Metrics single-dim breakdown query, lazy on dropdown open, TanStack-cached | New `/api/facets` endpoint; eager fetch on mount | No new server surface; lazy avoids 3–4 queries per page load |
| Custom range UI | Two native `<input type="date">` | Full calendar picker; presets-only | Meets acceptance with minimal UI; richer picker is #P4-1's job |
| Query building | Reuse existing `qk.metrics` + `postMetrics` | Ad-hoc keys in pages | §11 one-key-factory rule |

## Patterns & Conventions

- **Pure parse/serialize core** — `parseFilters`/`serializeFilters`/`resolveRange` are
  side-effect-free string↔object functions, unit-tested in isolation (mirrors
  `server/`'s file-per-concern + heavy unit-test style, e.g. `metrics/grain.ts`).
- **One key factory (§11)** — pages build queries through `qk.metrics`; the filter
  module never invents query keys.
- **File-per-concern** — `state.ts` (pure), `useFilters.ts` (hook), `useFacets.ts`
  (hook), `FilterBar.tsx` (UI) rather than one module (matches `api/` split).
- **URL name vs contract name** — URL uses clean `branch`; mapped to the contract
  `gitBranch` dimension only when building `MetricsQuery.filters`.

## Data Models

### FilterState (client-only, derived from the URL)

**Purpose:** the decoded representation of the query string that pages and the bar read.

**Key fields:**
| Field | Type / Constraint | Notes |
|-------|-------------------|-------|
| `range` | `{ preset: "1d"\|"7d"\|"30d"\|"90d" }` \| `{ from: string; to: string }` | preset resolved to concrete `{from,to}` client-side per §8; default `7d` when absent |
| `project` | `string[]` | maps to `filters.project` |
| `model` | `string[]` | maps to `filters.model` |
| `branch` | `string[]` | maps to `filters.gitBranch` |
| `host` | `string[]` | maps to `filters.host` (placeholder values today) |

**Lifecycle:** parsed from `useSearch()` on every render → mutated only via
`navigate()` → re-parsed. Never stored elsewhere.

## API Contracts / Interfaces

### `client/src/filters/state.ts` (pure)

| Op | Signature | Purpose | Returns |
|----|-----------|---------|---------|
| parse | `parseFilters(search: string): FilterState` | decode query string; unknown/garbage params ignored, defaults applied | always a valid `FilterState` |
| serialize | `serializeFilters(state: FilterState): string` | encode to query string; omit empty chips & default range for clean URLs | `string` (no leading `?`) |
| resolve | `resolveRange(range: FilterState["range"], now: Date): {from,to}` | preset → concrete ISO instants | `{from,to}` |
| build | `filtersToQuery(state, now): { range: {from,to}; filters: Partial<Record<Dimension,string[]>> }` | shape for `MetricsQuery` (branch→gitBranch remap, drop empties) | query fragment |

### `client/src/filters/useFilters.ts`

`useFilters(): { filters: FilterState; setChip(dim, values: string[]): void; setRange(r): void; reset(): void }`
— reads `useSearch()`, writes via `navigate()`. Setters are non-replace navigations
(each filter change is a history entry, so Back works).

### `client/src/filters/useFacets.ts`

`useFacets(dim: "project"|"model"|"gitBranch"|"host"): { options: string[]; isPending; isError }`
— TanStack `useQuery`, `enabled` only once the dropdown opens; queries
`{ measures:["sessions"], dimensions:[dim], grain:"day", range: <current> }` and maps
returned `Series[]` → `label`s. Keyed through `qk.metrics`.

## Module Boundaries

| Module | Responsibility | Allowed Dependencies |
|--------|----------------|----------------------|
| `filters/state.ts` | pure URL↔FilterState + range resolution | `shared/metrics-contract` types only |
| `filters/useFilters.ts` | reactive read/write of filter state | wouter, `state.ts` |
| `filters/useFacets.ts` | fetch chip options | TanStack Query, `api/` (`qk`,`postMetrics`), `state.ts` |
| `filters/FilterBar.tsx` | the bar UI | the three above, clsx |

## Change Footprint

### New files / modules

| Path | Purpose | Pattern reference |
|------|---------|-------------------|
| `client/src/filters/state.ts` | pure parse/serialize/resolve/build | `server/metrics/grain.ts` (pure + tested) |
| `client/src/filters/state.test.ts` | unit tests for the pure core | `server/metrics/grain.test.ts` |
| `client/src/filters/useFilters.ts` | URL↔state hook | — (new) |
| `client/src/filters/useFacets.ts` | lazy chip-option hook | `pages/Dashboard.tsx` useQuery usage |
| `client/src/filters/FilterBar.tsx` | range presets + custom inputs + 4 chip dropdowns | `layout/AppShell.tsx` Tailwind chrome |
| `client/src/filters/FilterBar.stories.tsx` | Storybook states (optional, matches P1-4 setup) | `ExampleStat.stories.tsx` |

### Modified files / modules

| Path | What changes here |
|------|-------------------|
| `client/src/layout/AppShell.tsx` | render `<FilterBar/>` in a top bar above `{children}` |
| `client/src/pages/Dashboard.tsx` | replace hardcoded `smokeQuery()` range with `filtersToQuery(useFilters().filters)` output; query key still via `qk.metrics` |

### Deleted / replaced

| Path | Reason |
|------|--------|
| `Dashboard.tsx` `smokeQuery()` / `SEVEN_DAYS_MS` | superseded by filter-bar-driven range (kept only if still needed for empty-filter default) |

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|------|----------------|
| `client/src/api/queryKeys.ts` | `qk.metrics(query)` hashing must stay stable — filter-driven queries rely on identical keys deduping; array order in `filters`/`measures` must be canonical (comment already warns of this) |
| `client/src/ws.ts` | invalidates by `metrics` prefix; filter-driven queries live under the same prefix so live-update still works — verify a filtered Dashboard still refetches on WS |
| `server/routes/metrics.ts` | already validates `filters` keys/values and 400s on bad input; the client must send only known dimensions (`gitBranch`, not `branch`) and non-empty arrays |

## Areas of Impact

| Area | Impact | Risk | Why |
|------|--------|------|-----|
| Every page (future) | all pages will read `useFilters()` for their queries | L | only Dashboard consumes it now; contract is additive |
| WS live-update loop | filtered queries must still invalidate | L | same `metrics` key prefix; no protocol change |
| `/api/metrics` load | lazy facet queries add ≤4 breakdown calls per session, on demand | L | cached; only on dropdown open |
| `host` dimension | chip shows placeholder `"default"` only | L | known ⚑N gap; documented, not a regression |

**Contract changes:** none — no shared types or API shapes change. `MetricsQuery`
already supports `filters`/`range`.

**Cross-cutting ripples:** none for auth/telemetry/build. The only cross-cutting
convention touched is the URL scheme, which becomes the app's permalink format
(future pages must adopt the same param names).

## Cross-Cutting Concerns

- **Errors:** `parseFilters` never throws — malformed/unknown params fall back to
  defaults (a bad pasted URL degrades gracefully, not a crash). Facet-query errors
  surface as a disabled/"couldn't load options" dropdown state, not a page break.
- **Logging & metrics:** none (client UI).
- **Auth:** n/a (loopback-only local app).
- **Performance:** URL parsed per render but it's a tiny string; `filtersToQuery`
  memoized where it feeds a query key to avoid refetch loops (same discipline as the
  existing `useMemo` in Dashboard). Facets lazy + cached.
- **Security:** the server already validates `filters` (known dimensions, non-empty
  string/number arrays) and 400s otherwise — the client is not the trust boundary.
- **Rollout:** additive; no migration. Default (no query params) reproduces today's
  7-day Dashboard behavior.

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies |
|---|----------|--------------|----------------|-----------|
| A1 | URL query string is the only source of filter state | React state + effect sync | can't desync; least machinery; meets §11 | R3,R4,R5 |
| A2 | Chip options from metrics breakdown, lazy + cached | new `/api/facets`; eager | no new server surface; cheap | R2,R6 |
| A3 | Custom range = two native date inputs | calendar picker; presets-only | meets acceptance minimally; picker is #P4-1 | R1 |
| A4 | URL name `branch` remapped to `gitBranch` at query-build time | expose `gitBranch` in URL | cleaner permalinks | R3 |
| A5 | Each filter change is a real history entry (non-replace navigate) | replaceState | Back button restores prior filters | R5 |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|----------|---------------------------|
| User pastes a URL with a bogus `range=xyz` or unknown param | `parseFilters` ignores unknowns, falls back to default `7d`; view still renders |
| Custom `from` after `to`, or unparseable date | `resolveRange` validates; invalid custom range falls back to default and the inputs show the corrected value; server also 400s as backstop |
| Chip selected for a value that no longer exists in data | query returns empty series → empty/partial-range state (pages §0 lists this); filter still legal |
| Two rapid chip clicks | each navigates; last write wins in the URL; TanStack cancels superseded fetches by key |
| WS invalidation arrives while a filter is applied | same `metrics` prefix → filtered query refetches; live-update preserved |

### Backward — regression risk per touched area

| Touched area | What could regress | How we'd know / mitigation |
|--------------|--------------------|-----------------------------|
| `Dashboard.tsx` | refetch loop if `filtersToQuery` output isn't referentially stable | memoize; existing tests + manual check that it doesn't spin |
| `queryKeys.ts` | non-canonical array order breaks dedupe | send canonical order; the factory comment already warns; covered by parse/serialize tests |
| `ws.ts` | filtered query not invalidated | verify step: append to a fixture with a filter active, confirm refetch |

## Open Questions

- Should chip param encoding be CSV (`project=a,b`) or repeated (`project=a&project=b`)?
  - **Impact if unresolved:** cosmetic URL difference; both round-trip fine.
  - **Suggested default:** CSV — shorter, simpler to parse; revisit if a value can
    contain a comma (project = cwd path; unlikely but escape if needed).

## Out of Scope

- Facets/distinct-values API endpoint (reason: metrics breakdown suffices; no new server surface this task).
- Calendar range picker, saved views, export/permalink-copy button (reason: #P4-1 primitives / later §0 items).
- Wiring pages other than Dashboard (reason: they're stubs until Phase 4; the hook is ready for them).
- Real per-host data (reason: ⚑N gap; `host` chip is a documented placeholder).

---

# Tasks

## Task T1: Filter state — pure URL ↔ FilterState core

> **Status:** done
> **Verification:** tdd
> **Effort:** s
> **Priority:** high
> **Depends on:** None
> **Satisfies REQs:** R1, R2, R3, R4, A4
> **Footprint slice:** New: `client/src/filters/state.ts`
> **High-risk areas touched:** None

### Description

The pure logic core of the filter bar: decode a URL query string into `FilterState`,
encode it back, resolve a range preset to concrete instants, and shape the state into
the `{range, filters}` fragment a `MetricsQuery` needs. This is the only piece of the
filter feature with a clear, deterministic contract — everything else (T2) is thin
wiring around it. Getting this right is what makes copy-pasting a URL reproduce the
exact same view (R4) and survive navigation (R5, exercised in T2).

### Test Plan

#### Test File(s)
- `client/src/filters/state.test.ts`

#### Test Scenarios

##### parseFilters — defaults & decoding

- **defaults on empty query string** — GIVEN `search = ""` WHEN `parseFilters` runs THEN it returns `{ range: {preset:"7d"}, project: [], model: [], branch: [], host: [] }` _(verifies R1)_
- **decodes a range preset** — GIVEN `search = "?range=30d"` WHEN parsed THEN `range` is `{preset:"30d"}` _(verifies R1)_
- **decodes a custom range** — GIVEN `search = "?from=2026-07-01&to=2026-07-10"` WHEN parsed THEN `range` is `{from:"2026-07-01", to:"2026-07-10"}` _(verifies R1)_
- **decodes CSV chip values** — GIVEN `search = "?project=a,b"` WHEN parsed THEN `project` is `["a","b"]` _(verifies R2)_

##### parseFilters — malformed input falls back to defaults

- **ignores unknown params and a garbage range value** — GIVEN `search = "?range=bogus&foo=bar"` WHEN parsed THEN `range` falls back to `{preset:"7d"}` and unknown params are dropped _(verifies ARCH forward stress-test: bogus pasted URL)_
- **falls back on invalid custom range** — GIVEN `search = "?from=2026-07-10&to=2026-07-01"` (from after to) OR an unparseable date string WHEN parsed THEN `range` falls back to the default preset _(verifies ARCH forward stress-test: invalid custom range)_

##### serializeFilters — round-trip and clean URLs

- **round-trips a fully-populated state** — GIVEN a `FilterState` with every field set WHEN serialized then re-parsed THEN the result deep-equals the original _(verifies R3, R4)_
- **omits empty chips and the default range** — GIVEN the default `FilterState` WHEN serialized THEN the result is an empty string (no `range=7d`, no empty chip params) _(verifies R3 — clean permalinks)_

##### resolveRange — preset → concrete instants

- **resolves each preset relative to `now`** — GIVEN `now = 2026-07-15T00:00:00Z` WHEN `resolveRange({preset:"1d"|"7d"|"30d"|"90d"}, now)` runs THEN `from`/`to` are the correct N-day-back window _(verifies R1)_
- **passes a custom range through unchanged** — GIVEN `{from,to}` WHEN resolved THEN the same `{from,to}` is returned _(verifies R1)_

##### filtersToQuery — shaping for MetricsQuery

- **remaps `branch` to `gitBranch`** — GIVEN `FilterState.branch = ["main"]` WHEN built THEN the result's `filters.gitBranch` is `["main"]` and no `filters.branch` key exists _(verifies A4)_
- **drops empty-array chips** — GIVEN a state with `host: []` WHEN built THEN `filters` has no `host` key _(verifies R2 — matches server's `isValidFilters` which rejects empty-array values)_
- **includes the resolved range** — GIVEN any state WHEN built THEN `range` is the `resolveRange` output _(verifies R1)_

### Implementation Notes

- **Module(s):** `filters/state.ts` per ARCH Module Boundaries — depends only on `shared/metrics-contract` types, no React/wouter imports.
- **Pattern reference:** `server/metrics/grain.ts` + `grain.test.ts` — pure functions, one behavior per test, local-time-safe date handling.
- **Key decisions:** A1 (URL is the only state — this module is the entire state layer), A3 (custom range = plain `{from,to}` strings, no calendar-picker shape), A4 (branch→gitBranch remap happens here, not in the URL).
- **Libraries:** none new — plain TS.
- **High-risk callouts:** None.

### Scope Boundaries

- Do NOT read `window.location` or touch wouter — this module takes/returns plain strings and objects only (that's what makes it unit-testable without a DOM).
- Do NOT implement chip-option fetching (facets) — that's T2's `useFacets.ts`.
- Only implement the four functions named above; no additional exports beyond types needed by T2.

### Files Expected

**New files:**
- `client/src/filters/state.ts` — `FilterState` type + `parseFilters`/`serializeFilters`/`resolveRange`/`filtersToQuery`
- `client/src/filters/state.test.ts` — the scenarios above

**Modified files:** None.

**Must NOT modify:** None (no existing file touched by this task).

---

## Task T2: FilterBar UI, hooks, and page wiring

> **Status:** not started
> **Verification:** ui
> **Effort:** m
> **Priority:** high
> **Depends on:** T1
> **Satisfies REQs:** R1, R2, R3, R4, R5, R6, R7, A2, A5
> **Footprint slice:** New: `client/src/filters/useFilters.ts`, `useFacets.ts`, `FilterBar.tsx`, `FilterBar.stories.tsx`; Modified: `client/src/layout/AppShell.tsx`, `client/src/pages/Dashboard.tsx`
> **High-risk areas touched:** WS live-update loop (L risk) — regression-guard checklist item 9 below covers it.

### Description

Wires T1's pure state module into the running app: `useFilters` gives reactive
read/write access to the URL-encoded filters via wouter; `useFacets` fetches chip
option lists lazily through the existing metrics engine; `FilterBar` renders presets,
custom-range inputs, and the four chips, mounted once in `AppShell` so it appears on
every page. `Dashboard` is wired to consume real filter state instead of its
hardcoded 7-day placeholder, closing the loose end its `smokeQuery()` comment flags.

### Verification Checklist

- **Storybook — FilterBar default state** — expected: presets, 4 chip dropdowns, and custom-range date inputs all render with no filters active
- **Storybook — FilterBar with active filters** — expected: selected preset and selected chip values are visibly indicated (not just present in state)
- **Storybook — chip dropdown loading/empty states** — expected: a distinct visual state while a facet query is pending, and when it returns zero options
- **Manual — preset click updates URL** — expected: clicking `30D` sets `?range=30d` in the address bar and Dashboard's query key changes
- **Manual — chip selection updates URL** — expected: selecting a project chip adds `?project=<value>`; Dashboard's series reflect the filtered result
- **Manual — paste-URL reproduces view (R4)** — expected: opening a URL with `?range=…&project=…` in a fresh tab renders the filter bar pre-populated and Dashboard pre-filtered to match
- **Manual — cross-page persistence (R5)** — expected: navigating Dashboard → another route → back to Dashboard leaves the URL's filter params (and the bar's displayed state) unchanged
- **Manual — lazy facet loading (R6, A2)** — expected: browser network tab shows zero `/api/metrics` breakdown calls for chips until their dropdown is opened; opening it fires exactly one, cached on reopen
- **Manual — WS regression guard** — expected: with a filter active, appending a line to a watched fixture JSONL still causes the filtered Dashboard query to refetch/update over `/ws` (guards ARCH backward-regression risk for `client/src/ws.ts`)
- **Manual — back button restores prior filters (A5)** — expected: after two consecutive filter changes, pressing Back once returns to the first change's state, not to the empty/default state
- **Manual — host placeholder (documented gap)** — expected: the host chip's only option is `"default"`; this is correct behavior, not a bug, per ARCH's `host` dimension note

#### Testable Seams

None — no DOM test environment exists in this repo yet (no `jsdom`/`happy-dom`
environment in `vitest.config.ts`, no `@testing-library/react` dependency), and
CLAUDE.md's testing conventions explicitly rely on Storybook + manual review + Cypress
for UI, not component unit tests. Adding that infra is out of scope for this task —
flag separately if the developer wants it for a future task.

### Implementation Notes

- **Module(s):** `filters/useFilters.ts`, `filters/useFacets.ts`, `filters/FilterBar.tsx` per ARCH Module Boundaries.
- **Pattern reference:** `pages/Dashboard.tsx`'s existing `useQuery`/`postMetrics`/`qk.metrics` usage for `useFacets`; `layout/AppShell.tsx`'s existing Tailwind chrome + `clsx` usage for `FilterBar`; `ExampleStat.stories.tsx` for the Storybook file shape.
- **Key decisions:** A1 (no React state — `useFilters` only wraps wouter's `useSearch`/`useLocation` around T1's parse/serialize), A2 (facets lazy + TanStack-cached, `enabled` gated on dropdown open), A3 (native `<input type="date">`, no calendar widget), A5 (filter changes are non-replace `navigate()` calls so Back works).
- **Libraries:** wouter (`useSearch`, `useLocation`), `@tanstack/react-query` (`useQuery`), existing `api/queryKeys.ts` (`qk`) and `api/metrics.ts` (`postMetrics`) — no new dependencies.
- **High-risk callouts:** WS live-update loop is L-risk per ARCH Areas of Impact — checklist item 9 is the direct regression guard; no code changes to `ws.ts` are needed since it already invalidates by the `metrics` key prefix that filtered queries also use.

### Scope Boundaries

- Do NOT add a facets API endpoint — chip options come from `useFacets`'s metrics breakdown query only (ARCH Out of Scope).
- Do NOT build a calendar range picker — two date inputs only (ARCH Out of Scope; deferred to #P4-1).
- Do NOT wire pages other than Dashboard — other pages are stubs until Phase 4 (ARCH Out of Scope).
- Do NOT add `jsdom`/`@testing-library/react` or component unit tests — not in scope for this task; use Storybook + manual checklist per project convention.
- Do NOT modify `client/src/api/queryKeys.ts` or `client/src/ws.ts` — consume them as-is.

### Files Expected

**New files:**
- `client/src/filters/useFilters.ts` — `useFilters()` hook: reads `useSearch()`, parses via T1, writes via `navigate()`
- `client/src/filters/useFacets.ts` — `useFacets(dim)` hook: lazy `useQuery` wrapping a single-dimension breakdown `MetricsQuery`
- `client/src/filters/FilterBar.tsx` — the bar UI: presets, custom-range inputs, 4 chip dropdowns
- `client/src/filters/FilterBar.stories.tsx` — Storybook states (default, active filters, loading/empty chip dropdown)

**Modified files:**
- `client/src/layout/AppShell.tsx` — render `<FilterBar/>` above `{children}`
- `client/src/pages/Dashboard.tsx` — replace hardcoded `smokeQuery()`/`SEVEN_DAYS_MS` with `filtersToQuery(useFilters().filters)`, still keyed via `qk.metrics`

**Must NOT modify:**
- `client/src/api/queryKeys.ts` (silent-regression hotspot — key hashing stability; covered by checklist items 4–5, 9)
- `client/src/ws.ts` (silent-regression hotspot — covered by checklist item 9)
- `server/routes/metrics.ts` (out of scope — no server changes this task)

### TDD Sequence

N/A — `ui` mode. Suggested build order: `useFilters` (needs T1) → `useFacets` → `FilterBar` (consumes both) → `AppShell` wiring → `Dashboard` wiring, so each piece has something real to render against as it's built.
