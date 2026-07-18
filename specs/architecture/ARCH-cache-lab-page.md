# Architecture: Cache Lab Page

> **Date:** 2026-07-18
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Standalone brief — see Inferred Requirements
> (`specs/context/41.md`, `specs/issues/P4-9-cache-lab-page.md`, and the binding page specs)
> **Type:** feature

## Architecture Summary

Cache Lab is a brownfield React page over the existing in-memory transcript store. Ordinary token,
hit-rate, distribution, and trend data continue through the generic `POST /api/metrics` engine,
while a new `POST /api/cache-lab` boundary returns cache-specific classified events and aggregates.
A pure server classifier preserves the K2 rule exactly and is reusable by the later gates engine;
Cache Lab adds a separate TTL-attribution overlay. The client replaces the current `/cache` stub
with section-owned queries and ECharts panels, using the existing URL filters and WebSocket-driven
metrics invalidation without adding storage, dependencies, or a WebSocket message.

## Inferred Requirements (if Mode B / no REQ)

| ID | Inferred Requirement | Source |
|---|---|---|
| R1 | Render every Cache Lab section in the binding page table; use the HTML mockup only as the visual reference. | `specs/claude-lens-pages.md` §7; issue #41 |
| R2 | Show fleet cache totals, input composition, hit-rate trend, and per-session hit-rate distribution from transcript data. | Page spec §7 |
| R3 | Show saved cost, uncached counterfactual, bust loss, net cache benefit, and net-negative sessions using the runtime pricing table. | Page spec §7; issue #41 |
| R4 | Build the K2 cache-write cause classifier as a reusable, fixture-tested server module, then add TTL-lapse attribution for Cache Lab. | `specs/gates.md` K2; issue #41 |
| R5 | Show 5m/1h TTL mix and a baseline-weight trend based on the first cache write of each session. | Page spec §7 |
| R6 | Show a cause-labeled invalidation gallery with turn navigation and invalidation cost by cause over time. | Page spec §7; mockup |
| R7 | Show transcript-only token-estimated context growth now, while leaving the premium observed upgrade to #P4-13. | Page spec §7; plan #P4-13 |
| R8 | Apply the global URL range/project/model/branch/host filters and preserve permalink and drill-down behavior. | Phase 4 standing rules; `CLAUDE.md` |
| R9 | Cover populated and non-happy UI states in Storybook, add a fixture-backed Cypress smoke journey, and support manual mockup comparison. | Issue #41 Definition of Done |
| N1 | Stay inside the V2 TypeScript/Fastify/React architecture and do not extend `legacy/` or add a new persistence layer. | `AGENTS.md`; `CLAUDE.md` |
| N2 | Preserve honest exact/estimated/unavailable semantics: missing pricing or evidence must not become a fabricated zero or cause. | Tier-system conventions in `CLAUDE.md` |
| N3 | Keep one analysis request bounded and local-first: one fleet scan, no N+1 reads, at most 50 gallery items and 24 context curves. | Inferred performance requirement confirmed during architecture |

## High-Level Structure

```text
transcript JSONL
      │ existing parser/store (ApiCall → Turn → Session)
      ▼
in-memory Store snapshot
      │
      ├── POST /api/metrics ────────────────────────────────────────────┐
      │   totals · composition · hit trend · hit distribution          │
      │                                                               │
      └── POST /api/cache-lab                                         │
          │                                                           │
          ├── partition calls into ordered logical streams             │
          ├── K2 base classifier (first/model/compaction/unexplained)  │
          ├── TTL attribution overlay                                  │
          ├── pricing + bust/net accounting                            │
          └── bounded trends/gallery/context curves                    │
                                                                      ▼
                                           CacheLab React composition shell
                                           ├── metrics-owned sections
                                           ├── analysis-owned sections
                                           └── ECharts + accessible data views
```

The classifier receives one deduplicated, ordered logical stream and has no Store, HTTP, pricing,
filtering, chart, or React dependency. Cache Lab analysis partitions calls by session and stream
(`main` or sidechain `agentId`), classifies the complete stream, and only then applies the query's
range and categorical filters to candidate events. The later K2 gate reuses the same classifier but
passes only the main-chain stream, matching gate-wide sidechain exclusion.

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|---|---|---|---|
| API shape | Keep generic aggregates on `/api/metrics`; add `POST /api/cache-lab` for event analysis | Extend `MetricsQuery`; one all-purpose Cache Lab endpoint; client computation | The metrics engine remains measure × dimension × grain, while adjacency-based events and gallery rows get an honest boundary. |
| Contracts | Add `shared/cache-lab-contract.ts` | Server/client duplicate types; extend `metrics-contract.ts` | One additive shared wire contract prevents drift without polluting the generic query language. |
| Classification | Pure TypeScript functions over ordered `ApiCall` streams | React classifier; Store-coupled service; persisted derived events | Pure functions are deterministic, fixture-testable, and directly reusable by K2. |
| Storage | Compute from the current in-memory Store snapshot | Database, cache table, derived Store columns | Existing scale and invalidation model already make pages cheap; no migration or stale derived state is needed. |
| Pricing | Inject the existing `RuntimeMetadata.pricing`; reuse `priceCall`/`uncachedPrice` primitives | Import defaults in the route; duplicate formulas | Cache Lab, derived sessions, and metrics must never disagree about prices. |
| Client data | TanStack Query with typed wrappers and section-owned states | Parent fetch with prop drilling; bespoke state store | Matches Dashboard and lets generic sections survive a Cache Lab endpoint failure. |
| Charts | Existing ECharts `Chart` wrapper with line/bar options and semantic alternatives | New chart library; inline SVG | Reuses the established accessible chart lifecycle and adds no dependency. |
| Dates/grain | Reuse `server/metrics/grain.ts` and native `Date` behavior | Date library; new UTC bucketing rules | Keeps Cache Lab bucket boundaries identical to existing metrics charts. |
| Live updates | Nest `qk.cacheLab(query)` under the existing `metrics` prefix | New WS message/prefix; polling | Existing session/scan invalidations already stale every aggregate view. |

## Patterns & Conventions

- **Functional core, imperative shell** — classifier and analyzer accept plain arrays/configuration;
  the Fastify route only validates, snapshots the Store, and delegates.
- **Two-axis classification** — K2 base cause and Cache Lab TTL attribution remain separate so TTL
  interpretation cannot silently change the later gate's normative behavior.
- **Section-owned queries** — follows `client/src/pages/Dashboard.tsx`; each section renders its own
  loading, empty, unavailable, and error state.
- **One query-key factory** — `qk.cacheLab` is the sole key constructor and lives under
  `qk.prefixes.metrics` for existing WS invalidation.
- **Specs over mockup** — the page table owns section presence; in particular, baseline weight and
  the token-estimated context fallback render even though the HTML does not fully show them.
- **Honest nullability** — zero is a real result; missing pricing/evidence uses `null`, `unknown`, or
  an estimated-basis label rather than a synthetic value.
- **Strict TypeScript/ESM/Biome** — two-space indentation, `.js` import suffixes, colocated tests,
  and existing naming conventions apply throughout.

## Data Models

### CacheLabQuery

**Purpose:** Describes one filter-aware Cache Lab analysis request.

**Key fields:**

| Field | Type / Constraint | Notes |
|---|---|---|
| `range` | required `{ from: ISO string; to: ISO string }`, `from <= to` | Resolved from URL presets client-side, matching `MetricsQuery`. |
| `filters` | optional project/model/gitBranch/host arrays; non-empty arrays | Only global chip dimensions are accepted. |
| `grain` | required `hour \| day \| week \| month` | Drives dense baseline and invalidation-cost buckets. |
| `spikeThreshold` | not accepted over HTTP | The route injects the current default `10_000`; Settings owns future persistence. |

**Relationships:**

- Produces exactly one `CacheLabAnalysis` from one synchronous Store snapshot.

**Lifecycle:**

- Created from URL filters per render → used as a TanStack key/request body → discarded or cached
  client-side; never persisted server-side.

### ClassifiedCacheWrite

**Purpose:** Represents one call whose cache creation exceeds the injected K2 spike threshold,
including the reusable base cause and Cache Lab's TTL overlay.

**Key fields:**

| Field | Type / Constraint | Notes |
|---|---|---|
| `sessionId`, `callId`, `messageId` | required strings | Stable evidence identity. |
| `promptId`, `turnIndex` | optional | Enables a Turn Inspector link when the call belongs to a derived turn. |
| `streamKey` | required string | `main` or sidechain agent stream; classifier input is one stream. |
| `timestamp`, `model` | required strings | Used for ordering, grain, TTL gap, and model-switch evidence. |
| `cacheCreateTokens` | required number, `> threshold` | Strict `>` matches `gates.md` K2. |
| `baseCause` | `first-call \| model-switch \| compaction \| unexplained` | First match in normative K2 precedence order. |
| `attribution` | `ttl-lapse \| prefix-change \| unknown` | Independent, conservative TTL interpretation. |
| `trace` | required structured numeric/boolean facts | Records checks and values without prompt/tool content. |
| `bustLossComputed` | number or `null` | Null when required pricing is unavailable. |
| `sessionNetComputed` | number or `null` | Scoped session savings minus scoped bust loss. |
| `sessionNetNegative` | boolean or `null` | Null follows unavailable economics. |

**Relationships:**

- Belongs to one logical call stream and one session; may belong to one derived turn.
- First-call classifications feed baseline evidence but are excluded from bust counts, gallery, and
  invalidation-cost trends.

**Lifecycle:**

- Derived per request → aggregated and optionally included in the bounded gallery → discarded.

### CacheLabAnalysis

**Purpose:** Typed, bounded response for every cache-specific panel.

**Key fields:**

| Field | Type / Constraint | Notes |
|---|---|---|
| `economics` | computed values plus `pricingComplete` | Actual cost, cache savings, uncached cost, bust loss, net benefit, bust/session counts. |
| `attribution` | three counts plus verdict | Verdict is `ttl-lapse`, `prefix-change`, `mixed`, `insufficient-evidence`, or `no-events`. |
| `ttlMix` | 5m, 1h, and unknown creation-token totals | Unknown reconciles total creation against optional bucket fields. |
| `baseline` | dense grain points with median tokens and sample count | First nonzero main-chain cache write per session. |
| `invalidationCost` | dense grain points with three cause amounts | Model-switch, compaction, and K2-unexplained; first calls excluded. |
| `gallery` | latest 50 items, `total`, `truncated` | Summary counts still include all matching events. |
| `contextGrowth` | up to 24 session curves, `total`, `truncated`, basis | Main-chain per-turn maximum estimated input context. |

**Relationships:**

- Contains aggregates of zero or more `ClassifiedCacheWrite` values and matching calls/turns.

**Lifecycle:**

- Built atomically for a request → serialized to JSON → cached by TanStack until metrics
  invalidation; no server-side lifecycle.

## API Contracts / Interfaces

### Cache Lab HTTP Route

**Boundary:** HTTP API

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| POST | `/api/cache-lab` with `CacheLabQuery` | Return cache-specific economics, classification, trends, gallery, and context curves | `200 CacheLabAnalysis`; `400 { error }` for invalid body/range/grain/filter; unhandled failures use Fastify's `500`. |

**Auth requirements:** Same as existing `/api/*` routes: local same-origin application access, with
no new authentication or authorization layer. The route returns no prompt text, tool input, or tool
result body.

### K2 Base Classifier

**Boundary:** internal library API

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| classify | `classifyCacheWrite(stream, callIndex, options)` | Apply threshold and K2 precedence to one ordered logical stream | `ClassifiedBaseCause \| null`; no throw for insufficient compaction history. |
| attribute | `attributeCacheMiss(classification, previousCall)` | Add conservative 5m/1h timestamp attribution | `ttl-lapse \| prefix-change \| unknown`. |

The base classifier checks: first call; current model differs from the previous call; previous
call's cache-read tokens are more than 50% lower than the call before it; otherwise unexplained.
The trace records which checks ran and their values. TTL attribution uses the current write's bucket
fields: a gap beyond every represented TTL is definitive expiry; a gap within every represented TTL
plus a base `unexplained` cause is prefix change; mixed-bucket partial expiry, missing buckets, bad
timestamps, or other ambiguity is unknown.

**Auth requirements:** Not applicable; pure in-process interface.

### Cache Lab Analyzer

**Boundary:** internal module

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| analyze | `analyzeCacheLab(input, query, options): CacheLabAnalysis` | Filter, classify, price, aggregate, and bound a plain Store snapshot | Deterministic response; invalid wire data is rejected before this boundary. |

Classification runs against complete streams before event-call filtering so a range boundary does
not become a false first call. Bust loss is
`cacheCreateTokens × max(cacheCreateRate - cacheReadRate, 0) / 1_000_000`, the conservative delta
from a stable-cache read to an invalidation rewrite. If any scoped model needed for an economic
claim is unpriced, counterfactual and net fields are null; token panels remain available.

**Auth requirements:** Not applicable; in-process interface.

## Module Boundaries

| Module / Package | Responsibility | Allowed Dependencies |
|---|---|---|
| `shared/cache-lab-contract.ts` | Wire types, cause/attribution vocabulary, limits | Other shared type-only contracts; never server/client modules. |
| `server/cache/classifier.ts` | Threshold, K2 cause trace, TTL overlay | `shared/types.ts` and cache contract types only. |
| `server/cache/analysis.ts` | Stream partitioning, filter/range application, pricing, dense aggregates, response bounds | Classifier, shared contracts, metrics dimension/grain/pricing primitives; never Fastify or Store. |
| `server/routes/cache-lab.ts` | Validate HTTP body, capture arrays from Store, inject runtime pricing, delegate | Fastify, Store type, analyzer, runtime pricing type. |
| `client/src/api/cacheLab.ts` | Typed fetch and non-2xx/shape boundary | Shared cache contract only. |
| `client/src/pages/cache-lab/` | Queries, presentation, chart options, accessible fallbacks, navigation | Client API/query/filter/chart/components and shared contracts; never server modules. |
| `client/src/pages/CacheLab.tsx` | Section ordering and responsive page layout | Cache Lab section components only; no direct fetch. |

The HTTP layer never classifies or aggregates, the classifier never imports pricing or filtering,
and React never reconstructs causes from event traces. Existing metrics files remain the sole owner
of generic measure, dimension, grain, and pricing semantics.

## Change Footprint

_The concrete answer to "where does this land in the codebase?" — produced during the Phase D2 walk._

### New files / modules

| Path | Purpose | Pattern reference |
|---|---|---|
| `shared/cache-lab-contract.ts` | Cache Lab request/response and classification wire types | `shared/metrics-contract.ts` |
| `shared/cache-lab-contract.test.ts` | Contract exhaustiveness and stable vocabulary coverage | `shared/metrics-contract.test.ts` |
| `server/cache/classifier.ts` | Pure K2 base classifier and TTL overlay | `server/metrics/measures.ts` functional-core style |
| `server/cache/classifier.test.ts` | Fixture-backed classifier regression coverage | `server/ingest/parse-transcript.test.ts` fixture use |
| `server/cache/analysis.ts` | Filter-aware cache economics and aggregate response builder | `server/metrics/engine.ts` |
| `server/cache/analysis.test.ts` | Analyzer invariants, nullability, bounds, and dense-output coverage | `server/metrics/engine.test.ts` |
| `server/routes/cache-lab.ts` | Validated additive Fastify endpoint | `server/routes/metrics.ts` |
| `server/routes/cache-lab.test.ts` | Route validation, pricing injection, and fixture response coverage | `server/routes/metrics.test.ts` |
| `client/src/api/cacheLab.ts` | Typed `POST /api/cache-lab` wrapper | `client/src/api/metrics.ts` |
| `client/src/api/cacheLab.test.ts` | API boundary failure/response validation coverage | `client/src/api/sessions.test.ts` |
| `client/src/charts/drilldown.ts` | Shared time-bucket → filtered Sessions URL mapping | extracted from `client/src/charts/ChartCard.tsx` |
| `client/src/charts/drilldown.test.ts` | Stable bucket and filter-link coverage | `client/src/charts/ChartCard.test.tsx` |
| `client/src/pages/cache-lab/useCacheLabAnalysis.ts` | Stable filter-aware dedicated query reused by analysis panels | Dashboard section query pattern |
| `client/src/pages/cache-lab/FleetOverview.tsx` | Fleet stats, savings/counterfactual, and input composition | `dashboard/StatCardsRow.tsx` |
| `client/src/pages/cache-lab/BustEconomicsPanel.tsx` | Saved-versus-bust net accounting and negative-session summary | `dashboard/SavingsDecomposition.tsx` |
| `client/src/pages/cache-lab/MissAttributionPanel.tsx` | TTL/prefix/unknown counts and verdict | existing panel/badge components |
| `client/src/pages/cache-lab/TtlMixPanel.tsx` | 5m/1h/unknown composition | existing dashboard composition bars |
| `client/src/pages/cache-lab/HitRatePanel.tsx` | Time trend and per-session histogram with drill-down | `client/src/charts/ChartCard.tsx` |
| `client/src/pages/cache-lab/BaselineWeightPanel.tsx` | Median first-write trend | existing chart wrapper |
| `client/src/pages/cache-lab/InvalidationCostPanel.tsx` | Stacked cost-by-cause trend/totals | existing chart wrapper |
| `client/src/pages/cache-lab/InvalidationGallery.tsx` | Bounded cause-labeled event cards and turn links | `dashboard/AnomalyFeed.tsx` |
| `client/src/pages/cache-lab/ContextGrowthPanel.tsx` | Token-estimated main-chain session curves | existing chart wrapper/tier badge |
| `client/src/pages/cache-lab/chart-options.ts` | Pure ECharts option builders and semantic summaries | `client/src/charts/timeseries.ts` |
| `client/src/pages/cache-lab/CacheLab.test.tsx` | Page composition and section failure-isolation coverage | `dashboard/Dashboard.test.tsx` |
| `client/src/pages/cache-lab/CacheLab.stories.tsx` | Populated, empty, loading, error, unknown, and unpriced visual states | Dashboard component stories |
| `cypress/e2e/cache-lab.cy.ts` | Fixture-backed built-route smoke and filtered drill journey | `cypress/e2e/dashboard.cy.ts` |
| `test/fixtures/projects/-Users-demo-project-alpha/55555555-5555-4555-8555-555555555555.jsonl` | Synthetic cache-classifier and TTL/economics history, timestamped before the Dashboard fixture | existing JSONL fixture tree |

### Modified files / modules

| Path | What changes here |
|---|---|
| `server/app.ts` | Register the Cache Lab route and pass the same runtime pricing table used by Store/metrics. |
| `client/src/pages/CacheLab.tsx` | Replace `PageStub` with the binding section order and responsive composition shell. |
| `client/src/api/queryKeys.ts` | Add `qk.cacheLab(query)` under the existing `metrics` prefix. |
| `client/src/api/queryKeys.test.ts` | Guard Cache Lab key identity and metrics-prefix invalidation compatibility. |
| `client/src/charts/ChartCard.tsx` | Import the extracted shared bucket drill-link helper without changing behavior. |
| `test/fixtures/README.md` | Document the new synthetic Cache Lab fixture and preserve the #P4-11 gate-fixture boundary. |

### Deleted / replaced

| Path | Reason |
|---|---|
| None | The `CacheLab.tsx` stub implementation is replaced in place; no file or public route is removed. |

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|---|---|
| `shared/types.ts` | Existing optional TTL fields and call/turn identities are the analyzer's source contract. |
| `server/ingest/parse-transcript.ts` | Already maps exact 5m/1h fields; parser behavior must not drift or be duplicated. |
| `server/store/store.ts` | Supplies raw calls and derived turns/sessions with eventual-consistency semantics. |
| `server/metrics/measures.ts` | Owns runtime price/counterfactual primitives and generic cache totals/savings. |
| `server/metrics/dimensions.ts` | Defines project/model/branch/host filter values reused by analysis. |
| `server/metrics/grain.ts` | Defines local-time bucket boundaries reused by Cache Lab trends. |
| `shared/metrics-contract.ts` and `server/metrics/engine.ts` | Generic hit-rate series/distributions remain unchanged and power part of the page. |
| `client/src/ws.ts` | Must remain unchanged because `qk.cacheLab` deliberately nests under the metrics prefix. |
| `client/src/routes.ts` | `/cache` and `/turns/:id` already exist; this work does not change route shapes. |
| `client/src/pages/TurnInspector.tsx` | Gallery links depend on its provisional `:id` contract but do not implement the page. |
| `cypress/e2e/dashboard.cy.ts` | The global fixture population changes; most-recent/anomaly assumptions must remain true. |
| `test/fixtures/projects/-Users-demo-project-alpha/44444444-4444-4444-8444-444444444444.jsonl` | Must remain the latest fixture so existing Dashboard assertions do not silently change target. |
| `specs/pages/cache-lab.html` and `specs/pages/cache-lab.png` | Visual references used for manual sign-off, never copied as implementation code. |

## Areas of Impact

_Broader-than-files impact — modules, services, teams, contracts, cross-cutting effects._

| Area | Impact | Risk (L/M/H) | Why |
|---|---|---|---|
| K2/gates contract | Establishes the classifier later consumed by #P4-11 | H | A precedence or trace mistake would produce future gate false positives/negatives. |
| Cache economics | Adds user-visible savings, bust, and net claims | H | Pricing incompleteness or double counting would undermine financial trust. |
| In-memory query path | Adds a full fleet analysis scan on Cache Lab refetch | M | Current data is small, but large histories can block the single Node event loop. |
| Client live updates | Adds a query under the existing metrics invalidation family | M | A wrong key prefix would leave the page stale without an obvious failure. |
| Generic metrics consumers | Reuses measures/distributions without changing their contract | L | Dashboard behavior should remain byte-for-byte independent. |
| Turn navigation | Emits evidence for a currently provisional Turn Inspector route | M | Later route normalization may require only the link builder to change. |
| Synthetic fixture fleet | Adds priced cache spikes to all fixture-backed runs | M | Aggregate and anomaly populations shift even on other pages. |
| UI/visual/accessibility | Replaces one stub with a dense multi-chart page | M | Loading/error/empty semantics and canvas alternatives span many sections. |
| Ingest/store | No schema or parser change; reads existing exact fields | L | Optional/malformed fields still require conservative handling. |
| Deployment/storage | Additive code only, no migration or new service | L | Rollback is a code revert. |

**Contract changes:** Adds the internal/public-local `POST /api/cache-lab` JSON contract and the shared
`CacheLabQuery`/`CacheLabAnalysis` types. Adds `qk.cacheLab` for client consumers. It does not alter
`MetricsQuery`, `Series`, `ApiCall`, existing HTTP responses, or `WsServerMessage`.

**Cross-cutting ripples:** Existing metrics-prefix invalidation covers the new query; no auth,
telemetry protocol, migration, feature flag, dependency, build step, or deployment topology changes.
The fixture population changes and therefore remains a regression hotspot for every fixture-backed
aggregate page.

## Cross-Cutting Concerns

- **Errors:** The route rejects malformed bodies, dates, reversed ranges, grains, filter keys, empty
  filter arrays, and non-string/number values with `400 { error }`. Fetch wrappers throw on non-2xx;
  each section renders an alert without blanking unrelated sections. Missing evidence becomes
  `unknown`; missing pricing makes economic claims null while token panels remain available.
- **Logging & metrics:** Existing Fastify request/error logging is sufficient. Do not log individual
  event traces, prompt content, paths beyond existing request metadata, or one line per call. No new
  telemetry backend is introduced.
- **Auth / authz:** Same local same-origin trust boundary as current `/api/*`; no new roles or checks.
  Validation remains at the HTTP boundary.
- **Performance:** One synchronous store-array snapshot, one call scan, and per-stream sorting; no
  Store lookup inside event loops and no client raw-call transfer. Dense time series scale with
  requested buckets, gallery is capped at 50, and context curves at 24. Design target is under
  250ms for 100k calls on development hardware; 10M calls requires profiling or future memoization.
- **Security:** Return identifiers, token counts, causes, timestamps, model/project labels, and numeric
  traces only—never prompt text, tool inputs, tool-result bodies, or secrets. Validate every filter
  and date before analysis and use typed route output.
- **Migrations / rollout:** Additive route and page replacement, no migration or feature flag. The
  current stub can be restored by reverting this feature. Future Settings/premium work can inject a
  different threshold/pricing/basis through existing seams without breaking the response shape.

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies REQs |
|---|---|---|---|---|
| A1 | Hybrid generic metrics plus dedicated Cache Lab analysis API | Extend metrics language; all-dedicated; client analysis | Keeps adjacency/event data out of measure × dimension semantics while reusing mature aggregates. | R1, R2, R6, N1 |
| A2 | Pure, Store-independent K2 classifier | Route/Store-coupled classifier; React classifier | Enables exact fixture tests and direct #P4-11 reuse. | R4 |
| A3 | Preserve K2 precedence and strict `> 10_000`; classify per logical stream | Cache Lab-specific order; `>=`; whole-session interleaving | `gates.md` is normative and sidechains must not corrupt adjacency. | R4, N2 |
| A4 | Keep TTL attribution as an independent conservative overlay | Fold TTL into K2; guess a dominant TTL | K2 semantics stay stable and mixed/missing evidence remains honest. | R4, R5, N2 |
| A5 | Price bust loss as stable-read versus rewrite delta; null incomplete economics | Count tokens only; duplicate flat rates; treat unpriced as zero | Uses the one runtime pricing source and avoids double counting/fabrication. | R3, N2 |
| A6 | Classify full streams before filtering event calls | Filter first; treat range start as session start | Preserves previous-call context across range and categorical boundaries. | R4, R8 |
| A7 | Median first main-chain write per grain; per-turn max token context estimate | Sum/mean baseline; lock context panel; client derivation | Median represents typical baseline drift; token fallback satisfies the binding spec now. | R5, R7 |
| A8 | Bounded server response: 50 gallery items and 24 context curves | Unbounded arrays; pagination/new storage | Keeps the initial local endpoint predictable while retaining total/truncated metadata. | R6, R7, N3 |
| A9 | Put `qk.cacheLab` under the existing metrics prefix | New WS message/prefix; polling | Live updates work through current invalidation with no protocol ripple. | R2, R8, N1 |
| A10 | Extract the filtered bucket drill-link helper; preserve current turn route | Duplicate link logic; change route shape | Keeps Cypress/permalink behavior consistent without taking ownership of Turn Inspector. | R6, R8, R9 |
| A11 | Section-owned client queries and honest states | Page-level all-or-nothing fetch | A dedicated endpoint outage cannot erase generic fleet panels. | R1, R9, N2 |
| A12 | Add a purpose-built early-dated synthetic transcript fixture | Reuse insufficient fixtures; add #P4-11 gate scenarios early | Meets classifier/Cypress needs without taking later gate-fixture scope or changing the latest session. | R4, R9 |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|---|---|
| `/api/cache-lab` is unavailable for 30 seconds | Dedicated panels show local errors; `/api/metrics` fleet totals and hit charts remain usable; TanStack retries/refetches through existing policy. |
| Two callers request the same analysis while ingest updates a session | Analysis is read-only and synchronous; JavaScript cannot interleave an ingest callback inside the snapshot/analysis call, and the next WS invalidation refreshes both cached queries. |
| A range begins halfway through a session | Full logical streams are classified first, so previous-call/model/compaction/TTL evidence remains correct; only result inclusion is range-filtered. |
| TTL fields or timestamps are absent/malformed | Base K2 cause still resolves where possible; TTL overlay returns `unknown` and no `NaN` reaches the response. |
| A scoped model is absent from pricing | Token panels and causes remain available; financial counterfactual/net values and affected event losses are null with `pricingComplete: false`. |
| There are no calls, no cache writes, or all values are zero | Dense trends contain real zeros/sample counts, gallery is empty, verdict is `no-events`, and the client distinguishes zero from unavailable. |
| Store grows from 10k to 10M calls | One scan and bounded output avoid N+1/network explosion, but synchronous CPU is a known limit; profile and add memoization/incremental derived state later without changing the API. |
| Feature must be rolled back after release | Revert additive route/contract/client modules and restore the in-place page stub; no data migration, protocol downgrade, or cleanup is required. |

### Backward — regression risk per touched area (brownfield only)

| Touched area (from Change Footprint) | What could regress | How we'd know / mitigation |
|---|---|---|
| `server/app.ts` | Route registration could alter fallback/error behavior or receive different pricing | Route/app integration coverage and explicit runtime pricing injection. |
| K2 classifier contract | Future gates could inherit wrong precedence or sidechain behavior | Normative trace assertions over the dedicated synthetic transcript; classifier accepts one stream rather than filtering implicitly. |
| `client/src/api/queryKeys.ts` | Cache Lab could fail to refetch, or keys could collide with generic metrics | Prefix/key identity coverage; second key segment is the literal `cache-lab`. |
| `client/src/charts/ChartCard.tsx` drill helper extraction | Existing Dashboard chart links could lose range/filter semantics | Existing ChartCard interaction coverage plus pure drill-link coverage. |
| Generic metrics engine | New page assumptions could tempt page-specific measures/dimensions into the engine | Architecture boundary forbids those changes; existing engine/measure suites remain unchanged. |
| Store/parser TTL fields | Optional values could be treated as required or duplicated | Analyzer reads existing optional fields and reconciles missing bucket tokens into `unknown`. |
| Turn Inspector route | Gallery links could break when the provisional route is normalized | Response carries session, prompt, and turn index; one client link builder contains the route assumption. |
| Fixture fleet / Dashboard Cypress | New session could become “latest” or shift anomaly expectations | New fixture timestamps precede `4444…`; existing Dashboard smoke remains part of the full E2E gate. |
| Dense multi-panel UI | One rejected query could blank the page or canvases could be inaccessible | Section-owned error states, semantic summaries/data views, Storybook states, and page composition coverage. |

## Open Questions

- Will Turn Inspector retain `/turns/:id`, or later adopt the gates-spec
  `/session/:id/turn/:n` shape?
  - **Impact if unresolved:** Gallery navigation may need a localized URL migration when the real
    Turn Inspector lands; classification and the wire contract do not change.
  - **Suggested default:** Use current `/turns/:promptId` now and keep `sessionId`, `promptId`, and
    `turnIndex` in each event so either future route can be generated.

## Out of Scope

- Gates engine and K2 pass/fail/session scoring (reason: owned by #P4-11; only its classifier lands).
- Persistent/custom K2 thresholds and pricing editor UI (reason: owned by Settings #P4-15).
- Premium C/B/L parsing and observed context curves (reason: owned by #P4-13; current basis is
  explicitly token-estimated).
- New database, server cache, background aggregation job, or WebSocket message (reason: unnecessary
  for the current in-memory local-first scale).
- Implementing or changing Session Detail and Turn Inspector routes/pages (reason: separate Phase 4
  tasks; Cache Lab carries enough identifiers for later normalization).
- Changes to `legacy/` (reason: V2 is active and repository instructions forbid extending it).

---

# Tasks

_This section is populated by the **generate-tasks** skill (Phase 3)._
_Run: `/generate-tasks from: specs/architecture/ARCH-cache-lab-page.md`_
