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

> **Date:** 2026-07-18
> **Critical path:** T1 → T3a → T4 → T5 → T6 → T7 → T9 → T14 → T15 (9 layers; 16 tasks total)
> **Max concurrent fan-out:** 5 (T9-T13 in Layer 5, after T7 lands)
> **Dependency layers:**
> ```
> L0: T1, T2, T8                                 (no deps)
> L1: T3a, T3b (both depend on T1)
> L2: T4 (T1, T2, T3a)
> L3: T5 (T4); T6 (T1, T5)
> L4: T7 (T1, T6)
> L5: T9, T10, T11, T12, T13 (T7; T12 also T3a; T13 also T3b)
> L6: T14 (T9-T13)
> L7: T15 (T14)
> ```

## Task T1: Shared contracts layer

> **Status:** not started
> **Verification:** tdd
> **Effort:** s
> **Priority:** critical (foundation for everything downstream)
> **Depends on:** None
> **Satisfies REQs:** R3, R4, R8
> **Footprint slice:**
> - New: `shared/sessions-contract.ts`
> - Modified: `shared/types.ts` (add `Turn.errorToolResults?`, `Session.{cacheSavingsComputed?, maxTurnCostComputed?, contextPctEstimated?}`)
> - Modified: `shared/metrics-contract.ts` (add `toolErrors | cacheSavingsComputed | routingSavingsComputed` to `Measure` and `MEASURES`)
> **High-risk areas touched:** None (type-level only)

### Description

Lands the wire-shape primitives the rest of the implementation hangs off: additive optional fields on Turn/Session, the new sessions-list query/response contract, and three new `Measure` literals driving the cost-related series on the Dashboard. Every downstream task reads from these — landing them first prevents guard-clause drift across the codebase.

### Test Plan

#### Test File(s)
- `shared/metrics-contract.test.ts` (new)
- `shared/sessions-contract.test.ts` (new)
- `shared/types.test.ts` (new)

#### Test Scenarios

##### Exhaustive Measure union

- **every Measure literal is in MEASURES** — GIVEN the Measure union WHEN MEASURES is read THEN it contains all 15 prior literals plus `toolErrors`, `cacheSavingsComputed`, `routingSavingsComputed`, and only those _(guards the exhaustive-array pattern at `shared/metrics-contract.ts:11`)_
- **unknown Measure literal rejected** — GIVEN a literal not in the union WHEN used as a Measure THEN TypeScript fails to compile

##### SessionListResponse shape

- **default response has items + total + meta** — GIVEN a successful query WHEN the response is projected THEN `items: SessionListItem[]`, `total: number`, and `meta.matchedExtent: {from,to}|null` and `meta.globalCapture: TierFlags` are all present _(satisfies R4)_
- **trace inclusion is opt-in** — GIVEN `include=trace` WHEN building the response THEN `items[*].trace` is populated; GIVEN no `include` THEN it is `undefined` _(satisfies R3)_

##### Turn / Session additive fields

- **Turn.errorToolResults is optional and additive** — GIVEN a Session lacking the field WHEN read THEN value is `undefined`, not `0` _(honors R3 — null/missing means unavailable)_
- **Session savings/max-turn/context fields default absent** — GIVEN a rollup before derive-session runs WHEN fields are read THEN `cacheSavingsComputed`, `maxTurnCostComputed`, `contextPctEstimated` are each `undefined`

##### Type Stability (Regression Guard)

- **existing fields preserved** — GIVEN an existing fixture Session WHEN read THEN `sessionId`, `startedAt`, `project`, etc. are still present and unchanged _(guards `shared/types.ts` silent regression)_
- **ws-protocol untouched** — GIVEN `shared/ws-protocol.ts` WHEN imported THEN message types are unchanged _(guards wire contract per A12)_

### Implementation Notes

- **Module(s):** `shared/types.ts`, `shared/sessions-contract.ts`, `shared/metrics-contract.ts`
- **Pattern reference:** Existing `exhaustiveArray<T>()` helper at `shared/metrics-contract.ts:11`; existing additive field patterns in `shared/types.ts`
- **Key decisions:** A2 (typed response metadata + opt-in trace), A3 (pricing surface stays server-side; optional fields are additive only)
- **Libraries:** None new.

### Scope Boundaries

- Do NOT alter existing field types or required-ness.
- Do NOT introduce runtime logic — pure type additions.
- Only these 3 files.

### Files Expected

**New files:**
- `shared/sessions-contract.ts` — query vocabulary, list item, response metadata, optional trace; pattern: `shared/metrics-contract.ts`
- `shared/metrics-contract.test.ts` — exhaustive union + type-only compile checks
- `shared/sessions-contract.test.ts` — shape checks
- `shared/types.test.ts` — optional-field round-trip

**Modified files:**
- `shared/types.ts` — add `errorToolResults?` to `Turn`; add `cacheSavingsComputed?`, `maxTurnCostComputed?`, `contextPctEstimated?` to `Session`
- `shared/metrics-contract.ts` — extend `Measure` union and `MEASURES`

**Must NOT modify:**
- `shared/ws-protocol.ts` — wire contract frozen (per A12)
- `server/**`, `client/**` — downstream tasks own those

---

## Task T2: Model-metadata provider (context-window catalog)

> **Status:** not started
> **Verification:** tdd
> **Effort:** s
> **Priority:** high (input to T4 context-pct derivation)
> **Depends on:** None
> **Satisfies REQs:** R3, R9
> **Footprint slice:**
> - New: `server/metrics/model-metadata.ts` and its test
> **High-risk areas touched:** None (pure resolver)

### Description

Lands the default model context-window catalog and resolver used by T4's derive-session to compute the optional `contextPctEstimated` field, and replaces the unknown-model "guessed percentage" anti-pattern with an explicit `null`/`undefined`. The provider is one of two runtime inputs (the other being pricing) that the CLI assembles in T5; it has no Store or route dependencies and lands independently.

### Test Plan

#### Test File(s)
- `server/metrics/model-metadata.test.ts` (new)

#### Test Scenarios

##### Resolver semantics

- **known model returns catalog window** — GIVEN a known model WHEN `resolveContextWindow(model)` is called THEN the window token count matches the catalog entry
- **unknown model returns null** — GIVEN an unlisted model WHEN `resolveContextWindow(model)` is called THEN it returns `null` (not `0`, not `undefined`) _(honors R3 — explicit unavailable)_
- **empty catalog returns null** — GIVEN an empty catalog WHEN any model is resolved THEN `null` is returned
- **resolver is pure** — GIVEN the same input WHEN called twice THEN results are reference-equal or value-equal

##### Catalog stability (Regression Guard)

- **default catalog lists the four known models** — GIVEN `DEFAULT_CONTEXT_WINDOWS` WHEN read THEN it includes `claude-fable-5`, `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5-20251001` _(guards catalog drift from `shared/types.ts`)_

### Implementation Notes

- **Module(s):** `server/metrics/model-metadata.ts`
- **Pattern reference:** `server/metrics/measures.ts` `ModelRate`/`PricingTable` shape (`measures.ts:4-30`)
- **Key decisions:** A4 (estimate via catalog; unknown returns explicitly unavailable)
- **Libraries:** None new.
- **High-risk callouts:** None.

### Scope Boundaries

- Do NOT include premium-observed context overrides (#P4-13).
- Do NOT yet wire into Store (that's T4).
- Only this one file plus its test.

### Files Expected

**New files:**
- `server/metrics/model-metadata.ts` — catalog + `resolveContextWindow` resolver; pattern: `ModelRate`/`PricingTable`
- `server/metrics/model-metadata.test.ts` — catalog + resolver unit tests

**Must NOT modify:**
- `shared/**` — context types live in `shared/types.ts` (T1)
- `server/store/**`, `server/ingest/**` — T4 owns wiring

---

## Task T3a: Metrics engine measures (toolErrors, cacheSavingsComputed, routingSavingsComputed)

> **Status:** not started
> **Verification:** tdd
> **Effort:** s
> **Priority:** critical (T12 and T13 depend on these measures)
> **Depends on:** T1 (Measure literal extensions)
> **Satisfies REQs:** R1, R6, R9
> **Footprint slice:**
> - Modified: `server/metrics/measures.ts` (add 3 new measures + export pricing primitives)
> - Modified: `server/metrics/measures.test.ts` (new tests; existing file likely present)
> - Modified: `server/metrics/engine.test.ts` (extend coverage through existing series/distribution paths)
> **High-risk areas touched:** Metrics engine surface (Medium) — exhaustive validation must include the new literals

### Description

Implements the three new Dashboard metrics measures in `server/metrics/measures.ts`: `toolErrors` (count of classified failed tool results), `cacheSavingsComputed` (current-model cache discount), and `routingSavingsComputed` (current-model vs all-Opus-uncached difference on a non-overlapping basis). Also exports reusable pricing primitives so T4's derive-session and T6's sessions route share one pricing helper. Scope-aware semantics: turn-grain measures return `null` (not 0) for unsupported entity/distribution combinations.

### Test Plan

#### Test File(s)
- `server/metrics/measures.test.ts` (extend; existing file)
- `server/metrics/engine.test.ts` (extend; existing file)

#### Test Scenarios

##### toolErrors measure

- **counts classified failed tool results** — GIVEN a Turn with `errorToolResults` set WHEN the measure runs over a turn-grain scope THEN it returns the sum of failed tool results per turn
- **returns null on unsupported distribution entity** — GIVEN `mode: "distribution"` `entity: "call"` THEN `toolErrors` returns `null` (calls have no classified tool-result failure metadata) _(satisfies R6; honors R3 null/unavailable)_
- **zero failed results is a real zero** — GIVEN a Turn with `errorToolResults: 0` THEN the measure returns `0`, not `null`

##### cacheSavingsComputed measure

- **computes cache discount correctly** — GIVEN priced calls with cache reads WHEN summed THEN `actual cost` is subtracted from `uncached cost at current model rates` (cacheRead price treated as if it were input rate for the counterfactual)
- **unknown/unpriced model returns null** — GIVEN a call with an unpriced model THEN the contributing share is `null`, and an aggregate containing it returns `null` (not silently 0)
- **matches hand-rolled expectations** — GIVEN a hand-priced fixture WHEN the measure runs THEN values match within rounding tolerance

##### routingSavingsComputed measure

- **computes all-Opus counterfactual** — GIVEN priced calls WHEN the routing measure runs THEN it represents `(cost at all-Opus uncached) − actual cost`
- **shares non-overlapping cache counterfactual** — GIVEN a session with cache and cheap routing WHEN both savings measures sum THEN they equal `all-Opus-uncached − actual` exactly (no double counting) _(satisfies A8 invariant)_
- **unknown model returns null** — same as above for unpriced contributing calls

##### Engine integration (Regression Guard)

- **series-mode returns Series[]** — GIVEN a `SeriesMetricsQuery` with the new measures THEN the engine produces valid Series with no NaN/Infinity entries
- **distribution-mode for compatible measures** — GIVEN a `DistributionMetricsQuery` THEN compatible measures return valid Distribution; incompatible return `null` per scope rules
- **unknown measure literal still exhaustively rejected** — GIVEN a typo'd measure WHEN the engine runs THEN it returns the existing 400-equivalent error path

### Implementation Notes

- **Module(s):** `server/metrics/measures.ts`
- **Pattern reference:** Existing `computeMeasure` switch at `measures.ts:65-` and `priceCall` helper at `measures.ts:39-`
- **Key decisions:** A8 (cache + routing through one non-overlapping counterfactual); A9 (toolErrors extends compact tool-result metadata, not parallel pipeline)
- **Libraries:** None new.
- **High-risk callouts:** **Scope mistakes can silently emit plausible but wrong values.** Mitigated by exhaustive measure switch + per-scope return semantics in the test plan above.

### Scope Boundaries

- Do NOT add new pricing tables (T5 wires runtime).
- Do NOT implement session-level rollups (those live on Session in T4).
- Do NOT yet touch `routes/metrics.ts` — T5 wires runtime pricing into the route.

### Files Expected

**Modified files:**
- `server/metrics/measures.ts` — extend `computeMeasure` switch with the 3 measures; export `priceCall` and pricing helpers for T4/T6 reuse
- `server/metrics/measures.test.ts` — extend existing tests with 3 new measure blocks
- `server/metrics/engine.test.ts` — extend existing series/distribution tests to cover the new measures

**Must NOT modify:**
- `server/metrics/engine.ts` — touched but not changed (silent-regression hotspot; covered by engine tests)
- `shared/**` — T1 owns contract updates
- `server/store/**`, `server/routes/**` — downstream tasks

---

## Task T3b: Anomaly detector (shared pure function)

> **Status:** not started
> **Verification:** tdd
> **Effort:** s
> **Priority:** high (T13 anomaly feed depends on output; future #P4-5 session detail reuses)
> **Depends on:** T1 (pre-priced sample type availability)
> **Satisfies REQs:** R5
> **Footprint slice:**
> - New: `shared/anomaly.ts` and its test
> **High-risk areas touched:** None (pure function)

### Description

Lands the user-history-aware anomaly detector as a pure shared function over pre-priced turn samples. The detector returns deterministic baseline (median), ratios, and flagged samples; empty or invalid populations produce no fabricated flags. The function is the single source of truth for "expensive turn" judgments reused by this Dashboard's anomaly feed (T13) and later Session Detail's per-turn bars.

### Test Plan

#### Test File(s)
- `shared/anomaly.test.ts` (new)

#### Test Scenarios

##### Detector semantics

- **flags only samples above threshold** — GIVEN samples where exactly one is `5x` the median WHEN the detector runs with `factor=5` THEN that sample is flagged and others are not
- **default factor is 5** — GIVEN no factor argument WHEN the detector runs THEN it uses `5` (matches ARCH's section-level lock)
- **non-positive factor rejected** — GIVEN `factor=0` or `factor=-1` WHEN the detector runs THEN it throws a typed error (no fabricated flags)
- **empty population returns no flags** — GIVEN an empty samples array WHEN the detector runs THEN it returns `{baseline: null, ratio: null, flagged: []}`
- **single-sample population returns no flags** — GIVEN exactly one sample WHEN the detector runs THEN no flag is emitted (insufficient baseline)
- **median computation correct** — GIVEN hand-crafted odd-count and even-count samples WHEN computed THEN median matches the textbook definition

##### Determinism (Regression Guard)

- **stable output for stable input** — GIVEN identical input WHEN called twice THEN output is structurally identical (no map ordering surprises)
- **does not mutate input** — GIVEN a samples array WHEN the detector runs THEN the input array is unchanged

### Implementation Notes

- **Module(s):** `shared/anomaly.ts`
- **Pattern reference:** Pure/tested helpers such as `server/metrics/distributions.ts`
- **Key decisions:** A10 (pre-priced history, user-wide baseline, reusable output)
- **Libraries:** None new.
- **High-risk callouts:** None.

### Scope Boundaries

- Do NOT import server pricing (the detector receives pre-priced inputs).
- Do NOT produce side effects (no I/O, no globals).
- Do NOT include Session Detail's per-turn integration (later phase).

### Files Expected

**New files:**
- `shared/anomaly.ts` — `detectTurnCostAnomalies(samples, factor?)`; pure function; pattern: `server/metrics/distributions.ts`
- `shared/anomaly.test.ts` — pure function test suite per the scenarios above

**Must NOT modify:**
- `server/**`, `client/**` — downstream tasks consume this module

---

## Task T8: ChartCard fix (time-series + filter-preserving drills)

> **Status:** not started
> **Verification:** tdd
> **Effort:** s
> **Priority:** high (the Dashboard's Cost-over-time section is the existing stub using ChartCard; fixing the wrapper upgrades the section)
> **Depends on:** None
> **Satisfies REQs:** R2, R8
> **Footprint slice:**
> - Modified: `client/src/charts/ChartCard.tsx` (request `time` dimension; preserve categorical filters in bucket drill links)
> - Modified: `client/src/charts/ChartCard.test.tsx` (extend existing tests)
> **High-risk areas touched:** Chart foundation (Medium) — accessible chart/table behavior and existing tests change together

### Description

Corrects `ChartCard.tsx` so it requests the `time` dimension by default for area-style cost charts (current call passes `dimensions: []` which is aggregate-only), and so its bucket drill links preserve active categorical filters (project/model/branch/host) while replacing the global date range with the clicked bucket's `[from, to]`. This is also the natural vehicle for single-day buckets drilling to `from = to = dayStart`. The current Dashboard stub renders Cost-over-time through ChartCard, so this fix upgrades that section in place.

### Test Plan

#### Test File(s)
- `client/src/charts/ChartCard.test.tsx` (extend existing)
- `cypress/e2e/chart-accessibility.cy.ts` (extend, if existing test covers bucket drilling)

#### Test Scenarios

##### Time-dimension query

- **requests `time` dimension by default for area charts** — GIVEN a ChartCard rendering a unit=`$` area chart WHEN rendered THEN the underlying `/api/metrics` request payload includes `dimensions: ["time"]`
- **aggregate-mode for non-area charts** — GIVEN a ChartCard with `mode: "aggregate"` THEN `dimensions: []` is still sent (no regression)
- **grain honors active range preset** — GIVEN the active URL range is `7D` THEN the request uses `grain: "hour"` (matches existing range-derived grain logic in `client/src/charts/timeseries.ts`)

##### Bucket drill link

- **drill preserves categorical filters** — GIVEN a ChartCard with active chips `project=alpha, model=fable` WHEN a bucket is clicked THEN the resulting navigation URL retains both `project=alpha` and `model=fable`
- **drill replaces global date range with bucket range** — GIVEN the active global range is `30D` and the user clicks a single-day bucket THEN the new URL has `from=<bucket-start>` and `to=<bucket-end>`
- **single-day bucket clicks drill to point** — GIVEN a daily-granular bucket WHEN clicked THEN `from == to == dayStart`

##### Accessibility (Regression Guard)

- **chart role/label still set** — GIVEN the rendered chart WHEN introspected THEN `role="img"` with `aria-label` is present and includes the total _(guards `chart-accessibility.cy.ts`)_
- **data-table fallback still rendered** — GIVEN any state WHEN inspected THEN the sr-only table is present and `aria-describedby`/`aria-controls` references match

### Implementation Notes

- **Module(s):** `client/src/charts/ChartCard.tsx`
- **Pattern reference:** Existing drill-link serialization in `client/src/charts/` and `client/src/filters/state.ts`
- **Key decisions:** A6 (correct to time buckets and filter-preserving drills), section-level lock for click-to-drill semantics
- **Libraries:** None new.
- **High-risk callouts:** **Drill URL construction must use `URLSearchParams` / existing serialization, not string concatenation** (per ARCH "Security" cross-cutting).

### Scope Boundaries

- Do NOT introduce a new chart component.
- Do NOT alter Dashboard's section composition (T14 owns that).
- Do NOT change the existing aggregate-mode behavior.

### Files Expected

**Modified files:**
- `client/src/charts/ChartCard.tsx` — request `time` dimension; bucket-drill link construction preserves categorical filters and replaces date range
- `client/src/charts/ChartCard.test.tsx` — extend with time-dimension and drill tests per scenarios above
- `cypress/e2e/chart-accessibility.cy.ts` — extend (if drill scenarios aren't already covered)

**Must NOT modify:**
- `client/src/charts/Chart.tsx` (low-level wrapper; ChartCard owns its drill behavior)
- `client/src/filters/state.ts`, `useFilters.ts` (silent-regression hotspots; chart uses existing serialization)
- `client/src/pages/Dashboard.tsx` (T14 owns composition)

---

## Task T4: Parser + derivation + Store threading (errors + savings + context estimate)

> **Status:** not started
> **Verification:** tdd
> **Effort:** m
> **Priority:** critical (every consumer of Session fields depends on this)
> **Depends on:** T1, T2, T3a
> **Satisfies REQs:** R3, R6, R9
> **Footprint slice:**
> - Modified: `server/ingest/parse-transcript.ts` (classify tool_result `is_error` before content is dropped)
> - Modified: `server/store/derive-turns.ts` (aggregate `errorToolResults` into the attributed Turn)
> - Modified: `server/store/derive-session.ts` (compute `cacheSavingsComputed`, `maxTurnCostComputed`, `contextPctEstimated`)
> - Modified: `server/store/store.ts` (carry pricer + context resolver through recomputation)
> - Modified: each of the three test files above
> **High-risk areas touched:** Pricing/session derivation (High); Transcript parser/store (Medium)

### Description

Threads the data path from raw transcript through Sessions such that every consumer (routes, metrics, sessions list) sees `costComputed` from a single injected pricer, `cacheSavingsComputed`/`maxTurnCostComputed` from one shared counterfactual formula, optional `contextPctEstimated` from the catalog resolver, and `errorToolResults` per Turn from parser-classified failures. Parser classifies the failed-command exit evidence and raw `is_error` flag before content is dropped; Store recomputes through the existing debounced window.

### Test Plan

#### Test File(s)
- `server/ingest/parse-transcript.test.ts` (extend)
- `server/store/derive-turns.test.ts` (extend)
- `server/store/derive-session.test.ts` (extend)
- `server/store/store.test.ts` (extend)

#### Test Scenarios

##### Parser classification

- **classifies raw `is_error: true`** — GIVEN a tool_result block with `is_error: true` WHEN parsed THEN the resulting record carries `isError: true`
- **classifies recognized failed-command exit** — GIVEN a Bash tool_result containing a non-zero exit marker matching the predefined patterns WHEN parsed THEN it is flagged `isError: true` (test fixtures provide positive and negative cases)
- **retains only flags/byte counts** — GIVEN any classified tool_result WHEN the parser finishes THEN the record holds no raw result body (memory discipline per ARCH A9)
- **malformed lines never throw** — GIVEN a malformed JSONL line WHEN parsed THEN the parser counts it and continues (honors existing parser contract)

##### Derive-turns aggregation

- **aggregates failed tool results per Turn** — GIVEN a Turn with prompt-attributed tool results WHEN derived THEN `errorToolResults` equals the count of `isError: true` records attributed to that prompt
- **missing field treated as 0** — GIVEN an older parser event without the new field WHEN derived THEN `errorToolResults` is `0` (additive backward compat)

##### Derive-session field computation

- **`costComputed` non-zero under priced table** — GIVEN a session with priced calls and an injected pricing table WHEN derived THEN `costComputed > 0` (fixes the current zero-cost regression)
- **`costComputed = 0` under empty pricing** — GIVEN the same session and an empty pricing table WHEN derived THEN `costComputed = 0`, not `null` (matches existing unpriced convention)
- **`cacheSavingsComputed` matches measure expectation** — GIVEN a hand-priced fixture WHEN derived THEN `cacheSavingsComputed` equals the value produced by the `cacheSavingsComputed` measure in T3a
- **`maxTurnCostComputed` is the max over Turns** — GIVEN a session with multiple Turns WHEN derived THEN `maxTurnCostComputed` is `max(turn.costComputed)`
- **`contextPctEstimated` computed for known models** — GIVEN a session's last-call model exists in `DEFAULT_CONTEXT_WINDOWS` WHEN derived THEN `contextPctEstimated` is in `[0, 1]`
- **`contextPctEstimated` undefined for unknown model** — GIVEN the same with an unlisted model WHEN derived THEN `contextPctEstimated` is `undefined`, not `0` _(honors R3)_

##### Store threading (Regression Guard)

- **`costComputed` survives Store recompute** — GIVEN a session in Store WHEN Store recomputes THEN its `costComputed` reflects the latest pricing input
- **changing pricing triggers recompute** — GIVEN a session derived under pricing-A WHEN pricing changes to pricing-B and recompute runs THEN values flip accordingly (no stale field drift; satisfies ARCH stress-test "Pricing/config changes later")
- **existing derive-turns/derive-session invariants preserved** — GIVEN the existing turn/session test fixtures WHEN re-run under the new types THEN pre-existing assertions still pass

### Implementation Notes

- **Module(s):** Per Module Boundaries — Store derivation owns compact per-session rolls; parser owns classification before content drop.
- **Pattern reference:** Existing `derive-turns.ts` / `derive-session.ts` per-prompt attribution; `parse-transcript.ts` existing malformed-line handling
- **Key decisions:** A3 (one injected pricer), A4 (catalog-derived context, `null` for unknown), A8 (savings share one counterfactual), A9 (extend compact metadata, no parallel pipeline)
- **Libraries:** None new.
- **High-risk callouts:**
  - **Pricing/session derivation (H):** monetary correctness downstream — covered by hand-priced fixtures and engine cross-check
  - **Transcript parser/store (M):** hot ingest path must keep malformed-line safety — covered by malformed-line tests

### Scope Boundaries

- Do NOT introduce runtime pricing/context assembly (T5).
- Do NOT add HTTP routes (T5/T6).
- Do NOT recompute history on file-change apart from existing debounce.

### Files Expected

**Modified files:**
- `server/ingest/parse-transcript.ts` — classify `isError` before drop, retain flag/byte count
- `server/ingest/parse-transcript.test.ts` — classification scenarios
- `server/store/derive-turns.ts` — aggregate `errorToolResults` per Turn
- `server/store/derive-turns.test.ts` — aggregation + backward-compat scenarios
- `server/store/derive-session.ts` — compute `cacheSavingsComputed`, `maxTurnCostComputed`, `contextPctEstimated`
- `server/store/derive-session.test.ts` — derivation scenarios per the rules above
- `server/store/store.ts` — accept pricer + context resolver; thread through recompute
- `server/store/store.test.ts` — recompute + pricing-change scenarios

**Must NOT modify:**
- `server/cli.ts`, `server/ingest/pipeline.ts`, `server/app.ts` (T5)
- `server/routes/**` (T5/T6)

---

## Task T5: Runtime assembly wiring (CLI + pipeline + app)

> **Status:** not started
> **Verification:** test-after
> **Effort:** s
> **Priority:** high (replaces current zero-cost CLI with priced runtime)
> **Depends on:** T4
> **Satisfies REQs:** R3, R9
> **Footprint slice:**
> - Modified: `server/cli.ts` (assemble one runtime pricing input + context resolver; pass to ingest and Fastify)
> - Modified: `server/ingest/pipeline.ts` (thread providers into Store construction)
> - Modified: `server/app.ts` (accept runtime metadata; pass to ingest + register metrics route with priced context)
> - Modified: `server/routes/metrics.ts` (use injected runtime pricing instead of importing default at request time)
> - Modified: each test file
> **High-risk areas touched:** Pricing/session derivation (High)

### Description

Replaces the CLI's current implicit-pricing path with one runtime pricing input built once at startup and passed to both the ingest pipeline and the Fastify app. The `/api/metrics` route consumes the decorated pricing so sessions are priced consistently across routes and Store. The app also accepts and forwards the context resolver so derived-session's `contextPctEstimated` works in production.

### Test Plan

#### Test File(s)
- `server/cli.test.ts` (new or extend, depending on existing coverage)
- `server/app.test.ts` (new or extend)
- `server/routes/metrics.test.ts` (extend)

#### Test Scenarios

##### Runtime pricing assembly

- **CLI builds one PricingTable** — GIVEN CLI startup WHEN the app is assembled THEN the same `PricingTable` instance is observable in both the Store and the running Fastify instance
- **pricing comes from a single source** — GIVEN a custom pricing injected via env WHEN CLI runs THEN it is honored exactly once (no duplicate or competing tables)

##### App metadata acceptance

- **app accepts runtime metadata** — GIVEN an `BuildAppOptions` (or equivalent seam) WHEN app is built with pricing + context resolver THEN both are wired to the metrics route and Store construction
- **app preserves existing defaults** — GIVEN tests that call app without metadata WHEN assembled THEN defaults still work (existing test compatibility preserved)

##### Metrics route pricing (Regression Guard)

- **route uses decorated pricing** — GIVEN an injected custom pricing WHEN `/api/metrics` is called THEN aggregation uses the injected table's rates (and not the default)
- **existing metrics contract unchanged** — GIVEN the existing metrics endpoint tests WHEN re-run THEN series shapes, error codes, and validation behavior are preserved

### Implementation Notes

- **Module(s):** `server/cli.ts`, `server/ingest/pipeline.ts`, `server/app.ts`, `server/routes/metrics.ts`
- **Pattern reference:** Existing CLI assembly in `server/cli.ts`; existing `BuildAppOptions` (or equivalent) in `server/app.ts`
- **Key decisions:** A3 (one runtime pricing input), A5 (route uses injected pricing), A13 (settings/calibration deferred to #P4-15)
- **Libraries:** None new.
- **High-risk callouts:** **A change here silently changes the prices seen by every consumer.** Mitigated by single-source assertion and route-level integration test.

### Scope Boundaries

- Do NOT create the sessions route (T6).
- Do NOT add new pricing tables or a Settings UI (#P4-15 territory).
- Do NOT alter existing CLI parsing or env contracts beyond what is needed for the input.

### Files Expected

**Modified files:**
- `server/cli.ts` — build runtime pricing + context; pass to ingest and `app.ts`
- `server/ingest/pipeline.ts` — accept providers; forward to Store
- `server/app.ts` — accept runtime metadata; wire to metrics route + Store
- `server/app.test.ts` — extend if exists, else new
- `server/routes/metrics.ts` — use decorated pricing
- `server/routes/metrics.test.ts` — extend with injected-pricing scenarios

**Must NOT modify:**
- `shared/**`, `server/store/**` (T1/T4)
- `server/routes/sessions.ts` (T6)

---

## Task T6: Sessions API route (GET /api/sessions)

> **Status:** not started
> **Verification:** tdd
> **Effort:** m
> **Priority:** critical (foundation reused by #P4-4 later)
> **Depends on:** T1, T5 (T5 modifies app.ts; T6 registers the route within app.ts)
> **Satisfies REQs:** R3, R4, R8
> **Footprint slice:**
> - New: `server/routes/sessions.ts` (Fastify route + validation + projection)
> - New: `server/routes/sessions.test.ts`
> - Modified: `server/app.ts` (register the sessions route; surgical add — one `fastify.register(sessionsRoutes, ...)`)
> **High-risk areas touched:** General sessions API (High) — durable contract for #P4-4 and other consumers

### Description

Adds the general paginated sessions endpoint as a new Fastify plugin. Reads through `Store.listSessions()`, validates every query field against the contract from T1, supports the six `sort` keys, CSV-style categorical filters, paired `from`/`to`, capped `limit`, `offset`, and the opt-in `include=trace`. Returns the typed `SessionListResponse` from T1.

### Test Plan

#### Test File(s)
- `server/routes/sessions.test.ts` (new)

#### Test Scenarios

##### Validation

- **rejects negative offset** — GIVEN `offset=-1` WHEN the route runs THEN 400 with a typed error
- **caps limit at the documented maximum** — GIVEN `limit=99999` WHEN the route runs THEN response uses the cap and reflects it (header or response meta)
- **rejects unknown sort** — GIVEN `sort=garbage` WHEN route runs THEN 400
- **rejects cross-field date contradictions** — GIVEN `from > to` WHEN route runs THEN 400

##### Filtering / sorting

- **sort=lastAt default** — GIVEN no sort WHEN called THEN results are recent-first
- **each supported sort key works** — GIVEN `sort` in `lastAt|costComputed|durationMs|cacheSavingsComputed|maxTurnCostComputed` WHEN called THEN ordering matches expectation
- **CSV filters apply per dimension** — GIVEN `?project=a,b&model=fable` WHEN called THEN only matching sessions are returned
- **range filter respects session-start convention** — GIVEN `from`/`to` WHEN called THEN sessions whose `startedAt` falls inside are included (matches existing metrics engine convention)

##### Pagination / trace

- **paginates deterministically** — GIVEN a stored set of N=20 sessions and `limit=10` WHEN called twice with `offset=0` and `offset=10` THEN no overlap and total is 20
- **trace restricted to small page** — GIVEN `include=trace&limit=5` WHEN called THEN the trace is included; GIVEN `include=trace&limit=999` WHEN called THEN 400 (trace cap)
- **matched extent returned in meta** — GIVEN any response WHEN `meta.matchedExtent` is checked THEN it is the earliest/latest timestamp among matches, or `null` when none
- **globalCapture from unfiltered file set** — GIVEN filters WHEN called THEN `meta.globalCapture` still reflects the unfiltered C/B/L presence (this is the section-level lock item)

##### App registration (Regression Guard)

- **route is registered exactly once** — GIVEN app startup WHEN introspected THEN `/api/sessions` is reachable and metrics endpoints still resolve
- **existing routes still respond** — GIVEN `/api/metrics` WHEN called THEN its shape is unchanged

### Implementation Notes

- **Module(s):** `server/routes/sessions.ts`
- **Pattern reference:** Existing `server/routes/metrics.ts` validation + plugin registration shape
- **Key decisions:** A1 (land in #P4-2 vs. waiting for #P4-4), A2 (typed metadata + opt-in trace), section-level lock on global capture and click-to-drill
- **Libraries:** None new.
- **High-risk callouts:** **Sort/filter/range/pagination drift becomes a later-page dependency (#P4-4).** Mitigated by deterministic sort + capped defaults in tests.

### Scope Boundaries

- Do NOT persist or mutate sessions in the route (read-only).
- Do NOT include non-entity endpoints.
- Only registration in `app.ts` (one line); T5 already established the BuildAppOptions shape.

### Files Expected

**New files:**
- `server/routes/sessions.ts` — Fastify plugin, validation, projection, sort/filter/page
- `server/routes/sessions.test.ts` — full coverage per scenarios

**Modified files:**
- `server/app.ts` — register sessions route; surgical add

**Must NOT modify:**
- `shared/sessions-contract.ts` (T1 owns)
- `server/store/store.ts` (T4 owns listSessions shape)

---

## Task T7: Client foundation (api/sessions + queryKeys + WS invalidation)

> **Status:** not started
> **Verification:** test-after
> **Effort:** s
> **Priority:** critical (every section task consumes this)
> **Depends on:** T1, T6
> **Satisfies REQs:** R4, R7
> **Footprint slice:**
> - New: `client/src/api/sessions.ts`
> - Modified: `client/src/api/queryKeys.ts` (add canonical `qk.sessions()`)
> - Modified: `client/src/ws.ts` (invalidate sessions lists on add/update)
> - Modified: `client/src/ws.test.ts`
> **High-risk areas touched:** Query invalidation (Medium)

### Description

Lands the client-side wrapper for `/api/sessions`, the canonical query-key factory entries under the existing sessions prefix, and the WS invalidation that makes any session-backed card refetch on `session-added` and `session-updated` messages. This is the single foundation layer every Dashboard section (T9-T13) depends on, so its scope and tests are deliberately tight.

### Test Plan

#### Test File(s)
- `client/src/api/sessions.test.ts` (new)
- `client/src/api/queryKeys.test.ts` (new or extend)
- `client/src/ws.test.ts` (extend)

#### Test Scenarios

##### Sessions fetch wrapper

- **sends allowed query fields verbatim** — GIVEN `listSessions({sort: "costComputed", limit: 10})` WHEN called THEN the URL is `/api/sessions?sort=costComputed&limit=10`
- **omits empty values** — GIVEN a params object with empty strings/arrays WHEN called THEN those keys are dropped (no `?limit=` empty)
- **aborts superseded request** — GIVEN an in-flight `listSessions` call WHEN a new query is started with overlapping params THEN the previous request's AbortSignal fires
- **decodes 400 with typed error** — GIVEN the server returns 400 WHEN the wrapper resolves THEN it throws a typed error carrying the validation message
- **opt-in trace** — GIVEN `{include: "trace"}` WHEN called THEN the response items carry `.trace`

##### Query keys

- **`qk.sessions(params)` lives under `qk.prefixes.sessions`** — GIVEN a params object WHEN `qk.sessions(...)` is called THEN the key path starts with `qk.prefixes.sessions`
- **stable key for stable params** — GIVEN the same params object WHEN computed twice THEN the keys are reference-equal (deterministic under React Query caching)
- **different params produce different keys** — GIVEN two params differing in `sort` or `from` THEN keys differ

##### WS invalidation

- **`session-added` invalidates sessions prefix** — GIVEN a mounted `qk.sessions(...)` listener WHEN a `session-added` message arrives THEN the query refetches
- **`session-updated` invalidates sessions prefix** — same as above for `session-updated`
- **`metrics-added` does NOT invalidate sessions prefix** — GIVEN a `metrics-added` event WHEN received THEN sessions queries are NOT refetched (separation of concerns)
- **still invalidates metrics prefix as before** — GIVEN any metrics event WHEN received THEN the existing invalidation behavior is preserved _(guards `client/src/ws.ts` silent regression)_

### Implementation Notes

- **Module(s):** `client/src/api/sessions.ts`, `client/src/api/queryKeys.ts`, `client/src/ws.ts`
- **Pattern reference:** `client/src/api/metrics.ts` wrapper shape; existing `qk` factory pattern; `client/src/ws.ts` invalidation wiring
- **Key decisions:** A2 (typed metadata + opt-in trace), A12 (invalidate sessions on add/update), section-level lock on global capture revalidation timing
- **Libraries:** None new.
- **High-risk callouts:** **Missing invalidation leaves stale cards; excessive invalidation can amplify request load.** Mitigated by per-message-type tests.

### Scope Boundaries

- Do NOT introduce new chart components or sections (those follow in T8-T14).
- Do NOT broaden WS protocol (`shared/ws-protocol.ts` is frozen).
- Only the three files listed above plus their tests.

### Files Expected

**New files:**
- `client/src/api/sessions.ts` — typed `listSessions` wrapper with AbortSignal support; pattern: `client/src/api/metrics.ts`
- `client/src/api/sessions.test.ts` — wrapper unit tests
- `client/src/api/queryKeys.test.ts` — factory test

**Modified files:**
- `client/src/api/queryKeys.ts` — add canonical `qk.sessions()` under existing sessions prefix
- `client/src/ws.ts` — invalidate sessions lists for `session-added`/`session-updated`
- `client/src/ws.test.ts` — extend with new invalidation scenarios; preserve existing metrics tests

**Must NOT modify:**
- `shared/ws-protocol.ts` — frozen
- `client/src/pages/Dashboard.tsx` — T14 owns composition
- `client/src/filters/**` — silent-regression hotspots; section tasks read filters but do not change them

---

## Task T9: Data-driven sections (StatCardsRow + RecentSessionCard)

> **Status:** not started
> **Verification:** ui
> **Effort:** m
> **Priority:** high (5 stat cards + recent session are the Dashboard's most-trafficked surfaces)
> **Depends on:** T7 (also T8 for stat-card sparkline use of ChartCard — see notes)
> **Satisfies REQs:** R1, R2
> **Footprint slice:**
> - New: `client/src/pages/dashboard/StatCardsRow.tsx`
> - New: `client/src/pages/dashboard/RecentSessionCard.tsx`
> - New: `client/src/pages/dashboard/StatCardsRow.stories.tsx`
> - New: `client/src/pages/dashboard/RecentSessionCard.stories.tsx`
> **High-risk areas touched:** Dashboard UI (Medium)

### Description

Builds the row of 5 stat cards (spend, total tokens, cache hit %, sessions, avg $/session) with delta + sparkline using the corrected ChartCard from T8 for the sparkline role, and the most-recent-session card with trace thumbnail, turns count, and estimated context %. Each card deep-links per the section-level contract locks (spend → §8, tokens → §6, cache hit % → §7, sessions → §2, avg $/session → §8). The recent-session card calls `/api/sessions?sort=lastAt&limit=1&include=trace` with active filters applied.

### Verification Checklist

- **renders 5 stat cards with correct labels** — see run: open Dashboard with seed fixtures → expected: row shows 5 cards labeled Spend / Total tokens / Cache hit % / Sessions / Avg $/session, in that order.
- **delta arrows present** — expected: each card shows ▲▼ with previous-equal-period value; card without a previous period shows "—" or hides the delta.
- **sparkline renders** — expected: each card has an accessible sparkline (`role="img"` + `aria-label`).
- **drill links match the section-level lock matrix** — run: inspect `href` on each card → expected: spend/avg-$-session → `/trends`, tokens → `/models`, cache hit % → `/cache`, sessions → `/sessions`, filters retained in query string.
- **recent-session card renders trace thumbnail** — run: with seeded session that has trace WHEN rendered → expected: thumbnail bars visible, scaled to trace points.
- **recent-session card displays turns count** — expected: "N turns" label visible.
- **ctx % shown for known model, hidden for unknown** — run: with a known-model session → expected: shows percentage; with an unlisted model → expected: shows "—" with no number.
- **filters carry into recent-session** — run: set project=alpha in URL → expected: the displayed session is from project alpha (or empty state otherwise).
- **independent loading/error states** — run: throttle /api/sessions WHEN metrics respond → expected: only stat-cards renders ready, recent-session shows its loading state; if /api/sessions errors → expected: only recent-session shows error; stats remain.
- **stories cover loading/error/empty/populated/estimated states** — run: `npm run storybook` → expected: all 5 states per card visible.

#### Testable Seams (component tests)
- Drill link target via accessible-name click — uses existing `renderHook`/`render` patterns from `client/src/components/StatCard.stories.tsx`.

### Implementation Notes

- **Module(s):** `client/src/pages/dashboard/StatCardsRow.tsx`, `RecentSessionCard.tsx`
- **Pattern reference:** `client/src/components/StatCard.tsx`; section-container pattern from `charts/ChartCard.tsx`
- **Key decisions:** A5 (section-owned, measure-batched queries); section-level locks for drill matrix and tier basis
- **Libraries:** None new.
- **High-risk callouts:** Stat-card query batch must include both aggregate+compare and time-bucketed sparkline variants in one call (per ARCH A5) — fan-out is the perf-critical seam.

### Scope Boundaries

- Do NOT replace the existing stub `Dashboard.tsx` (T14).
- Do NOT introduce new shared components (`StatCard.tsx` already supports delta + sparkline).
- Only these two files plus their stories.

### Files Expected

**New files:**
- `client/src/pages/dashboard/StatCardsRow.tsx` — 5 cards, drill links, batched queries
- `client/src/pages/dashboard/RecentSessionCard.tsx` — summary, trace thumbnail, ctx %, drill to §3
- `client/src/pages/dashboard/StatCardsRow.stories.tsx`
- `client/src/pages/dashboard/RecentSessionCard.stories.tsx`

**Must NOT modify:**
- `client/src/components/StatCard.tsx` (silent-regression hotspot; downstream consumers depend on its public shape)
- `client/src/pages/Dashboard.tsx` (T14 owns composition)
- `client/src/charts/ChartCard.tsx` (T8 owns the fix)

---

## Task T10: Windowed sections (BurnRateCard + SubscriptionWindow)

> **Status:** not started
> **Verification:** ui
> **Effort:** s
> **Priority:** medium (independent of /api/sessions; can run in parallel with T9)
> **Depends on:** T7
> **Satisfies REQs:** R1
> **Footprint slice:**
> - New: `client/src/pages/dashboard/BurnRateCard.tsx`
> - New: `client/src/pages/dashboard/SubscriptionWindow.tsx`
> - New: stories for each
> **High-risk areas touched:** Dashboard UI (Medium)

### Description

Builds the calendar-month-to-date burn-rate card with linear projection to month-end and an honest budget-bar state when no budget is set, and the rolling 5h/7d subscription-window tracker with "resets in Xh Ym" and vs-peak comparison. Both sections override only the global date range; categorical filters remain active. The subscription tracker distinguishes computed historical peak vs Settings-calibrated ceiling per the section-level lock.

### Verification Checklist

- **BurnRateCard renders MTD value** — run: with seeded calls in current month → expected: shows MTD $ within rounding tolerance.
- **projection is linear** — expected: projected month-end = `MTD / elapsedDays * daysInMonth` (sanity check using known fixture).
- **budget bar honest** — run: with no budget configured → expected: shows "no budget set" CTA → Settings, no fake number; with budget configured → expected: bar shows MTD/budget.
- **categorical filters applied** — run: set project=alpha WHEN rendered → expected: numbers reflect only alpha sessions.
- **SubscriptionWindow bars show 5h and 7d totals** — expected: two bars per the labels "5h" and "7d".
- **"resets in Xh Ym" label** — run: with rolling window in progress → expected: countdown matches the oldest contributing event's age.
- **historical peak fallback when no ceiling set** — run: with no Settings calibration → expected: peak = max historical rolling-window value seen in current matched extent.
- **Settings ceiling replaces peak when set** — placeholder for #P4-15; present `Settings`-sourced ceiling with same label.
- **stories cover unconfigured/populated states** — run: `npm run storybook` → expected: both states visible per section.

#### Testable Seams
- MTD/projection values via `aria-label` queries; subscription countdown timer via `data-testid` if needed.

### Implementation Notes

- **Module(s):** `client/src/pages/dashboard/BurnRateCard.tsx`, `SubscriptionWindow.tsx`
- **Pattern reference:** Existing card/container primitives; `client/src/charts/units.ts` for unit switching
- **Key decisions:** A7 (date override only), A11 (rolling-window semantics, peak vs ceiling), A13 (budget unconfigured state)
- **Libraries:** Existing `date-fns` for MTD/window math.
- **High-risk callouts:** Burn-rate calendar needs timezone choice — UTC for consistency with metrics engine, but UI labels in local time; pin explicitly.

### Scope Boundaries

- Do NOT add a Settings UI for budget/calibration (#P4-10 / #P4-15 territory).
- Do NOT compute rolling windows server-side; current scope derives client-side from hourly series.

### Files Expected

**New files:**
- `client/src/pages/dashboard/BurnRateCard.tsx`
- `client/src/pages/dashboard/SubscriptionWindow.tsx`
- `client/src/pages/dashboard/BurnRateCard.stories.tsx`
- `client/src/pages/dashboard/SubscriptionWindow.stories.tsx`

**Must NOT modify:**
- `client/src/pages/Dashboard.tsx` (T14)

---

## Task T11: Simple stat sections (RecordsStrip + LeverageRatio + FailedWorkStat)

> **Status:** not started
> **Verification:** ui
> **Effort:** s
> **Priority:** medium
> **Depends on:** T7
> **Satisfies REQs:** R1
> **Footprint slice:**
> - New: `client/src/pages/dashboard/RecordsStrip.tsx`
> - New: `client/src/pages/dashboard/LeverageRatio.tsx`
> - New: `client/src/pages/dashboard/FailedWorkStat.tsx`
> - New: stories for each
> **High-risk areas touched:** Dashboard UI (Medium)

### Description

Builds three simple value sections: a RecordsStrip with five records (most expensive day, session, turn; longest session; biggest cache save), a LeverageRatio headline (cache ÷ fresh-billed, "Nx" format), and a FailedWorkStat counter for classified error tool_results/failed commands. Records ignore only the active date range; categorical filters remain. Leverage renders unavailable (not NaN/Infinity) on a zero denominator.

### Verification Checklist

- **RecordsStrip shows 5 records with correct measures** — expected: most-expensive-day → `costComputed` aggregate over matched history extent; -session → `listSessions({sort:"costComputed", limit:1})`; -turn → derived from each session's max turn; longest-session → `listSessions({sort:"durationMs", limit:1})`; biggest-cache-save → `listSessions({sort:"cacheSavingsComputed", limit:1})`.
- **records respect categorical filters** — run: set project=alpha WHEN rendered → expected: project filter applied to records.
- **records ignore date range** — expected: navigating date range does not change records display (override per A7).
- **LeverageRatio renders Nx format** — expected: pattern is "Nx" with one decimal place; e.g., "20.5×".
- **zero denominator renders unavailable, not NaN** — run: with no fresh-billed tokens → expected: shows "—" or "unavailable", no NaN/Infinity.
- **FailedWorkStat reflects toolErrors measure** — run: with seeded failed tool results WHEN rendered → expected: number equals `measure: toolErrors` aggregate over the active range.
- **zero failed results is a real zero** — expected: shows "0", not "—", when the parser records zero failures.
- **stories cover empty/zero/populated states** — run: storybook → expected: each section has at least 3 states visible.

#### Testable Seams
- LeverageRatio numerator/denominator test (denominator=0 case).
- FailedWorkStat renders `0` vs `undefined` distinctly.

### Implementation Notes

- **Module(s):** `client/src/pages/dashboard/RecordsStrip.tsx`, `LeverageRatio.tsx`, `FailedWorkStat.tsx`
- **Pattern reference:** `components/StatCard.tsx` formatting; the section-container pattern
- **Key decisions:** A7 (date override for records), section-level lock on Records strip measures, A3+R3 (zero failed = real zero, leverage zero = unavailable)
- **Libraries:** None new.

### Scope Boundaries

- Do NOT split failed-work counts into separate `error tool_results` vs `failed commands` numbers — single unioned count per section-level lock.
- Do NOT deep-link the records (spec shows "—" for record drill targets).

### Files Expected

**New files:**
- `client/src/pages/dashboard/RecordsStrip.tsx` — 5 records per matrix
- `client/src/pages/dashboard/LeverageRatio.tsx`
- `client/src/pages/dashboard/FailedWorkStat.tsx`
- Three colocated `*.stories.tsx`

**Must NOT modify:**
- `client/src/pages/Dashboard.tsx` (T14)

---

## Task T12: Savings decomposition section

> **Status:** not started
> **Verification:** ui
> **Effort:** s
> **Priority:** medium
> **Depends on:** T3a (cache/routing measures), T7 (client foundation for fetch)
> **Satisfies REQs:** R1, R9
> **Footprint slice:**
> - New: `client/src/pages/dashboard/SavingsDecomposition.tsx` + story
> **High-risk areas touched:** Dashboard UI (Medium); Metrics engine surface (M, indirect via measure consumption)

### Description

Builds the SavingsDecomposition section showing two stacked savings values (cache discount + cheap-model routing) using the new measures from T3a. The two must sum exactly to the all-Opus-uncached counterfactual savings without double-counting (per A8). Unknown or unpriced models contribute no fabricated savings.

### Verification Checklist

- **shows two stacked savings segments** — expected: stack chart or stacked bar with cache and routing segments; both labeled.
- **sums to all-Opus-uncached savings** — run: with hand-priced fixture WHEN rendered → expected: `cache + routing` equals `costAtOpusUncached − actualCost` within tolerance.
- **unknown model contributes no fabricated savings** — run: with one unpriced call WHEN rendered → expected: that call's share is silently dropped from both segments; total savings is non-negative and consistent with only the priced calls.
- **zero savings is a real zero** — expected: shows $0.00 (or "—") instead of fabricating any optimistic number.
- **stories cover unpriced/populated/zero states** — run: storybook → expected: ≥3 states visible.

#### Testable Seams
- Sum-of-savings invariant test (asserts cache+routing == opus-uncached-actual within tolerance).

### Implementation Notes

- **Module(s):** `client/src/pages/dashboard/SavingsDecomposition.tsx`
- **Pattern reference:** section-card pattern; stack rendering matches existing placeholder pattern in mockup
- **Key decisions:** A8 (one non-overlapping counterfactual); section-level lock for stack algebra
- **Libraries:** None new.
- **High-risk callouts:** **Double-counting cache + routing** is the failure mode this task explicitly guards against.

### Scope Boundaries

- Do NOT introduce per-model rate switching (#P4-15 territory).
- Do NOT display savings for sessions without pricing (#P4-15 territory).

### Files Expected

**New files:**
- `client/src/pages/dashboard/SavingsDecomposition.tsx`
- `client/src/pages/dashboard/SavingsDecomposition.stories.tsx`

**Must NOT modify:**
- `client/src/pages/Dashboard.tsx` (T14)

---

## Task T13: Composite sections (LeaderboardsCard + AnomalyFeed)

> **Status:** not started
> **Verification:** ui
> **Effort:** m
> **Priority:** high (leaderboards tie to existing pages; anomaly feed hooks up the detector)
> **Depends on:** T3b (anomaly detector output), T7
> **Satisfies REQs:** R1, R5
> **Footprint slice:**
> - New: `client/src/pages/dashboard/LeaderboardsCard.tsx`
> - New: `client/src/pages/dashboard/AnomalyFeed.tsx`
> - New: stories for each
> **High-risk areas touched:** Dashboard UI (Medium)

### Description

Builds the tabbed top-sessions/top-projects/top-models LeaderboardsCard (each tab deep-links to §3 / §5 / §6 per the section-level lock) using the `/api/sessions` endpoint for sessions and dimension metrics queries for projects/models. Builds AnomalyFeed as a stable UI container that today renders a "gate data not available yet" stub but is shaped to render the three item kinds (`anomaly`, `gateFailure`, `captureGap`) once #P4-12 lands, and reuses `shared/anomaly.ts` from T3b for the `anomaly` kind today when enough session history exists.

### Verification Checklist

- **LeaderboardsCard renders 3 tabs** — run: with seeded fixture → expected: tabbar with Sessions / Projects / Models; default Sessions.
- **Sessions tab uses /api/sessions** — expected: top 5 sessions by `costComputed` desc, each row links to `/sessions/:id`.
- **Projects tab uses dimension metrics query** — expected: top 5 projects by `costComputed` aggregate, links to `/projects`.
- **Models tab uses dimension metrics query** — expected: top 5 models, links to `/models`.
- **each row links to the binding page per section-level lock** — expected: tab Sessions → §3, Projects → §5, Models → §6; if a row is uncategorized/empty, "no data yet" empty state shown.
- **AnomalyFeed renders "gate data not available yet" by default** — expected: explicit message, not an empty list.
- **AnomalyFeed structure is item-kind aware** — expected: a `data-testid="anomaly-feed"` exists; under the hood, when items are present the row rendering path branches on `kind` (`anomaly` / `gateFailure` / `captureGap`) with the documented fields (`sessionId`, optional `turnId`, `severity`, `summary`, `drill`).
- **anomaly item uses detector output** — run: with seeded pre-priced samples that have one outlier, AFTER T3b lands → expected: row appears with summary derived from the detector's output.
- **stories cover empty/populated/anomaly-only/capture-gap states** — run: storybook → expected: ≥4 states visible for AnomalyFeed.

#### Testable Seams
- Tab-switch interaction (render with active tab prop).
- Item-kind rendering branches in AnomalyFeed (mock data per kind).

### Implementation Notes

- **Module(s):** `client/src/pages/dashboard/LeaderboardsCard.tsx`, `AnomalyFeed.tsx`
- **Pattern reference:** `components/DataTable.tsx` for tabular rows; section-container pattern
- **Key decisions:** A2/A4 (entity delivery + display), A10 (anomaly detector output feed forward), section-level lock on item kinds
- **Libraries:** None new.
- **High-risk callouts:** Leaderboards are the busiest cross-page drill surface — link correctness is the user-facing risk.

### Scope Boundaries

- Do NOT implement real gate-failure data wiring (that's #P4-12).
- Do NOT include premium capture-gap detection beyond what the contract's `captureGap` kind reserves.

### Files Expected

**New files:**
- `client/src/pages/dashboard/LeaderboardsCard.tsx`
- `client/src/pages/dashboard/AnomalyFeed.tsx`
- Two colocated `*.stories.tsx`

**Must NOT modify:**
- `client/src/pages/Dashboard.tsx` (T14)
- `shared/anomaly.ts` (T3b owns the detector)

---

## Task T14: Page shell (CaptureBanner + format/queries helpers + Dashboard composition)

> **Status:** not started
> **Verification:** ui
> **Effort:** m
> **Priority:** high (composition glue; one failing section must not blank the page)
> **Depends on:** T7, T9, T10, T11, T12, T13
> **Satisfies REQs:** R1, R2, R8
> **Footprint slice:**
> - New: `client/src/pages/dashboard/CaptureBanner.tsx` (+ story)
> - New: `client/src/pages/dashboard/format.ts`
> - New: `client/src/pages/dashboard/queries.ts`
> - Modified: `client/src/pages/Dashboard.tsx` (replace stub with the responsive 12-section composition)
> **High-risk areas touched:** Dashboard UI (Medium); Build/deployment (Low, additive only)

### Description

Lands the page shell that composes every other section in a responsive 12-section layout. Adds the CaptureBanner that surfaces the global CTA when no C/B/L source exists (using `meta.globalCapture` from `/api/sessions`, intentionally filter-independent per the section-level lock), the `format.ts`/`queries.ts` helpers shared across section components, and replaces the current `Dashboard.tsx` stub with the full composition. Section components retain independent loading/error/empty states so one failure does not blank the page.

### Verification Checklist

- **Dashboard renders all 12 sections** — run: with full fixtures WHEN `/` is loaded → expected: Cost over time, Burn rate, Most recent session, Top sessions/projects/models, Anomaly & gate feed, Records strip, Subscription windows, Leverage ratio, Savings decomposition, Failed-work stat, Capture banner — and the 5 stat cards from T9. Order matches mockup unless the spec table dictates otherwise.
- **CaptureBanner hidden when C/B/L present** — run: with seeded capture files → expected: banner is not rendered.
- **CaptureBanner shown when no C/B/L** — run: without capture files → expected: banner is rendered with copy + link to `/settings`.
- **CaptureBanner ignores active filters** — run: set project=alpha WHEN rendered → expected: banner visibility does not change.
- **section errors do not blank the page** — run: deliberately break `/api/sessions` WHEN rendered → expected: only the affected sections show error; rest of page renders.
- **responsive layout survives narrow viewports** — run: resize to ~640px → expected: sections reflow; nothing clipped offscreen.
- **existing steel-thread assertions still pass** — run: `cypress/e2e/steel-thread.cy.ts` → expected: cost over time chart and persisted filters still work.

#### Testable Seams
- Dashboard smoke component test: render with mocked sections asserting presence of all 12 placeholders.
- CaptureBanner visibility based on `globalCapture` prop.

### Implementation Notes

- **Module(s):** `client/src/pages/dashboard/{CaptureBanner.tsx,format.ts,queries.ts}`, `client/src/pages/Dashboard.tsx`
- **Pattern reference:** `components/LockedCard.tsx` for the banner shell; `client/src/charts/units.ts` for format helpers
- **Key decisions:** A5 (section-owned queries), section-level locks for tier basis, capture banner global rule, and date overrides; layout order from `specs/pages/dashboard.html` mockup unless spec table conflicts (mockup precedence per ARCH §"Specs over mockup for presence")
- **Libraries:** None new.
- **High-risk callouts:** **One failing section blanking the page** is the failure mode this task explicitly guards against — verified by the "section errors do not blank" checklist item.

### Scope Boundaries

- Do NOT introduce new shared components beyond what's needed.
- Do NOT change filter wiring (sections already use `useFilters()`).
- Only these 4 files.

### Files Expected

**New files:**
- `client/src/pages/dashboard/CaptureBanner.tsx`
- `client/src/pages/dashboard/CaptureBanner.stories.tsx`
- `client/src/pages/dashboard/format.ts` — display/range formatting helpers (no pricing formulas)
- `client/src/pages/dashboard/queries.ts` — query construction helpers

**Modified files:**
- `client/src/pages/Dashboard.tsx` — replace stub with the 12-section composition

**Must NOT modify:**
- `client/src/filters/**` (silent-regression hotspot)
- `client/src/components/**` (silent-regression hotspots)
- `client/src/charts/ChartCard.tsx` (T8 owns)

---

## Task T15: Cypress smoke + fixture

> **Status:** not started
> **Verification:** checklist
> **Effort:** s
> **Priority:** high (final DoD gate from issue acceptance criteria)
> **Depends on:** T14
> **Satisfies REQs:** R1, R2, R8
> **Footprint slice:**
> - New: `cypress/e2e/dashboard.cy.ts`
> - New: `test/fixtures/projects/-Users-demo-project-alpha/44444444-4444-4444-8444-444444444444.jsonl`
> - Modified: `test/fixtures/README.md` (document the new fixture)
> **High-risk areas touched:** Build/deployment (Low, additive only)

### Description

Adds the Phase 4 standing-rules deliverable: a Cypress smoke spec that loads the Dashboard route from fixtures, asserts key sections render, and exercises at least one drill-link navigation that lands on a correctly filtered destination. Also adds a fixture session with anomaly/failed-result history so the anomaly feed and failed-work stat have real data to consume, and documents the new fixture in `test/fixtures/README.md`.

### Verification Checklist

- **npm run test:e2e passes** — run: `npm run test:e2e` from primary checkout (or local equivalent) → expected: all Cypress specs pass, including the new `dashboard.cy.ts`.
- **Dashboard route renders key sections** — run: spec visit → expected: visible text for "Cost over time", "Burn rate", "Recent session", "Top", "Records", and at least one of "Leverage", "Savings", "Failed work".
- **at least one drill-link lands on the right filtered destination** — run: spec clicks a stat card or leaderboard row → expected: URL matches the section-level lock target (`/trends`, `/sessions`, `/models`, `/cache`, `/projects`, `/sessions/:id`) AND filter chips carried over.
- **fixture document updated** — run: read `test/fixtures/README.md` → expected: an entry documents the `44444444-…jsonl` fixture (anomaly history + failed tool result).
- **no orphan failure of existing specs** — run: existing `steel-thread.cy.ts` and `chart-accessibility.cy.ts` → expected: still pass with the new fixture present.

### Implementation Notes

- **Module(s):** `cypress/e2e/dashboard.cy.ts`, `test/fixtures/projects/-Users-demo-project-alpha/...`, `test/fixtures/README.md`
- **Pattern reference:** Existing `cypress/e2e/steel-thread.cy.ts` patterns: fixture URL pattern, `setDateInput`, `totalFromLabel` helpers
- **Key decisions:** Issue acceptance criteria + Phase 4 standing rules
- **Libraries:** Cypress (existing).
- **High-risk callouts:** Cypress must use the existing test-fixtures convention; the existing fixture must keep working (no project-wide reset).

### Scope Boundaries

- Do NOT delete or modify existing fixtures.
- Do NOT introduce a new test runner.
- Only these 3 files.

### Files Expected

**New files:**
- `cypress/e2e/dashboard.cy.ts` — fixture-backed Dashboard smoke + one filtered drill journey
- `test/fixtures/projects/-Users-demo-project-alpha/44444444-4444-4444-8444-444444444444.jsonl` — anomaly/failed-result fixture

**Modified files:**
- `test/fixtures/README.md` — document the new fixture

**Must NOT modify:**
- Existing fixture files (silent-regression for `steel-thread.cy.ts` and `chart-accessibility.cy.ts`)
- `cypress.config.ts` or other Cypress configuration unless strictly needed (prefer to keep scope additive)

---



