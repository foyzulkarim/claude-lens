# Architecture: Projects page

> **Date:** 2026-07-19
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Plan task #P4-7 / GitHub issue #39 (`specs/issues/P4-7-projects-page.md` + `specs/context/39.md`); section contract from `specs/claude-lens-pages.md` §5; visual reference `specs/pages/projects.html` (binding over mockup per CLAUDE.md / Phase 4 standing rule)
> **Type:** feature

## Architecture Summary

Replace the `client/src/pages/Projects.tsx` stub with a four-section page (Spend composition stacked-area / Projects efficiency table / per-branch breakdown / project selector) composed entirely of preset `MetricsQuery` calls against the existing `POST /api/metrics` engine. No new server route, no new engine mode, no new dependency — every dimension (`time`/`project`/`gitBranch`) and every measure (`costComputed`/`sessions`/`turns`/`inputTokens`/`outputTokens`/`cacheReadTokens`/`cacheCreateTokens`) the spec requires is already first-class in `shared/metrics-contract.ts` and `server/metrics/dimensions.ts`. The work reuses the established `client/src/pages/models/` directory shape (shell + per-section panel + hook bundle + drilldown helper) so Stories / Tests / Cypress coverage pattern match the five closed pages around it. Gate pass-rate reserves its column for #P4-12 by rendering a `—` stub; the top-N+other composition cap and top-3+more branch disclosure both reuse existing engine output with no aggregation in the panel.

## Inferred Requirements

This issue references the spec table directly — no REQ interview was run. Inferred bindings that downstream skills can lean on:

| ID   | Inferred Requirement                                                                                                                                                          | Source                                              |
|------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------|
| IR-1 | Page MUST satisfy the five `specs/claude-lens-pages.md` §5 rows: stacked-area composition (🟢), WoW project growth (🟢), efficiency table incl. gate pass stub (🟢), per-branch breakdown (🟢), Project → sessions drill (🟢) | spec table §5                                        |
| IR-2 | Page MUST match `specs/pages/projects.html` per Phase 4 standing rule 3, with the spec-vs-mockup resolution rule (the spec adds gate pass column not in mockup, omits the page-wide $ computed badge stub) | standing rule 3                                      |
| IR-3 | Page MUST stay within the existing `POST /api/metrics` query surface (no new server route) per architecture §3 module-boundary rule and the team's `metrics-engine-covers-curated-pages` decision | architecture §3 + memory note                       |
| IR-4 | Page MUST live-update on transcript appends without reload, via the existing per-session `session-updated` → `qk.prefixes.metrics` invalidation bus (architecture §7)            | architecture §7                                      |
| IR-5 | Page MUST produce a Cypress smoke spec (route renders key sections + one drill lands filtered) and Storybook coverage for component states (Phase 4 standing rule 1)        | Phase 4 standing rule 1                              |

## High-Level Structure

```
Global filter bar (URL-owned, shared with every page)
                │
                ▼
┌──────────────────────────────────────────────────────────────┐
│ Projects() — page shell                                      │
│  useProjectsQueries(filters, grain) → { composition,         │
│     efficiency, branchesOf(projectId) }                      │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ SpendComposition — ChartCard-shaped stacked area        │ │
│  │ dimensions: ["time","project"] · measures: costComputed  │ │
│  │ compare: previous-period · shape: area/bars · unit: $/…  │ │
│  │ click bucket → /sessions?project=&from=&to=              │ │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ EfficiencyTable — DataTable                             │ │
│  │ dimensions: ["project"] · measures: cost + 4 tokens +   │ │
│  │   sessions + turns · compare: previous-period · WoW     │ │
│  │ derived per-row: $/session, cache%, tok/turn, gate stub │ │
│  │ row click → /sessions?project=<x>                        │ │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Chip row — one chip per visible project from B; click   │ │
│  │ updates `selectedProject` (local state, section owned). │ │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ BranchBreakdown — bar list (top-3 + "show all")         │ │
│  │ dimensions: ["gitBranch"] · filters: { project:[sel] }  │ │
│  │ click branch → /sessions?project=<x>&branch=<y>          │ │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                │
                ▼
POST /api/metrics   (existing route — server/routes/metrics.ts)
                │
                ▼
SeriesMetricsQuery → server/metrics/engine.ts → store data
                                                (server/store/store.ts)
```

**What changes in the existing system:** only `client/src/pages/Projects.tsx` becomes a 5-line re-export shim mirroring `Models.tsx`. No server code, no shared contract, no other page.

## Tech Choices

| Area                          | Decision                                                                                                | Alternatives Considered                                  | Rationale                                                                                                                                                                                                 |
|-------------------------------|---------------------------------------------------------------------------------------------------------|---------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Data source                   | `POST /api/metrics` only (no new route)                                                                 | New `GET /api/projects` returning bespoke payload       | Architecture §3 enforces "pages never aggregate raw data"; engine already returns `dimensions:["time","project"]` and `dimensions:["gitBranch"]` series (validated against fixture acceptance in #P2-8) |
| Composition chart family      | Stacked `line + area` ECharts via a new `buildSpendCompositionAreaOption`                                | Reuse `buildModelMixAreaOption` verbatim                | The model-mix builder names its shared stack `"model-mix"` and its legend uses model labels — sharing the same builder would couple Pages-Models. A ~30-LOC sibling with the same stack semantics is clearer. |
| Composition cap               | Top-N + `"other"` bucket when a bucket has > 8 distinct projects                                          | Render every project                                  | Stacks past ~8 entries become unreadable; engine still returns per-project series so section B's table keeps the full set                                                                                  |
| Branch panel cap              | Top-3 bars + `"show all N branches"` toggle (local `useState`)                                           | Render every branch                                    | Matches `specs/pages/projects.html` mockup verbatim (3 bars + caption); most projects have ≤3 distinct feature branches in real data                                                                     |
| Hook bundle                   | One `useProjectsQueries(filters, grain)` mirroring `useModelsQueries`                                    | Three independent `useQuery` calls in each panel        | Established pattern across Models / Cache Lab — TanStack dedupes by query key, so panel-level fetching the same body would either duplicate or fight the cache                                                    |
| Drill helper                  | New `projects/drilldown.ts`: `projectHref` + `branchHref`                                                | Reuse `models/drilldown.ts`                            | Models' helpers cover `model` and `entrypoint` only; Projects needs `project` chip replacement plus a `project+branch` combined chip + `lastActiveFrom` ordering. Parallel helper stays ~60 LOC                  |
| Gate pass-rate cell           | Reserve column, render `—` until #P4-12 drops in                                                          | Omit column until #P4-12                                | Issue acceptance text explicitly says "Gate pass-rate column ... stubs until #P4-12". Stable column avoids a #P4-12 layout ripple                                                                              |
| Per-section display prefs     | Local `useState` (unit, shape, branch cap toggle) — not URL-owned                                        | URL-owned                                              | Architecture §11 + Phase 4 standing rule 2: display prefs are not shareable filter state                                                                                                                   |
| Last-active "Nd ago" column   | New `format.ts`: `compactTokens`, `lastActiveFrom(now)`                                                  | Pull date-fns into the page directory                   | date-fns is already a client dep (`architecture §2`); a 5-LOC helper colocated with the page avoids pulling more surface                                                                                     |

## Patterns & Conventions

- **Per-section state ownership** (architecture decision A5, Models/Dashboard/Trends precedent) — every panel owns its own query/loading/empty/error state; the page shell does no fetching of its own.
- **One-query-per-section-family** (Models precedent) — three distinct `useQuery` bodies, three distinct `qk.metrics(query)` keys, all under the existing `qk.prefixes.metrics` umbrella so per-session WS invalidation already refetches them.
- **`useStableNow` shared clock** (decisions log 2026-07-14) — memoize query bodies on `(filtersKey, grain, now)` tuple, never on a fresh `Date`, so refreshes merge into existing cache entries.
- **`keepPreviousData` on every query** (`useModelsQueries` pattern) — fast filter-bar toggles keep the previous chart visible; bare `isPending` only flashes when the query identity genuinely changes.
- **Pure URL drilldown helpers** (`models/drilldown.ts` precedent) — no React, no router imports; Storybook and Vitest can pin behavior without mounting a wouter tree. Sorted CSV chip encoding + percent-encoding + range-preservation rules match the established patterns.
- **No raw aggregation client-side** (architecture §3) — the efficiency table derives per-row ratios from the existing per-project series (same approach as Models' `EfficiencyTable.tsx`); WoW delta pulls from the engine's `compareGhost`; section C's last-active sort reads `series.dimensionKey`'s sibling via already-fetched session rollups only when needed.
- **Mockup-disclaimer respected** (CLAUDE.md / `_chrome.css` note) — `projects.html` is visual reference only; the spec section table is binding; no implementation contract for the page-wide `$ computed` badge label, the filter chip dropdowns, etc.

## Data Models

### `MetricsQuery` (existing — reused as-is)

**Purpose:** the single vocabulary the metrics engine accepts (architecture §8, `shared/metrics-contract.ts:91-168`). Three `SeriesMetricsQuery` flavors serve this page.

**Per-section bodies:**

| Section                     | measures                                                                                              | dimensions                  | grain   | filters                                 | other                                                  |
|-----------------------------|-------------------------------------------------------------------------------------------------------|-----------------------------|---------|-----------------------------------------|--------------------------------------------------------|
| Spend composition (A)       | `["costComputed"]`                                                                                    | `["time","project"]`        | `day`   | global (URL)                            | `compare: "previous-period"`                            |
| Efficiency table (B)        | `["costComputed","sessions","inputTokens","outputTokens","cacheReadTokens","cacheCreateTokens","turns"]` | `["project"]`               | `day`   | global (URL)                            | `compare: "previous-period"`                            |
| Branch breakdown (C)        | `["costComputed"]`                                                                                    | `["gitBranch"]`             | `day`   | global ∪ `{ project:[selectedProject] }` | none                                                    |

**Empty-bracket semantics:** the engine returns the `"all"` group when no breakdown dimensions are passed (engine.ts:124-128); we never send an empty `filters` object (the route validator in `routes/metrics.ts:44-56` rejects empty array values, and `filtersToQuery` in `filters/state.ts:179-189` already drops empty arrays).

### `Series[]` (existing — consumed; not re-shapped)

**Purpose:** what `metrics(query)` returns. The option builders (`chart-options.ts`, `drilldown.ts`, panel renderers) consume the existing `Series[]` contract — `dimensionKey` derived from `dim:value` per engine.ts:82-88, `label` human-readable, `points: [{t, value}]`, `compareGhost`/`basis` as documented.

### BranchBreakdown row (new view-model, derived client-side)

**Purpose:** the bar-list row shape for section C, derived entirely from the section C `Series[]` response.

**Fields:**
| Field        | Type                                                  | Notes                                                                |
|--------------|-------------------------------------------------------|----------------------------------------------------------------------|
| `branch`     | `string`                                              | `series.label`                                                        |
| `cost`       | `number`                                             | summed across all buckets in `series.points`                          |
| `maxCost`    | `number`                                              | from the top-3 sub-list, used to compute bar widths                    |
| `lastActive` | `string \| undefined`                                | if a `lastAt` companion series is included (drives "Nd ago" column)   |

**Lifecycle:** built per-render from the fetched series set, never persisted, no identity across re-renders other than `branch` value.

### EfficiencyTable row (new view-model, derived client-side)

**Purpose:** per-project row shape for section B, derived from the section B `Series[]`.

**Fields:**
| Field              | Type                  | Notes                                                                                                                  |
|--------------------|-----------------------|------------------------------------------------------------------------------------------------------------------------|
| `project`          | `string`              | `series.label`                                                                                                          |
| `spend`            | `number`              | sum of `costComputed`                                                                                                   |
| `spendPrev`        | `number \| undefined` | sum of `costComputed.compareGhost` (drop column entirely if `compareGhost` is missing, mirroring `StatCardsRow`)         |
| `sessions`         | `number`              |                                                                                                                         |
| `cacheHitPct`      | `number \| null`      | derived from `cacheReadTokens / (inputTokens + cacheRead + cacheCreate)` (matches the existing Dashboard helper math)  |
| `tokensPerTurn`    | `number \| null`      | derived from `(inputTokens + outputTokens) / turns`                                                                     |
| `dollarsPerSession`| `number \| null`      | derived from `costComputed / sessions`                                                                                  |
| `lastActive`       | `string \| undefined` | last-bucket timestamp                                                                                                   |
| `gatePassRate`     | `null`                | stub; stays `null` until #P4-12 supplies real values; column renders `—`                                                |

**Lifecycle:** derived per-render from the fetched series set; `WoW` direction is `Math.sign(spend - spendPrev)` evaluated at cell-render time.

## API Contracts / Interfaces

This issue adds **zero new HTTP boundaries** — every contract below already exists and is reused.

### `POST /api/metrics` — `client → server`

**Boundary:** HTTP API (existing route, `server/routes/metrics.ts:280-301`).

**Per-section requests:**

| Section   | Request body                                                                                                                                                         | Success                                                  | Errors                                                                                       |
|-----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------|----------------------------------------------------------------------------------------------|
| A         | `SeriesMetricsQuery{ measures:["costComputed"], dimensions:["time","project"], grain:"day", range, filters?, compare:"previous-period" }`                            | `Series[]` — one per `(costComputed, project)` time series | 400 from `parseMetricsQuery` (`routes/metrics.ts:179-265`); existing `MetricsApiError` parse  |
| B         | `SeriesMetricsQuery{ measures:[7 measures], dimensions:["project"], grain:"day", range, filters?, compare:"previous-period" }`                                       | `Series[]` — one per `(measure, project)`                | as above                                                                                     |
| C         | `SeriesMetricsQuery{ measures:["costComputed"], dimensions:["gitBranch"], grain:"day", range, filters:{ project:[selected] ∪ ...global } }`                           | `Series[]` — one per `gitBranch` value                   | as above                                                                                     |

**Auth requirements:** none (local-first single-user).

## Module Boundaries

| Module / Package                              | Responsibility                                                                            | Allowed Dependencies                                                                 |
|-----------------------------------------------|-------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| `client/src/pages/projects/Projects.tsx`      | Page shell — composes 4 sections, exposes global error sink via per-section `isError`     | `@tanstack/react-query`, `wouter`, the four sibling components, `useProjectsQueries`  |
| `client/src/pages/projects/useProjectsQueries.ts` | Builds 3 stable `SeriesMetricsQuery` bodies, returns typed `UseQueryResult<Series[]>`s   | `@tanstack/react-query`, `api/metrics.js`, `api/queryKeys.ts`, `filters/state.ts`, `pages/dashboard/useStableNow` |
| `client/src/pages/projects/SpendComposition.tsx` | Stacked-area panel, top-N+other composer, shape/unit toggles, bucket-click drill         | `charts/Chart`, `charts/timeseries`, `charts/units`, `charts/drilldown`, `ui/toggleStyles`, `projects/chart-options`, `projects/drilldown` |
| `client/src/pages/projects/EfficiencyTable.tsx` | Per-project `DataTable` with WoW delta + gate stub column                                 | `components/DataTable`, `projects/drilldown`, `projects/format`, `filters/state.ts`   |
| `client/src/pages/projects/BranchBreakdown.tsx` | Top-3 bar list with "show all" toggle, branch drill                                       | `charts/timeseries` primitives, `projects/drilldown`, `projects/format`                |
| `client/src/pages/projects/ProjectSelector.tsx` | Chip row above the branch panel, derived from section B's output                          | `pages/dashboard/DrillStatCard` patterns are *not* used here — chips are local   |
| `client/src/pages/projects/chart-options.ts`   | Pure ECharts option builders, top-N+other composer                                         | `echarts` type contracts, `charts/units`                                               |
| `client/src/pages/projects/drilldown.ts`       | Pure URL builders (`projectHref`, `branchHref`)                                          | `filters/state.ts` only                                                                |
| `client/src/pages/projects/format.ts`          | `$`, `compactTokens`, `lastActiveFrom(now)`                                              | `date-fns` (already a client dep)                                                       |

**Cross-cutting rule** (architecture §3): this directory imports from `api/`, `charts/`, `components/`, `filters/`, `ui/`, `pages/dashboard/useStableNow` — never from `server/`, never from `store/`, never from the new metrics engine code.

## Change Footprint

### New files / modules

| Path                                                          | Purpose                                                          | Pattern reference                |
|---------------------------------------------------------------|------------------------------------------------------------------|----------------------------------|
| `client/src/pages/projects/Projects.tsx`                       | Page shell — composes the four sections                          | `models/Models.tsx`              |
| `client/src/pages/projects/Projects.stories.tsx`               | Stories: one per section + full-page composable                 | `models/Models.stories.tsx`      |
| `client/src/pages/projects/Projects.test.tsx`                  | jsdom smoke covering heading + testids + loading/empty/error + four query body shapes | `models/Models.test.tsx`         |
| `client/src/pages/projects/useProjectsQueries.ts`               | Hook bundle — memoizes 2 stable + 1 dynamic `SeriesMetricsQuery` | `models/useModelsQueries.ts`     |
| `client/src/pages/projects/SpendComposition.tsx`                | Section A stacked-area chart panel                              | `models/ModelMixOverTime.tsx`    |
| `client/src/pages/projects/EfficiencyTable.tsx`                 | Section B `DataTable` with derived ratios + WoW + gate stub cell | `models/EfficiencyTable.tsx`     |
| `client/src/pages/projects/BranchBreakdown.tsx`                 | Section C bar list (top-3 + "show all" toggle)                   | new (small)                      |
| `client/src/pages/projects/ProjectSelector.tsx`                 | Chip row above section C                                         | new (small)                      |
| `client/src/pages/projects/chart-options.ts`                   | Stacked-area + top-N+other composer                              | `models/chart-options.ts`        |
| `client/src/pages/projects/drilldown.ts`                       | `projectHref`, `branchHref` URL builders                          | `models/drilldown.ts`            |
| `client/src/pages/projects/drilldown.test.ts`                  | URL preservation tests                                            | `models/drilldown.test.ts`       |
| `client/src/pages/projects/format.ts`                          | `compactTokens`, `lastActiveFrom`                                | new (small)                      |
| `cypress/e2e/projects.cy.ts`                                   | Route renders key sections + one drill lands filtered             | `cypress/e2e/models.cy.ts`       |

### Modified files / modules

| Path                                                  | What changes here                                                                                       |
|-------------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| `client/src/pages/Projects.tsx` (5-line body)         | Replace 3-line stub with `export { Projects } from "./projects/Projects.js"` (mirrors `Models.tsx`)     |

### Deleted / replaced

None.

### Touched but not changed (silent-regression hotspots)

| Path                                                              | Why it matters                                                                                                                                |
|-------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------|
| `client/src/routes.ts`                                            | `import { Projects } from "./pages/Projects.js"` — already points at this file; rewriting the shim body does not affect `routes.ts`                |
| `client/src/layout/AppShell.tsx`                                  | Its nav reads from `routes.ts`; the `label: "Projects"` row already exists                                                                     |
| `client/src/api/metrics.ts`, `client/src/api/queryKeys.ts`        | Imported by the new hook bundle; no method/key shape change                                                                                     |
| `client/src/filters/state.ts`                                     | `parseFilters` / `serializeFilters` / `mergeGlobalFilters` / `filtersToQuery` reused verbatim                                                   |
| `client/src/charts/Chart.tsx`, `client/src/charts/ChartCard.tsx`  | Compose-only; chart merge semantics (#P4-20 fix) already in place — section A benefits without edits                                           |
| `server/store/store.ts`, `server/metrics/engine.ts`                | Already produce the per-project + per-branch series the panel consumes                                                                          |
| `server/routes/sessions.ts`                                       | Already accepts `?project=<csv>` and `?branch=<csv>` (lines 159-180, 263); the drill helper drops chips into the same shape the route already parses |

## Areas of Impact

| Area                                                                  | Impact                                                                                                | Risk (L/M/H) | Why                                                                                                                 |
|----------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|--------------|---------------------------------------------------------------------------------------------------------------------|
| `client/src/pages/Projects.tsx` (shim)                                | Becomes a 5-line re-export; old body deleted                                                          | L            | Already a stub; replacing its body never worked; no production code or wire contract depends on its content          |
| `client/src/pages/Projects.tsx` callers (`routes.ts`, `App.tsx`)      | Continue to import the same path; no edit required                                                   | L            | Component identity preserved by re-export                                                                            |
| `client/src/api/metrics.ts`, `client/src/api/queryKeys.ts`            | New consumers added; contract unchanged                                                                | L            | Hook bundle calls the same `postMetrics` and uses the same `qk.metrics(query)` shape as Models/Cache Lab             |
| `client/src/filters/state.ts`                                        | Three new consumers; no edit required                                                                 | L            | Hook bundle calls `filtersToQuery` and `serializeFilters` already used by 5 sibling pages                            |
| WS invalidation bus                                                   | The three new keys fall under `qk.prefixes.metrics`; existing per-session invalidation already covers them | L            | Architecture §7 contract — `metrics` prefix is the umbrella `session-updated` invalidates                           |
| Live-update merge semantics                                           | Sections A and C rely on `Chart.tsx`'s merge mode to avoid flicker during active-session invalidation  | L            | #P4-20 already corrected this — nothing project-specific                                                              |
| Sessions route URL schema                                             | Drill destinations reuse `?project=` and `?branch=` already parsed                                       | L            | Same shape the Sessions page already consumes; cross-section round-trip already covered                              |
| Gate pass-rate cell (EfficiencyTable column 6)                       | Stub until #P4-12; becomes a one-cell edit                                                            | L            | Stable column reserve; #P4-12 spec text confirms this is the integration slot                                          |
| Premium tier (#P4-13)                                                 | No contract edit; section A is 🟢 with no premium path                                                  | L            | Spec row stays 🟢; spec-vs-mockup resolution rule documented                                                         |
| `server/metrics/engine.ts`                                            | Not touched                                                                                            | L            | All three queries already validated against fixture acceptance in #P2-8                                               |

**Contract changes:** none. No HTTP route added, no shared contract (`shared/*.ts`) changed, no event payload changed. The smallest possible surface for a Phase 4 page of this size.

**Cross-cutting ripples:** none. Auth/telemetry/migrations/feature-flags/build-pipeline/build outputs are all unchanged; the artifact tree (build.ts + vite) treats this directory like any other client page.

## Cross-Cutting Concerns

- **Errors:** each section renders `<p role="alert">` inside its own panel boundary; the page shell does no fetching of its own, so a single section's fetch failure cannot blank the page (architecture decision A5; Dashboard/Models/Trends precedent).
- **Logging & metrics:** no new server logs; the existing `POST /api/metrics` instrumentation covers the three new queries; `ws.ts` continues to log WS connect/reconnect as today.
- **Auth / authz:** N/A (local-first single-user).
- **Performance:**
  - Budget: section A returns ≤8 series after top-N+other composer cap; section B returns ≤10 series for typical local datasets (each dimension × measure combo); section C returns ≤~10 series for typical project. Total wire payload stays in the "few hundred KB" band.
  - Live-update path: existing per-session `session-updated` debounce (200-500ms per session) plus `keepPreviousData` keeps the UI from blanking during active sessions.
  - No new query on every render: the hook bundle memoizes on `(filtersKey, grain, now)` and a separate mem dep on `selectedProject` for section C only.
  - Tabular section B stays client-side sorted (≤tens of rows) so no server-side paginate.
- **Security:** no new validation surface; URL drill helpers preserve percent-encoding the same way `models/drilldown.ts` does.
- **Migrations / rollout:** none. The page installs as a single branch; flip the `feat/39/projects-page` checkbox when the merge lands per Phase 4 standing rule 3.

## Architecture Decisions Log

| #   | Decision                                                                                              | Alternatives                                      | Chosen Because                                                                                                                                                | Satisfies REQs |
|-----|-------------------------------------------------------------------------------------------------------|---------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------|
| A1  | Use `POST /api/metrics` only (no new server route)                                                     | Add `GET /api/projects` bespoke shape             | Architecture §3 + `metrics-engine-covers-curated-pages` memory: pages never aggregate raw data; engine already serves every required dimension × measure   | IR-3           |
| A2  | Page directory lives at `client/src/pages/projects/` with a 5-line shim at `client/src/pages/Projects.tsx` | Co-locate everything inside the shim              | Mirrors the Models/Trends/Cache Lab pattern; shim keeps `routes.ts` and `App.tsx` import path stable                                                            | IR-2, IR-3     |
| A3  | Three `useQuery` bodies coordinated by `useProjectsQueries`                                          | Per-panel `useQuery` calls                          | Established pattern across Models / Cache Lab (decision A5); TanStack dedupes by key, so panel-level fetching would either duplicate or fight the cache      | IR-3, IR-4     |
| A4  | Stacked-area chart uses a sibling `buildSpendCompositionAreaOption` (not the model-mix builder)       | Reuse `buildModelMixAreaOption` verbatim          | Both share stack semantics, but the model-mix builder hardcodes the stack id `"model-mix"` and labels as model; a sibling keeps Pages-Models decoupled          | IR-2, IR-3     |
| A5  | Top-N + `"other"` cap on the composition chart when a bucket has > 8 distinct projects                | Render every project                              | Stacks past ~8 entries become unreadable; engine still returns per-project series, so section B's table keeps the full set                                    | IR-2           |
| A6  | Top-3 + "show all N branches" toggle in the branch breakdown                                          | Render every branch                                | Matches `projects.html` mockup; most projects have ≤3 distinct feature branches; users can opt-in to the full list                                            | IR-2           |
| A7  | Gate pass-rate column reserved with `—` stub cell                                                      | Omit the column until #P4-12 lands                | Issue acceptance explicitly says "Gate pass-rate column ... stubs until #P4-12"; stable column avoids a #P4-12 layout ripple                                  | IR-2           |
| A8  | New `projects/drilldown.ts` for `projectHref` + `branchHref`                                         | Reuse `models/drilldown.ts`; add a section-style chart helper | Models' helpers cover model and entrypoint only; Projects needs `project` chip replacement + a `project+branch` combined chip + `lastActiveFrom` ordering  | IR-2           |
| A9  | Last-active "Nd ago" column sourced from session `lastAt` already present in the same Series[]       | Fire a second `/api/sessions` round-trip        | Engine emits `lastAt`-aligned bucket boundaries; reusing keeps the page to 3 metrics calls total                                                                | IR-3           |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario                                                                  | How the Design Handles It                                                                                                                                                |
|---------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Active Claude Code session appends calls while page is mounted            | Existing per-session `session-updated` invalidates `qk.prefixes.metrics`; TanStack refetches the 3 mounted queries; `keepPreviousData` keeps the previous series visible; `Chart` merge mode (#P4-20) prevents full redraw flicker |
| 50 active projects (long tail) across the date range                       | Section A's top-N+other cap keeps the legend at most 9 entries; engine still produces one series per project so section B's table keeps the full set                      |
| User narrows filters to a single project                                  | Section A still renders; section C's `selectedProject` defaults to that single project automatically; section B's table collapses to one row with no error              |
| Filter-bar toggles between range presets rapidly                           | `filtersKey` is stable on the global filter state; `useMemo` keys produce the same `(filters, grain, now)` identity across renders → no spurious refetch                  |
| Engine returns no rows because project dimension is all-`unknown`         | Section A, B, C empty-state components (mirrors Models' `EmptyState` usage); page heading still renders                                                                  |
| #P4-12 lands and supplies a real gate-status signal                        | The cell renderer swaps its return from `—` to the live value — no layout change                                                                                            |
| Premium tier (#P4-13) upgrades and lights up 🟡 paths                    | Spec §5 row 1 ("Spend by project + WoW growth") stays 🟢 with no premium path; no engine change needed; section A's existing `costComputed` continues to render             |

### Backward — regression risk per touched area (brownfield only)

| Touched area (from Change Footprint)               | What could regress                                                                                    | How we'd know / mitigation                                                                                                                |
|----------------------------------------------------|------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `client/src/pages/Projects.tsx` shim rewrite        | A consumer expecting the old stub body re-exporting a `PageStub` would see Projects' content         | No callers outside `routes.ts` import it; `routes.ts` keeps the same import path; Cypress smoke spec lands a visit to `/projects` early    |
| `client/src/api/metrics.ts` consumption             | A 2xx → non-2xx or response-shape drift would surface a previously-quiet error                       | The hook bundle uses `postMetrics(query, signal)` exactly like Models / Cache Lab; their tests give us coverage; Cypress smoke catches it   |
| `client/src/filters/state.ts` consumption           | A future rename of `branch` ↔ `gitBranch` would silently break the section C chip encoding           | `CHIP_DIMENSION` is the single source of truth; the new code reads it the same way Models does                                            |
| WS invalidation (`qk.prefixes.metrics`)            | A larger fan-out than intended would refetch the Projects page on every unrelated update             | `qk.metrics(query)` keys are scoped by query body, so refetches only ever hit the 3 query identities mounted here                         |
| `POST /api/metrics` route validator                | A future dimension addition that breaks `project`/`gitBranch` parsers would 400 here, not elsewhere   | Existing fixture acceptance in `engine.test.ts` and `routes/metrics.test.ts` keeps that surface green                                       |
| Sessions route (`/sessions`) accepts the drill URL | A future Sessions filter schema change removing `project`/`branch` would break the drill            | `server/routes/sessions.ts:159-180, 263` already consumes both filters today; the Sessions page lists them as supported filter chips      |

## Open Questions

- **None blocking.** All three explicit developer confirmations (top-N+other cap, top-3+more branches, gate-column stub) were approved before this artifact was generated.

## Out of Scope

- **Live-update flicker regression tracking** — already fixed in #P4-20; this page inherits the fix.
- **Gate feed / Report Card UI** — #P4-12, explicitly slotted by the issue's "Gate pass-rate column in the efficiency table stubs until #P4-12 replaces it with live results".
- **Premium tier labels (`🟡 costObserved` upgrade on section A)** — pages spec §5 row 1 specifies 🟢 + L-upgrade is a separate layer; the page renders plain `costComputed` without L-flagging. (Defer to a follow-up if label fidelity matters; the shape the page returns is already tier-aware via the engine.)
- **`$/line` per project** — pages spec §5 row 3 lists `$/line` as 🟡; not implemented in this issue because the per-project line count is a derived metric that #P4-13's premium tier supplies.
- **Project deep-dive sub-page** (not in spec) — deliberately omitted.
- **Saved-view pinned Project default view** — handled by #P4-16 Explore.

---

# Tasks

_This section is populated by the **generate-tasks** skill (Phase 3)._
_Run: `/generate-tasks from: specs/architecture/ARCH-projects-page.md`_
