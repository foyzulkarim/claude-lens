# Architecture: Explore page (Issue #48 / #P4-16)

> **Date:** 2026-07-20
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** specs/claude-lens-pages.md §11 (binding page contract); specs/issues/P4-16-explore-page.md; specs/pages/explore.html (visual acceptance target)
> **Type:** feature (brownfield new feature)

## Architecture Summary

The Explore page is a **client-side pivot builder** that exposes the existing metrics engine directly: measure × dimension × grain × chart type, with a separate distribution-mode toggle and a scatter-mode variant that picks X/Y(/Size) measures. There is **no new server route** — `POST /api/metrics` already serves the three `MetricsQuery` modes (`series`, `distribution`, `scatter`) per `shared/metrics-contract.ts`. Pivot configuration lives in the URL query string under an `xp.*` key prefix so it composes with the existing global filter bar (`range`/`project`/`model`/`branch`/`host`) and produces permalinks. Saving a pivot uses the existing `createView` local-store endpoint with one small additive extension: an optional `pinned?: boolean` field that gives the Dashboard pin target (#P4-2 / #34) a stable contract for "which views are pinned."

## Inferred Requirements

The pages spec §11 + the issue body are the requirements source — no REQ-*.md was authored for this work (it's a plan task, not an interviewed enhancement). The implicit requirements captured during context gathering:

| ID | Inferred Requirement | Source |
|---|---|---|
| R1 | Pivot selections (measure/dim/grain/chart/mode/entity) are URL-encoded so the URL is a shareable permalink that recreates the chart exactly. | specs §11 + "any curated chart reproducible as an Explore query" acceptance criterion. |
| R2 | Saved views created from Explore are eligible to be pinned to the Dashboard without manual pin action — saving from Explore implies pin. | specs §11 "Save result as a Saved View (pins to Dashboard)". |
| R3 | Distribution mode applies to any measure, orthogonal to chart type — a histogram and percentile markers surface alongside or instead of the chosen chart. | specs §11 "Percentile/distribution mode for any measure". |
| R4 | Every Explore result point/bar/cell is drillable to Sessions filtered to that slice (drill-anywhere parity). | specs §0 "Drill-anywhere" (global analytics layer applies to every page). |
| R5 | The page reads from `transcript-only` data (Tier 🟢) — no premium capture required to render. | specs §11 all three sections carry 🟢 tier. |
| R6 | Cypress smoke spec + Storybook states + manual visual sign-off per Phase 4 standing rules. | specs/issues/P4-16-explore-page.md "Definition of done". |

## High-Level Structure

```
client/src/pages/explore/             ← new directory (Models pattern)
├── Explore.tsx                       page shell
├── PivotBuilder.tsx                  measure/dim/grain/chart/distribution/scatter controls
├── PivotResult.tsx                   dispatches on chart-type → ECharts/DataTable/scatter
├── SavedViewsGrid.tsx                lists pinned Explore-origin views, click restores pivot
├── usePivotState.ts                  URL ↔ pivot state; builds MetricsQuery (union)
├── usePivotState.test.ts             parser + dispatcher unit tests
├── Explore.test.tsx                  RTL: defaults render, toggle refetches, save round-trips
└── PivotBuilder.stories.tsx          Storybook: empty/loading/error/distribution/scatter

client/src/pages/Explore.tsx          MODIFIED — replace stub with shim re-export

shared/local-store-contract.ts        MODIFIED — SavedView.pinned? + validator acceptance
server/routes/views.ts                MODIFIED — POST /api/views accepts optional pinned
client/src/api/localStore.ts          MODIFIED — createView signature gains pinned?: boolean

cypress/e2e/explore.cy.ts             NEW — smoke spec per DoD
```

Data flow (one pivot interaction):

```
URL key change (e.g. ?xp.chart=scatter)
  → usePivotState parses → state {chart, measure, x, y, size}
  → usePivotState builds ScatterMetricsQuery (with sessionPopulation from useFilters)
  → TanStack Query useQuery(qk.metrics(query), postScatterMetrics)
  → POST /api/metrics → server/metrics/engine.ts metricsScatter() (existing)
  → ScatterMetricsResult → PivotResult renders via charts/scatterOption.ts + Chart.tsx
  → click on point → sessionsHrefForBucket or wouter navigate to /sessions/:id
```

Save flow:

```
User clicks "★ Save view" in PivotBuilder header
  → window.prompt for name → createView({name, path:"/explore", search, pinned:true})
  → POST /api/views → server/routes/views.ts persists with pinned:true
  → queryClient.invalidateQueries(qk.prefixes.views)
  → SavedViewsGrid re-renders with the new tile
  → Dashboard pin target (#P4-2) reads qk.views().filter(v => v.pinned) when its turn comes
```

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|---|---|---|---|
| HTTP transport | `POST /api/metrics` with discriminated union query | New route `/api/explore` | Rejected: violates "metrics engine covers every chart" (architecture §8); no consumer wants the split. |
| State location | URL query string under `xp.*` key prefix | React state | Architecture §11 mandates permalinks; acceptance criterion requires shareability. |
| Persistence | `~/.claude-lens/local.json` via `createView` | New file | Rejected: splits state, breaks #P4-15 contract. |
| Chart rendering | Reuse `Chart`, `DataTable`, `buildScatterOption`, `buildTimeseriesOption`, `buildDistributionOption` | Build new chart components | Rejected: introduces visual drift across pages. |
| Routing | Shim `client/src/pages/Explore.tsx` re-exports `./explore/Explore.js` | Inline in `Explore.tsx` | Models/Trends/CacheLab pattern — directory owns the real page, top-level shim keeps the import path stable for `routes.ts` and any other importer. |
| Validation | Hand-rolled enum guards (`isGrain`, etc.) like `ChartCard` | Schema library (zod, etc.) | Existing pages don't use one; over-engineering for URL-string parsing. |
| Saved-view pin contract | Add `pinned?: boolean` to `SavedView` | Implicit via `path === "/explore"` | Rejected: conflates *what the view is about* with *whether it's pinned*; Dashboard pin target (#P4-2) needs an explicit signal. |

## Patterns & Conventions

- **TanStack Query key factory (`qk.*`)** — single source of truth; Explore reuses `qk.metrics` (already covers all three modes) and `qk.views`. No new prefixes.
- **`mergeGlobalFilters`-style URL composition** — `usePivotState` patches `xp.*` keys onto the existing search string so the global filter chips (range/project/model/branch/host) and pivot config never stomp each other.
- **Section-level loading/error/empty states** — same rule Models/Trends follow: each section owns its own `isPending`/`isError`/`isEmpty` rendering so a single failure doesn't blank the page.
- **Bookmarkability + Back button parity** — every control change is a real `navigate()` (not `replace`), matching the FilterBar decision. Browser Back undoes one pivot change.
- **Storybook for component states, Cypress for routes** — Phase 4 standing rule (CLAUDE.md §delivery pipeline).
- **Models directory pattern** — Models/Trends/CacheLab all use `<page>/Page.tsx` + top-level shim. Explore follows.

## Data Models

### SavedView (extended)

**Purpose:** A named, persisted URL state snapshot — the same record used by FilterBar's "Save view" (filter-only) and Explore's "Save view" (pivot+filter).

**Key fields:**
| Field | Type / Constraint | Notes |
|---|---|---|
| `id` | `string` (server-generated UUID) | Unchanged. |
| `name` | `string` 1–200 chars | Unchanged. |
| `path` | `string` 1–200 chars | Unchanged. `/explore` when saved from Explore; `/sessions` etc. when saved from FilterBar. |
| `search` | `string` ≤200 chars | Unchanged. The full query string including `xp.*` keys when saved from Explore. |
| `pinned` | `boolean?` (**NEW**) | Optional. FilterBar writes `undefined` (not pinned); Explore writes `true` (pinned to Dashboard by convention). |
| `createdAt` | `string` (ISO) | Unchanged. |

**Relationships:**
- One-to-many with `LocalStore.views: SavedView[]`.
- Dashboard pin target (#P4-2) reads `views.filter(v => v.pinned)` — a stable contract that does not require Explore-specific knowledge.

**Lifecycle:**
- **Created** by `POST /api/views` (id + createdAt server-generated, `pinned` client-supplied or undefined).
- **Read** by `GET /api/views` (every consumer: SavedViewsTagsPanel, Explore's SavedViewsGrid, future Dashboard pin target).
- **Deleted** by `DELETE /api/views/:id`.
- **Persisted** in `~/.claude-lens/local.json` (deep-validated per-element by `isValidSavedView`).

### PivotState (client-side only)

**Purpose:** The decoded form of the Explore page's `xp.*` URL keys; lives only in memory and is re-derived from URL on every render.

**Shape:**
```ts
type PivotState =
  | { chart: "scatter"; measure: Measure; x: ScatterMeasure; y: ScatterMeasure; size?: ScatterMeasure; grain: Grain }
  | { chart: "bar" | "line" | "area" | "table"; mode: "series"; measure: Measure; dim: Dimension; grain: Grain }
  | { chart: "bar" | "line" | "area" | "table"; mode: "distribution"; measure: Measure; dim: Dimension; grain: Grain; entity: DistributionEntity };
```
(The three-way union is collapsed into one `MetricsQuery` build step inside `usePivotState`.)

**Lifecycle:** Re-derived on every render from `useSearch()`. No React state, no cache. Each setter triggers a single `navigate()`.

## API Contracts / Interfaces

No new server routes. Two boundary contracts shift:

### `POST /api/views` (modified request body)

**Boundary:** HTTP API (`client/src/api/localStore.ts` ↔ `server/routes/views.ts`).

**Operations:**
| Verb | Path | Purpose | Errors |
|---|---|---|---|
| POST | `/api/views` | Create a saved view. Body now accepts optional `pinned: boolean`. | 400 on invalid shape (unchanged contract — pinned is optional); 500 bubbles to app.ts top-level handler (unchanged). |
| GET | `/api/views` | List all saved views (unchanged shape — `pinned` may be present or absent per view). | 500 on disk read failure (unchanged). |
| DELETE | `/api/views/:id` | Delete by id (unchanged). | 404 on missing id (unchanged); 500 (unchanged). |

**Auth requirements:** None (local-first single-user).

### `POST /api/metrics` (no change — already supports all three modes)

**Boundary:** HTTP API (`client/src/api/metrics.ts` ↔ `server/routes/metrics.ts`).

**Operations:**
| Mode | Request shape | Response shape |
|---|---|---|
| `series` (default) | `SeriesMetricsQuery` | `Series[]` |
| `distribution` | `DistributionMetricsQuery` (adds `mode:"distribution"` + `distributionEntity`) | `Series[]` with per-series `.distribution` populated |
| `scatter` | `ScatterMetricsQuery` (adds `mode:"scatter"`, `entity:"session"`, `xMeasure`/`yMeasure`/`sizeMeasure?`/`sessionPopulation`) | `ScatterMetricsResult` |

`PivotResult` dispatches by `state.chart`:
- `bar` / `line` / `area` / `table` → `SeriesMetricsQuery` (or `DistributionMetricsQuery` if `state.mode === "distribution"`)
- `scatter` → `ScatterMetricsQuery`

## Module Boundaries

| Module | Responsibility | Allowed Dependencies |
|---|---|---|
| `client/src/pages/explore/*` | Page UI + URL state hook | `client/src/api/*`, `client/src/charts/*`, `client/src/filters/*`, `client/src/ui/*`, `shared/*` |
| `client/src/api/metrics.ts` | HTTP wrappers for `/api/metrics` | `shared/metrics-contract.js` only |
| `client/src/api/localStore.ts` | HTTP wrappers for `/api/views`, `/api/tags` | `shared/local-store-contract.js` only |
| `shared/metrics-contract.ts` | `Measure`/`Dimension`/`Grain`/`ScatterMeasure` unions + exhaustive-array validators | none |
| `shared/local-store-contract.ts` | `SavedView` shape + `isValidSavedView*` guards | none |
| `server/routes/views.ts` | `/api/views` CRUD | `shared/local-store-contract.js`, `server/local-store.ts` |
| `server/metrics/engine.ts` | `metrics()` + `metricsScatter()` | unchanged |

Rules:
- HTTP wrappers never import from `client/src/pages/`.
- Pages never import from `server/`.
- `qk.*` is the only place TanStack Query keys are minted.

## Change Footprint

### New files / modules

| Path | Purpose | Pattern reference |
|---|---|---|
| `client/src/pages/explore/Explore.tsx` | Page shell: FilterBar (global) → PivotBuilder → PivotResult → SavedViewsGrid | `client/src/pages/models/Models.tsx` |
| `client/src/pages/explore/PivotBuilder.tsx` | Controlled UI: Measure/Dim/Grain/Chart + Distribution toggle + Scatter X/Y/Size pickers | `client/src/charts/ChartCard.tsx` (toggle-group pattern) |
| `client/src/pages/explore/PivotResult.tsx` | Dispatches by chart-type; renders ECharts / DataTable / scatter / distribution | `client/src/pages/sessions/CostDistributionCard.tsx` + `EfficiencyScatterCard.tsx` |
| `client/src/pages/explore/SavedViewsGrid.tsx` | Lists pinned Explore-origin views from `qk.views()`, click restores URL | `client/src/pages/settings/SavedViewsTagsPanel.tsx` (list rendering) |
| `client/src/pages/explore/usePivotState.ts` | URL ↔ pivot state; builds `MetricsQuery` (series/distribution/scatter) | `client/src/filters/useFilters.ts` (URL-state pattern) |
| `client/src/pages/explore/usePivotState.test.ts` | Parser + dispatcher unit tests | existing `client/src/filters/state.test.ts` |
| `client/src/pages/explore/Explore.test.tsx` | RTL: defaults render, toggle refetches, save round-trips | `client/src/pages/sessions/Sessions.test.tsx` |
| `client/src/pages/explore/PivotBuilder.stories.tsx` | Storybook: empty, with-data, loading, error, distribution-mode, scatter-mode | `client/src/charts/ChartCard.stories.tsx` |
| `cypress/e2e/explore.cy.ts` | Smoke spec per DoD | `cypress/e2e/cache-lab.cy.ts` |
| `specs/architecture/ARCH-explore-page.md` | This document | — |

### Modified files / modules

| Path | What changes here |
|---|---|
| `client/src/pages/Explore.tsx` | Replace 5-line stub with shim `export { Explore } from "./explore/Explore.js"` (Models pattern) |
| `shared/local-store-contract.ts` | Add `pinned?: boolean` to `SavedView`; `isValidSavedViewInput` accepts optional `pinned: boolean`; `isValidSavedView` permits optional `pinned: boolean` |
| `server/routes/views.ts` | `POST /api/views` reads optional `pinned` from body, passes it through to the persisted `SavedView` |
| `client/src/api/localStore.ts` | `createView` signature: `createView(input: { name, path, search, pinned?: boolean }, signal?)` |
| `client/src/filters/FilterBar.tsx` | `SaveViewButton` keeps existing call shape (no `pinned` arg → defaults undefined → not pinned). No behavior change. |

### Deleted / replaced

| Path | Reason |
|---|---|
| (none) | The existing `client/src/pages/Explore.tsx` stub is *replaced* with a shim, not deleted. The path stays. |

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|---|---|
| `client/src/pages/settings/SavedViewsTagsPanel.tsx` | Reads `qk.views()`. Lists all views (pinned or not). Verify it doesn't choke on the new optional field — should be transparent. |
| `server/routes/views.ts` tests | May need a new test for `pinned` round-trip; existing per-test contract literals without `pinned` are still valid (optional field). |
| `server/local-store.ts` | Already deep-validates per-element via `isValidSavedView`; the validator widening auto-extends — no code change. |
| `client/src/pages/Trends.tsx`, `client/src/pages/CacheLab.tsx`, `client/src/pages/sessions/Sessions.tsx` | All call `postMetrics` / `postScatterMetrics`. `MetricsQuery` shape is unchanged (Explore uses the existing discriminator union), so their `as const` literals stay valid. |
| `client/src/charts/Chart.tsx`, `client/src/charts/timeseries.ts`, `client/src/charts/scatterOption.ts`, `client/src/charts/units.ts` | PivotResult reuses these. No changes; verify imports compile. |
| `cypress/e2e/settings.cy.ts` | Saved-views smoke spec exists but doesn't pin/unpin — should keep passing. Re-run after the contract change. |
| `client/src/api/queryKeys.ts` | Existing `qk.metrics` and `qk.views` keys cover Explore's needs; no new prefix required. WS invalidation bus continues to refresh both unchanged. |
| `client/src/api/metrics.ts` | `postMetrics` and `postScatterMetrics` already handle all three modes. No new wrapper needed. |

## Areas of Impact

| Area | Impact | Risk (L/M/H) | Why |
|---|---|---|---|
| Saved-view contract (`shared/local-store-contract.ts`) | One optional field added | **L** | Pure additive; existing validators are field-name-based, not exhaustive. |
| Server `/api/views` route | Accept + persist optional `pinned` | **L** | Two-line change; same write path. |
| `client/src/api/localStore.ts` `createView` | New optional param | **L** | All existing callers unchanged (FilterBar passes no `pinned`). |
| `client/src/filters/FilterBar.tsx` | Untouched code path | **L** | SaveViewButton's call to `createView` is shape-compatible (extra optional field is fine). |
| Settings page saved-views panel | Lists all views including pinned | **L** | No behavior change; just verifies the new field doesn't break the list. |
| Metrics engine contract | None | **None** | No change to `MetricsQuery` / `Series` / `ScatterMetricsResult`. |
| Routes table | None | **None** | `/explore` already points to the stub at `client/src/pages/Explore.tsx`; shim keeps the path stable. |
| WS invalidation bus | None | **None** | `qk.metrics` and `qk.views` prefixes already covered. |
| Dashboard pin target (#P4-2 / #34, future) | Now has a contract to consume | **None for #48; positive ripple** | The whole point of D3: this lands the contract #P4-2 will rely on. |
| Existing users' `~/.claude-lens/local.json` | Reads back unchanged | **None** | Optional field; no migration. Old code reading new files ignores `pinned`; new code reading old files sees `undefined`. |

**Contract changes:**
- `SavedView` gains optional `pinned?: boolean`. Additive only — all existing consumers (`SavedViewsTagsPanel`, FilterBar, server route) continue to work without code changes.
- `isValidSavedViewInput` accepts optional `pinned: boolean`. Backward-compatible (was previously strict; now optionally allows the field).
- All other public contracts unchanged.

**Cross-cutting ripples:**
- None for auth/telemetry/migrations/build pipeline. The change is additive across one optional field + new client files.

## Cross-Cutting Concerns

- **Errors:** TanStack Query surfaces non-2xx as `Error` (aggregate) or `MetricsApiError` (scatter). Save-view failures render an inline alert next to the Save button. URL parser silently ignores unknown `xp.*` keys (don't 400 the user for a typo).
- **Logging & metrics:** No new server log lines (no new server route). Existing Fastify logging on `/api/metrics` and `/api/views` is unchanged. Client-side, no new console output.
- **Auth / authz:** None — local-first single-user app.
- **Performance:** TanStack Query dedupes by `qk.metrics(query)`. `keepPreviousData` prevents blank-on-toggle. AbortSignal cancels in-flight requests when the user toggles quickly. Scatter is bounded at 500 points server-side (existing contract cap).
- **Security:** Validation at two boundaries — `usePivotState` validates `xp.*` values against the `Measure`/`Dimension`/`Grain`/`ScatterMeasure` unions and falls back to defaults; server-side `isValidSavedViewInput` rejects malformed `pinned` (must be boolean if present, else 400).
- **Migrations / rollout:** No schema migration. The `pinned` field is optional and additive. Backward-compatible for both old code reading new files (ignores field) and new code reading old files (sees `undefined`).

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies |
|---|---|---|---|---|
| A1 | Pivot state in URL under `xp.*` keys, merged with global filter keys via a `mergePivotFilters` helper that mirrors `mergeGlobalFilters`. | React state; separate Jotai/Redux store | Architecture §11 mandates permalinks; "any curated chart reproducible as an Explore query" is the binding acceptance criterion. | R1 |
| A2 | Chart-type coverage: bar/line/area/scatter/table + distribution mode toggle (orthogonal to chart). | Restrict to bar/line only; defer scatter/table | Spec §11 lists all five; engine supports all five. | R3, R5 |
| A3 | Add `pinned?: boolean` to `SavedView`. | Implicit pin via `path === "/explore"`; new `/api/views/:id/pin` route | Dashboard pin target (#P4-2) needs an explicit contract; URL-path heuristic conflates *what* with *pinned-ness*; a new route adds API surface for no benefit. | R2 |
| A4 | Reuse `EfficiencyScatterCard` and `CostDistributionCard` patterns (ECharts option builders, `qk.metrics`, `useFilters` for range). | Build parallel Explore-specific chart components | Visual drift risk; existing components already ship. | R4 |
| A5 | Saved Views list on Explore surfaces pinned views; click restores URL via `navigate(`${path}${search}`)`. | Modal picker; in-place replace | Matches the mockup's third panel; URL round-trip is the canonical pattern. | R2 |
| A6 | No new server route. | New `/api/explore` route | Memory `metrics-engine-covers-curated-pages`: Phase 4 pages reduce to `/api/metrics` queries; no new server route needed. | R5 |
| A7 | Shim `client/src/pages/Explore.tsx` re-exports `./explore/Explore.js` (Models/Trends/CacheLab pattern). | Inline page in `Explore.tsx` | Directory layout keeps helper/panel files together; top-level shim preserves the import path in `routes.ts`. | R5, R6 |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|---|---|
| Metrics engine returns slow / times out for a complex pivot. | TanStack Query exposes `isPending`; `PivotResult` renders a skeleton. `placeholderData: keepPreviousData` keeps the previous chart on screen during refetch. `signal` cancels in-flight requests on rapid toggle. |
| User types a garbage value in URL (e.g. `?xp.measure=garbage`). | `usePivotState` validates against `MEASURES`/`DIMENSIONS`/`GRAINS`/`ScatterMeasure`; unknown values fall back to defaults. No throw, no 400. |
| Two clients save a view simultaneously (theoretical — local-only app). | `mutateLocalStore` is already serialized per-file-path (`mutationQueues` map). Second gets the first's state in `current`; both writes are atomic. |
| `local.json` corrupted mid-write (power loss). | `readLocalStore` falls back to `{views:[], tags:{}}` on JSON parse error. Best-effort salvage per `isValidSavedView`. New `pinned` field is optional — partially-written view reads back as `pinned:undefined`. |
| User creates a view pointing to a pivot that's no longer valid (e.g. a Measure gets removed in a future release). | `usePivotState` defaults-on-invalid — re-opening a saved view silently falls back to defaults rather than 500ing. Could improve later by storing the pivot config explicitly in `SavedView`, but URL round-trip is the explicit choice per architecture §11. |
| User toggles Chart rapidly (bar → line → area → scatter in quick succession). | AbortSignal cancels in-flight requests; only the latest query's response is rendered. `placeholderData` keeps a chart on screen until the new response lands. |

### Backward — regression risk per touched area

| Touched area | What could regress | How we'd know / mitigation |
|---|---|---|
| `client/src/pages/settings/SavedViewsTagsPanel.tsx` | Could fail to render if `pinned:true` views aren't accepted in the list. | Manual smoke: save an Explore view → confirm Settings lists it. Existing test `Settings.test.tsx` covers list rendering. |
| `client/src/filters/FilterBar.tsx` | Could break if `createView`'s new signature is incompatible with its current call. | FilterBar calls `createView({name, path, search})` — `pinned` is optional and defaults to undefined. No change to call site; behavior unchanged. Verified by `npm run verify`. |
| Server `views` route | Could break if a hand-written client passes `pinned:"yes"`. | `isValidSavedViewInput` rejects with a typed 400 (mirror existing pattern). Existing `views.test.ts` covers shape validation. |
| `server/local-store.ts` | Could fail to read a `local.json` written by an older client with no `pinned` field. | The per-element guard (`isValidSavedView`) only checks named fields; missing `pinned` is fine. Verified by reading any pre-existing `local.json` after deploy. |
| Sessions / Trends / CacheLab pages | Could break if `MetricsQuery` literals using `as const` widen incorrectly. | `MetricsQuery` is unchanged. No widening. Verified by `npm run verify`. |
| `local.json` written by an older app version | Could fail to deserialize with the new validator. | The new `isValidSavedView` accepts the old shape (optional `pinned` is fine). Verified by `npm run verify` against the test fixture. |

## Open Questions

- **Should Explore also support a "Saved views filter" (showing all views, not just pinned)?** — *Impact if unresolved:* users who save from Explore without wanting to pin would have no UI to revisit them (they'd still appear in Settings, just not on Explore). *Suggested default:* show pinned only on Explore; Settings remains the management view. Revisit if user feedback says otherwise.

- **Should the Explore Save flow offer "Pin to Dashboard" as an opt-out checkbox?** — *Impact if unresolved:* users who want an unpinned Explore-saved view can't get one from Explore (they'd have to save from FilterBar). *Suggested default:* always pin from Explore (matches the spec language "pins to Dashboard"). Revisit if users complain about Dashboard clutter.

- **Should the scatter variant in Explore allow `size` to be a separate dimension (e.g. bubble-by-model) instead of just a measure?** — *Impact if unresolved:* users can only size scatter points by a measure, not a dimension. *Suggested default:* measure only (matches the metrics-contract `sizeMeasure?: ScatterMeasure`). Revisit if a clear use case surfaces.

## Out of Scope

- **Dashboard pin rendering** (#P4-2 / issue #34) — this issue delivers the *contract* (the `pinned` field); the Dashboard view that *displays* pinned views is a separate task. Out of scope for #48.
- **Saved-view editing in-place** (rename, re-pivot an existing saved view from Explore). Settings has rename-via-prompt for views, which is enough. A richer in-place editor can come later.
- **Explore as a saved-view editor (open a saved view and re-pivot, save back to same id).** — feasible (just re-POST with same name), but the spec doesn't require it. Future enhancement.
- **Export current view as CSV/JSON** — listed in specs §0 ("Export current view") but applies to every page globally, not Explore-specific. Out of scope for #48 unless the task explicitly takes it on.
- **Sharing Explore views across machines** — local-first app; sharing = copy the URL.

---

# Tasks

_This section is populated by the **generate-tasks** skill (Phase 3)._
_Run: `/generate-tasks from: specs/architecture/ARCH-explore-page.md`_
