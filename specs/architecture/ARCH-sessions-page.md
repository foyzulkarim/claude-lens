# Architecture: Sessions Page

> **Date:** 2026-07-18
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Standalone brief — see Inferred Requirements; grounded in
> `specs/context/36.md`, `specs/issues/P4-4-sessions-page.md`,
> `specs/claude-lens-pages.md` §2, and `specs/claude-lens-architecture.md` §9
> **Type:** feature

## Architecture Summary

The Sessions page replaces the current route stub with a URL-driven composition of a session
browser, timeline, cost distribution, efficiency scatter, comparison panel, and stable integration
slots for later search, tags, and gate work. The existing `GET /api/sessions` route gains a
discriminated page projection while its current summary/trace behavior remains backward-compatible
for Dashboard consumers. Session identities, exact sorting, pagination, timeline bars, and compare
rows come from the sessions route; aggregate distributions and scatter/regression calculations stay
inside the metrics engine. A shared session-population predicate gives every section identical range,
categorical, cost, gate, and drilldown semantics.

## Inferred Requirements (if Mode B / no REQ)

| ID | Inferred Requirement | Source |
|---|---|---|
| R1 | Replace `/sessions` with all eight sections in the binding Sessions page table. | `specs/claude-lens-pages.md` §2; issue #36 |
| R2 | Preserve global range/project/model/branch/host filters and add cost, gate-status, has-drilldown, and entrypoint filtering for the whole page. | Sessions page row 2; user direction to make behavior consistent |
| R3 | Render an exactly pageable and server-sortable session table covering computed cost, tokens, turns, duration, cache percentage, branch, version, and future gate/premium fields. | Sessions page row 3; architecture §9 |
| R4 | Toggle between table and Gantt/timeline presentations without changing or refetching the matched population. | Sessions page row 4; `sessions.html` |
| R5 | Support any-measure × any-measure session scatter plots, including the specified cost × duration and tokens × turns presets, with regression calculated over the full eligible population. | Sessions page row 5 |
| R6 | Show an exact computed-cost histogram and p50/p90/p99 values for the full matched session population. | Sessions page row 6 |
| R7 | Compare two or three selected, currently matching sessions side-by-side without depending on the future Session Detail endpoint. | Sessions page row 7; issue scope |
| R8 | Provide stable UI seams for prompt search, tags, and gate values while leaving their real data behavior to #P4-3, #P4-15, and #P4-12. | Issue #36 scope and dependency notes |
| R9 | Treat `hasDrilldown` as a transcript-tier fact: a session has drilldown data when it has at least one derived turn. | Recommended resolution of the otherwise undefined page-table term |
| R10 | Keep every shareable Sessions control in the URL and preserve those parameters when the global FilterBar changes. | Architecture §11 permalink rule; user consistency confirmation |
| R11 | Keep exact aggregate results but cap rendered timeline/scatter point payloads at 500 deterministic, outlier-preserving items and disclose the cap. | Scale stress test; user-confirmed recommendation |
| R12 | A Dashboard drill into `/sessions` must render the population described by the incoming URL filters. | Issue #36 acceptance criterion |
| R13 | Supply fixture-backed Cypress smoke coverage, Storybook component-state coverage, and a manual mockup comparison path. | Phase 4 standing rules |
| R14 | Add no database, persisted state, authentication layer, or third-party dependency. | Existing local-first architecture and confirmed technical lock |

## High-Level Structure

```text
AppShell global FilterBar
        │ patches only global URL keys
        ▼
/sessions?<global + page state>
        │
        ├── Sessions page-state parser
        │      ├── SessionPageParams
        │      └── sessionPopulation for MetricsQuery
        │
        ├── GET /api/sessions?view=page&include=timeline
        │      ├── exact filtered/sorted/paged SessionPageItem[]
        │      ├── exact total + tier metadata
        │      └── deterministic timeline visual set
        │              ├── SessionBrowser (table/timeline)
        │              └── SessionCompare (selected IDs)
        │
        ├── POST /api/metrics { mode: "distribution", entity: "session" }
        │      └── exact histogram + p50/p90/p99
        │
        └── POST /api/metrics { mode: "scatter", entity: "session" }
               └── exact regression + deterministic visual point set

Store invalidation ──► existing WS messages ──► existing sessions/metrics query prefixes
```

The route remains read-only over the in-memory store. The page projection and metrics query both
normalize their inputs into the same server-side session-population criteria before any pagination,
sampling, or measure calculation. The table page is exact; timeline/scatter sampling happens only
after the exact population and aggregate statistics are known.

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|---|---|---|---|
| Frameworks | Keep Fastify, React, wouter, TanStack Query/Table, Tailwind, and ECharts. | Add a page framework, state library, chart library, or component library. | Existing choices already cover every boundary and preserve Phase 4 visual consistency. |
| Session API | Add `view=page` to the existing `GET /api/sessions` contract. | Replace the summary response; add `/api/sessions/analytics`; fetch raw store data client-side. | A discriminated projection keeps Dashboard behavior stable while satisfying architecture §9 on the established route. |
| Aggregate analytics | Keep histogram/percentiles in distribution mode and add a discriminated metrics scatter mode. | Calculate in React; add a session dimension; add a dedicated analytics endpoint. | The architecture requires pages to use the metrics vocabulary and never duplicate measure aggregation. |
| Population filtering | Normalize both APIs through one pure server-side session matcher. | Independent route/engine filters; send a large session-ID list between APIs. | One matcher prevents range, model, host, cost, and drilldown semantics from drifting. |
| UI state | Encode global and Sessions-specific controls in the URL. | React local state; context/store state; browser storage. | URL state supports Dashboard drill-ins, browser history, refresh, and permalinks. |
| Table sorting | Add optional controlled/manual sorting to shared `DataTable`; sort on the server. | Page-specific table; load all rows and sort in React. | Exact paging requires server sorting, while the additive primitive API preserves existing callers. |
| Timeline | Semantic HTML/CSS bars backed by timeline projection data. | ECharts custom series; SVG-only Gantt; a new timeline library. | Each bar is naturally a focusable session link and requires no new chart family or dependency. |
| Scatter/histogram | Extend the existing `Chart` boundary with ECharts scatter support and semantic companion representations. | Decorative SVG; another chart library; canvas-only output. | Reuses the established lifecycle and accessibility pattern. |
| Scaling | Exact counts/aggregates plus a 500-point visual cap with disclosed metadata. | Unbounded payloads; approximate aggregates; silently show the first page. | Keeps answers exact while bounding DOM, canvas, serialization, and response size. |
| Storage | No new persistence. | Database, cache table, or browser storage. | The feature is a read-only view over existing derived state; tags remain owned by #P4-15. |

## Patterns & Conventions

- **Discriminated contract** — `view=page` and `mode="scatter"` add strict new response shapes
  without weakening existing session-summary and aggregate-metrics types.
- **Single population, multiple projections** — filtering happens before page slicing, visual
  sampling, distribution, regression, or comparison.
- **Exact aggregate, bounded rendering** — totals, percentiles, histogram, and regression use the
  full eligible population; only identity-bearing visual point sets are capped.
- **URL as source of truth** — Sessions state is re-derived from `useSearch`; global filter commits
  patch owned keys instead of reconstructing and dropping page state.
- **Section-owned failure boundaries** — list, distribution, and scatter queries can fail
  independently; one failed section does not remove successful sections.
- **Honest optionality** — premium, tag, and gate fields remain unavailable rather than fabricated
  as zero, pass, or empty values.
- **Additive shared primitives** — controlled sorting and scatter registration are optional paths;
  existing DataTable and time-series behavior remains the default.
- **Project conventions** — strict TypeScript, ESM imports, two-space indentation, colocated tests
  and stories, shared wire contracts in `shared/`, and no changes under `legacy/`.

## Data Models

### SessionPopulationFilter

**Purpose:** The canonical definition of which sessions participate in every Sessions-page section.

**Key fields:**

| Field | Type / Constraint | Notes |
|---|---|---|
| `range` | required `{ from, to }`, parseable ISO instants, `from <= to` | Inclusive session-start range, matching the current sessions route convention. |
| `project` | optional non-empty string array | A session matches when its project is allowed. |
| `model` | optional non-empty string array | A session matches when any session model is allowed; selected sessions retain their full totals. |
| `branch` | optional non-empty string array | Matches `Session.gitBranch`. |
| `host` | optional non-empty string array | Matches the current synthetic host and future labeled-root values. |
| `entrypoint` | optional non-empty string array | Matches `Session.entrypoint`. |
| `minCostComputed` | optional finite number, `>= 0` | Inclusive lower bound on computed cost. |
| `maxCostComputed` | optional finite number, `>= minCostComputed` | Inclusive upper bound on computed cost. |
| `gateStatus` | optional non-empty status array | Reserved and not emitted by the page until #P4-12 provides session-level values. |
| `hasDrilldown` | optional boolean | `true` means `turnCount > 0`; `false` means no derived turns. |
| `sessionId` | optional unique string array, maximum 3 for comparison queries | Narrows comparison hydration while retaining every other active population rule. |

**Relationships:**

- `Session` — evaluates zero or one match for each stored session.
- Session-list and session-level metrics queries — both normalize into this model.

**Lifecycle:**

- Parsed per HTTP request → applied to a request-local snapshot → discarded after response.

### SessionPageItem

**Purpose:** Strict row/compare projection for the Sessions page, separate from the existing compact
Dashboard `SessionListItem`.

**Key fields:**

| Field | Type / Constraint | Notes |
|---|---|---|
| `sessionId` | required string | Stable row, compare, timeline, and drill-link identity. |
| `startedAt`, `lastAt` | required strings | Honest store values; unparseable/empty values remain visible in the table but are excluded from timeline eligibility. |
| `project` | required string | Existing session rollup value. |
| `models` | required string array | Preserves multi-model sessions; compact `model` remains on the summary projection. |
| `branch` | optional string | Absent when the derived branch is empty. |
| `host` | required string | Current value is normally `default` until Settings supplies labeled roots. |
| `entrypoint`, `version` | required strings | Transcript-tier fields and sortable/filterable page columns. |
| `durationMs`, `turnCount`, `totalTokens`, `cacheHitPct` | required finite numbers, non-negative | Transcript-derived core table/scatter values. `totalTokens` sums the four stored token categories. |
| `costComputed` | required finite number, non-negative | Primary `$` table, range-filter, histogram, and default-scatter value. |
| `tier` | required `TierFlags` | Per-session availability and cost-basis evidence. |
| `costObserved`, `linesAdded`, `linesRemoved` | optional finite numbers | Premium fields; visible only when both availability and a value are present. |
| `contextPctEstimated`, `contextPctObserved` | optional finite numbers | The estimate remains available at transcript tier; the observed value is reserved for #P4-13 and is never inferred from the estimate. |
| `gateScore`, `gateStatus` | optional | Reserved for #P4-12; no inferred pass state. |
| `tags` | optional string array | Reserved for #P4-15; no local storage is introduced here. |
| `hasDrilldown` | required boolean | Derived as `turnCount > 0`. |

**Relationships:**

- `Session` — one page item is projected from one derived session.
- `SessionTimelineItem` — a smaller identity projection of an eligible page item.
- compare state — two or three item IDs may be selected.

**Lifecycle:**

- Projected from current store state → cached under the sessions query prefix → invalidated by
  existing session-added/session-updated messages.

### SessionTimelineSet

**Purpose:** Bounded, disclosed identity-bearing data for the table/Gantt toggle.

**Key fields:**

| Field | Type / Constraint | Notes |
|---|---|---|
| `items` | maximum 500 `SessionTimelineItem` values | Each contains identity, start/end, project, and computed cost for a focusable bar. |
| `matched` | required non-negative integer | Exact population before timeline eligibility checks. |
| `eligible` | required non-negative integer | Sessions with usable start/end instants. |
| `returned` | required non-negative integer, `<= eligible` | Serialized visual item count. |
| `sampled` | required boolean | True only when `returned < eligible`. |
| `excludedInvalidTime` | required non-negative integer | Makes table/timeline count differences explicit. |

**Relationships:**

- `SessionPopulationFilter` defines `matched`.
- `SessionPageResponse` optionally contains one set when `include=timeline`.

**Lifecycle:**

- Derived before table pagination → sampled deterministically if needed → discarded with response.

### ScatterMetricsResult

**Purpose:** A session-level numerical visualization response without adding a high-cardinality
`session` dimension to ordinary metrics series.

**Key fields:**

| Field | Type / Constraint | Notes |
|---|---|---|
| `mode` | literal `scatter` | Response discriminator. |
| `entity` | literal `session` | This task adds only session scatter. |
| `xMeasure`, `yMeasure` | required `Measure` values | Any existing measures; entities with unavailable values are excluded honestly. |
| `sizeMeasure` | optional `Measure` | Drives point size when available. |
| `points` | maximum 500 points | Includes `sessionId`, x/y, optional size, and tooltip identity. |
| `regression` | `{ slope, intercept, rSquared }` or `null` | Ordinary least squares over all eligible points; null for fewer than two usable/distinct-x points. |
| `population` | matched/eligible/returned/excluded/sample metadata | Discloses filtering, missing measures, and sampling. |

**Relationships:**

- `SessionPopulationFilter` selects candidate sessions.
- `MeasureScope` and `computeMeasure` provide x/y/size values without duplicating pricing or token
  semantics.

**Lifecycle:**

- Computed per metrics request → cached under the metrics query key → invalidated by existing WS
  events.

### SessionsPageState

**Purpose:** Typed client representation of every shareable Sessions control.

**Key fields:**

| Field | Type / Constraint | Notes |
|---|---|---|
| global filters | existing `FilterState` | Range, project, model, branch, and host. |
| page filters | cost bounds, entrypoint, drilldown, reserved gate/tag | Defaults are omitted from the URL. |
| sort/page | allowed sort key, order, non-negative offset | Drives exact server paging. |
| browser view | `table` or `timeline` | Switching uses already-fetched response data. |
| distribution view | `histogram` or `percentiles` | Display-only selection over one exact result. |
| scatter controls | x/y and optional size measures | Presets write the same underlying fields as custom selection. |
| compare IDs | unique array of zero to three session IDs | Comparison renders when two or three currently matching items resolve. |

**Relationships:**

- Parses global and page-owned URL keys from one query string.
- Produces both `SessionPageParams` and metrics `sessionPopulation` values.

**Lifecycle:**

- Parsed on render → modified through wouter navigation/history → re-parsed; never duplicated in
  React context or storage.

## API Contracts / Interfaces

### Sessions List Route

**Boundary:** HTTP API

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| Existing summary | `GET /api/sessions` | Preserve compact Dashboard list, pagination, metadata, and optional trace behavior. | Existing `SessionListResponse`; existing typed 400 behavior and trace/page caps remain unchanged. |
| Page projection | `GET /api/sessions?view=page` | Return exact page rows from the normalized population. | `SessionPageResponse` with strict `SessionPageItem[]`, exact total, and existing capture/extent metadata. |
| Page + timeline | `GET /api/sessions?view=page&include=timeline` | Return the same exact rows plus the pre-pagination timeline set. | `SessionPageResponse.timeline`; sampling and invalid-time exclusions are disclosed. |
| Compare hydration | `GET /api/sessions?view=page&sessionId=a,b` | Resolve selected IDs under the same active population filters. | Zero to three page items; IDs that no longer match are absent rather than fetched outside the population. |

Expanded page sorts cover computed/observed cost, total tokens, turns, duration, cache percentage,
gate score, branch, version, last activity, and existing savings/peak-cost keys. Expanded filters cover
entrypoint, computed-cost bounds, drilldown availability, reserved gate status, and session IDs.
Unsupported combinations such as `view=page&include=trace` or summary `include=timeline` return 400.

**Auth requirements:** No new auth. The route inherits the local Claude Lens server boundary and
does not expose prompt bodies or raw transcript content.

### Metrics Route

**Boundary:** HTTP API

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| Distribution | `POST /api/metrics` with top-level `range`, `mode: "distribution"`, `distributionEntity: "session"`, and non-range `sessionPopulation` criteria | Compute exact histogram and percentiles for the Sessions population. | Existing `Series[]`; invalid filters/measures/ranges return typed 400. |
| Scatter | `POST /api/metrics` with top-level `range`, `mode: "scatter"`, `entity: "session"`, x/y/optional-size measures, and non-range `sessionPopulation` criteria | Compute full-population points, regression, eligibility, and bounded display points. | `ScatterMetricsResult`; invalid measures/population/caps return typed 400. Degenerate populations return `regression: null`. |

The existing aggregate client wrapper accepts only series/distribution queries and still returns
`Series[]`. A separate guarded scatter wrapper accepts only `ScatterMetricsQuery` and requires the
discriminated object response, preventing existing callers from receiving a widened union.
The server combines the metrics query's existing top-level `range` with `sessionPopulation`; the
sessions route combines `from`/`to` with its flattened page filters. Both normalize to the internal
`SessionPopulationFilter`, so the canonical model contains one range rather than two competing ones.

**Auth requirements:** No new auth; same local API boundary as existing metrics requests.

### Global and Sessions URL State

**Boundary:** Internal module API

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| Global patch | `mergeGlobalFilters(search, nextFilters)` | Replace owned global keys while preserving page-owned keys. | Returns a canonical query string; malformed global values fall back through existing parsing. |
| Sessions parse | `parseSessionsPageState(search)` | Decode page controls, enforce enums/ranges, deduplicate/cap compare IDs. | Never throws; invalid page values fall back to documented defaults. |
| Sessions update | `serializeSessionsPageState(state)` | Produce canonical, default-omitting URL state. | Stable ordering for query keys, history, and tests. |
| Query mapping | page-state query builders | Produce list params and metrics population from the same resolved range and filters. | Pure typed values; no fetch or aggregation side effects. |

**Auth requirements:** Not applicable.

### Existing WebSocket Invalidation

**Boundary:** Event consumer

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| Session invalidation | existing `session-added` / `session-updated` messages | Refetch page rows, timeline, distribution, scatter, and compare data through existing prefixes. | No event shape or producer change. Temporary cross-request skew converges on invalidation/refetch. |

**Auth requirements:** Unchanged existing `/ws` boundary.

## Module Boundaries

| Module / Package | Responsibility | Allowed Dependencies |
|---|---|---|
| `shared/sessions-contract.ts` | Summary and page list vocabulary, population/filter fields, timeline metadata. | Shared scalar/domain types only. |
| `shared/metrics-contract.ts` | Aggregate and scatter query/result vocabulary. | Shared session-population type where needed; no server/client imports. |
| `server/metrics/session-population.ts` | Pure normalization, matching, and session-ID scope indexing. | Shared contracts/types; no Fastify, filesystem, or client modules. |
| `server/routes/sessions.ts` | Validate HTTP query, read Store once, project/sort/page, optionally build timeline. | Store for data; shared contracts; pure metrics/session helpers for computation. |
| `server/metrics/scatter.ts` | Per-session measure pairing, regression, eligibility, deterministic sampling. | Existing measures and pure session-population helpers. |
| `server/metrics/engine.ts` | Dispatch aggregate/distribution/scatter modes and reuse indexed entity scopes. | Metrics modules and shared contracts; no Fastify or filesystem. |
| `server/routes/metrics.ts` | Validate discriminated query shapes and return engine output. | Store for data and metrics engine for computation. |
| `client/src/api/*` | Serialize requests and validate response shapes. | Shared contracts; no page components. |
| `client/src/pages/sessions/state.ts` | URL state and pure query construction. | Shared contracts and existing filter-state primitives; no fetch/render logic. |
| `client/src/pages/sessions/*` | Page-specific queries, display state, interactions, accessible fallbacks. | Client APIs, query keys, shared primitives/charts, and page state. |
| `client/src/pages/Sessions.tsx` | Compose sections in binding spec order. | Sessions page-local modules only; no direct store or aggregation logic. |
| `client/src/components/DataTable.tsx` | Generic accessible client- or server-controlled table rendering. | TanStack Table/Virtual and generic UI primitives only. |
| `client/src/charts/Chart.tsx` | Generic ECharts lifecycle and registered chart families. | ECharts only; no API, filters, or page business logic. |

## Change Footprint

_The concrete answer to "where does this land in the codebase?" — produced during the Phase D2 walk._

### New files / modules

| Path | Purpose | Pattern reference |
|---|---|---|
| `server/metrics/session-population.ts` | Canonical matcher and linear-time per-session scope indexing. | Pure helpers in `server/metrics/dimensions.ts`. |
| `server/metrics/session-population.test.ts` | Contract coverage for shared population semantics. | `server/metrics/dimensions.test.ts`. |
| `server/metrics/scatter.ts` | Measure pairing, regression, eligibility metadata, and sampling. | `server/metrics/distributions.ts`. |
| `server/metrics/scatter.test.ts` | Pure scatter/regression/sampling coverage. | `server/metrics/distributions.test.ts`. |
| `client/src/api/metrics.test.ts` | Aggregate/scatter wrapper and response-guard coverage. | `client/src/api/sessions.test.ts`. |
| `client/src/components/DataTable.test.tsx` | Controlled/manual sorting regression coverage. | `client/src/charts/Chart.test.tsx`. |
| `client/src/pages/sessions/state.ts` | Canonical Sessions URL state and query builders. | `client/src/filters/state.ts`. |
| `client/src/pages/sessions/state.test.ts` | URL/query-builder contract coverage. | `client/src/filters/state.test.ts`. |
| `client/src/pages/sessions/PromptSearchSlot.tsx` | Stable #P4-3 mount point with unavailable state. | Dashboard conditional/stub sections. |
| `client/src/pages/sessions/SessionsFilters.tsx` | Page-only cost, entrypoint, drilldown, and future gate/tag controls. | `client/src/filters/FilterBar.tsx`. |
| `client/src/pages/sessions/SessionsFilters.test.tsx` | Page-filter interaction coverage. | Dashboard section tests. |
| `client/src/pages/sessions/SessionsFilters.stories.tsx` | Default, active, and unavailable-filter states. | `client/src/filters/FilterBar.stories.tsx`. |
| `client/src/pages/sessions/SessionBrowser.tsx` | Query-owned table/timeline toggle, server paging/sorting, selection, and drill links. | `client/src/pages/dashboard/LeaderboardsCard.tsx`. |
| `client/src/pages/sessions/SessionBrowser.test.tsx` | Browser interaction and state-boundary coverage. | `client/src/pages/dashboard/LeaderboardsCard.test.tsx`. |
| `client/src/pages/sessions/SessionBrowser.stories.tsx` | Table, timeline, loading, empty, sampled, and premium states. | `client/src/pages/dashboard/LeaderboardsCard.stories.tsx`. |
| `client/src/pages/sessions/CostDistributionCard.tsx` | Distribution query, histogram/percentile display, and semantic values. | `client/src/charts/ChartCard.tsx`. |
| `client/src/pages/sessions/CostDistributionCard.test.tsx` | Distribution state and accessibility coverage. | `client/src/charts/ChartCard.test.tsx`. |
| `client/src/pages/sessions/CostDistributionCard.stories.tsx` | Histogram, percentiles, empty, loading, and error states. | `client/src/charts/ChartCard.stories.tsx`. |
| `client/src/pages/sessions/EfficiencyScatterCard.tsx` | Scatter controls, chart, regression summary, point-to-table filtering, and semantic table. | `client/src/charts/ChartCard.tsx`. |
| `client/src/pages/sessions/EfficiencyScatterCard.test.tsx` | Scatter state, point interaction, and degenerate-result coverage. | `client/src/charts/ChartCard.test.tsx`. |
| `client/src/pages/sessions/EfficiencyScatterCard.stories.tsx` | Preset, sampled, unavailable-measure, empty, loading, and error states. | `client/src/charts/ChartCard.stories.tsx`. |
| `client/src/pages/sessions/SessionCompare.tsx` | Two/three-session side-by-side summary and unavailable-selection handling. | `client/src/pages/dashboard/RecordsStrip.tsx`. |
| `client/src/pages/sessions/SessionCompare.test.tsx` | Compare selection/hydration coverage. | Dashboard section tests. |
| `client/src/pages/sessions/SessionCompare.stories.tsx` | Two-way, three-way, premium, and missing-selection states. | Dashboard section stories. |
| `client/src/pages/sessions/Sessions.test.tsx` | Whole-page composition and independent-error coverage. | `client/src/pages/dashboard/Dashboard.test.tsx`. |
| `cypress/e2e/sessions.cy.ts` | Fixture-backed Sessions route and drill smoke coverage. | `cypress/e2e/dashboard.cy.ts`. |

### Modified files / modules

| Path | What changes here |
|---|---|
| `shared/sessions-contract.ts` | Add page params/item/response, population filters, expanded sorts, and timeline metadata while preserving summary types. |
| `shared/sessions-contract.test.ts` | Pin the new discriminated page vocabulary and existing-summary compatibility. |
| `shared/metrics-contract.ts` | Add session-population input and discriminated scatter query/result types without widening ordinary `Series[]` callers. |
| `shared/metrics-contract.test.ts` | Pin scatter discriminators and existing exhaustive measure/dimension guards. |
| `server/routes/sessions.ts` | Validate page-only fields, reuse population matching, project strict page rows, and optionally attach the pre-pagination timeline set. |
| `server/routes/sessions.test.ts` | Cover the page projection while retaining all default/trace/filter/meta regression guards. |
| `server/routes/metrics.ts` | Validate session-population and scatter-specific request fields and dispatch the new mode. |
| `server/routes/metrics.test.ts` | Cover the new discriminated route response and malformed-request rejection. |
| `server/metrics/engine.ts` | Reuse indexed session scopes for distribution and dispatch scatter without changing series semantics. |
| `server/metrics/engine.test.ts` | Pin session-population consistency, scatter dispatch, and unchanged aggregate/distribution behavior. |
| `client/src/api/sessions.ts` | Serialize new list fields and add a strict `listSessionsPage` response guard/wrapper alongside existing `listSessions`. |
| `client/src/api/sessions.test.ts` | Pin page serialization/guarding and compact-summary compatibility. |
| `client/src/api/metrics.ts` | Narrow the existing aggregate wrapper and add a guarded `postScatterMetrics` wrapper. |
| `client/src/filters/state.ts` | Add a pure global-key merge operation that preserves page-owned URL fields. |
| `client/src/filters/state.test.ts` | Pin canonical global patching and unknown/page-key preservation. |
| `client/src/filters/useFilters.ts` | Commit global changes by merging into the current search string instead of replacing every key. |
| `client/src/components/DataTable.tsx` | Add an optional controlled/manual sorting prop path while retaining internal sorting by default. |
| `client/src/components/DataTable.stories.tsx` | Add the controlled sorting state without changing existing stories. |
| `client/src/charts/Chart.tsx` | Register scatter and accept the generic ECharts option boundary promised by its existing module comment. |
| `client/src/charts/Chart.test.tsx` | Update ECharts registration mocks and preserve lifecycle/click/accessibility guards. |
| `client/src/charts/Chart.stories.tsx` | Add a scatter-family rendering state. |
| `client/src/pages/Sessions.tsx` | Replace `PageStub` with the Sessions composition shell in binding section order. |
| `cypress/e2e/dashboard.cy.ts` | Strengthen the existing Dashboard drill to assert filtered Sessions content, not only URL navigation. |
| `test/fixtures/README.md` | Record which existing fixture properties drive Sessions table, chart, timeline, and compare coverage. |

### Deleted / replaced

| Path | Reason |
|---|---|
| None | No module or public route is removed; only the implementation inside the existing Sessions page stub is replaced. |

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|---|---|
| `shared/types.ts` | Already contains every transcript/premium session field needed by the new projection; changing it would expand scope unnecessarily. |
| `server/metrics/measures.ts` | Remains the single source of measure semantics used by distribution and scatter. |
| `server/metrics/distributions.ts` | Existing exact histogram/percentile implementation must remain the page's source. |
| `server/app.ts` | `/api/sessions` and `/api/metrics` remain registered exactly once; no new route is added. |
| `client/src/api/queryKeys.ts` | Existing metrics/sessions keys already cover all new variants and drive WS invalidation. |
| `client/src/api/queryKeys.test.ts` | Guards the prefixes that new page queries depend on. |
| `client/src/ws.ts` | Existing session events already invalidate both relevant prefixes; event behavior must not drift. |
| `client/src/routes.ts` | The `/sessions` route and navigation entry already point to `Sessions`; path shape stays stable. |
| `client/src/pages/dashboard/*` | Multiple components consume the compact sessions response and aggregate metrics wrapper; defaults must remain compatible. |
| `client/src/charts/ChartCard.tsx` | Existing time-series caller of `Chart` and aggregate metrics wrapper must remain behaviorally identical. |
| `specs/pages/sessions.html` and `specs/pages/sessions.png` | Read-only visual references; spec table overrides their missing compare/tags sections. |
| `specs/claude-lens-pages.md` and `specs/claude-lens-plan.md` | Binding scope/sequence sources; this architecture does not rewrite requirements or prematurely flip the issue checkbox. |
| `test/fixtures/projects/**/*.jsonl` | Existing four-session fixture population should drive the new smoke test without task-specific data fabrication unless implementation proves a gap. |

## Areas of Impact

_Broader-than-files impact — modules, services, teams, contracts, cross-cutting effects._

| Area | Impact | Risk (L/M/H) | Why |
|---|---|---|---|
| Shared metrics contract/engine | Adds a new result family and session-population semantics; optimizes session entity scoping. | H | Exhaustive unions, validators, and many existing aggregate callers depend on precise narrowing. |
| Sessions HTTP/client contract | Adds a strict page projection and expanded query vocabulary while preserving defaults. | M | Existing Dashboard consumers share the endpoint and response guard. |
| URL/filter ownership | Global updates begin preserving non-global keys; Sessions adds a second typed state layer. | M | A merge error could retain stale state or drop drill-in/page parameters. |
| Shared DataTable | Adds optional server-controlled sorting. | M | Header accessibility and existing uncontrolled sorting must both remain correct. |
| Shared Chart | Registers scatter and widens only the option type boundary. | M | ECharts tree-shaking/mocks and every time-series caller share this lifecycle shell. |
| Sessions page UI | Replaces a stub with several live, independently failing sections. | M | Complex loading, empty, premium, sampling, selection, and responsive states converge here. |
| Existing Dashboard | Drill destination becomes live; compact list consumers remain on the old projection. | M | Default response or URL behavior regressions would surface outside the new page. |
| Store/ingest/WS | No stored shape or event changes; current values feed new projections. | L | Read-only consumers only, but live invalidation convergence remains important. |
| Build/deployment | No dependency, generated asset, database, or route-registration change. | L | Existing build and single-process deployment are retained. |

**Contract changes:** `GET /api/sessions` gains additive `view=page`, expanded page-only filters/sorts,
and a strict page response; its default response remains unchanged. `POST /api/metrics` accepts a
new discriminated scatter query and returns an object only for that mode; existing series and
distribution calls still return `Series[]`. No WebSocket payload changes.

**Cross-cutting ripples:** URL commits preserve page-owned parameters, shared table/chart primitives
gain opt-in behavior, and the Dashboard drill test now validates its real destination. There are no
auth, telemetry pipeline, migration, feature-flag, dependency-install, or deployment-topology
changes.

## Cross-Cutting Concerns

- **Errors:** Server parsers reject unknown enums, invalid ISO ranges, non-finite/negative bounds,
  contradictory cost bounds, oversized ID selections, and incompatible projection/include pairs
  with HTTP 400 and `{ error }`. Client guards distinguish rejected requests from invalid 2xx
  shapes. Sessions, distribution, and scatter queries surface errors within their own sections;
  compare reports selected IDs that no longer match instead of fetching outside the population.
- **Logging & metrics:** Use existing Fastify/Pino request/error logging; expected validation 400s do
  not add noisy custom logs. Responses expose exact population, eligibility, exclusion, returned,
  and sampling fields so truncation is observable in UI and diagnostics. No new telemetry system is
  introduced.
- **Auth / authz:** No change. Claude Lens remains a local-first app with the existing server
  boundary. The new APIs return derived session metadata and measures, not raw prompt or transcript
  bodies.
- **Performance:** Filtering is linear over sessions; sorting is `O(S log S)` on the exact matched
  set; pagination happens after sorting. Calls and turns are indexed by session ID once per metrics
  request so distribution/scatter do not scan all calls once per session. Histogram and regression
  remain exact; table pages stay bounded by the existing route cap; timeline/scatter serialize at
  most 500 identity points. TanStack Query cancellation, keep-previous-data, and existing prefix
  invalidation are reused.
- **Security:** Treat every URL/API field as untrusted. Validate finite numeric values, ISO dates,
  enumerations, CSV contents, ID counts, and projection combinations before computation. Do not add
  filesystem access, raw transcript reads, HTML injection, new secrets, or prompt-text transport.
- **Migrations / rollout:** No data migration. Server and SPA ship in the same package, and new
  contracts are additive/discriminated. A rollback restores the Sessions stub/client use while the
  default session and aggregate metrics behavior remains compatible. No feature flag is required.

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies REQs |
|---|---|---|---|---|
| A1 | Add a strict `view=page` projection to the existing sessions route. | Replace summary shape; new endpoint; client-side projection. | Preserves Dashboard while satisfying the settled API surface. | R3, R9, R12 |
| A2 | Normalize both APIs through one `SessionPopulationFilter`. | Independent filters; transfer session IDs between APIs. | All page sections must describe the same population. | R2, R5, R6, R7, R10 |
| A3 | Keep histogram/percentiles in distribution mode. | Compute from paged list data; new analytics endpoint. | Existing metrics engine already owns exact distribution semantics. | R6 |
| A4 | Add discriminated session scatter mode to the metrics engine. | Client regression; session dimension; dedicated endpoint. | Supports any-measure pairing without duplicating aggregation or exploding ordinary dimensions. | R5 |
| A5 | Compute aggregates on the full population and cap only visual identities at 500. | Approximate all results; unbounded points; silently first-page results. | Exact answers and bounded rendering are both preserved and disclosed. | R4, R5, R6, R11 |
| A6 | Encode all shareable Sessions state in the URL. | Local React/context/storage state. | Preserves drill-ins, history, refresh, and permalinks. | R2, R7, R10, R12 |
| A7 | Make global filter updates patch owned URL keys. | Keep replacement serialization; move all page state into global FilterState. | Prevents Sessions state loss without polluting global vocabulary. | R2, R10 |
| A8 | Add optional controlled/manual sorting to shared DataTable. | Bespoke table; client sorting over all rows. | Exact paging needs server sorting and existing consumers need stability. | R3 |
| A9 | Use semantic HTML/CSS timeline bars and ECharts scatter/histogram with non-canvas equivalents. | Canvas-only charts; custom SVG; another library. | Reuses established tooling while keeping bars and points keyboard/screen-reader reachable. | R4, R5, R6, R13 |
| A10 | Put compare IDs in the URL and resolve only two or three IDs under current filters. | Ephemeral selection; future detail endpoint; fetch outside filters. | Comparison is shareable, bounded, and population-consistent. | R7, R10 |
| A11 | Treat search, tags, gates, and unavailable premium fields as explicit seams. | Implement dependencies early; fabricate values; omit all UI evidence. | Keeps issue ownership clear while making later integration stable and honest. | R3, R8 |
| A12 | Reuse existing errors, query keys, WS invalidation, storage, auth, and deployment topology. | New event, cache, persistence, auth, dependency, or route. | The page is a read-only brownfield feature and needs no infrastructure expansion. | R12, R14 |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|---|---|
| Sessions or metrics API is unavailable for 30 seconds. | Each query has an independent section state; cached/previous data may remain visible, failed sections show actionable errors, and successful sections remain mounted. |
| A live session updates between list, distribution, and scatter requests. | Each request uses a coherent request-local store read and the existing WS invalidation refetches both prefixes. Cross-request atomic snapshot isolation is not claimed; the page converges after invalidation. |
| The matched history grows from hundreds to millions of calls/sessions. | Exact work remains linear plus list sorting; per-session call/turn maps prevent quadratic entity scans; table payloads are paged and identity visual sets cap at 500. Sampling metadata prevents silent partial displays. |
| Two callers request different sorts/filters concurrently. | Routes are read-only and sort request-local filtered arrays; no Store mutation, shared cursor, or created resource can race or duplicate. |
| Scatter has zero/one eligible point or all X values are identical. | Returns an honest eligible count and `regression: null`; UI renders the points or an insufficiency message, never NaN/Infinity. |
| A premium measure is selected for a transcript-only population. | Entities with null values are excluded and counted; the section renders an unavailable/locked state rather than zero-valued points. |
| A session has empty/unparseable timestamps but valid aggregate fields. | It remains in the table, is excluded from timeline eligibility, and the timeline metadata/UI discloses the exclusion count. |
| URL contains malformed bounds, unknown measures, duplicate IDs, or more than three compare IDs. | Client parsing falls back/canonicalizes safely; direct malformed API requests receive typed 400 responses before computation. |
| The release must be rolled back. | No migration or persisted state exists. Default API modes remain backward-compatible and server/SPA deploy together, so reverting code is sufficient. |

### Backward — regression risk per touched area (brownfield only)

| Touched area (from Change Footprint) | What could regress | How we'd know / mitigation |
|---|---|---|
| `shared/sessions-contract.ts` + `server/routes/sessions.ts` | Dashboard summary fields, trace limits, filtering, sorting, extent, or global-capture semantics change. | Keep summary/page projections discriminated and retain existing route/client tests as regression gates. |
| `shared/metrics-contract.ts` + metrics route | Existing callers receive an object/union instead of `Series[]`, or malformed modes reach the engine. | Narrow aggregate/scatter client wrappers separately and validate each discriminator at the HTTP boundary. |
| `server/metrics/engine.ts` | Series/distribution grouping, range, cost basis, smoothing, or compare behavior shifts during session-scope optimization. | Reuse existing paths and keep the full engine suite green; isolate new scatter dispatch and indexed scope helper. |
| `server/metrics/session-population.ts` | Route and metrics disagree on model/host/range semantics or accidentally compute partial-session totals. | One matcher plus parity coverage; selected sessions retain all their calls/turns after population selection. |
| `client/src/filters/*` | Global filter commits drop page params, preserve stale global values, or break Back navigation. | Pure canonical merge contract and existing filter tests; navigation still creates real history entries. |
| `client/src/components/DataTable.tsx` | Existing uncontrolled sorting, virtualization, row actions, or `aria-sort` breaks. | Add a prop-discriminated controlled path; leave current internal-state path as default and retain stories/coverage. |
| `client/src/charts/Chart.tsx` | Time-series registration, lifecycle, resize, click handling, or test mocks break. | Add scatter registration only, keep lifecycle unchanged, and retain existing Chart/ChartCard tests. |
| `client/src/api/queryKeys.ts` and `client/src/ws.ts` | New page variants fail to refetch on live session updates. | Both variants keep existing `sessions`/`metrics` prefixes; no new prefix or WS message is introduced. |
| `client/src/pages/dashboard/*` | Compact session fixtures or aggregate metrics calls become incompatible. | Page-only response/wrapper is separate; Dashboard component/unit/Cypress coverage remains in the verification gate. |
| `server/app.ts` and `client/src/routes.ts` | Duplicate API registration or changed `/sessions` path. | No edits planned; existing registration and routing regression tests remain authoritative. |

## Open Questions

- None. The developer confirmed the decision set and the Phase 2 readiness gate on 2026-07-18.

## Out of Scope

- Real full-text prompt search and result deep-links (reason: owned by #P4-3; this issue supplies the
  stable mount point only).
- Gate calculation, gate-status filtering, and real gate-score cells (reason: owned by #P4-12;
  controls/fields remain unavailable seams).
- Premium C/B/L parsing and population of observed cost, true context percentage, and line changes
  (reason: owned by #P4-13; this issue renders fields when honestly present).
- Persistent tags and tag filtering (reason: owned by #P4-15 local-store work; this issue supplies
  the visible stub/seam).
- Session Detail or Turn Inspector APIs/content (reason: owned by #P4-5 and #P4-6).
- Export behavior (reason: owned by #P4-17, which consumes the Sessions view later).
- Cross-request transactional snapshot isolation (reason: the existing live architecture is
  eventually consistent through WS invalidation; no database or snapshot token is introduced).
- Automated visual regression or changing the reference mockup (reason: Phase 4 requires manual
  comparison plus Cypress smoke, and the spec table remains binding over the mockup).

---

# Tasks

_This section is populated by the **generate-tasks** skill (Phase 3)._
_Run: `/generate-tasks from: specs/architecture/ARCH-sessions-page.md`_
