# Architecture: Dashboard page (#P4-2 / issue #34)

> **Date:** 2026-07-18
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** `specs/claude-lens-pages.md` §0–§1, `specs/claude-lens-plan.md` #P4-2, and `specs/issues/P4-2-dashboard-page.md`
> **Type:** feature (brownfield)
>
> **Contributor annotation:** **[Sol]** marks content added or materially revised by Sol during the code-grounded architecture audit on 2026-07-18. The audit retained the original Dashboard direction but corrected boundaries and assumptions after walking the current implementation.

## Architecture Summary

> **[Sol] Revised after the codebase and change-footprint walk.**

The Dashboard remains a composition of section-level React containers over the existing metrics engine, shared dashboard primitives, URL filters, and TanStack Query. A new general, paginated `GET /api/sessions` endpoint supplies entity-shaped data that the metrics engine intentionally does not expose; it lands in #P4-2 because the Dashboard needs it now and later becomes the foundation for #P4-4. Pricing and model context metadata are injected once into ingest and HTTP assembly so stored session rollups, metric queries, trace data, savings, and context estimates use the same runtime inputs. The existing `ChartCard` is corrected to request time buckets and preserve categorical filters during drill-down, while new savings, failed-work, and historical-anomaly calculations stay server/shared-domain concerns rather than client-side pricing logic. Every section degrades independently and honestly when history, pricing, calibration, premium capture, or downstream gate data is unavailable.

## Inferred Requirements (if Mode B / no REQ)

> **[Sol] Added because this planned task has no standalone `REQ-*` artifact.**

| ID | Inferred Requirement | Source |
|---|---|---|
| R1 | Render all 12 Dashboard sections using real repository data; the pages table is binding where it differs from the mockup. | `specs/claude-lens-pages.md` §1; issue #34 |
| R2 | Preserve the global analytics contract: URL filters, deltas, sparklines, time grains, unit switching, compare overlays, drill links, and honest empty states. | `specs/claude-lens-pages.md` §0 |
| R3 | Keep transcript-only behavior useful and label computed/estimated/unavailable values without fabricating premium observations. | pages data-source legend and tier rules |
| R4 | Serve recent/top/record session data through a reusable server boundary rather than a Dashboard-specific aggregate. | current `Store.listSessions()` shape; “pages are cheap” architecture principle |
| R5 | Detect expensive turns against the user-wide historical median and make the detector reusable by Session Detail. | #P4-2 issue scope; pages §10 anomaly threshold row |
| R6 | Count failed tool results/commands even though raw tool-result bodies are discarded after parsing. | pages §1 failed-work row; existing parser memory contract |
| R7 | Keep live session-backed views fresh through the existing WebSocket invalidation bus. | architecture §7 and current TanStack Query wiring |
| R8 | Cover component states in Storybook, add a fixture-backed Cypress smoke journey, and preserve the accessible chart/data-table boundary. | Phase 4 standing rules; #P4-19 |
| R9 | Make pricing, savings, and transcript context estimates internally consistent and replaceable by later Settings/premium work. | existing pricing injection seam; #P4-13/#P4-15 boundaries |

## High-Level Structure

> **[Sol] Revised: adds the grounded session boundary, runtime metadata injection, and real chart correction.**

```text
CLI assembly
  ├─ pricing table ───────────────┬─> ingest Store session derivation
  └─ context-window catalog ──────┘            │
                                               v
                                    calls + turns + sessions
                                               │
                    ┌──────────────────────────┴──────────────────────────┐
                    v                                                     v
          POST /api/metrics                                      GET /api/sessions
      existing engine + new measures                     NEW typed/paginated summaries
                    │                                      + optional recent trace
                    └──────────────────────────┬──────────────────────────┘
                                               v
                         client/src/pages/Dashboard.tsx
                           ├─ section-owned, batched metrics queries
                           ├─ entity queries through api/sessions.ts
                           ├─ corrected ChartCard time-series query
                           └─ shared primitives + independent states

shared/anomaly.ts
  pre-priced historical turn samples -> median + ratios + flagged samples
```

The Dashboard uses the following concrete data boundaries:

| Section | Data source and range semantics | Degradation |
|---|---|---|
| Stat cards | Two batched `/api/metrics` queries: aggregate+compare and time-bucketed sparklines for spend, tokens, cache hit, sessions, and average cost/session | Empty state; computed basis label |
| Cost over time | Existing `ChartCard`, corrected to use the `time` dimension and preserve categorical filters in bucket links | Per-card loading/error/empty state |
| Burn rate | Calendar-month-to-date metrics plus client projection; categorical filters apply but the global date range does not | Real MTD/projected value; budget control shows unconfigured until #P4-10/#P4-15 |
| Most recent session | `/api/sessions?sort=lastAt&limit=1&include=trace`, using active filters/range | Empty state; context estimate unavailable for unknown models |
| Leaderboards | Sessions from `/api/sessions`; projects/models from separate dimension metrics queries | Independent tab state and errors |
| Anomaly & gate feed | Stable stub UI now; `shared/anomaly.ts` ships for later feed and Session Detail consumers | Explicit “gate data not available yet” state |
| Records | Session record sorts through `/api/sessions`; expensive day through `/api/metrics` over matched history extent | “Ever” ignores only date selection; categorical filters remain active |
| Subscription windows | All-history hourly token series; client derives rolling 5h/7d totals, historical peaks, and next expiry | Historical-peak estimate until calibrated limit exists |
| Leverage ratio | Aggregate cache-read tokens divided by fresh-billed input/cache-create tokens | Zero denominator renders unavailable, not infinity |
| Savings decomposition | New cache and routing savings measures using one non-overlapping counterfactual | Unknown/unpriced models contribute no fabricated savings |
| Failed-work stat | New `toolErrors` measure over parser-classified failed tool results | Zero is a real zero; malformed records never throw |
| Capture banner | Global capture coverage metadata from `/api/sessions`, intentionally independent of filters | CTA appears only when no C/B/L source exists globally |

> **[Sol] Section-level contract locks** added 2026-07-18 to lock the implementer-facing details surfaced during the architecture review. These resolve the contract-level ambiguities (drill matrix, compare-ghost formula, click-to-drill date semantics, records measures, subscription peak semantics, capture-banner global rule, anomaly feed item kinds, anomaly factor default) without changing the architecture or footprint.

**Section-level contract locks** (Phase 2 → Phase 3 handoff; resolve the next-implementer's open questions inline):

- **Stat-card drill matrix** (pages §1 "Each → its page", binding): spend → Trends (§8); total tokens → Models (§6); cache hit % → Cache Lab (§7); sessions → Sessions (§2); avg $/session → Trends (§8). Each card is its own link target; selected filters carry into the destination page.
- **Stat-card tier basis after A3**: spend/avg $/session render as 🟡 computed (priced via the injected runtime table) and switch to 🟢 observed only when an `<uuid>.cost.jsonl` (L) overlay is present; tokens/cache hit %/sessions remain 🟢 computed from transcripts. The basis label is mandatory; no number renders without one.
- **Compare-ghost formula** (Cost over time): the ghost series is **the previous equal-length period ending where this period starts**; categorical filters (project/model/branch/host) are preserved across both legs, so the comparison is apples-to-apples for the active cohort. Granularity options on this chart: day/week/month by default, hour only when C capture is present; unit switcher cycles `$` ↔ tokens ↔ API calls ↔ turns (the latter two fall back to transcript-only when pricing is absent).
- **Click-to-drill on Cost over time** (pages §0 "Drill-anywhere"): a clicked bucket replaces the global date range with that bucket's `[from, to]`; categorical filters remain active. Single-day buckets drill to `from = to = dayStart`.
- **Records strip measures** (binding from spec): most-expensive day/session/turn use `costComputed` (only meaningful after A3); longest session uses `durationMs`; biggest cache save uses `cacheSavingsComputed`. All five records ignore only the active date range; categorical filters stay applied.
- **Subscription window peak semantics** (resolving ⚑N): when no user-calibrated limit exists, "vs peak" compares current rolling 5h/7d usage to the **highest** historical 5h/7d window seen in the current matched extent; once a calibrated ceiling is set in Settings, "vs peak" switches to comparing against that ceiling. The "resets in Xh Ym" label is the wall-clock expiry of the oldest contributing event in the active window, expressed in local time.
- **Capture-banner global rule** (`meta.globalCapture`): the field is computed once from the **unfiltered** C/B/L file set so the CTA is stable across filter changes; the route must not accept filter params into its computation, and the client renders the banner based on this single value alone.
- **Anomaly & gate-feed item kinds** (wire shape until #P4-12 lands): each rendered row is one of `anomaly` (price-driven, output of `detectTurnCostAnomalies`), `gateFailure` (placeholder until gate engine is wired), or `captureGap` (B/C missing). Items carry `kind`, `sessionId`, optional `turnId`, `severity`, `summary`, and `drill` (one of → §3 Session Detail, → §4 Turn Inspector, → §9 Data Health, or → §3 §Report Card). Stub state renders `kind: gateFailure` items with the explicit "gate data not available yet" message; other kinds fall through to their detector output.

Data flow for a filter-aware section is: URL query string → `useFilters()` → stable query construction → `qk` factory → typed API helper → Fastify validation → Store/metrics computation → section state. WebSocket messages invalidate metrics, session-detail, and sessions-list prefixes; mounted queries refetch data rather than receiving data over the socket.

## Tech Choices

> **[Sol] Revised to reflect current code rather than hypothetical task ownership.**

| Area | Decision | Alternatives Considered | Rationale |
|---|---|---|---|
| Entity delivery | Add general paginated `GET /api/sessions` in #P4-2 | Dashboard aggregator; wait for #P4-4 | Dashboard already needs entity identity/sorts/traces; `Store.listSessions()` exists; a reusable route avoids a throwaway page API |
| Response shape | Typed `{ items, total, meta }`, with opt-in trace | Raw `Session[]`; always include traces | Pagination and metadata prevent unbounded payloads; opt-in traces avoid bloating later Sessions-table reads |
| Pricing | Create one runtime pricing input and inject it into ingest plus HTTP routes | Route-only pricing; client pricing | Stored `Session.costComputed` is currently zero in production because CLI omits the pricer; one input prevents route/store drift and remains replaceable by Settings |
| Context fallback | Inject a model context-window catalog and derive optional estimated session context percent | Invent a universal percentage; show tokens only | Preserves the `ctx %` contract while keeping unknown models explicitly unavailable; premium C later supersedes the estimate |
| Dashboard queries | Section-owned containers, batching related measures within each section | One page aggregator/query; one request per stat | Independent states and Storybook isolation without needless request fan-out |
| Savings | Server measures with a decomposed all-Opus-uncached counterfactual | Client pricing; two independent counterfactuals | Pricing remains server-owned and the two displayed savings add exactly without double counting |
| Failed-work capture | Extend existing tool-result metadata before content is dropped | Retain raw output; parallel error-record pipeline | Preserves memory discipline and avoids duplicate parser/store plumbing |
| Anomaly detector | Pure shared function over pre-priced historical samples | Session-local `Turn[]`; server-only opaque flag | The input makes user-wide history explicit and lets later server/client consumers reuse the same median/ratio rule |
| Subscription semantics | Rolling UTC 5h/7d windows; expiry of oldest contributing event; historical peak until calibration | Fake fixed reset; hide section | Produces a useful, explainable transcript-only estimate without claiming provider-observed quota state |
| Dependencies | Use existing Fastify, React, TanStack Query, wouter, ECharts, date-fns, Tailwind | Add schema/state/chart libraries | Current stack already supplies every required boundary; no new dependency is justified |

## Patterns & Conventions

> **[Sol] Revised with the concrete rules implementation must preserve.**

- **URL as filter state** — active date/project/model/branch/host filters come only from `filters/`; widget display state stays local.
- **Intentional date overrides** — MTD, rolling windows, and “ever” records replace only the global date range and retain categorical filters.
- **Query keys from one factory** — `qk.sessions(params)` lives under `qk.prefixes.sessions`; WebSocket invalidation imports the same prefixes.
- **Server-owned money** — the client formats monetary values but never owns model rates or counterfactual formulas.
- **`null`/missing means unavailable; `0` means measured zero** — applies to context, savings, failures, calibration, and premium-only values.
- **Section container + presentational rendering** — each section owns a coherent request set; related stat measures are batched; stories exercise render states without requiring the whole page.
- **Invalidation bus only** — WebSocket payloads remain the existing three message types and never carry Dashboard data.
- **Strict module boundaries** — routes read through Store and call computation helpers; client API code owns fetch; `shared/` owns wire contracts and pure cross-runtime types.
- **Specs over mockup for presence** — the failed-work stat and average-cost/session stat remain even though the older mockup omits/replaces them.

## Data Models

> **[Sol] Revised: corrects pricing/context assumptions and avoids a parallel tool-result pipeline.**

### ToolResultBytesRecord

**Purpose:** Preserve compact tool-result metadata needed for context composition and failed-work counting while discarding raw result bodies.

**Key fields:**

| Field | Type / Constraint | Notes |
|---|---|---|
| existing identity/size fields | existing, required | `sessionId`, `promptId`, `toolUseId`, `bytes` remain unchanged |
| `isError` | boolean, required | True for raw `is_error: true` or recognized failed-command exit evidence, classified before content is dropped |

**Relationships:**

- Belongs to one prompt/turn through `promptId`; multiple records may aggregate into one main-thread Turn.

**Lifecycle:**

- Created during transcript parsing → accumulated in Store session state → summarized during turn derivation → cleared on session reset.

### Turn

**Purpose:** Existing derived prompt-level aggregate, extended for failed-work and anomaly consumers.

**Key fields:**

| Field | Type / Constraint | Notes |
|---|---|---|
| `errorToolResults` | number, optional additive field | Count of classified failed tool results; missing is treated as zero for backward compatibility |
| existing `calls` | `ApiCall[]` | Source for server-side computed turn cost samples |

**Relationships:**

- Many Turns belong to one Session; each Turn owns its attributed API calls.

**Lifecycle:**

- Re-derived from the complete per-session call/prompt/tool-result state on Store recompute.

### Session

**Purpose:** Existing session rollup used by the general sessions API and later pages.

**Key fields:**

| Field | Type / Constraint | Notes |
|---|---|---|
| `costComputed` | existing number | Becomes meaningful in production once CLI injects the runtime pricer |
| `cacheSavingsComputed` | number, optional | Current-model uncached cost minus actual cached cost |
| `maxTurnCostComputed` | number, optional | Maximum priced Turn total in the session |
| `contextPctEstimated` | number, optional | Latest-call transcript estimate using the matching model context window; unavailable for unknown models |

**Relationships:**

- Derived from one session’s calls and Turns; returned as the base of a `SessionListItem`.

**Lifecycle:**

- Lazily recomputed by Store, eventually consistent within the existing debounce window; no persistence or deletion change.

### SessionListItem and SessionListResponse

**Purpose:** Shared wire contract for the reusable sessions-list boundary.

**Key fields:**

| Field | Type / Constraint | Notes |
|---|---|---|
| `items` | `SessionListItem[]` | Sorted, filtered, offset, and capped page |
| `total` | non-negative integer | Count after range and categorical filters, before pagination |
| `meta.matchedExtent` | `{ from, to } \| null` | Earliest/latest matching session activity; supports bounded all-history metrics queries |
| `meta.globalCapture` | aggregate TierFlags | Global C/B/L presence for a stable capture CTA |
| `item.trace` | optional trace points | Included only for `include=trace`; cumulative priced turn values for the recent-session thumbnail |

**Relationships:**

- `SessionListItem` contains one Session summary and optionally projects its Turns into a lightweight trace.

**Lifecycle:**

- Constructed per HTTP read; never stored or mutated.

### TurnCostSample and TurnAnomaly

**Purpose:** Pricing-independent inputs/results for user-history anomaly detection.

**Key fields:**

| Field | Type / Constraint | Notes |
|---|---|---|
| sample identity | session ID + prompt/turn identity | Lets later consumers link a flagged result |
| `costComputed` | finite non-negative number | Produced by server-side pricing before detection |
| result median/ratio | finite numbers when baseline exists | Makes the historical baseline and threshold decision inspectable |

**Relationships:**

- Many historical samples form one comparison population; flagged results refer back to their source sample.

**Lifecycle:**

- Computed on demand; no persistence.

## API Contracts / Interfaces

> **[Sol] Revised with a complete, reusable sessions contract and explicit computation boundaries.**

### Sessions list API

**Boundary:** HTTP API, loopback Fastify server.

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| GET | `/api/sessions` | Return filtered/sorted session summaries, pagination metadata, matched extent, and global capture coverage | `200 SessionListResponse`; `400 { error }` for invalid/cross-field query values |

Supported query fields are `sort=lastAt|costComputed|durationMs|cacheSavingsComputed|maxTurnCostComputed`, `order=asc|desc`, `offset`, capped `limit`, paired `from`/`to`, CSV `project`/`model`/`branch`/`host`, and `include=trace`. The default is recent-first, offset zero, a bounded page, and no trace. Range membership follows the existing session-start convention used by the metrics engine; `include=trace` is restricted to a small page so trace projection cannot create an unbounded response.

**Auth requirements:** No user identity layer; same loopback-only trust model as `/api/metrics`. Every query field is allowlisted and validated before Store access.

### Metrics API extensions

**Boundary:** Existing HTTP API and pure metrics engine.

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| POST | `/api/metrics` with `toolErrors` | Count classified failed tool results in the requested group/range | Existing `Series[]`/`400` contract |
| POST | `/api/metrics` with `cacheSavingsComputed` | Aggregate current-model cache discount | Existing `Series[]`/`400` contract |
| POST | `/api/metrics` with `routingSavingsComputed` | Aggregate all-Opus versus current-model routing difference on an uncached basis | Existing `Series[]`/`400` contract |

The savings formulas share one pricing helper and are valid in series and aggregate scopes. `toolErrors` is turn-grain; unsupported entity/distribution combinations must return unavailable rather than a misleading population of zeros.

**Auth requirements:** Unchanged loopback API boundary.

### Anomaly detector

**Boundary:** Pure shared library API.

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| detect | `detectTurnCostAnomalies(samples, factor)` | Compare pre-priced turn samples to the median of the complete supplied history | Deterministic result containing baseline, ratios, and flagged samples; empty/invalid populations produce no fabricated flags |

> **[Sol]** `factor` defaults to `5`...

`factor` defaults to `5` (turn cost > 5× the user-wide median flags as anomalous) until #P4-15 exposes a configurable setting; the function rejects non-positive factors.

**Auth requirements:** Not applicable; pure in-process function.

**Feed item-kind wire shape** (consumed by the Anomaly & gate-feed row): see *Section-level contract locks* above for the `anomaly` / `gateFailure` / `captureGap` discriminated row type and its drill targets.

### Runtime pricing/context providers

**Boundary:** Internal server assembly interfaces.

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| price | usage + model → computed dollars | Shared by session derivation, metric measures, and trace projection | Unknown model yields unavailable/zero according to existing computed-cost convention; never throws |
| resolve context | model → context-window tokens or unavailable | Produce optional transcript context estimate | Unknown model yields no percentage |

**Auth requirements:** Not applicable; injected in process.

## Module Boundaries

> **[Sol] Revised after inspecting current imports and production assembly.**

| Module / Package | Responsibility | Allowed Dependencies |
|---|---|---|
| `shared/anomaly.ts` | Pure median/ratio/flag logic over pre-priced samples | shared types only; no server pricing or React |
| `shared/sessions-contract.ts` | Sessions query/response wire vocabulary | `shared/types.ts` only |
| `server/metrics/model-metadata.ts` | Default context-window catalog and resolver | server/shared types; no Store or routes |
| `server/metrics/measures.ts` | Shared pricing helpers and existing/new measures | shared contracts/types |
| `server/routes/sessions.ts` | Validate query, read Store, project/sort/page response | Store, shared contract, server computation helpers; never ingest/fs directly |
| `server/routes/metrics.ts` | Existing metrics boundary using injected runtime pricing | Store, metrics engine, shared contract |
| Store derivation | Maintain compact per-session rolls with injected pricer/context resolver | ingest records and shared types; no client/routes |
| `client/src/api/sessions.ts` | Sole client fetch/decoding boundary for `/api/sessions` | shared sessions contract |
| `client/src/pages/dashboard/` | Section containers, presentation, formatting, and range semantics | client API/query/filter/chart/component modules only |

## Change Footprint

> **[Sol] Rebuilt file-by-file from the current worktree.**

_The concrete answer to "where does this land in the codebase?" — produced during the Phase D2 walk._

### New files / modules

| Path | Purpose | Pattern reference |
|---|---|---|
| `shared/anomaly.ts` and `shared/anomaly.test.ts` | Historical-median detector and shared result types | Pure/tested helpers such as `server/metrics/distributions.ts` |
| `shared/sessions-contract.ts` | Typed query vocabulary, list item, response metadata, and optional trace | `shared/metrics-contract.ts` |
| `server/metrics/model-metadata.ts` and test | Context-window catalog/resolver used by the transcript estimate | `server/metrics/measures.ts` |
| `server/routes/sessions.ts` and `server/routes/sessions.test.ts` | General validated/paginated `GET /api/sessions` | `server/routes/metrics.ts` and test |
| `client/src/api/sessions.ts` | Typed fetch wrapper with AbortSignal support | `client/src/api/metrics.ts` |
| `client/src/pages/dashboard/StatCardsRow.tsx` | Batched values/deltas/sparklines and stat deep links | `components/StatCard.tsx` |
| `client/src/pages/dashboard/BurnRateCard.tsx` | Calendar MTD and projection with honest budget state | `charts/ChartCard.tsx` section-container pattern |
| `client/src/pages/dashboard/RecentSessionCard.tsx` | Latest summary, estimated context, and trace thumbnail | existing `Chart`/card primitives |
| `client/src/pages/dashboard/LeaderboardsCard.tsx` | Tabbed session/project/model top lists and drill links | `components/DataTable.tsx` |
| `client/src/pages/dashboard/AnomalyFeed.tsx` | Stable anomaly/gate placeholder boundary for #P4-12 | `components/EmptyState.tsx` |
| `client/src/pages/dashboard/RecordsStrip.tsx` | Filter-aware all-history records | `components/StatCard.tsx` formatting conventions |
| `client/src/pages/dashboard/SubscriptionWindow.tsx` | Rolling 5h/7d sums, peaks, and estimated expiry | pure data helpers colocated with section |
| `client/src/pages/dashboard/LeverageRatio.tsx` | Cache-to-fresh headline | section-card pattern |
| `client/src/pages/dashboard/SavingsDecomposition.tsx` | Non-overlapping cache/routing savings stack | section-card pattern |
| `client/src/pages/dashboard/FailedWorkStat.tsx` | Binding spec-only failed-work section | `components/StatCard.tsx` |
| `client/src/pages/dashboard/CaptureBanner.tsx` | Global no-C/B/L CTA | `components/LockedCard.tsx` |
| `client/src/pages/dashboard/format.ts` and `client/src/pages/dashboard/queries.ts` | Shared display/range/query construction without pricing formulas | `client/src/charts/units.ts`; `filters/state.ts` |
| `client/src/pages/dashboard/*.stories.tsx` | Section loading/error/empty/estimated/populated states | existing colocated stories |
| `cypress/e2e/dashboard.cy.ts` | Fixture-backed Dashboard smoke and one filtered drill journey | `cypress/e2e/steel-thread.cy.ts` |
| `test/fixtures/projects/-Users-demo-project-alpha/44444444-4444-4444-8444-444444444444.jsonl` | Dashboard anomaly/failed-result fixture history | existing UUID fixture convention |

### Modified files / modules

| Path | What changes here |
|---|---|
| `shared/metrics-contract.ts` | Add `toolErrors`, `cacheSavingsComputed`, and `routingSavingsComputed` to `Measure` and its exhaustive array |
| `shared/types.ts` | Add optional Turn failure count and Session savings/max-turn/context estimate fields |
| `server/metrics/measures.ts` and test | Export reusable pricing primitives; implement the three measures and unsupported-scope semantics |
| `server/metrics/engine.test.ts` | Verify new measures remain correct through existing series/distribution plumbing |
| `server/ingest/parse-transcript.ts` and test | Classify tool-result failure before discarding content and retain it on the compact record |
| `server/store/derive-turns.ts` and test | Aggregate error tool results into their attributed main Turn |
| `server/store/derive-session.ts` and test | Compute savings, max turn cost, and optional context estimate from injected providers |
| `server/store/store.ts` and test | Carry the context resolver alongside the existing pricer and pass both through recomputation |
| `server/ingest/pipeline.ts` | Thread pricing/context providers into Store construction |
| `server/cli.ts` | Create one runtime pricing/context input and pass it to ingest and Fastify assembly |
| `server/routes/metrics.ts` and test | Use injected runtime pricing instead of importing an independent default at request time |
| `server/app.ts` and test | Accept runtime metadata, register sessions route, and preserve existing defaults for tests/callers |
| `client/src/api/queryKeys.ts` | Add canonical `qk.sessions(params)` under the existing sessions prefix |
| `client/src/ws.ts` and `client/src/ws.test.ts` | Invalidate sessions lists for session-added/session-updated messages |
| `client/src/charts/ChartCard.tsx`, test, and story | Request the `time` dimension and preserve categorical filters in mouse/keyboard bucket drill links |
| `client/src/pages/Dashboard.tsx` | Replace the stub with the responsive 12-section composition while retaining the corrected ChartCard |
| `test/fixtures/README.md` | Document the Dashboard anomaly/failed-result fixture |

### Deleted / replaced

| Path | Reason |
|---|---|
| `client/src/pages/Dashboard.tsx` stub body | Replaced in place by the real Dashboard composition; file and route identity stay stable |

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|---|---|
| `server/metrics/engine.ts` | New measures traverse its grouping, range, compare, and distribution paths without changing the core engine |
| `client/src/filters/state.ts`, `useFilters.ts`, and `FilterBar.tsx` | Every normal query and intentional date override depends on their URL/categorical mapping |
| `client/src/components/StatCard.tsx`, `LockedCard.tsx`, `EmptyState.tsx`, `DataTable.tsx` | Dashboard composition relies on their accessibility and state contracts as delivered by #P4-1 |
| `client/src/routes.ts` | Existing `/`, `/sessions`, `/sessions/:id`, `/cache`, `/trends`, `/health`, and `/settings` paths define every drill target |
| `shared/ws-protocol.ts` and server WS modules | Message vocabulary remains unchanged while client invalidation coverage expands |
| `cypress/e2e/steel-thread.cy.ts` | Its existing Dashboard/chart assumptions must continue to pass after the stub is replaced |
| `specs/claude-lens-plan.md` and Phase 4 issue records | They still describe `/api/sessions` under #P4-4; implementation must recognize it has already landed through #P4-2 rather than recreate it |

## Areas of Impact

> **[Sol] Revised with contract and regression risk discovered during the walk.**

_Broader-than-files impact — modules, services, teams, contracts, cross-cutting effects._

| Area | Impact | Risk (L/M/H) | Why |
|---|---|---|---|
| Pricing/session derivation | Production Sessions change from zero-cost rollups to computed values and gain counterfactual fields | H | Monetary correctness affects sorting, records, leaderboards, and later pages; duplicated providers would drift |
| General sessions API | New reusable public loopback boundary and DTO foundation for #P4-4/#P4-5 | H | Pagination, range/filter semantics, trace size, and later consumers become a durable contract |
| Metrics engine surface | Three new measures enter exhaustive validation, series, and distribution paths | M | Scope mistakes can silently emit plausible but wrong values |
| Transcript parser/store | Existing compact tool-result path gains failure classification | M | Hot ingest path must retain malformed-line safety and context-byte behavior |
| Chart foundation | Aggregate query becomes a real time series; drills preserve active chips | M | Shared accessible chart/table behavior and existing tests change together |
| Query invalidation | Sessions lists begin refetching on add/update | M | Missing invalidation leaves stale cards; excessive invalidation can amplify request load |
| Dashboard UI | Stub becomes the first full 12-section page pattern | M | Many independent states and responsive sections must compose without a page-wide failure |
| Later Phase 4 pages | Reuse sessions API, anomaly detector, pricing, and session fields | M | Helpful foundation, but later task docs must not implement competing contracts |
| Build/deployment/storage | No dependency, database, config-file, or migration change | L | Additive TypeScript/HTTP/client work within the existing package |

**Contract changes:** `Measure` gains three literals; `Turn`/`Session` gain additive optional fields; `GET /api/sessions` and `SessionListResponse` become new shared wire contracts; `BuildAppOptions`/ingest assembly accept runtime pricing and context metadata. Existing WebSocket payloads and existing HTTP response shapes do not change.

**Cross-cutting ripples:** #P4-4 must consume rather than recreate the sessions route; #P4-5 can consume the anomaly result and session pricing fields; #P4-13 can replace estimated context with observed C data; #P4-15 can replace runtime default pricing/context/calibration providers. No auth, persistence migration, feature flag, or new build dependency is introduced.

## Cross-Cutting Concerns

> **[Sol] Revised and stress-tested against current failure modes.**

- **Errors:** Fastify query parsing returns `400` without throwing; API helpers throw typed-context errors on non-2xx/invalid top-level shapes; each section renders its own pending/error/empty/unavailable state so one request cannot blank the page.
- **Logging & metrics:** Reuse Fastify request/error logs; do not log transcript prompts, tool-result content, or entire session responses. Unexpected projector failures include route and session ID, not raw content.
- **Auth / authz:** No user accounts; existing loopback binding remains the trust boundary. Query fields are allowlisted, dates validated, pagination capped, and response content remains local.
- **Performance:** Batch stat measures; opt traces in only for small pages; use bounded pagination; derive rolling windows from one hourly series; let AbortSignal cancel superseded client requests. `Store.listSessions()` is already O(history) and establishes the scale ceiling; this task must not add an unbounded response or one request per session.
- **Security:** Classify failure markers while content is in memory, then retain only flags/byte counts. Never echo raw tool results. Drill URLs are built through `URLSearchParams`/existing serialization, not string-concatenated untrusted labels.
- **Migrations / rollout:** Additive in-memory types and HTTP route; no disk/schema migration. The Dashboard can roll back to its stub independently. Later pricing/config rollout must trigger Store re-derivation when runtime providers change.

## Architecture Decisions Log

> **[Sol] Final decisions confirmed by the developer on 2026-07-18.**

| # | Decision | Alternatives | Chosen Because | Satisfies REQs |
|---|---|---|---|---|
| A1 | Land general paginated `/api/sessions` in #P4-2 | Dashboard aggregator; wait for #P4-4 | Current Dashboard needs entity data and Store already exposes the correct reusable source | R1, R4 |
| A2 | Use typed response metadata and opt-in traces | Raw array; traces on all rows | Supports stable capture/extent semantics and bounded payloads | R3, R4 |
| A3 | Inject one runtime pricing input through ingest and HTTP assembly | Route-only pricing; client pricing | Fixes current zero-cost Sessions and prevents store/route monetary drift | R3, R9 |
| A4 | Estimate context with injected model windows; unknown models stay unavailable | Universal guessed percentage; token count only | Preserves `ctx %` while remaining honest and replaceable by C | R3, R9 |
| A5 | Section-owned, measure-batched queries | Page aggregator; query per card | Preserves independent states without wasteful fan-out | R1, R2, R8 |
| A6 | Correct ChartCard to time buckets and filter-preserving drills | Reuse verbatim; Dashboard-only chart fork | Current `dimensions: []` is aggregate-only and current drills drop chip filters | R2, R8 |
| A7 | Override only date for MTD/windows/ever records | Apply global date literally; ignore all filters | Matches semantic labels while retaining cohort selection | R1, R2 |
| A8 | Decompose savings through current-model uncached midpoint | Two independent savings baselines | Cache+routing sum exactly to all-Opus-uncached savings | R1, R3, R9 |
| A9 | Extend compact tool-result metadata | Retain content; parallel error record | Preserves memory contract and shares existing plumbing | R6 |
| A10 | Detect anomalies from explicit pre-priced history | Session-local Turn median; opaque server flags | Enforces user-wide baseline and reusable explainable output | R5 |
| A11 | Use rolling-window expiry and historical-peak calibration | Fake provider reset; hide tracker | Useful transcript-only behavior with explicit estimation | R1, R3 |
| A12 | Invalidate sessions lists on add/update | Metrics-only invalidation | Entity-backed Dashboard cards otherwise remain stale | R7 |
| A13 | Render budget/gate/calibration as honest unconfigured/stub states | Hard-coded placeholder numbers | Avoids fabricated product state while keeping all sections present | R1, R3 |

## Risk & Stress-Test Scenarios

> **[Sol] Added after forward and backward stress testing.**

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|---|---|
| No transcript history or an over-filtered view | Bounded empty responses and zero-length Series map to section-level EmptyState; no all-history query runs without an extent |
| No C/B/L files | Global capture metadata makes the CTA stable; computed/estimated sections remain usable and labeled |
| Unknown or unpriced model | Context percentage is unavailable and monetary helpers follow the existing unpriced convention; no universal context size or fabricated savings appears |
| Backend unavailable for 30 seconds | Each mounted query shows its own error while unaffected/local UI remains; TanStack retries/refetches through existing behavior |
| Session changes during multiple Dashboard queries | Existing debounce/eventual-consistency model applies; WS invalidates metrics and sessions prefixes, and `keepPreviousData` prevents destructive flicker |
| Rapid filter changes plus WS updates | Stable keys and AbortSignal cancel superseded requests; the final URL state determines the winning data |
| Tool result is malformed, enormous, or contains failure-like text | Parser never throws, retains only bounded metadata, and applies the same explicit classifier before dropping content |
| Multiple tool-result blocks share one transcript line | Existing one-ParsedLine limitation remains visible; fixture scope does not claim exact parallel-result counting (see Out of Scope) |
| Zero fresh-billed tokens | Leverage renders unavailable rather than infinity/NaN |
| Empty or degenerate anomaly population | Detector returns no fabricated baseline/flags; factor validation fails safely |
| History grows from thousands toward millions of sessions | Pagination/trace caps bound response size; Store-wide O(history) reads remain the known system ceiling and trigger a future storage redesign rather than hidden client overfetch |
| Pricing/config changes later | Central providers give #P4-15 one replacement seam; Store re-derivation is required so session and metrics values change together |
| Release must roll back | No migration exists; restore the Dashboard stub while additive contracts can remain without affecting old consumers |

### Backward — regression risk per touched area (brownfield only)

| Touched area (from Change Footprint) | What could regress | How we'd know / mitigation |
|---|---|---|
| `server/cli.ts` + Store pricing | Existing zero-cost assumption or duplicate pricing paths | Production-assembly coverage and derived-session/route monetary assertions use the same injected table |
| parser/tool-result derivation | Byte accounting, prompt attribution, or malformed-line behavior | Existing parser/derive tests remain authoritative while additive fields are asserted |
| metrics measures/contract | New literals produce misleading series/distributions | Exhaustive arrays/switches plus scope-aware measure and engine coverage |
| sessions API | Sort/filter/range/pagination drift becomes a later-page dependency | Shared contract and route parser tests; capped defaults and deterministic tie-breaking |
| `ChartCard` | Accessibility table, visible chart, and bucket links disagree | Existing unit/accessibility/Cypress paths exercise one shared bucket-to-link mapping |
| query keys/WS | Stale sessions cards or refetch storms | Prefix-mapping tests assert exact invalidations for each existing WS message |
| Dashboard composition | One failed section blanks the page or old steel-thread assumptions break | Section boundaries retain independent states; existing steel-thread smoke remains green |
| Phase 4 follow-on work | #P4-4 recreates `/api/sessions` with a conflicting DTO | Architecture/issue handoff explicitly records that the foundation landed early |

## Open Questions

> **[Sol] All implementation-blocking decisions were resolved with the developer.**

- None blocking. Unknown future model context windows, configurable pricing, budget, anomaly factor, subscription calibration, and premium observations enter through the documented provider/config seams rather than changing this architecture.

## Out of Scope

> **[Sol] Revised to make task boundaries explicit.**

- Live anomaly/gate feed rows and gate results (reason: #P4-11/#P4-12 own gate computation and feed wiring; this task supplies the detector and stable UI boundary).
- Premium C/B/L parsing and observed context/cost upgrades (reason: #P4-13).
- Persistent budget, subscription calibration, configurable anomaly factor, pricing editor, and runtime provider reload UI (reason: #P4-10/#P4-15).
- Sessions list page, session detail endpoint/page, and turn inspector (reason: #P4-4/#P4-5/#P4-6 consume these foundations).
- Correcting the parser’s existing one-ParsedLine/first-tool-result limitation for parallel tool results (reason: broader parser-contract change not required by current fixtures; failed-work remains as accurate as retained parser records).
- Replacing the in-memory Store for multi-million-session scale (reason: system-level storage migration, not Dashboard scope).
- Editing holistic plan/issue artifacts to move historical task ownership (reason: this architecture records the grounded early landing; later work should consume it).

---

# Tasks

_This section is populated by the **generate-tasks** skill (Phase 3)._
_Run: `/generate-tasks from: specs/architecture/ARCH-dashboard-page.md`_
