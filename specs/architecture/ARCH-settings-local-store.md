# Architecture: Settings page + config/local-store

> **Date:** 2026-07-19
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** `specs/claude-lens-pages.md` §10, `specs/claude-lens-architecture.md` §9–10, `specs/gates.md` §"Configurable constants", issue #47 / #P4-15 (`specs/context/47.md`)
> **Type:** feature (brownfield — extends #P4-10's budget-only config store)

## Architecture Summary

The Settings page (§10) is built over two local JSON stores: the existing `~/.claude-lens/config.json` (extended from budget+gate-thresholds to also carry pricing, scan roots, and anomaly factor) and a new `~/.claude-lens/local.json` (saved views + session tags — data with no runtime/ingest coupling). Two propagation mechanisms carry config changes to running state, chosen by what already consumes the value: fields baked into `Session` at derive time (pricing, host labels) propagate through a live `Store` swap mirroring the existing `updatePricing()`; fields consumed fresh per HTTP request (gate thresholds, anomaly factor) propagate by extending the existing `readConfig()`-per-request pattern already used by `gates.ts`. Scan-root *paths* are restart-only (the ingest pipeline is constructed once at boot); scan-root *labels* are live. The task also removes a known fake: `Session.host` is hardcoded `"default"` everywhere today — this lands the real value, sourced from a session's originating scan root's label.

## High-Level Structure

```
Boot (cli.ts):
  readConfig() ─┬─→ resolveScanConfig(config.scanRoots, cliRootsOverride)  [restart-only]
                ├─→ buildRuntimeMetadata({ pricing: config.pricing })       [pricer/contextResolver]
                └─→ buildHostLabels(config.scanRoots)                      [path→label map]
  → new Store({ ...metadata, hostLabels })
  → startIngest(scanConfig, { metadata })

Live ingest:
  discovery.ts (unchanged: DiscoveredFile already carries .root/.label)
  → tailer → pipeline.onRecords(file, result)
  → store.applyRecords(sessionId, result, file.root)   [NEW 3rd param]
      Store remembers sessionRoot: Map<sessionId, rootPath> (first-seen wins)
  → store.recompute(sessionId)
      → deriveSession(..., hostLabels.get(sessionRoot))
          host = label ?? rootPath ?? "unlabeled"        [replaces hardcoded "default"]

Config write:
  PUT /api/config { pricing?, scanRoots?, anomalyFactor?, budget?, gateThresholds? }
  → parseConfigPatch validates each present field
  → writeConfig(patch)                                   [existing merge-on-disk semantics]
  → if patch.pricing:    store.updatePricing(buildRuntimeMetadata({pricing: merged.pricing}))
  → if patch.scanRoots:  store.updateHostLabels(buildHostLabels(merged.scanRoots))
      (both mark every session dirty; next read recomputes — same cost model as today's
       updatePricing, not a new tradeoff)
  → gateThresholds/anomalyFactor need no propagation call — already read per-request

Per-request live reads (unchanged pattern, extended):
  GET /api/sessions/:id/gates  → readConfig() → getGateThresholds()          [existing]
  GET /api/sessions/:id        → readConfig() → anomalyFactor (NEW)          [session-detail.ts]
  Dashboard AnomalyFeed.tsx    → getConfig()  → anomalyFactor (NEW, client)

Local store (independent of ingest):
  GET/POST /api/views, DELETE /api/views/:id       → server/local-store.ts → local.json
  GET /api/tags, PUT/DELETE /api/tags/:tag         → server/local-store.ts → local.json
  PUT /api/sessions/:id/tags                       → server/local-store.ts → local.json
  GET /api/sessions merges tags onto each SessionListItem (read-only join, per request)
```

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|---|---|---|---|
| Pricing/host-label propagation | Live `Store` mutation (`updatePricing`, new `updateHostLabels`), triggered from the `PUT /api/config` handler | (a) Per-request `readConfig()` for everything, like gates; (b) full process restart on every config change | These two fields are baked into `Session` at derive time (`costComputed`, `host`), so a per-request read can't reach them — only mutating Store state and marking sessions dirty does. (a) would require re-deriving `Session` inside every route, duplicating the Store's own recompute logic. (b) fails the acceptance criterion ("without restart") outright. |
| Gate thresholds / anomaly factor propagation | Extend the existing per-request `readConfig()` pattern (`gates.ts`) to `session-detail.ts` and client `AnomalyFeed.tsx` | Route both through `RuntimeMetadata`/Store like pricing | These are computed fresh against a session snapshot on every request already (gates engine is stateless per-call) — reading config live is strictly simpler and there's already a working precedent. Forcing them through the Store would mean adding dirty-tracking for values nothing else needs cached. |
| Scan root paths | Restart-required; UI surfaces a "restart to apply" notice | Dynamically start/stop Poller/Tailer instances per root at runtime | `startIngest` constructs one `Poller`/`Tailer` pair per process lifetime; making that dynamic is a much larger, riskier change (thread-safety of adding/removing watched paths mid-run) for a rare admin action. Confirmed acceptable — acceptance criteria only requires *label* changes to be live. |
| `ModelRate`/`PricingTable` location | Move type definitions from `server/metrics/measures.ts` to new `shared/pricing-contract.ts`; re-export from `measures.ts` for the 11 existing importers | Duplicate the shape inline in `shared/settings-contract.ts` | Per CLAUDE.md's module-boundary rule, `shared/` owns contracts; a pricing rate shape edited by both client (editor) and server (ingest pricer) is exactly that. Re-exporting keeps all 11 existing importers unchanged — pure relocation, zero behavior change. |
| Tags storage shape | `Record<sessionId, string[]>` in `local.json` — no separate tag-definition entity | A `tags: {id, name}[]` catalog + `sessionTags` join table | Tags here are just user-typed strings with no other properties (color, description). A flat map is the smallest structure that supports rename (rewrite the string across all arrays) and delete (remove from all arrays) — the two operations the "tags manager" needs. |
| Saved views creation point | `client/src/filters/FilterBar.tsx` gets a "☆ Save view" button (shared chrome, all pages) | Settings-page-only form where the user pastes a URL manually | `FilterBar` is the only place "the current view" is naturally in scope (architecture §11: filter state lives in the URL, owned by `filters/`). A paste-a-URL form is clunkier and doesn't match how permalinks are meant to be used. |
| Cost-capture "N sessions capturing / last verified" | New `SessionListMeta.captureSummary` field, computed alongside the existing `aggregateGlobalCapture` loop in `sessions.ts` | New `GET /api/health` route (§9) | `/api/health` is explicitly #P4-14's task, not built yet. `aggregateGlobalCapture` already loops every session once per `GET /api/sessions` request computing `globalCapture`; adding `captureSummary` is the same O(n) pass, no new route or fetch. |

## Patterns & Conventions

- **Validate-snapshot-delegate route shape** — every new/extended route handler (`parseConfigPatch`, new views/tags routes) follows `config.ts`'s existing shape: a pure `(body) => patch | errorString` validator, never throwing, called before any I/O.
- **Degrade-to-default file I/O** — `server/local-store.ts` mirrors `server/settings.ts`: missing or corrupt file reads back as an empty default (`{views: [], tags: {}}`), never throws.
- **`{error, cause?}` wire shape for 500s** — new routes rely on `app.ts`'s top-level `setErrorHandler`, matching the existing convention documented there.
- **Per-section page components** — `client/src/pages/settings/*.tsx` follows the same per-panel component split already used in `pages/dashboard/`, `pages/trends/`, `pages/cache-lab/`, rather than one monolithic `Settings.tsx`.
- **Not applied: optimistic concurrency on config writes.** Last-PUT-wins, no ETag/version field — consistent with this being a local single-user tool where concurrent edits from two tabs are a rare, low-stakes edge case, not worth the added contract surface.

## Data Models

### `AppConfig` (extended, `shared/settings-contract.ts`)

**Purpose:** the full `~/.claude-lens/config.json` wire shape — pricing, scan roots, budget, gate thresholds, anomaly factor.

**Key fields:**
| Field | Type / Constraint | Notes |
|---|---|---|
| `budget` | `number \| null`, optional | Unchanged from #P4-10 |
| `gateThresholds` | `Partial<GateThresholds>`, optional | Unchanged from #P4-11 |
| `pricing` | `Record<string, ModelRate>`, optional | NEW. Each `ModelRate` requires all 4 rate fields (no partial rates) |
| `scanRoots` | `ScanRootConfig[]`, optional | NEW. `{path: string, label?: string}[]` |
| `anomalyFactor` | `number`, optional | NEW. Finite, > 0 |

**Lifecycle:** read at CLI boot (seeds ingest + runtime metadata); read/written any time via `GET/PUT /api/config`; on-disk file degrades to `{}`-equivalent defaults if missing/corrupt.

### `LocalStore` (new, `shared/local-store-contract.ts`)

**Purpose:** the full `~/.claude-lens/local.json` wire shape — saved views + session tags.

**Key fields:**
| Field | Type / Constraint | Notes |
|---|---|---|
| `views` | `SavedView[]` | `{id, name, path, search, createdAt}` — `id`/`createdAt` server-generated on `POST` |
| `tags` | `Record<string, string[]>` | Keyed by `sessionId`; empty/absent entries mean untagged |

**Lifecycle:** views are created only via `FilterBar`'s save action and deleted only via Settings; tags are attached/detached per-session via `PUT /api/sessions/:id/tags` and renamed/deleted fleet-wide via the Settings tags manager.

### `Session.host` (existing field, semantics change)

**Purpose:** was a hardcoded constant `"default"`; becomes the real scan-root label (or raw root path if unlabeled).

**Lifecycle:** resolved once per `Store.recompute(sessionId)` from `sessionRoot.get(sessionId)` (set once, first-file-wins, immutable for that session's life) joined against the live `hostLabels` map (swappable without re-ingest).

## API Contracts / Interfaces

### `GET/PUT /api/config` (extended)

**Boundary:** HTTP API (Fastify), `server/routes/config.ts`

| Method | Path | Purpose | Errors / Returns |
|---|---|---|---|
| GET | `/api/config` | Full current `AppConfig` | 200 + body |
| PUT | `/api/config` | Merge-patch `AppConfig`; triggers live propagation for `pricing`/`scanRoots` | 400 on any invalid present field (unchanged `{error}` shape); 200 + merged `AppConfig`; 500 on write failure |

**Auth requirements:** none (localhost single-user tool, unchanged).

### `GET/POST /api/views`, `DELETE /api/views/:id` (new)

**Boundary:** HTTP API, `server/routes/views.ts`

| Method | Path | Purpose | Errors / Returns |
|---|---|---|---|
| GET | `/api/views` | List saved views | 200 + `SavedView[]` |
| POST | `/api/views` | Create a view; body `{name, path, search}` | 400 on invalid body; 200 + created `SavedView` |
| DELETE | `/api/views/:id` | Remove a view | 404 if unknown id; 204 on success |

### `GET /api/tags`, `PUT/DELETE /api/tags/:tag` (new)

**Boundary:** HTTP API, `server/routes/tags.ts`

| Method | Path | Purpose | Errors / Returns |
|---|---|---|---|
| GET | `/api/tags` | Distinct tags in use + usage count | 200 + `{tag, sessionCount}[]` |
| PUT | `/api/tags/:tag` | Rename a tag across every session | body `{newName: string}`; 400 invalid; 200 on success |
| DELETE | `/api/tags/:tag` | Remove a tag from every session | 204 on success |

### `PUT /api/sessions/:id/tags` (new, added to existing `sessions.ts`)

**Boundary:** HTTP API, `server/routes/sessions.ts`

| Method | Path | Purpose | Errors / Returns |
|---|---|---|---|
| PUT | `/api/sessions/:id/tags` | Replace one session's tag list | body `{tags: string[]}`; 400 invalid; 200 + `{tags}` |

**Auth requirements (all above):** none.

## Module Boundaries

| Module / Package | Responsibility | Allowed Dependencies |
|---|---|---|
| `shared/pricing-contract.ts` | `ModelRate`/`PricingTable` types + validator | none (leaf contract) |
| `shared/local-store-contract.ts` | `LocalStore`/`SavedView` types + validators | none (leaf contract) |
| `server/local-store.ts` | File I/O for `local.json` only — no business logic | `shared/local-store-contract.ts`, node `fs` |
| `server/routes/views.ts`, `server/routes/tags.ts` | Business logic (CRUD, rename-across-sessions) over `local-store.ts` | `local-store.ts`, `shared/local-store-contract.ts` |
| `server/runtime.ts` | `buildRuntimeMetadata` (existing) + new `buildHostLabels` — both pure functions, no I/O | `metrics/measures.ts` (re-exported types), `shared/settings-contract.ts` |
| `server/store/store.ts` | Owns `sessionRoot`/`hostLabels` state and their live-swap methods | unchanged — no new external deps |
| `client/src/api/localStore.ts` | Client wrappers for views/tags routes | `shared/local-store-contract.ts`, mirrors `api/config.ts` conventions |

## Change Footprint

### New files / modules

| Path | Purpose | Pattern reference |
|---|---|---|
| `shared/pricing-contract.ts` | `ModelRate`, `PricingTable`, `isValidPricingTable` | `shared/settings-contract.ts`'s validator style |
| `shared/local-store-contract.ts` | `SavedView`, `LocalStore`, validators | `shared/settings-contract.ts` |
| `server/local-store.ts` | Read/write `local.json` | `server/settings.ts` |
| `server/routes/views.ts` | Saved-view CRUD routes | `server/routes/config.ts` |
| `server/routes/tags.ts` | Tag manager + rename/delete routes | `server/routes/config.ts` |
| `client/src/api/localStore.ts` | Views/tags client wrappers | `client/src/api/config.ts` |
| `client/src/pages/settings/PricingEditor.tsx` | Pricing table editor panel | `pages/trends/BudgetForecastPanel.tsx` |
| `client/src/pages/settings/ScanRootsEditor.tsx` | Scan roots + label editor panel | same |
| `client/src/pages/settings/ThresholdsPanel.tsx` | Budget/anomaly/gate thresholds panel | same |
| `client/src/pages/settings/SavedViewsTagsPanel.tsx` | Combined saved-views + tags manager panel | same |
| `client/src/pages/settings/CostCaptureGuide.tsx` | Static setup guide + capture-summary readout | same |

### Modified files / modules

| Path | What changes here |
|---|---|
| `shared/settings-contract.ts` | `AppConfig` gains `pricing?`, `scanRoots?`, `anomalyFactor?`; new validators |
| `shared/sessions-contract.ts` | `SessionListMeta` gains `captureSummary` |
| `server/metrics/measures.ts` | `ModelRate`/`PricingTable` become re-exports from `shared/pricing-contract.ts` |
| `server/metrics/dimensions.ts` | `case "host":` reads `session.host` instead of synthesizing `"default"` (required — see Risk section) |
| `server/metrics/session-population.ts` | Same `host` synthesis fix, if it independently constructs the constant |
| `server/runtime.ts` | Add `buildHostLabels(scanRoots)` |
| `server/ingest/pipeline.ts` | Thread `file.root` into `store.applyRecords` |
| `server/store/store.ts` | `sessionRoot` map, `hostLabels` map, `applyRecords` 3rd param, new `updateHostLabels()` |
| `server/store/derive-session.ts` | Real `host` resolution replacing hardcoded `"default"` |
| `server/routes/config.ts` | Extended `parseConfigPatch`; `store` param; post-write propagation calls |
| `server/routes/sessions.ts` | `captureSummary` computation; `projectItem` adds `host`/`tags`; new tags-PUT handler |
| `server/routes/session-detail.ts` | `configPath` option; per-request `anomalyFactor` read |
| `server/session-detail/projector.ts` | `RuntimeMetadata.anomalyFactor?`; `buildTurns` uses it |
| `server/cli.ts` | Boot reads `config.json` before building scan config + runtime metadata |
| `server/app.ts` | Wire `store`/`configPath` into `registerConfigRoute`/`registerSessionDetailRoute`; register `views.ts`/`tags.ts` |
| `client/src/api/config.ts` | Type import grows only |
| `client/src/pages/Settings.tsx` | Stub → full page assembling the 5 panels |
| `client/src/pages/Sessions.tsx` | `TagsStub` → real filter + inline per-row tag editor |
| `client/src/filters/FilterBar.tsx` | "☆ Save view" button |
| `client/src/pages/dashboard/AnomalyFeed.tsx` | Reads `anomalyFactor` from config instead of the pure function's default |

### Deleted / replaced

None. `Settings.tsx`'s stub body is replaced in place, not removed as a file.

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|---|---|
| 11 importers of `server/metrics/measures.ts` for `PricingTable`/`ModelRate` | Must keep compiling against the new re-export; a wrong re-export path is a wide TS-only break, caught by `npm run verify` |
| `server/routes/sessions.ts`'s existing `host` filter param | Semantics change once `host` is real — `?host=default` today matches everything (constant value), after this it matches only unlabeled sessions |
| `test/fixtures/` + `scripts/e2e.ts` | Fixtures are ingested under one implicit root; `sessionRoot`/`hostLabels` resolve against whatever root `--roots test/fixtures` passes — any Cypress spec asserting host text needs checking |
| `client/src/pages/trends/BudgetForecastPanel.tsx` | Already does its own partial `PUT /api/config` (`{budget}` only) — must keep working unmodified; protected by `writeConfig`'s existing merge-not-replace semantics |

## Areas of Impact

| Area | Impact | Risk (L/M/H) | Why |
|---|---|---|---|
| Ingest pipeline (`store.ts`, `derive-session.ts`, `pipeline.ts`) | New state (`sessionRoot`, `hostLabels`) and a changed `applyRecords` signature | M | Touches the hot append path every tailed line goes through; low complexity added but any regression here affects every session |
| Metrics engine (`dimensions.ts`, `session-population.ts`) | Host dimension now sourced from real data instead of a constant | M | Required fix to avoid a Dashboard/Sessions host-value split; any missed synthesis site reintroduces the drift review #13 already flagged once |
| CLI boot sequence (`cli.ts`) | Now async-reads config before building scan config/runtime metadata | L | Startup-only code path, well-isolated, existing `--roots` CLI-flag-wins fallback preserves e2e fixture behavior |
| Shared chrome (`FilterBar.tsx`) | New save-view control on every page | L | Additive UI element; no existing filter-bar behavior changes |
| `/api/sessions` response shape | Additive fields (`host`, `tags`, `captureSummary`) | L | Backward-compatible additions; no existing field removed or retyped |

**Contract changes:** `AppConfig`, `SessionListMeta`, `SessionListItem` all gain optional/additive fields only — no existing field is removed or retyped. `Session.host`'s *value* changes semantics (constant → real), which is a behavior change even though the field's type is unchanged.

**Cross-cutting ripples:** none into auth, telemetry, or build/deploy. No feature flag — the fake `"default"` host is removed outright per the confirmed decision, not gated.

## Cross-Cutting Concerns

- **Errors:** New validators return `string | T`, never throw (matches `parseConfigPatch`). New route handlers rely on the app-level `setErrorHandler` for uncaught failures, matching `config.ts`/`gates.ts`.
- **Logging & metrics:** Write failures in `local-store.ts`/`settings.ts` log via `app.log.error`, matching the existing `config.ts` 500 path. No new metrics.
- **Auth / authz:** None — unchanged, localhost single-user tool.
- **Performance:** `captureSummary` and tag-merge both ride the existing O(n) per-request loop in `sessions.ts` — no new pass. `updatePricing`/`updateHostLabels` mark every session dirty; recompute cost scales with fleet size, an accepted existing tradeoff (same as today's `updatePricing`), not new risk.
- **Security:** `scanRoots.path` only reaches `fast-glob`'s `cwd` at process boot (restart-gated, same surface as today's `--roots` flag). Tag/view names are free text — rendered as text via React's default escaping, never `dangerouslySetInnerHTML`.
- **Migrations / rollout:** Both `config.json` and `local.json` degrade to defaults on missing/corrupt file; no schema version needed since both round-trip unknown keys already.

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies |
|---|---|---|---|---|
| A1 | Live `Store` swap for pricing/host-labels; per-request `readConfig()` for gate thresholds/anomaly factor | Single unified mechanism for all config fields | Matches each field's existing computation shape (baked-into-Session vs. computed-per-request); forcing one mechanism would either duplicate Store recompute logic in routes or add unnecessary dirty-tracking | §10, acceptance criterion "without restart" |
| A2 | Scan-root paths restart-only; labels live | Fully dynamic poller/tailer add/remove at runtime | Acceptance criteria only requires label changes to be live; dynamic root add/remove is materially riskier (thread-safety of live-adding watched paths) for a rare admin action | §10 |
| A3 | `ModelRate`/`PricingTable` relocated to `shared/pricing-contract.ts`, re-exported from `measures.ts` | Duplicate the shape in `shared/settings-contract.ts` | Contracts belong in `shared/` per CLAUDE.md module-boundary rule; re-export keeps 11 existing importers untouched | §9 (`GET/PUT /api/config` pricing) |
| A4 | Tags as `Record<sessionId, string[]>`, no tag-definition entity | Separate tag catalog + join table | Smallest structure supporting the two required operations (rename-everywhere, delete-everywhere); tags have no other properties | §10 "tags manager" |
| A5 | Saved-view creation lives in `FilterBar.tsx` (shared chrome); management (list/delete) lives in Settings | Settings-only paste-a-URL form | `FilterBar` is the only place "current view" is naturally in scope; matches the URL-as-permalink architecture (§11) | §10 "saved views manager" |
| A6 | `captureSummary` added to existing `aggregateGlobalCapture` computation instead of a new `/api/health` call | Build `/api/health` early, ahead of #P4-14 | `/api/health` is explicitly #P4-14's task; reusing the existing per-request loop avoids a second route or fetch for two derived numbers | §10 "cost-capture setup guide" |
| A7 | `metrics/dimensions.ts`'s synthetic `"default"` host synthesis is replaced with a real `session.host` read (required scope, not optional cleanup) | Leave the metrics-engine host dimension as a separate constant, out of scope | Otherwise Dashboard/Trends (metrics-engine-backed) and Sessions (Session-backed) would show different host values for the same data — reintroducing exactly the drift review #13 already flagged once | §10, cross-page consistency |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|---|---|
| `config.json`/`local.json` corrupted mid-write (process killed during `writeFile`) | Both stores already degrade to in-memory defaults on any parse failure (existing `readConfig` pattern, extended identically to `readLocalStore`) — next boot/request just sees defaults, no crash |
| `PUT /api/config` with new `pricing` arrives while a huge session is mid-recompute | `updatePricing`/`updateHostLabels` only mark sessions dirty; actual recompute is deferred to the next lazy read (`listSessions`/`getSession`), so the PUT handler itself stays fast regardless of fleet size |
| Two browser tabs edit Settings concurrently | Last-`PUT`-wins, no optimistic concurrency token — accepted for a local single-user tool (A1 area); not worth an ETag/version field for this task |
| Ship breaks in production | Both stores are just files — deleting either resets to defaults; no migration to reverse, no data loss beyond the user's own edited config |

### Backward — regression risk per touched area

| Touched area (from Change Footprint) | What could regress | How we'd know / mitigation |
|---|---|---|
| `metrics/dimensions.ts` / `session-population.ts` host synthesis | Dashboard/Trends charts showing `"default"` while Sessions list shows real labels | A7 makes this required scope, not optional; add a fixture test asserting both surfaces agree on host for the same session |
| `sessions.ts`'s `?host=` filter param | `?host=default` silently changing meaning from "everything" to "only unlabeled sessions" | Add an explicit fixture-based test for the new semantics rather than relying on the absence of a regression test to catch it |
| `applyRecords` signature change (`pipeline.ts` → `store.ts`) | Any other caller of `applyRecords` (tests) breaking on the new required 3rd param | TypeScript compiler catches every call site at `npm run verify`'s typecheck step — not a silent risk |
| `BudgetForecastPanel.tsx`'s independent partial `PUT /api/config` | A wider Settings-page PUT accidentally clobbering BudgetForecastPanel's own budget-only edits | Already protected by `writeConfig`'s existing merge-not-replace semantics — no change needed, but worth a regression test asserting a Settings PUT with `pricing` doesn't touch `budget` set moments earlier by the Trends panel |

## Open Questions

- Exact validation strictness for `ScanRootConfig.path` (e.g. must it be absolute? Reject `~`-relative paths?).
  - **Impact if unresolved:** a malformed path silently fails discovery at next restart rather than failing fast in the Settings form.
  - **Suggested default:** require non-empty string, resolve via `path.resolve()` before persisting (mirrors `discovery.ts`'s existing `resolve()` call), no further validation — let discovery's existing empty-glob-result handling be the fallback.
- Whether `client/src/pages/dashboard/AnomalyFeed.tsx` should show a loading/stale state while `getConfig()` resolves `anomalyFactor`, given it currently renders synchronously off already-fetched turn samples.
  - **Impact if unresolved:** a brief flash using the pure function's built-in default (5) before the configured value applies.
  - **Suggested default:** acceptable — matches how `BudgetForecastPanel.tsx` already handles its own `getConfig()` load state (brief default render, then reconciled).

## Out of Scope

- `GET /api/health` (#P4-14) — the cost-capture guide's verification readout uses the new `captureSummary` field instead, not a dependency on the unbuilt health route.
- Dynamic (restart-free) scan-root path add/remove (A2) — deferred; restart-required is the accepted behavior for this task.
- Optimistic concurrency / versioning on config writes — deferred; last-write-wins accepted for a single-user local tool.
- Tag entities with properties beyond a name (color, description) — deferred; flat string tags only.

---

# Tasks

_This section is populated by the **generate-tasks** skill (Phase 3)._
_Run: `/generate-tasks from: specs/architecture/ARCH-settings-local-store.md`_
