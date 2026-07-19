# Architecture: Models Page

> **Date:** 2026-07-19
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Plan task #P4-8 (`specs/issues/P4-8-models-page.md`, GitHub issue #40) — page contract defined in `specs/claude-lens-pages.md` §6; visual reference at `specs/pages/models.html`.
> **Type:** feature (brownfield — page composition on top of the page-pattern gate shipped in #P4-2/#34)

## Architecture Summary

The Models page is a **purely compositional** page built on top of the existing metrics engine (`/api/metrics`) — no new server route, no new shared contract. Every §6 section is a query against `metrics(query) → Series[]` plus (where required) a small client-side derivation over already-fetched Series. The page shell (`client/src/pages/models/Models.tsx`) follows the Cache Lab pattern: one stable TanStack hook per query family, each panel owns its own loading/empty/error states, drill-through lands on `/sessions` with a model/version/entrypoint filter appended to the URL.

The non-trivial design questions are: (1) the **🟡 latency/throughput fallback** has no first-class measure today — it is computed client-side from `wallMinutes ÷ apiCalls` and `outputTokens ÷ wallMinutes` per model, which is the cheapest faithful "timestamp-deltas" approximation on top of the existing measure set; (2) the **CC-version before/after** comparison must bucket raw semver versions into a `major.minor` group label before comparing, which is a client-side derivation on the `version` dimension; (3) the **🔴 $/1k-lines** section is a `LockedCard` per architecture §11's tier pattern.

## Inferred Requirements

Plan-task sourcing is Mode A (the spec page-contract table is the source of truth). The following derive directly from §6 + the mockup; none invent new requirements.

| ID  | Requirement                                                                  | Source                              |
|-----|------------------------------------------------------------------------------|-------------------------------------|
| R1  | Page renders every §6 section listed in the page contract.                  | pages spec §6 table                |
| R2  | Latency/throughput sections show 🟡 fallback values until #P4-13 upgrades them. | pages spec §6 + issue scope        |
| R3  | $/1k-lines section shows 🔴 `LockedCard` until premium capture lands.        | pages spec §6 + locked-card convention |
| R4  | One drill-link from any panel lands on `/sessions` with the relevant model/version/entrypoint filter appended. | pages spec §0 "Drill-anywhere"     |
| R5  | Each section renders independent loading/empty/error states.                | Architecture decision A11 / Cache Lab precedent |
| R6  | Cypress smoke spec covers route load + section presence + one drill-link.   | Definition of done (issue)         |
| R7  | Storybook stories cover component states (loading / empty / error / populated, by tier). | Definition of done (issue)         |
| R8  | Visual sign-off matches `specs/pages/models.html` on real data; plan checkbox flipped. | Definition of done (issue) |

## High-Level Structure

```
client/src/pages/models/
├── Models.tsx                    # page shell (compose sections, gating, error boundary)
├── useModelsQueries.ts           # one memoized query per section family
├── ModelMixOverTime.tsx          # stacked area, unit switcher ($ / tokens / calls)
├── ModelStatsRow.tsx             # top-N model stat cards with deltas
├── EfficiencyTable.tsx           # per-model efficiency ratios (data table)
├── VersionBeforeAfter.tsx        # CC-version before/after comparison
├── LatencyByModel.tsx            # 🟡 fallback latency (wallMinutes ÷ apiCalls)
├── ThroughputByModel.tsx         # 🟡 fallback throughput (outputTokens ÷ wallMinutes)
├── EntrypointBreakdown.tsx       # entrypoint × token flow
├── LockedLinesPerCost.tsx        # 🔴 LockedCard wrapper for $/1k-lines
└── versionBuckets.ts             # pure helper: raw semver → major.minor.x bucket
```

**Data flow (one request, end-to-end):**

```
user filters (URL) ──► Models.tsx ──► useModelsQueries(filters, grain)
                                              │
                                              ▼  one memoized SeriesMetricsQuery per section
                                       TanStack Query (key from qk.metrics)
                                              │
                                              ▼
                                       POST /api/metrics { measures, dimensions, grain, range, filters }
                                              │
                                              ▼
                                       Series[] ──► per-panel component (props)
                                              │
                                              ▼
                                       render: stat card / table / chart / locked / 🟡 fallback
                                              │
                                              ▼ (on click / drill-link)
                                       navigate(/sessions?<filters>&model=<x>&from=<bucket>&to=<bucket>)
```

**What lands where:**
- **Server / shared**: nothing new. The metrics contract (`shared/metrics-contract.ts`) already includes `model`, `version`, `entrypoint` dimensions and `outputTokens`, `costComputed`, `wallMinutes`, `apiCalls`, `turns` measures; the engine already buckets by any combination (see `server/metrics/dimensions.ts` lines 27–31 and `engine.ts` lines 169–172).
- **Client `client/src/pages/models/`**: new directory mirroring `cache-lab/`. One hook, one panel component per §6 section, one locked-card wrapper.
- **Cypress / Storybook**: one smoke spec + one stories file.

## Tech Choices

| Area              | Decision                                                    | Alternatives Considered              | Rationale                                                                 |
|-------------------|-------------------------------------------------------------|--------------------------------------|---------------------------------------------------------------------------|
| Charting          | Existing `Chart` wrapper (ECharts) via shared option builders in `cache-lab/chart-options.ts` style. | echarts-for-react (banned, ARCH §2).  | Consistent with every other page; one chart wrapper, one unit/smoothing/compare plumbing. |
| Stacked area      | Single ECharts `series: [{ stack: "mix", areaStyle: … }]` across all model dimensionKey series in one query. | Three separate lines chart (rejected: doesn't convey share). | Stacked area is the explicit spec wording ("did the new model change my spend profile?"). |
| Data fetching     | TanStack Query (`useQuery`) keyed on the full query via `qk.metrics`, one query per section family. | A single mega-query joining all dimensions (rejected: violates A5 batch rule; per-section failure isolation). | Section-owned states + dedupe across panels that share a query shape (A11). |
| Latency fallback  | Derive from `wallMinutes` ÷ `apiCalls` per model in the same query batch. | New measure on server (deferred — #P4-13 covers it properly); client-side recompute from raw timestamps (rejected: requires exposing call stream). | Reuses existing measures; the "coarse" prefix in the spec is honest about this approximation. |
| Throughput fallback | Derive from `outputTokens` ÷ `wallMinutes` per model in the same batch. | Same options as latency. | Same rationale. |
| Version bucketing | Pure client-side `versionBuckets(rawVersion): "v3.18.x"` helper. | Server-side bucketing (rejected: tight coupling to a presentation need). | Versions are a presentation concern; new bucketing rules shouldn't churn the metrics contract. |
| Drill-through     | `Link` to `/sessions?<existing filters>&model=<x>` (etc.) using `serializeFilters` + a small `modelHref` helper. | New sessions sub-page (rejected: sessions page already supports model filter). | Existing URL-driven filter contract. |
| Locked 🔴         | Reuse `<LockedCard>` from `client/src/components/LockedCard.tsx` with the standard "Set up cost capture →" CTA. | Build a page-local locked component (rejected: locked is a primitive, ARCH §11). | One primitive everywhere. |
| Tier badges 🟡    | Reuse `<TierBadge level="estimated">` from `client/src/components/TierBadge.tsx`. | Inline emoji rendering (rejected: ARIA label + slot is already in the primitive). | Single tier-rendering story across the app. |
| State for unit switcher | Local `useState` (the switcher is presentation, not a filter). | URL query (rejected: spec doesn't ask for permalinked unit choice; would clutter URL). | Spec §0 lists "unit switcher" without permalink requirement; stays local. |
| Fixture for tests | Reuse the existing `55555555-…` synthetic fixture (timestamped 2026-06-15) — already exercises cache + K2 + version + entrypoint variation. | Build a new model-specific fixture (rejected: would diverge the dashboard anchor; Cache Lab precedent shows 5555 covers what we need). | Single fixture fleet keeps the dashboard anchor stable. |

## Patterns & Conventions

- **Page composition shell** — `client/src/pages/models/Models.tsx` mirrors `CacheLab.tsx`: title + section-level error banner + composition in spec order. (`Models.tsx:1` stub → real shell.)
- **Per-section data hook** — `useModelsQueries.ts` returns one memoized `SeriesMetricsQuery` per family, identical to `useCacheLabAnalysis` shape; section-owned loading/empty/error states per A11.
- **Stat row top-N** — reuse `<StatRow>` + `<StatCard>` from `client/src/components/StatCard.tsx`; copy the `DrillStatCard` shape from `StatCardsRow.tsx:223-249` (display-contents `<Link>` so the click target wraps the card without breaking the grid).
- **Charts** — `<Chart option={…}>` with shared option builders, ARIA labels via `chartAriaLabel`/`chartTrendSummary`/`chartRangeSummary` from `client/src/charts/ChartCard.tsx`.
- **Drill-link helper** — `client/src/charts/drilldown.ts:sessionsHrefForBucket` for time-bucket drills; a new tiny `modelHref(model, filters)` / `entrypointHref(entrypoint, filters)` / `versionHref(version, filters)` for the dimension drills (all funnel into `serializeFilters`).
- **Locked card** — `<LockedCard title="…" message="…" ctaHref="/settings">` exactly once for `/1k-lines by model`. No new locked primitives.
- **Test seams** — every panel exports a `data-testid` matching its semantic role (e.g. `model-mix-over-time`, `efficiency-by-model`, `version-before-after`, `latency-by-model`, `throughput-by-model`, `entrypoint-breakdown`, `locked-lines-per-cost`). Cypress smoke spec asserts each testid.
- **Stories** — one `*.stories.tsx` per panel with `Default`, `Loading`, `Empty`, `Error`, `TierFallback` (🟡), `Locked` (🔴) stories. Inherit `data` prop shape from `FleetOverview.tsx:18` precedent — panels are presentational, the page shell feeds data.

## Data Models

No new entities. Reuses:

### Series (existing — `shared/metrics-contract.ts:187`)

Used unchanged. Each section pulls `Series[]` and picks the dimensionKey group it needs (`series.dimensionKey` is the model/version/entrypoint label; `series.points` is the bucketed series).

### `versionBuckets` (new helper — `client/src/pages/models/versionBuckets.ts`)

**Purpose:** Group raw CC semver versions (e.g. `"1.0.51"`) into presentation buckets (`"v3.18.x"`) for the before/after compare. Pure, no React, no fetch — easy to unit-test.

**Shape (informal — implementation is a single exported function):**
| Input          | Output              | Notes                                            |
|----------------|---------------------|--------------------------------------------------|
| `"3.18.2"`     | `"v3.18.x"`         | Trim to `major.minor` + `.x`.                   |
| `"3.18.0-rc"`  | `"v3.18.x"`         | Strip pre-release tag before bucketing.         |
| `""`           | `"unknown"`         | Matches `orUnknown` semantics in dimensions.ts.  |
| `"2.5.0"`      | `"v2.5.x"`          | Multi-year-old versions bucket to their own year. |

**Why client-side:** Versions are session metadata that can be added to the parser at any time; new bucketing policies should not require touching the metrics contract or engine.

### Query shapes (in-code — no new types)

| Section               | measures                                          | dimensions      | grain | notes                                       |
|-----------------------|---------------------------------------------------|-----------------|-------|---------------------------------------------|
| Model stats row       | `costComputed`, `sessions`                         | `model`         | n/a   | Batched with compare: "previous-period".    |
| Model mix over time   | `costComputed` (or `outputTokens`, or `apiCalls`) | `time`, `model` | day   | Stacked area; unit switcher swaps measure.   |
| Efficiency table      | `outputTokens`, `cacheReadTokens`, `cacheCreateTokens`, `inputTokens`, `costComputed`, `turns` | `model` | n/a | Ratios recomputed client-side per the same pattern as `cacheHitTotal` in `StatCardsRow.tsx:98-104`. |
| Version before/after  | `costComputed`, `outputTokens`, `cacheReadTokens`, `cacheCreateTokens`, `inputTokens`, `turns` | `version` | n/a | Client buckets → `versionBuckets`.          |
| Entrypoint breakdown  | `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreateTokens`, `costComputed` | `entrypoint` | n/a | Same shape; rename for clarity.             |
| Latency (🟡 fallback) | `wallMinutes`, `apiCalls`                          | `model`         | n/a   | `wallMinutes ÷ apiCalls` per model.         |
| Throughput (🟡 fallback) | `outputTokens`, `wallMinutes`                   | `model`         | n/a   | `outputTokens ÷ wallMinutes` per model.     |
| `/1k-lines by model`  | —                                                 | —               | —     | LockedCard (no query).                      |

All queries route through the existing `postMetrics` (`client/src/api/metrics.ts`); no new API wrapper.

## API Contracts / Interfaces

### Boundary: `POST /api/metrics` (existing)

**No contract change.** The Models page is a pure consumer of the existing metrics endpoint, calling it with the eight query shapes listed above.

**Operations consumed:**

| Section              | Query shape (informal)                                                                       | Returns |
|----------------------|----------------------------------------------------------------------------------------------|---------|
| All sections         | `SeriesMetricsQuery` (see `shared/metrics-contract.ts:104`)                                  | `Series[]` |

**Auth requirements:** None (local-only app, single-user); the endpoint enforces no auth today.

### Internal module boundary: `client/src/pages/models/useModelsQueries.ts`

Returns a typed bundle of `useQuery` results so the page shell doesn't memoize query objects itself (mirrors `useCacheLabAnalysis`).

```ts
interface ModelsQueries {
  filters: FilterState;
  grain: Grain;
  statRows: UseQueryResult<Series[] | undefined>;       // model stats row
  modelMixCost: UseQueryResult<Series[] | undefined>;    // $ over time, stacked
  modelMixTokens: UseQueryResult<Series[] | undefined>;  // tokens over time, stacked
  modelMixCalls: UseQueryResult<Series[] | undefined>;   // calls over time, stacked
  efficiency: UseQueryResult<Series[] | undefined>;
  versionBeforeAfter: UseQueryResult<Series[] | undefined>;
  entrypoint: UseQueryResult<Series[] | undefined>;
  latency: UseQueryResult<Series[] | undefined>;         // 🟡 fallback
  throughput: UseQueryResult<Series[] | undefined>;      // 🟡 fallback
}
```

**Drill-link helper (new, ~10 lines):**

```ts
// client/src/pages/models/drilldown.ts
export function modelHref(model: string, filtersKey: string): string;
export function versionHref(versionBucket: string, filtersKey: string): string;
export function entrypointHref(entrypoint: string, filtersKey: string): string;
```

Each appends `&model=…` / `&version=…` / `&entrypoint=…` to the existing serialized filter query. Lives next to `sessionsHrefForBucket` in `client/src/charts/drilldown.ts`.

## Module Boundaries

| Module / Package                                    | Responsibility                                                       | Allowed Dependencies                                                  |
|-----------------------------------------------------|----------------------------------------------------------------------|-----------------------------------------------------------------------|
| `client/src/pages/models/Models.tsx`                | Page shell; composes sections in §6 order; renders error banner.    | `useModelsQueries`, all panel components in this dir, `useFilters`, primitives, layout. |
| `client/src/pages/models/useModelsQueries.ts`        | One memoized `SeriesMetricsQuery` + `useQuery` per section family.   | `filters/state`, `api/metrics`, `api/queryKeys`, TanStack.            |
| `client/src/pages/models/<Panel>.tsx`               | Presentational; renders one §6 section from its data prop.           | `components/StatCard`, `charts/Chart`, `components/DataTable`, `charts/units`, drilldown helper, TierBadge. |
| `client/src/pages/models/versionBuckets.ts`         | Pure semver→major.minor helper.                                       | None.                                                                  |
| `client/src/pages/models/drilldown.ts`              | Pure URL builder for per-model / version / entrypoint drill links.   | `filters/state` (for `serializeFilters`).                              |
| `client/src/pages/models/Models.test.tsx`           | Component-state coverage (loading / empty / error / tier fallback).  | Vitest + React Testing Library (matching the rest of the app).         |
| `client/src/pages/models/<Panel>.stories.tsx`       | Storybook coverage for the panel's render states.                   | Same as the panel itself.                                              |
| `cypress/e2e/models.cy.ts`                          | Route-load smoke + section presence + one drill-link.                | Cypress, fixture range from Cache Lab spec.                            |

**Hard rules (mirrors Cache Lab):**
- Panel components never call `useQuery` directly — they receive `data` and `error` as props. Keeps them Storybook-friendly.
- No panel imports from `cache-lab/`. Each page owns its own derivation helpers.
- No new files in `shared/` (no contract changes).

## Change Footprint

### New files / modules

| Path                                                          | Purpose                                                                          | Pattern reference                                |
|---------------------------------------------------------------|----------------------------------------------------------------------------------|--------------------------------------------------|
| `client/src/pages/models/Models.tsx`                          | Page shell, replaces `PageStub` body.                                           | `client/src/pages/CacheLab.tsx`                  |
| `client/src/pages/models/useModelsQueries.ts`                 | One memoized query hook per section family.                                     | `client/src/pages/cache-lab/useCacheLabAnalysis.ts` |
| `client/src/pages/models/ModelMixOverTime.tsx`                | Stacked area chart with unit switcher.                                          | `client/src/pages/cache-lab/HitRatePanel.tsx` (chart pattern) |
| `client/src/pages/models/ModelStatsRow.tsx`                   | Per-model stat cards in a `<StatRow>`.                                          | `client/src/pages/dashboard/StatCardsRow.tsx`    |
| `client/src/pages/models/EfficiencyTable.tsx`                 | Per-model efficiency ratios table.                                              | `client/src/components/DataTable.tsx`            |
| `client/src/pages/models/VersionBeforeAfter.tsx`              | CC-version before/after compare.                                                | `cache-lab/BustEconomicsPanel.tsx` (paired-column pattern) |
| `client/src/pages/models/LatencyByModel.tsx`                  | 🟡 fallback latency p50/p90 from `wallMinutes ÷ apiCalls`.                       | `cache-lab/HitRatePanel.tsx` (loading/empty/error pattern) |
| `client/src/pages/models/ThroughputByModel.tsx`               | 🟡 fallback throughput p50/p95 from `outputTokens ÷ wallMinutes`.                 | Same.                                            |
| `client/src/pages/models/EntrypointBreakdown.tsx`             | Entrypoint × token flow table/bar.                                              | `EfficiencyTable.tsx`                            |
| `client/src/pages/models/LockedLinesPerCost.tsx`              | 🔴 LockedCard wrapper for $/1k-lines by model.                                  | `client/src/components/LockedCard.tsx`           |
| `client/src/pages/models/versionBuckets.ts`                   | Pure semver→major.minor helper.                                                  | `server/metrics/dimensions.ts:15` (orUnknown-style purity) |
| `client/src/pages/models/drilldown.ts`                        | Pure URL builders for drill-through.                                             | `client/src/charts/drilldown.ts`                 |
| `client/src/pages/models/<Panel>.stories.tsx`                 | Storybook stories (one file per panel — 8 total).                                | `cache-lab/CacheLab.stories.tsx`                 |
| `client/src/pages/models/Models.test.tsx`                     | Component-state coverage.                                                        | `cache-lab/CacheLab.test.tsx`                    |
| `cypress/e2e/models.cy.ts`                                    | Smoke spec: route renders key sections; one drill-link lands filtered.           | `cypress/e2e/cache-lab.cy.ts`                    |

### Modified files / modules

| Path                                            | What changes here                                                                                |
|-------------------------------------------------|--------------------------------------------------------------------------------------------------|
| `client/src/pages/Models.tsx`                   | Stub replaced by re-export `import { Models } from "./models/Models.js";` (one-liner shim).      |
| `client/src/routes.ts`                          | No change (route already exists).                                                                 |
| `client/src/layout/AppShell.tsx` (likely)       | If `models` link isn't already wired with the page-label order, no change — confirmed via `routes.ts:navRoutes` derivation. |
| `specs/claude-lens-plan.md`                     | Flip the #P4-8 checkbox (manual step on sign-off per the issue's definition-of-done).            |

### Deleted / replaced

| Path                          | Reason                                                                |
|-------------------------------|-----------------------------------------------------------------------|
| `client/src/pages/Models.tsx` stub body | Replaced by the re-export shim above; the directory owns the real implementation now. |

### Touched but not changed (silent-regression hotspots)

| Path                                                       | Why it matters                                                                                          |
|------------------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| `shared/metrics-contract.ts`                               | We rely on `version`/`entrypoint`/`model` dimensions + `wallMinutes` measure — any change to the measure/dimension union would silently blank the page. |
| `server/metrics/dimensions.ts`                             | The `callDimensionValue` switch handles `version`/`entrypoint` (lines 27–31). A regression there would surface as `"unknown"` everywhere. |
| `server/metrics/engine.ts`                                  | Version/entrypoint bucketing is done in lines 169–172. No code change, but it must stay in lockstep with how the client reads the dimensionKey label. |
| `server/metrics/measures.ts`                               | `wallMinutes` definition (per-session wall time). Re-check it still represents what the latency fallback assumes. |
| `client/src/api/metrics.ts` + `client/src/api/queryKeys.ts` | The query key factory serializes the full `SeriesMetricsQuery`. Any drift breaks TanStack dedupe across the page's panel set. |
| `client/src/components/LockedCard.tsx`                     | The 🔴 panel uses it; regression in the CTA href (`/settings`) or veil would surface as "the locked card no longer points at the right place". |
| `client/src/charts/drilldown.ts`                           | `sessionsHrefForBucket` is used for time-bucket drills. New dimension-drill helpers live in a sibling file to avoid editing this hot file. |
| `cypress/e2e/cache-lab.cy.ts`                              | Confirms the 5555 fixture continues to satisfy the dashboard anchor — no change, but we depend on its presence for our smoke spec. |

## Areas of Impact

| Area                                                       | Impact                                                                                                  | Risk (L/M/H) | Why                                                                          |
|------------------------------------------------------------|----------------------------------------------------------------------------------------------------------|--------------|------------------------------------------------------------------------------|
| Metrics contract (`shared/metrics-contract.ts`)           | No change; new queries consume existing unions.                                                          | L            | Pure consumer.                                                               |
| Metrics engine                                             | No change; `wallMinutes`/`apiCalls`/`outputTokens` already exist; `version`/`entrypoint`/`model` already supported. | L            | Reuses existing axes.                                                        |
| Page composition recipe (Cache Lab precedent)              | Establishes the same shell + one-hook-per-section pattern for upcoming pages (Trends, Data Health).       | L            | Same shape — no new abstraction.                                             |
| Cypress fixture fleet                                      | One more smoke spec on the existing 5555 fixture; no new fixture needed.                                | L            | 5555 already covers the dimensions we need.                                  |
| Storybook catalog                                          | ~8 new stories files following the established panel pattern.                                            | L            | Routine.                                                                     |
| `client/src/components/LockedCard.tsx`                     | No change — but more callers exercise it; any regression here would now bite Models in addition to wherever else it is used. | L | Pre-existing primitive; testing covers it. |
| URL permalinks (`?model=…&version=…&entrypoint=…`)         | Models page drill links now route through `/sessions` with new dimension query params.                   | M            | `serializeFilters`/`filtersToQuery` must accept and round-trip these params; check `client/src/filters/state.ts`. |
| Tier rules (`shared/sessions-contract.ts`)                 | No change; Models doesn't surface per-session tier.                                                      | L            | Page-level rendering only.                                                   |

**Contract changes:** None. No shared type, no HTTP shape, no event payload changes.

**Cross-cutting ripples:**
- **Telemetry:** None new. Existing WS invalidation bus already invalidates `qk.metrics` queries when an `/api/metrics` dependency invalidates (`specs/claude-lens-architecture.md` §7).
- **Build pipeline:** None. Same Vite + esbuild path; same Biome + Vitest gate.
- **Feature flags:** None. Tier gating is already a primitive.
- **Auth / perms:** None — local app.

## Cross-Cutting Concerns

- **Errors:**
  - **Per-section errors** render locally inside each panel (A11). The page shell adds a top-level error banner only if `useModelsQueries` itself throws — which it shouldn't, since each hook is independent.
  - **Validation errors** from `/api/metrics` (e.g. malformed range) propagate through TanStack's `error` field per the existing `MetricsApiError` pattern.
  - **Empty ranges** show an inline "No data in range" message per panel (same as `HitRatePanel.tsx:135-138`), not a top-level banner.
- **Logging & metrics:** No new logs. Existing pino logs from `/api/metrics` cover all server traffic.
- **Auth / authz:** None. Local-only single-user app.
- **Performance:**
  - **Query count ceiling:** 8 distinct queries (one per section family). TanStack dedupes across panels that share a query (e.g. `costComputed` appears in both the stat-row batch and the model-mix batch — different shapes so they don't dedupe, which is correct).
  - **Bucket sizing:** `grain: "day"` for time series (matches Cache Lab precedent). Per-model and per-version queries return ≤1 row per dimensionKey, so the response shape is bounded by the fleet's distinct value count.
  - **Render budget:** No panel renders more than ~30 rows (top-N models by spend or per-version). All ECharts instances lazy-load once per mount.
- **Security:**
  - All queries pass through `client/src/filters/state.ts:filtersToQuery` which whitelists dimension values; no user-controlled values reach the server directly.
  - URL drill params (`?model=…`) are validated by the existing `sessions` filter parser; no new validation surface.
- **Migrations / rollout:** None. Pure additive page — no schema, config, or capture changes. Deployment is the standard `npm run build` → `npm start`.

## Architecture Decisions Log

| #   | Decision                                                              | Alternatives                                                  | Chosen Because                                                                                                  | Satisfies REQs |
|-----|-----------------------------------------------------------------------|---------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------|----------------|
| A1  | Compose from existing `/api/metrics`; no new server route.            | New `/api/models` endpoint bundling all eight sections.       | All eight §6 sections reduce to one or two `SeriesMetricsQuery` calls; bundling duplicates engine semantics.     | R1, R2, R3     |
| A2  | Latency 🟡 fallback = `wallMinutes ÷ apiCalls` per model.            | Expose raw call timestamps (new API); add new server-side measure. | Spec explicitly says "coarse timestamp fallback"; uses existing measures; #P4-13 will replace it properly.       | R2             |
| A3  | Throughput 🟡 fallback = `outputTokens ÷ wallMinutes` per model.     | Same as A2.                                                   | Same.                                                                                                           | R2             |
| A4  | CC-version bucketing (`v3.18.x`) is a pure client-side helper.       | Server-side major.minor bucketing in engine.                  | Versions are presentation metadata; new bucket policies shouldn't churn the metrics contract.                  | R1             |
| A5  | One TanStack hook per section family (not one mega-hook).             | Single hook returning all 8 queries.                          | Section-owned loading/empty/error states (A11); easier Storybook isolation.                                    | R5             |
| A6  | Stat-row cards use the existing `<DrillStatCard>` pattern.            | Build a one-off per-model stat card component.                | Identical click-through contract to Dashboard; zero new pattern.                                                | R4             |
| A7  | Unit switcher for Model-mix-over-time is local state, not URL.         | URL query parameter for unit.                                 | Spec §0 lists unit switcher without permalink requirement; URL stays clean.                                    | R1             |
| A8  | Reuse existing `<LockedCard>` and `<TierBadge>` primitives.           | Page-local locked/fallback component.                         | ARCH §11: "six hand-built primitives" — locked card is one of them.                                             | R3             |
| A9  | Stacked area chart for Model-mix-over-time; lines for rate-of-change.  | Always lines; always area.                                    | Spec text: "did the new model change my spend profile?" — share + trend both matter; mockup shows area.         | R1             |
| A10 | Drill helpers live in `client/src/pages/models/drilldown.ts`, not in `client/src/charts/drilldown.ts`. | Extend the shared drilldown file.                       | Models-only helpers are not shared; keep `charts/drilldown.ts` focused on the time-bucket drill used by charts. | R4             |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario                                                                  | How the Design Handles It                                                                                                                  |
|---------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------|
| `/api/metrics` returns 500 for the model-mix query but succeeds elsewhere. | Stat-row + efficiency + entrypoint still render; only `ModelMixOverTime` shows an inline error per A11.                                    |
| `wallMinutes` measure returns `null` for a session.                       | Latency fallback guards with a safe-divide helper (`safeDivide` from `StatCardsRow.tsx:132`) and shows "—" for that model.                  |
| User has zero sessions with a known `version` (e.g. brand-new install).    | VersionBeforeAfter renders an empty-state ("No CC version data yet"); no crash from empty `versionBuckets` input.                          |
| 100+ distinct models in the fleet (unrealistic but bounded).               | Stacked area's legend collapses gracefully (ECharts handles overflow); EfficiencyTable scrolls; stat-row shows top-N only (capped at the columns count). |
| User clicks a model drill-link mid-fetch.                                 | TanStack Query cancellation via `signal`; the page navigates and the new route refetches cleanly.                                          |
| Network drop during page mount.                                           | Each section shows its own inline error; the page header still renders with the title.                                                    |
| Tier changes from 🟢 → 🟡 after cost capture is removed.                  | Latency/Throughput panels fall back automatically — they don't read C/L; 🟢-only sections (stat row, model mix, efficiency, entrypoint) keep working. |

### Backward — regression risk per touched area

| Touched area                                                            | What could regress                                                       | How we'd know / mitigation                                                                                       |
|-------------------------------------------------------------------------|--------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------|
| `shared/metrics-contract.ts`                                            | A union widening that drops `version`/`entrypoint`/`model`/`wallMinutes`. | TypeScript fails compile of `useModelsQueries.ts`; CI gate (`npm run verify`) catches.                          |
| `server/metrics/dimensions.ts:27-31`                                    | The `version`/`entrypoint` switch arms deleted.                          | All Models panels surface `"unknown"` dimensionKey. Mitigated by `dimensions.test.ts`; Cypress catches end-to-end. |
| `server/metrics/measures.ts` (`wallMinutes` definition)                  | `wallMinutes` stops representing per-session wall time.                  | Latency/Throughput fallback values drift visibly; Cypress smoke spec asserts a stable fallback figure.           |
| `client/src/filters/state.ts:filtersToQuery`                             | Stop round-tripping `model`/`version`/`entrypoint` URL params.            | Drill links from Models land on `/sessions` with no filter applied. Cypress drill assertion catches.             |
| `client/src/api/metrics.ts` + `queryKeys.ts`                             | Query key serialization drift.                                            | Sections refetch on every render; visible as a perf regression + Cypress refetch-count assertion (Cache Lab precedent). |
| `client/src/components/LockedCard.tsx`                                  | CTA href or veil styling breaks.                                         | Visual regression on the locked panel — caught by manual visual sign-off vs `models.html`.                       |
| `client/src/charts/drilldown.ts`                                        | Time-bucket drill URL changes shape.                                       | Model-mix drill (clicking a stacked area bucket) breaks. Cypress smoke spec asserts one drill.                  |
| Routes (`client/src/routes.ts`)                                         | Someone removes or renames the `/models` route.                           | `App.tsx` fails to render; `npm run build` succeeds but Storybook/visual is broken — manual sign-off catches.     |

## Open Questions

- **Should the Model-mix-over-time unit switcher be saved to the URL?**
  - **Impact if unresolved:** Switching to "tokens" loses state on reload. Minor UX wart.
  - **Suggested default:** Local state (per A7). Revisit if a user explicitly asks for permalink-stable unit choice.
- **Top-N for the model stat row?**
  - **Impact if unresolved:** Mockup shows 4 cards; large fleets might have many more models.
  - **Suggested default:** Show top-N by `costComputed` in descending order, capped at the page width (4–5 columns on desktop). Drop models below a threshold if N > the cap; never show all of them.
- **Should `versionBuckets` collapse identical versions to a single bucket label, or always show `v3.18.x`?**
  - **Impact if unresolved:** Inconsistent display when only one version exists in a bucket.
  - **Suggested default:** Always `v3.18.x` — keeps the format predictable; matches the mockup.
- **Cypress drill-link target — bucket vs. dimension?**
  - **Impact if unresolved:** Spec says "one drill-link lands filtered"; doesn't specify which panel.
  - **Suggested default:** Drill from ModelMixOverTime (clicking a stacked-area bucket lands on `/sessions` filtered to that model within the bucket time range) — combines both halves of the drill contract in one assertion.

## Out of Scope

- **Latency / throughput upgrade to 🔴** — owned by #P4-13 (premium tier CBL parsers). Models renders the 🟡 fallback only.
- **`$/1k-lines by model` (🔴)** — same; this section is a `LockedCard` and is unblocked when the corresponding measure lands.
- **Anomaly / gate scoring per model** — Models is a read-only composition; gate-style scoring on per-model metrics is a future enhancement.
- **Saved views bound to the Models URL** — the global filter state persists today; named Models-specific views are deferred to #P4-17 (export) or beyond.

---

# Tasks

_This section is populated by the **generate-tasks** skill (Phase 3)._
_Run: `/generate-tasks from: specs/architecture/ARCH-models-page.md`_
