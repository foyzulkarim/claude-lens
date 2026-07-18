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

## Task T1: Define the Cache Classifier Contract and Synthetic Fixture

> **Status:** not started
> **Verification:** tdd
> **Effort:** m
> **Priority:** critical
> **Depends on:** None
> **Satisfies REQs:** R4, R5, R9, N2
> **Footprint slice:** New: shared Cache Lab contract/test, pure classifier/test, `5555…` JSONL fixture; Modified: fixture README
> **High-risk areas touched:** K2/gates contract (H); synthetic fixture fleet (M); ingest/store source fields (L)

### Description

Define the additive Cache Lab wire vocabulary and implement the pure K2 base classifier plus its
independent TTL-attribution overlay. Add a synthetic transcript history that proves the contract
against real parser output and can later power the route and Cypress journey without taking
#P4-11's gate-fixture scope.

### Test Plan

#### Test File(s)

- `shared/cache-lab-contract.test.ts`
- `server/cache/classifier.test.ts`

#### Test Scenarios

##### Contract Vocabulary

- **keeps the classification vocabulary and response limits exhaustive** — GIVEN the exported cause,
  attribution, verdict, grain, gallery-limit, and context-limit values WHEN the contract suite runs
  THEN every union member is represented and the limits remain 50 gallery items and 24 context
  curves _(verifies R4, R5, N2)_
- **uses a strict spike boundary** — GIVEN writes below, equal to, and above 10,000 tokens WHEN each
  call is classified THEN only the write above the threshold yields a classification
  _(verifies R4; decision A3)_

##### K2 Base Cause

- **applies normative K2 precedence and emits its trace** — GIVEN streams that exercise first call,
  model switch, compaction, and otherwise-unexplained writes WHEN the spike is classified THEN the
  first matching rule wins and the trace records every check/value needed for evidence
  _(verifies R4)_
- **requires a greater-than-50-percent cache-read fall for compaction** — GIVEN boundary cases around
  the prior-read ratio WHEN the classifier compares the previous two calls THEN exactly 50% is not
  compaction and a larger fall is compaction _(verifies R4)_

##### TTL Attribution

- **distinguishes definitive TTL lapse from in-TTL prefix change** — GIVEN 5m-only and 1h-only writes
  with valid previous timestamps WHEN the idle gap is beyond or within the represented TTL THEN the
  overlay returns `ttl-lapse` or `prefix-change` respectively without changing the K2 base cause
  _(verifies R4, R5)_
- **returns unknown for ambiguous evidence** — GIVEN mixed 5m/1h partial expiry, missing buckets,
  malformed timestamps, or insufficient history WHEN attribution runs THEN it returns `unknown` and
  never throws or emits `NaN` _(verifies N2; ARCH forward stress-test)_

##### Fixture Regression Guard

- **classifies the parsed synthetic history without changing ingest contracts** — GIVEN the new
  early-dated JSONL fixture WHEN the existing parser loads it THEN both TTL buckets and intended
  spike histories survive dedupe, while the fixture timestamp remains earlier than `4444…`
  _(verifies R9; guards backward-regression risk for `shared/types.ts`,
  `server/ingest/parse-transcript.ts`, and the Dashboard fixture)_

### Implementation Notes

- **Module(s):** `shared/cache-lab-contract.ts`; `server/cache/classifier.ts`
- **Pattern reference:** `shared/metrics-contract.ts` exhaustive arrays and
  `server/metrics/measures.ts` functional-core style; fixture parsing patterns in
  `server/ingest/parse-transcript.test.ts`
- **Key decisions:** A2, A3, A4, A12; the classifier accepts one already ordered logical stream and
  never filters sidechains implicitly
- **Libraries:** TypeScript and Vitest only; reuse existing `ApiCall` types
- **High-risk callouts:** K2 precedence/trace is the future gates contract, so every branch and
  boundary is fixed by failing tests before implementation. The new fixture must not become the
  latest fixture or change `4444…`.

### Scope Boundaries

- Do NOT implement the gates engine, K2 pass/fail scoring, or session scoring.
- Do NOT add Settings persistence or an HTTP-configurable spike threshold.
- Do NOT modify transcript parsing, `shared/types.ts`, `4444…`, or `legacy/`.
- Only implement shared wire vocabulary, pure classification/attribution, and its synthetic history.

### Files Expected

**New files:**

- `shared/cache-lab-contract.ts` (wire types, vocabulary, and limits; mirrors
  `shared/metrics-contract.ts`)
- `shared/cache-lab-contract.test.ts`
- `server/cache/classifier.ts` (pure K2 base classifier and TTL overlay)
- `server/cache/classifier.test.ts`
- `test/fixtures/projects/-Users-demo-project-alpha/55555555-5555-4555-8555-555555555555.jsonl`

**Modified files:**

- `test/fixtures/README.md` (document Cache Lab coverage and retain #P4-11 fixture boundaries)

**Must NOT modify:**

- `shared/types.ts` (source contract; regression guarded)
- `server/ingest/parse-transcript.ts` (existing TTL mapping; regression guarded)
- `test/fixtures/projects/-Users-demo-project-alpha/44444444-4444-4444-8444-444444444444.jsonl`
- `legacy/`

### TDD Sequence

1. Lock the shared vocabulary and strict threshold.
2. Drive K2 precedence and trace branches.
3. Drive TTL boundary/ambiguity behavior.
4. Parse the synthetic fixture through the existing ingest boundary.

---

## Task T2: Build the Cache Analysis Engine

> **Status:** not started
> **Verification:** tdd
> **Effort:** m
> **Priority:** critical
> **Depends on:** T1
> **Satisfies REQs:** R3, R4, R5, R6, R7, R8, N2, N3
> **Footprint slice:** New: `server/cache/analysis.ts` and `server/cache/analysis.test.ts`
> **High-risk areas touched:** Cache economics (H); in-memory query path (M); K2/gates contract (H)

### Description

Build the Store-independent analysis function that partitions logical streams, classifies complete
histories, applies event-call filters, prices cache economics, and produces every bounded
cache-specific aggregate. It receives plain calls/turns/sessions and returns the shared contract,
leaving validation and Store access to the later route task.

### Test Plan

#### Test File(s)

- `server/cache/analysis.test.ts`

#### Test Scenarios

##### Stream and Filter Semantics

- **keeps main and sidechain-agent adjacency independent** — GIVEN interleaved main calls and two
  sidechain agents WHEN analysis partitions the fleet THEN each stream is ordered and classified
  without model/compaction evidence leaking across streams _(verifies R4; decision A3)_
- **classifies complete streams before including filtered events** — GIVEN a requested range or model
  filter beginning after the evidence call WHEN analysis runs THEN the matching spike retains the
  correct previous-call cause and is not treated as a first call _(verifies R4, R8; ARCH
  range-boundary stress-test)_

##### Economics and Nullability

- **computes a reconciled cache-economic ledger** — GIVEN fully priced scoped calls and multiple bust
  causes WHEN analysis runs THEN actual, saved, uncached, bust-loss, net, bust-count, and
  net-negative-session values agree without double counting _(verifies R3; decision A5)_
- **keeps tokens available when pricing is incomplete** — GIVEN a scoped unpriced model WHEN analysis
  runs THEN `pricingComplete` is false and financial claims are null while TTL, causes, and token
  outputs remain populated _(verifies N2; ARCH unpriced-model stress-test)_

##### Cache Aggregates

- **reconciles TTL creation buckets** — GIVEN complete and missing optional bucket fields WHEN TTL mix
  is aggregated THEN 5m + 1h + unknown equals total cache creation exactly _(verifies R5; guards
  parser/type optionality)_
- **builds dense median baseline points** — GIVEN first main-chain writes across occupied and empty
  grain buckets WHEN analysis runs THEN each bucket has the median and sample count or an honest
  empty value using existing grain boundaries _(verifies R5; guards `server/metrics/grain.ts`)_
- **bounds and orders invalidation evidence** — GIVEN first-call spikes and more than 50 busts across
  all causes WHEN analysis runs THEN first calls are excluded, cause costs are dense, gallery items
  are newest-first, and `total`/`truncated` describe the full population _(verifies R6, N3)_
- **bounds estimated context curves without invalid numbers** — GIVEN more than 24 matching sessions,
  empty turns, and zero-token turns WHEN context growth is derived THEN the highest-peak 24
  main-chain curves remain, basis is token-estimated, and no point is `NaN`/`Infinity`
  _(verifies R7, N2, N3; ARCH scale stress-test)_

### Implementation Notes

- **Module(s):** `server/cache/analysis.ts`
- **Pattern reference:** `server/metrics/engine.ts` for plain-array input and dense outputs;
  `server/metrics/dimensions.ts`, `grain.ts`, and `measures.ts` for existing semantics
- **Key decisions:** A1, A5, A6, A7, A8; first-call classifications are not busts
- **Libraries:** Existing TypeScript, Vitest, and date/pricing primitives only
- **High-risk callouts:** Financial values are user-trust-critical; tests reconcile every ledger
  component and poison incomplete pricing to null. The function must scan arrays without Store
  lookups or mutation.

### Scope Boundaries

- Do NOT add a route, Store column, database, memoization layer, worker, or background job.
- Do NOT add Cache Lab measures/dimensions to the generic metrics contract.
- Do NOT modify pricing, grain, dimension, parser, Store, or shared transcript types.
- Only implement deterministic analysis over the supplied snapshot.

### Files Expected

**New files:**

- `server/cache/analysis.ts` (filter-aware economics, trends, gallery, and context response builder;
  mirrors `server/metrics/engine.ts`)
- `server/cache/analysis.test.ts`

**Modified files:**

- None.

**Must NOT modify:**

- `server/store/store.ts`
- `server/metrics/measures.ts`
- `server/metrics/dimensions.ts`
- `server/metrics/grain.ts`
- `server/metrics/engine.ts`
- `shared/metrics-contract.ts`
- `shared/types.ts`
- `server/ingest/parse-transcript.ts`

### TDD Sequence

1. Drive stream partitioning and full-history filter semantics.
2. Drive economic reconciliation/nullability.
3. Drive TTL and baseline aggregates.
4. Drive evidence/context bounds and dense output.

---

## Task T3: Expose the Cache Lab HTTP Route

> **Status:** not started
> **Verification:** tdd
> **Effort:** s
> **Priority:** high
> **Depends on:** T1, T2
> **Satisfies REQs:** R1, R3, R4, R5, R6, R7, R8, N2, N3
> **Footprint slice:** New: Cache Lab route/test; Modified: Fastify app registration
> **High-risk areas touched:** Cache economics (H); in-memory query path (M)

### Description

Add the validated `POST /api/cache-lab` boundary and register it in the existing Fastify assembly.
The route captures one synchronous Store snapshot, injects the exact runtime pricing table already
used by Store/metrics, and delegates all computation to the analysis module.

### Test Plan

#### Test File(s)

- `server/routes/cache-lab.test.ts`

#### Test Scenarios

##### Request Validation

- **returns fixture-backed analysis for a valid query** — GIVEN a valid range, chip filters, and grain
  WHEN `POST /api/cache-lab` is called THEN it returns `200` with the typed analysis shape
  _(verifies R1, R3–R8)_
- **rejects every invalid wire shape consistently** — GIVEN non-object bodies, missing/malformed or
  reversed dates, unknown grains/filter keys, empty filter arrays, and invalid filter values WHEN
  posted THEN each returns `400 { error }` without invoking analysis _(verifies N2)_

##### Runtime Wiring

- **uses the injected runtime pricing table** — GIVEN a custom pricing table distinct from defaults
  WHEN the route analyzes the same fixture THEN economics reflect the injected table
  _(verifies R3; guards backward-regression risk for `server/app.ts`)_
- **takes one plain Store snapshot per request** — GIVEN an instrumented Store WHEN the route handles
  one request THEN calls, turns, and sessions are each listed once and no per-event Store read occurs
  _(verifies N3)_

##### Failure and Regression Behavior

- **returns nullable economics without treating unpriced data as an error** — GIVEN an unpriced
  fixture model WHEN the request is valid THEN the route returns `200` with token/classification
  data and nullable financial fields _(verifies N2; ARCH forward stress-test)_
- **preserves existing app endpoints and fallback** — GIVEN the new route registration WHEN ping,
  metrics validation, and an unknown API route are requested THEN their existing status/shape
  remains unchanged _(guards backward-regression risk for `server/app.ts` and
  `server/routes/metrics.ts`)_

### Implementation Notes

- **Module(s):** `server/routes/cache-lab.ts` and `server/app.ts`
- **Pattern reference:** `server/routes/metrics.ts` validation and registration
- **Key decisions:** A1, A5; route validates/snapshots/delegates and contains no analysis rules
- **Libraries:** Fastify, existing Store and RuntimeMetadata types, Vitest/Fastify injection
- **High-risk callouts:** Never import a separate default pricing table when app metadata exists;
  route tests prove the H-risk pricing seam.

### Scope Boundaries

- Do NOT add auth, an HTTP threshold setting, telemetry events, a WebSocket message, or persistence.
- Do NOT change existing metrics/session route contracts or SPA fallback behavior.
- Only implement request validation, snapshot assembly, runtime injection, and registration.

### Files Expected

**New files:**

- `server/routes/cache-lab.ts` (validated route; mirrors `server/routes/metrics.ts`)
- `server/routes/cache-lab.test.ts`

**Modified files:**

- `server/app.ts` (register route with shared runtime pricing)

**Must NOT modify:**

- `server/routes/metrics.ts`
- `server/routes/sessions.ts`
- `server/store/store.ts`
- `shared/ws-protocol.ts`
- `server/ws/`
- `legacy/`

### TDD Sequence

1. Drive parser error messages and valid-body output.
2. Drive Store snapshot and pricing injection.
3. Guard existing app behavior.

---

## Task T4: Add Client Cache Lab Query Plumbing

> **Status:** not started
> **Verification:** tdd
> **Effort:** m
> **Priority:** high
> **Depends on:** T3
> **Satisfies REQs:** R8, R9, N2, N3
> **Footprint slice:** New: typed Cache Lab API wrapper/test, shared analysis hook, initial Cache Lab test harness; Modified: query-key factory/test
> **High-risk areas touched:** Client live updates (M); in-memory query path (M)

### Description

Add the client boundary for fetching Cache Lab analysis and a stable, filter-aware TanStack hook
that multiple panels can share. Nest the query under the existing metrics prefix so current
WebSocket invalidations refresh Cache Lab without modifying the invalidation router.

### Test Plan

#### Test File(s)

- `client/src/api/cacheLab.test.ts`
- `client/src/api/queryKeys.test.ts`
- `client/src/pages/cache-lab/CacheLab.test.tsx`

#### Test Scenarios

##### API Boundary

- **posts the exact query and forwards cancellation** — GIVEN a Cache Lab query and AbortSignal WHEN
  the wrapper runs THEN fetch receives `POST /api/cache-lab`, JSON body, content type, and the same
  signal _(verifies R8)_
- **surfaces non-success and malformed responses** — GIVEN non-2xx or structurally invalid JSON WHEN
  the wrapper resolves THEN it rejects with an actionable error instead of casting silently
  _(verifies N2)_

##### Query Identity and Live Updates

- **places Cache Lab under the metrics prefix without collision** — GIVEN Cache Lab and generic
  metrics queries WHEN their keys are built THEN Cache Lab is
  `["metrics", "cache-lab", query]` and remains distinct from `qk.metrics`
  _(verifies R8; decision A9)_
- **is matched by existing metrics invalidation** — GIVEN a QueryClient containing Cache Lab data
  WHEN the existing metrics prefix is invalidated THEN the Cache Lab entry becomes stale without
  any `ws.ts` change _(guards client live-update regression)_

##### Shared Analysis Hook

- **derives a stable query from URL filters and grain** — GIVEN preset/custom ranges and chip filters
  WHEN the hook renders/re-renders THEN it sends canonical filters, resolved dates, and grain without
  a continuous fetch loop _(verifies R8, N3)_
- **deduplicates identical panel consumers** — GIVEN multiple mounted hook consumers with the same
  query WHEN they resolve concurrently THEN TanStack performs one request and shares the result
  _(verifies N3; decision A11)_

### Implementation Notes

- **Module(s):** `client/src/api/cacheLab.ts`,
  `client/src/pages/cache-lab/useCacheLabAnalysis.ts`, `client/src/api/queryKeys.ts`
- **Pattern reference:** `client/src/api/metrics.ts`, `filters/state.ts`, and Dashboard's
  `useStableNow`/section query pattern
- **Key decisions:** A9, A11; use one factory key, stable serialized filters, and section-owned states
- **Libraries:** React, TanStack Query, wouter filter hooks, Vitest/RTL
- **High-risk callouts:** A wrong key prefix silently stales live data; tests exercise actual
  QueryClient prefix matching and stable rerenders.

### Scope Boundaries

- Do NOT modify `client/src/ws.ts` or add polling/reconnect behavior.
- Do NOT implement panels, chart options, navigation, or client-side classification.
- Do NOT transfer raw calls to the browser.
- Only implement typed fetch, cache identity, and the reusable analysis hook.

### Files Expected

**New files:**

- `client/src/api/cacheLab.ts` (typed API wrapper; mirrors `client/src/api/metrics.ts`)
- `client/src/api/cacheLab.test.ts`
- `client/src/pages/cache-lab/useCacheLabAnalysis.ts`
- `client/src/pages/cache-lab/CacheLab.test.tsx` (initial hook/query harness; extended by T6–T8)

**Modified files:**

- `client/src/api/queryKeys.ts` (add Cache Lab key below metrics prefix)
- `client/src/api/queryKeys.test.ts` (key and prefix regression coverage)

**Must NOT modify:**

- `client/src/ws.ts`
- `client/src/ws.test.ts`
- `shared/ws-protocol.ts`
- `client/src/pages/CacheLab.tsx`
- `client/src/routes.ts`

### TDD Sequence

1. Drive API error/cancellation behavior.
2. Drive exact query-key structure and invalidation matching.
3. Drive stable hook filters and request deduplication.

---

## Task T5: Extract the Shared Chart Drill-Down Helper

> **Status:** not started
> **Verification:** tdd
> **Effort:** s
> **Priority:** medium
> **Depends on:** None
> **Satisfies REQs:** R8, R9
> **Footprint slice:** New: shared drill-down helper/test; Modified: existing ChartCard import/use
> **High-risk areas touched:** Turn/navigation behavior (M); existing Dashboard chart regression (M)

### Description

Extract the existing time-bucket-to-Sessions URL calculation into a reusable chart helper so Cache
Lab and ChartCard share identical permalink behavior. Preserve every existing ChartCard canvas and
keyboard interaction while making the helper independently testable.

### Test Plan

#### Test File(s)

- `client/src/charts/drilldown.test.ts`
- `client/src/charts/ChartCard.test.tsx`

#### Test Scenarios

##### Bucket Mapping

- **maps every grain to the established date range** — GIVEN day, hour, week, and month bucket starts
  WHEN a Sessions href is built THEN day uses identical `from`/`to` while other grains end at the
  next bucket boundary _(verifies R8)_
- **preserves and canonicalizes chip filters** — GIVEN unsorted project/model/branch/host values WHEN
  the href is built THEN every non-empty chip is preserved in sorted query-string form
  _(verifies R8)_

##### Interaction Regression

- **keeps canvas and keyboard drill destinations identical** — GIVEN one chart bucket WHEN its canvas
  point and matching data-table row are activated THEN both navigate to the same filtered Sessions
  URL _(verifies R8, R9)_
- **does not change existing ChartCard behavior** — GIVEN the Dashboard ChartCard regression suite
  WHEN the private implementation is replaced by the helper THEN existing fetch, toggle,
  accessibility, and navigation assertions still pass _(guards backward-regression risk for
  `client/src/charts/ChartCard.tsx`)_

### Implementation Notes

- **Module(s):** `client/src/charts/drilldown.ts` and `ChartCard.tsx`
- **Pattern reference:** the existing private `sessionsHrefForBucket`/`bucketEnd` logic in ChartCard
- **Key decisions:** A10; one helper owns date/chip mapping and routes remain unchanged
- **Libraries:** Existing `date-fns` helpers, URLSearchParams, Vitest/RTL
- **High-risk callouts:** This refactor affects a shipped Dashboard journey; preserve semantics
  exactly and use the existing ChartCard suite as a backward guard.

### Scope Boundaries

- Do NOT change `/sessions`, `/turns/:id`, wouter route definitions, or filter semantics.
- Do NOT add a new navigation store or alter chart query behavior.
- Only extract the helper and switch ChartCard to import it.

### Files Expected

**New files:**

- `client/src/charts/drilldown.ts` (shared bucket-to-Sessions href builder)
- `client/src/charts/drilldown.test.ts`

**Modified files:**

- `client/src/charts/ChartCard.tsx` (import/use helper with no behavior change)

**Must NOT modify:**

- `client/src/routes.ts`
- `client/src/pages/Sessions.tsx`
- `client/src/pages/TurnInspector.tsx`
- `client/src/filters/state.ts`

### TDD Sequence

1. Characterize the existing helper for every grain/filter.
2. Extract the helper.
3. Re-run the unchanged ChartCard interaction suite.

---

## Task T6: Build the Cache Overview and Diagnostics Panels

> **Status:** not started
> **Verification:** ui
> **Effort:** m
> **Priority:** high
> **Depends on:** T4
> **Satisfies REQs:** R1, R2, R3, R4, R5, R9, N2
> **Footprint slice:** New: FleetOverview, BustEconomicsPanel, MissAttributionPanel, TtlMixPanel, Cache Lab Storybook states; Modified: shared Cache Lab component test
> **High-risk areas touched:** Cache economics (H); UI/visual/accessibility (M); client failure isolation (M)

### Description

Implement the non-chart Cache Lab overview: fleet statistics, input composition, computed
counterfactuals, bust/net accounting, miss attribution, and TTL mix. Each panel owns or shares the
appropriate query boundary and renders honest loading, empty, unavailable, unknown, and
net-negative states.

### Verification Checklist

- **Populated overview** — expected: Storybook and RTL render four fleet stats, input composition,
  saved/uncached economics, bust net, attribution counts/verdict, and 5m/1h/unknown TTL values from
  supplied data _(verifies R1–R5)_
- **Zero versus unavailable** — expected: real zero renders `0`/`$0` while missing pricing or data
  renders an explicit unavailable value, never a fabricated zero _(verifies N2)_
- **Non-happy states** — expected: loading, empty, dedicated-endpoint error, unknown attribution,
  unpriced economics, and net-negative sessions are visibly and semantically distinct
  _(verifies R3, R9)_
- **Failure isolation** — expected: a rejected Cache Lab analysis query produces local alerts while
  metrics-backed fleet content remains mounted _(verifies ARCH endpoint-outage stress-test; A11)_
- **Composition reconciliation** — expected: input and TTL segments, labels, and percentages reconcile
  to displayed totals, including unknown TTL tokens _(verifies R2, R5)_
- **Responsive layout** — expected: narrow and desktop story viewports show no clipped numeric values
  or horizontal page overflow _(verifies R9)_
- **Accessible diagnostics** — expected: regions/headings, badges, alerts, bars, and numeric summaries
  have meaningful accessible names and status is not color-only _(verifies R9)_

#### Testable Seams

- Metrics/analysis response-to-view-model extraction and formatting.
- Conditional zero/null/loading/error/unknown/net-negative rendering.
- Query failure isolation and accessible region/alert names.
- Composition widths and labels derived from the same totals.

### Implementation Notes

- **Module(s):** `client/src/pages/cache-lab/` overview/diagnostic components
- **Pattern reference:** `dashboard/StatCardsRow.tsx`, `SavingsDecomposition.tsx`, existing
  `StatCard`/`Badge`/`EmptyState` components, and Dashboard Storybook decorators
- **Key decisions:** A1, A4, A5, A11; React displays server classifications and never rebuilds causes
- **Libraries:** React, TanStack Query, Tailwind utility classes, Storybook, RTL
- **High-risk callouts:** Financial presentation must preserve nullability and reconciliation; stories
  and component assertions cover every honest-state branch.

### Scope Boundaries

- Do NOT implement hit/baseline/cause charts, gallery, context curves, or final page composition.
- Do NOT calculate K2/TTL causes or cache economics in React.
- Do NOT add a new component library or modify generic metrics contracts.
- Only implement the four overview/diagnostic panels and their visual states.

### Files Expected

**New files:**

- `client/src/pages/cache-lab/FleetOverview.tsx`
- `client/src/pages/cache-lab/BustEconomicsPanel.tsx`
- `client/src/pages/cache-lab/MissAttributionPanel.tsx`
- `client/src/pages/cache-lab/TtlMixPanel.tsx`
- `client/src/pages/cache-lab/CacheLab.stories.tsx` (initial panel states; extended by T7–T8)

**Modified files:**

- `client/src/pages/cache-lab/CacheLab.test.tsx` (panel seams and failure isolation)

**Must NOT modify:**

- `shared/metrics-contract.ts`
- `server/metrics/engine.ts`
- `client/src/ws.ts`
- `client/src/pages/CacheLab.tsx`
- `client/src/routes.ts`

---

## Task T7: Build the Cache Trend Panels

> **Status:** not started
> **Verification:** ui
> **Effort:** m
> **Priority:** high
> **Depends on:** T4, T5
> **Satisfies REQs:** R1, R2, R5, R6, R8, R9, N2
> **Footprint slice:** New: chart option builders, HitRatePanel, BaselineWeightPanel, InvalidationCostPanel; Modified: Cache Lab tests/stories
> **High-risk areas touched:** UI/visual/accessibility (M); turn/navigation behavior (M); generic metrics consumer regression (L)

### Description

Implement the three Cache Lab trend families using the existing ECharts wrapper: hit-rate
line/bar/distribution views, median baseline weight, and invalidation cost by cause over time/totals.
Provide accessible semantic summaries and table/keyboard alternatives, with hit-rate drill-down
reusing T5's shared Sessions-link helper.

### Verification Checklist

- **Hit-rate variants** — expected: line, bars, and per-session histogram toggles render the intended
  series without incorrectly changing the active range/filter request _(verifies R2)_
- **Drill parity** — expected: a hit-rate canvas point and matching accessible table row navigate to
  the same filtered Sessions URL _(verifies R8)_
- **Baseline semantics** — expected: median tokens and sample counts render for populated buckets and
  empty buckets remain honestly empty rather than zero-filled claims _(verifies R5, N2)_
- **Cause views** — expected: invalidation cost switches between stacked time series and totals for
  exactly model-switch, compaction, and unexplained causes _(verifies R6)_
- **Finite chart data** — expected: option builders never emit `NaN`/`Infinity` and semantic summaries
  match the visible series _(verifies N2)_
- **Accessible interaction** — expected: toggles have pressed/selected state, focus is visible, charts
  have meaningful labels, data alternatives are keyboard operable, and updates are announced
  _(verifies R9)_
- **Responsive charts** — expected: desktop and tablet Storybook viewports preserve legends, controls,
  and readable plotting areas without page overflow _(verifies R9)_

#### Testable Seams

- Pure analysis/metrics response-to-ECharts option builders.
- Toggle state and query-shape stability.
- Canvas and data-row drill handlers.
- Finite-data guards, summaries, accessible labels, and announcements.

### Implementation Notes

- **Module(s):** Cache Lab chart option/panel modules
- **Pattern reference:** `client/src/charts/timeseries.ts`, `ChartCard.tsx`, `Chart.tsx`, and its
  accessibility/data-table patterns
- **Key decisions:** A7, A10; generic hit data remains on `/api/metrics` while analysis trends use the
  dedicated response
- **Libraries:** Existing ECharts core LineChart/BarChart, React, TanStack Query, RTL, Storybook
- **High-risk callouts:** ChartCard navigation is shipped behavior and generic metrics are shared;
  tests assert query shapes and reuse the extracted helper rather than duplicating it.

### Scope Boundaries

- Do NOT add a chart library, scatter/heatmap dependency, or page-specific generic measures.
- Do NOT implement the gallery, context curves, or final page shell.
- Do NOT add premium/observed context data.
- Only implement pure options and the three approved trend panels.

### Files Expected

**New files:**

- `client/src/pages/cache-lab/chart-options.ts`
- `client/src/pages/cache-lab/HitRatePanel.tsx`
- `client/src/pages/cache-lab/BaselineWeightPanel.tsx`
- `client/src/pages/cache-lab/InvalidationCostPanel.tsx`

**Modified files:**

- `client/src/pages/cache-lab/CacheLab.test.tsx` (chart seams and interaction assertions)
- `client/src/pages/cache-lab/CacheLab.stories.tsx` (chart states and responsive viewports)

**Must NOT modify:**

- `shared/metrics-contract.ts`
- `server/metrics/engine.ts`
- `client/src/charts/Chart.tsx`
- `client/src/charts/ChartCard.tsx` (owned by T5)
- `client/src/routes.ts`

---

## Task T8: Compose Cache Lab Evidence, Context, and Full Page

> **Status:** not started
> **Verification:** ui
> **Effort:** m
> **Priority:** high
> **Depends on:** T4, T6, T7
> **Satisfies REQs:** R1, R3, R6, R7, R9, N2, N3
> **Footprint slice:** New: InvalidationGallery and ContextGrowthPanel; Modified: CacheLab page shell and final tests/stories
> **High-risk areas touched:** UI/visual/accessibility (M); turn navigation (M); cache economics (H)

### Description

Complete the page with the bounded invalidation gallery, token-estimated context growth curves, and
the responsive `CacheLab` composition shell in the binding `7 section order. Finalize component and
Storybook coverage, verify section-level failure isolation, and perform the manual comparison
against the settled Cache Lab mockup plus spec-only additions.

### Verification Checklist

- **Evidence-rich gallery** — expected: each item displays base cause, TTL attribution, tokens,
  computed/null cost, session identity, turn evidence, and net-negative state without exposing
  prompt/tool bodies _(verifies R3, R6)_
- **Turn-link fallback** — expected: items with `promptId` link to `/turns/:promptId` and items without
  turn attribution render a clear non-link fallback rather than a fabricated destination
  _(verifies R6; guards Turn Inspector route risk)_
- **Bound disclosure** — expected: truncated gallery/context responses visibly state returned versus
  total counts and never imply completeness _(verifies N3)_
- **Estimated context** — expected: context curves are marked token-estimated, show the supplied
  main-chain sessions, and are not locked behind premium capture _(verifies R7)_
- **Binding page composition** — expected: every `specs/claude-lens-pages.md` `7 section renders in
  the approved hierarchy, including baseline weight absent from the mockup _(verifies R1)_
- **Section failure isolation** — expected: loading/error/empty state in one section leaves unrelated
  sections mounted and usable _(verifies A11 and ARCH endpoint-outage stress-test)_
- **Storybook state matrix** — expected: populated, empty, loading, error, unknown, unpriced, and
  net-negative stories cover all panel families _(verifies R9)_
- **Manual visual comparison** — expected: desktop and tablet renderings match
  `specs/pages/cache-lab.html` hierarchy, spacing, color intent, and density while including
  spec-over-mockup sections; retain visual evidence for handoff _(verifies R1, R9)_

#### Testable Seams

- Gallery ordering, truncation copy, link/fallback mapping, and accessible item labels.
- Context basis/truncation labels and finite chart option input.
- Full page section order and composition.
- Section-local error/empty/loading behavior and accessible landmarks.

### Implementation Notes

- **Module(s):** `InvalidationGallery.tsx`, `ContextGrowthPanel.tsx`, and
  `client/src/pages/CacheLab.tsx`
- **Pattern reference:** `dashboard/AnomalyFeed.tsx` for evidence lists, `Dashboard.tsx` for the
  composition shell, and existing `TierBadge`/chart components
- **Key decisions:** A8, A10, A11; response identifiers isolate the provisional Turn Inspector route
- **Libraries:** React, wouter, existing ECharts wrapper, Storybook, RTL, Tailwind utilities
- **High-risk callouts:** The page makes financial claims and spans canvas/accessibility states;
  manual visual evidence is paired with deterministic component seams and failure-isolation tests.

### Scope Boundaries

- Do NOT implement or change Turn Inspector, Session Detail, route shapes, premium parsers, or
  observed context.
- Do NOT copy hardcoded values/inline SVG from the mockup.
- Do NOT modify mockup assets, generic metrics, or `legacy/`.
- Only complete gallery/context presentation, the page shell, state matrix, and visual sign-off.

### Files Expected

**New files:**

- `client/src/pages/cache-lab/InvalidationGallery.tsx`
- `client/src/pages/cache-lab/ContextGrowthPanel.tsx`

**Modified files:**

- `client/src/pages/CacheLab.tsx` (replace PageStub with responsive binding-section composition)
- `client/src/pages/cache-lab/CacheLab.test.tsx` (full composition/failure/accessibility coverage)
- `client/src/pages/cache-lab/CacheLab.stories.tsx` (final state matrix and visual viewports)

**Must NOT modify:**

- `client/src/routes.ts`
- `client/src/pages/TurnInspector.tsx`
- `specs/pages/cache-lab.html`
- `specs/pages/cache-lab.png`
- `server/metrics/engine.ts`
- `legacy/`

---

## Task T9: Verify the Fixture-Backed Cache Lab Journey

> **Status:** not started
> **Verification:** test-after
> **Effort:** s
> **Priority:** high
> **Depends on:** T1, T2, T3, T4, T5, T6, T7, T8
> **Satisfies REQs:** R1, R2, R3, R4, R5, R6, R7, R8, R9, N1, N2, N3
> **Footprint slice:** New: Cache Lab Cypress spec; regression verification: existing Dashboard Cypress and fixture population
> **High-risk areas touched:** Synthetic fixture fleet (M); UI/visual/accessibility (M); client live updates (M)

### Description

Add the built-app Cache Lab smoke journey over the synthetic fixture tree and run the repository's
complete release gates. The journey proves all key sections render from the real Fastify/Store
pipeline, one chart drill preserves filters, request keys settle, and the new fixture does not
silently change the Dashboard's established latest/anomaly behavior.

### Test Plan

#### Test File(s)

- `cypress/e2e/cache-lab.cy.ts`
- existing `cypress/e2e/dashboard.cy.ts` (run unchanged as regression evidence)

#### Test Scenarios

##### Cache Lab Built Journey

- **renders every key Cache Lab section from fixtures** — GIVEN the fixed July fixture range WHEN
  `/cache` loads through the built server THEN fleet, composition, economics, attribution, TTL,
  hit-rate, baseline, invalidation, gallery, and estimated-context sections contain fixture-derived
  content _(verifies R1–R7)_
- **drills to a filtered Sessions view** — GIVEN active categorical filters and a visible hit-rate
  bucket WHEN the accessible drill action is activated THEN pathname is `/sessions` and query
  contains preserved chips plus explicit `from`/`to` _(verifies R8, R9)_
- **settles live analysis requests** — GIVEN the page has loaded and the initial WS invalidation has
  settled WHEN an observation window passes THEN Cache Lab/metrics request counts stop increasing
  without user action _(verifies N3; guards client live-update regression)_

##### Cross-Page Regression

- **preserves the Dashboard fixture anchor** — GIVEN the expanded fixture fleet WHEN the Dashboard
  smoke runs THEN `4444…` remains the most-recent session and its anomaly/failed-work content remains
  visible _(guards backward-regression risk for `cypress/e2e/dashboard.cy.ts` and `4444…`)_
- **preserves all existing built journeys** — GIVEN the new route/page/fixture WHEN the full Cypress
  harness runs THEN existing Dashboard, chart-accessibility, and steel-thread specs remain green
  _(guards ARCH fixture and generic-metrics regression risks)_

##### Repository Gates

- **passes the complete local verification gate** — GIVEN all tasks are implemented WHEN
  `npm run verify` runs THEN typecheck, lint, format-check, and all Vitest suites exit zero
  _(verifies N1)_
- **builds and passes isolated E2E** — GIVEN a clean implementation WHEN `npm run build` and
  `npm run test:e2e` run THEN the production CLI/SPA assemble and every Cypress spec exits zero
  _(verifies R9)_

#### Verification Commands

- `npm run verify` — expected: typecheck, Biome lint/format, and Vitest all pass.
- `npm run build` — expected: production CLI and SPA are created under `dist/` with exit code 0.
- `npm run test:e2e` — expected: Cache Lab and all pre-existing Cypress specs pass.

### Implementation Notes

- **Module(s):** Cypress built-app journey and repository verification only
- **Pattern reference:** `cypress/e2e/dashboard.cy.ts` fixed-range, section assertion, request-settle,
  and filtered-drill patterns
- **Key decisions:** A9, A12; the early-dated fixture must not replace `4444…`
- **Libraries:** Cypress, existing isolated E2E runner, npm verification/build scripts
- **High-risk callouts:** Do not “fix” cross-page regressions by weakening Dashboard assertions or
  editing `4444…`. Return defects to the owning T1–T8 implementation.

### Scope Boundaries

- Do NOT add production behavior, new requirements, route changes, or fixture-only special cases.
- Do NOT modify existing Cypress assertions or `4444…` merely to obtain a green run.
- Do NOT skip manual visual evidence already required by T8.
- Only add the Cache Lab journey and produce final integration evidence.

### Files Expected

**New files:**

- `cypress/e2e/cache-lab.cy.ts` (fixture-backed route smoke and filtered drill)

**Modified files:**

- None.

**Must NOT modify:**

- `cypress/e2e/dashboard.cy.ts`
- `test/fixtures/projects/-Users-demo-project-alpha/44444444-4444-4444-8444-444444444444.jsonl`
- `scripts/`
- `package.json`
- `legacy/`
