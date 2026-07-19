# Architecture: CSV/JSON Export (#P4-17)

> **Date:** 2026-07-19
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** `specs/context/49.md` (GitHub issue #49) — tracing to `specs/claude-lens-plan.md` #P4-17, `specs/claude-lens-architecture.md` §9 (`GET /api/export`) and §11 (permalink = query-string state), `specs/claude-lens-pages.md` §0 (global analytics layer)
> **Type:** feature

## Architecture Summary

A new `GET /api/export?format=csv|json&…` route streams the full matched Sessions-page population (not just the visible page) as CSV or JSON, reusing the existing Sessions-page population/sort/projection logic verbatim. The client adds a small global-layer action group — Export CSV, Export JSON, Copy permalink — mounted in `AppShell` next to the existing `FilterBar`, visible only on the Sessions list route. No new client state: both the export URL and the permalink are derived directly from the current URL, matching the codebase's "URL is the only place filter/page state lives" principle (architecture §11, decision A1 in `client/src/filters/state.ts`). No new runtime dependency — CSV is hand-rolled and both formats stream via a Node `Readable` piped through Fastify's `reply.send()`.

## High-Level Structure

```
Browser (Sessions page)
  GlobalActionsBar (client/src/layout/)
    reads useLocation() + useSearch()          [existing wouter hooks]
    "Export CSV"  → <a href="/api/export?format=csv&…"  download> click
    "Export JSON" → <a href="/api/export?format=json&…" download> click
    "Copy permalink" → navigator.clipboard.writeText(window.location.href)

Server
  GET /api/export  (server/routes/export.ts — NEW)
    parseExportQuery(query) → ExportParams | error string
    ExportParams → SessionPopulationFilter (built directly, no intermediate type)
    applyRange(filter, store.listSessions())  [server/metrics/session-population.ts — EXISTING]
      → { matched }
    matched.sort(comparePageSessions)          [server/routes/sessions.ts — EXISTING, newly exported]
    matched.map(projectPageItem)               [server/routes/sessions.ts — EXISTING, newly exported]
      → SessionPageItem[]
    Readable.from(asyncGenerator: write header, then row-by-row)
      → reply.header(content-type, content-disposition).send(stream)
```

**What's added:** one new server route file, one new client component, one new client pure-function helper.
**What's modified:** four symbols in `server/routes/sessions.ts` go from module-private to exported (no behavior change), `server/app.ts` registers the route, `AppShell.tsx` mounts the new component.
**What's NOT touched:** the Sessions page's own list-query path (`SessionBrowser.tsx`, `buildListQuery`), the metrics engine, the Store, ingest pipeline — export reads the same in-memory `Session[]` every other route already reads.

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|---|---|---|---|
| CSV serialization | Hand-rolled RFC4180 writer (no library) | Add `csv-stringify`/similar | Architecture §2 pins dependencies; adding one requires editing that doc first. Row shape is flat and known, escaping rules are ~10 lines. Confirmed with developer. |
| Response streaming | `Readable.from(asyncGenerator)` piped via Fastify's `reply.send()` | Buffer the full string then `reply.send(string)`; use a third-party streaming-CSV lib | Native Node `stream`, zero new deps, matches the architecture's explicit "Streams current view" contract for this route (§9), and Fastify natively accepts a `Readable`. |
| Export trigger (client) | Synthesized `<a href download>` click against the export URL | `fetch()` + `Blob` + `URL.createObjectURL` | The endpoint already sets `Content-Disposition: attachment`; letting the browser drive the download natively avoids buffering the whole response into a client-side Blob (defeats the point of a streaming server response) and needs no extra client code path. |
| Row population source | `applyRange` + `matchSession` (existing `session-population.ts`) applied directly to a `SessionPopulationFilter` built from export query params | Route through `pagePopulationFilter(SessionPageParams)` (existing helper in `sessions.ts`) | Export's param set is a strict subset of `SessionPageParams` (no offset/limit/include/sessionId) with one addition (`format`); constructing `SessionPopulationFilter` directly avoids awkwardly padding an `ExportParams` object into a `SessionPageParams`-shaped structure just to satisfy `pagePopulationFilter`'s signature. |
| Sort/projection reuse | Export `comparePageSessions`, `pageSortValue`, `PAGE_SORT_KEYS`, `projectPageItem` from `sessions.ts` (add `export` keyword only) | Duplicate the sort/projection logic in `export.ts` | These are pure, already-tested functions; duplicating them risks the two projections silently drifting (exactly the failure mode `session-population.ts`'s own module docstring calls out for population semantics). Adding `export` is a zero-risk, zero-behavior-change edit. |
| Query validation | New, self-contained parser in `export.ts` (not shared with `parseSessionsPageQuery`) | Extract a shared validation-helpers module (`parseCommaList`, `parseDateString`, etc.) used by both `sessions.ts` and `export.ts` | Export's parser is ~40 lines of small, single-purpose validators; export's field set differs enough (no offset/limit/view/include/sessionId, plus required-not-optional from/to, plus `format`) that a shared module would mostly be indirection for a handful of near-identical one-liners. Not worth touching the well-tested `sessions.ts` parser to extract it. Revisit if a third route needs the same validators. |

## Patterns & Conventions

- **URL is the single source of truth** (architecture §11, decision A1) — `GlobalActionsBar` derives both the export query and the permalink from `useSearch()`/`window.location.href` directly; no prop drilling of Sessions-page state into the global layer.
- **Section-level population reuse** (`session-population.ts` module docstring) — export is a fourth consumer (after the page table, timeline, and metrics distribution/scatter) of the same `matchSession`/`applyRange` population semantics, so filter behavior can never drift between "what's on screen" and "what's in the export."
- **Fastify route convention from `sessions.ts`** — manual query parsing that returns a typed params object or a human-readable error string (never throws), `reply.code(400)` + `{ error }` on invalid input. `export.ts` follows this exactly.
- **Never fabricate reserved fields** (ARCH A11, seen in `projectPageItem`) — CSV export omits `gateStatus`, `tags`, `contextPctObserved` (unpopulated today); JSON export carries `SessionPageItem` verbatim so those fields are honestly `undefined` rather than dropped, preserving the same disclosure the page UI already uses.

## Data Models

No new persistent entities. The wire shape is the existing `SessionPageItem` (`shared/sessions-contract.ts`), consumed two ways:

- **JSON export:** array of `SessionPageItem` unmodified — full fidelity, round-trips losslessly through `JSON.parse`.
- **CSV export:** a fixed flattening of `SessionPageItem`'s scalar fields (see column list below); `models: string[]` joins with `;`; the nested `tier: TierFlags` object flattens to three boolean columns.

**CSV columns (in order):** `sessionId, project, models, branch, host, entrypoint, version, startedAt, lastAt, durationMs, turnCount, totalTokens, cacheHitPct, costComputed, costObserved, linesAdded, linesRemoved, contextPctEstimated, gateScore, hasDrilldown, tierCostSamples, tierTurnBoundaries, tierCostLog`

## API Contracts / Interfaces

### `GET /api/export`

**Boundary:** HTTP API (Fastify route, `server/routes/export.ts`)

**Query parameters:**

| Param | Required | Values | Notes |
|---|---|---|---|
| `format` | yes | `csv` \| `json` | 400 if missing or invalid |
| `from`, `to` | yes | ISO date strings, `from <= to` | Population needs a bound range — same rule as `pagePopulationFilter` |
| `sort` | no | one of `PAGE_SORT_KEYS` (reused from `sessions.ts`) | default `lastAt` |
| `order` | no | `asc` \| `desc` | default `desc` |
| `project`, `model`, `branch`, `host`, `entrypoint` | no | comma-separated strings | same parsing as `parseSessionsPageQuery` |
| `minCostComputed`, `maxCostComputed` | no | non-negative numbers, `min <= max` | same as page route |
| `hasDrilldown` | no | `true` \| `false` | same as page route |

Deliberately **not accepted**: `offset`, `limit` (export is the whole filtered set), `include` (no timeline concept), `sessionId` (compare-panel selection is orthogonal to the exported population).

**Operations:**

| Method/Op | Path | Purpose | Errors / Returns |
|---|---|---|---|
| GET | `/api/export?format=csv\|json&from=…&to=…&…` | Streams the matched Sessions population as CSV or JSON | `200` + streamed body (`Content-Type` + `Content-Disposition: attachment`) on success; `400 { error }` on invalid/missing params, same convention as every other route |

**Auth requirements:** none — matches every other route in this single-user local tool (architecture has no auth layer).

## Module Boundaries

| Module / Package | Responsibility | Allowed Dependencies |
|---|---|---|
| `server/routes/export.ts` | Query parsing, population lookup via existing helpers, CSV/JSON stream serialization | `server/store/store.ts` (read-only `listSessions()`), `server/metrics/session-population.ts` (`applyRange`), `server/routes/sessions.ts` (newly-exported `comparePageSessions`, `pageSortValue`, `PAGE_SORT_KEYS`, `projectPageItem`), `shared/sessions-contract.ts` |
| `client/src/pages/sessions/state.ts` | Adds `buildExportUrl` alongside existing `buildListQuery`/`buildDistributionQuery`/`buildScatterQuery` | Same as existing (`shared/*-contract.ts`, `client/src/filters/state.ts`) |
| `client/src/layout/GlobalActionsBar.tsx` | Export/permalink UI, mounted globally, self-gates on route | `wouter` (`useLocation`, `useSearch`), `client/src/pages/sessions/state.ts`, `client/src/filters/state.ts` |

## Change Footprint

### New files / modules

| Path | Purpose | Pattern reference |
|---|---|---|
| `server/routes/export.ts` | `GET /api/export` route, param parser, CSV/JSON stream writers | `server/routes/sessions.ts` (parser + route-registration shape) |
| `server/routes/export.test.ts` | Parser validation, CSV escaping/round-trip, JSON round-trip, empty population, header/filename correctness | `server/routes/sessions.test.ts` |
| `client/src/layout/GlobalActionsBar.tsx` | Export CSV/JSON + Copy permalink buttons | `client/src/filters/FilterBar.tsx` (mounted-once global-layer component) |
| `client/src/layout/GlobalActionsBar.stories.tsx` | Storybook coverage | `client/src/filters/FilterBar.stories.tsx` |
| `client/src/layout/GlobalActionsBar.test.tsx` | Route-gating (visible only on `/sessions`), clipboard-copy behavior, href construction | Existing component test files under `client/src/pages/dashboard/*.test.tsx` |

### Modified files / modules

| Path | What changes here |
|---|---|
| `server/routes/sessions.ts` | Add `export` keyword to `projectPageItem`, `comparePageSessions`, `pageSortValue`, `PAGE_SORT_KEYS` — no logic change |
| `server/app.ts` | Register `registerExportRoute(app, store)` alongside the other route registrations |
| `client/src/pages/sessions/state.ts` | Add `buildExportUrl(state, filters, format, now): string` |
| `client/src/pages/sessions/state.test.ts` | Cover `buildExportUrl`'s field mapping (mirrors existing `buildListQuery` test coverage) |
| `client/src/layout/AppShell.tsx` | Mount `<GlobalActionsBar />` next to `<FilterBar />` |

### Deleted / replaced

None.

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|---|---|
| `server/routes/sessions.test.ts` | Exercises the four symbols being exported from `sessions.ts`; must keep passing unchanged since only visibility changes, not behavior |
| `cypress/e2e/sessions.cy.ts`, `cypress/e2e/steel-thread.cy.ts` | Both interact with the Sessions page and global nav chrome; checked — assertions use `cy.contains(...)` on semantic text, not structural selectors, so adding a sibling bar in `AppShell` doesn't break them |

## Areas of Impact

| Area | Impact | Risk (L/M/H) | Why |
|---|---|---|---|
| `server/routes/sessions.ts` public surface | Four previously-private symbols become exported | L | Pure visibility change, functions unchanged, existing tests unaffected |
| `AppShell.tsx` global chrome | New sibling component rendered on every page | L | Purely additive; no existing story/E2E asserts exact DOM structure of the chrome |
| `server/app.ts` route table | One new route registered | L | Additive; no existing route path collides with `/api/export` |
| Sessions population semantics | Export becomes a fourth consumer of `session-population.ts`'s `matchSession`/`applyRange` | L | Read-only reuse of already-shared, already-tested logic — matches the module's own stated design intent |

**Contract changes:** none to existing endpoints. New public contract is `GET /api/export`'s query params and streamed body shape, documented above.

**Cross-cutting ripples:** none — no auth, no telemetry, no migrations, no feature flags, no build/deploy changes. No WS invalidation involvement (export is a one-shot read, not a subscribed view).

## Cross-Cutting Concerns

- **Errors:** same convention as every other route — invalid/missing query params return `400 { error: string }` before any store read; anything unexpected during streaming (e.g., a serialization throw) is caught by the existing top-level `app.setErrorHandler` in `app.ts` for the pre-stream-start case. Once the stream has started (headers already sent), a mid-stream error simply ends the response early — no wire-level "partial success" signal exists for streaming HTTP responses, which is accepted as the honest state of the art here (see Open Questions).
- **Logging & metrics:** no new logging beyond Fastify's default request log line — matches every other route (no route in this codebase does custom access logging).
- **Auth / authz:** none, matching the rest of the app.
- **Performance:** population lookup and sort are O(sessions), identical cost profile to the existing `GET /api/sessions?view=page` route (same functions). Serialization is O(rows × columns) but streamed row-by-row so peak memory is bounded by one row's string, not the whole output.
- **Security:** query params go through the same strict parse-or-reject validation as `parseSessionsPageQuery`; CSV values are escaped per RFC4180 to prevent malformed output (not a formula-injection concern here — there's no formula-capable content in session data, but quoting is still correct-by-construction). `Content-Disposition` filename is a fixed, server-generated string (timestamp + extension), never derived from user input, so no header/path injection surface.
- **Migrations / rollout:** none — stateless read-only route, ships and reverts like any other route addition.

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies REQs |
|---|---|---|---|---|
| A1 | Hand-roll CSV serialization, no new dependency | Add `csv-stringify` or similar | Architecture §2 pins dependencies; row shape is simple enough that hand-rolling is ~10 lines and avoids a doc-edit-first detour | R (acceptance: exported CSV opens correctly) |
| A2 | Stream via `Readable.from(asyncGenerator)` → `reply.send()` | Buffer full string then send | Matches architecture §9's explicit "Streams current view" contract; native Node stream, zero deps | R (architecture §9) |
| A3 | Export button visible only on exact `/sessions` route, hidden elsewhere | Render globally but disabled on other pages | Confirmed with developer — scope matches acceptance criteria (Sessions view only); avoids building dead-end affordances for pages with no tabular "current view" yet | R (acceptance: exports a Sessions view) |
| A4 | Export the full matched population (all filtered rows), not just the visible 25-row page | Export only the current page slice | Confirmed with developer — "export current view" means the full filtered result set for external use, not a screen dump; also matches why the route streams instead of just JSON-serializing a small array | R (acceptance: exported CSV/JSON of a filtered Sessions view) |
| A5 | Build `SessionPopulationFilter` directly from export params rather than routing through `SessionPageParams`/`pagePopulationFilter` | Reuse `pagePopulationFilter` by padding an `ExportParams` into a full `SessionPageParams` shape | Export's param set is a strict subset (no offset/limit/include/sessionId); direct construction avoids an awkward type-shape workaround | — |
| A6 | Export CSV/JSON trigger via synthesized `<a download>` click, not `fetch`+`Blob` | `fetch` the URL, wrap response in a `Blob`, `URL.createObjectURL` | Server already sets `Content-Disposition: attachment`; letting the browser stream the download natively avoids buffering the whole response client-side, which would defeat the point of a streaming server response | R (architecture §9 streaming) |
| A7 | Reuse (export) `comparePageSessions`, `pageSortValue`, `PAGE_SORT_KEYS`, `projectPageItem` from `sessions.ts` rather than duplicating | Reimplement sort/projection logic in `export.ts` | These are pure, already-tested; duplicating risks the export and the page table silently disagreeing on row order/shape over time | — |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|---|---|
| Very large matched population (thousands of sessions) | Population array is O(sessions) in memory (same as every existing route reading `store.listSessions()`); only the CSV/JSON *text* is streamed row-by-row, so response memory stays bounded regardless of population size |
| Client cancels the download mid-stream (navigates away, closes tab) | Standard Node/Fastify behavior: the underlying socket close propagates to the `Readable`, which stops being pumped; the async generator is simply never resumed further and is garbage-collected. No custom handling required |
| Two concurrent export requests with different filters | Fully stateless per-request read of `store.listSessions()` (read-only) — no shared mutable state between requests, identical to how every other route already handles concurrency |
| Store mutates mid-request (ingest updates a session while export is computing) | The matched/sorted array is computed once at the start of the request handler, before streaming begins — the same "snapshot the array reference, then work from it" behavior every existing route already relies on. No new consistency risk introduced |
| Empty matched population (filters exclude everything) | CSV emits header-only output; JSON emits `[]` — both are valid, both round-trip / open correctly, no special-cased error |

### Backward — regression risk per touched area (brownfield only)

| Touched area (from Change Footprint) | What could regress | How we'd know / mitigation |
|---|---|---|
| `server/routes/sessions.ts` (4 symbols made `export`) | None expected — pure visibility change | Existing `sessions.test.ts` suite must pass unchanged; no test asserts module-private-ness |
| `client/src/layout/AppShell.tsx` | New sibling component could shift layout or introduce a layout-breaking element | `cypress/e2e/steel-thread.cy.ts` and `sessions.cy.ts` exercise nav + Sessions page and use semantic `cy.contains`, not structural selectors — re-run both after the change as the regression check |

## Open Questions

- What happens to the HTTP response if serialization throws *after* headers/some rows have already been sent (mid-stream error)?
  - **Impact if unresolved:** the client receives a truncated file with no explicit "export failed" signal — an inherent limitation of streaming HTTP downloads, not specific to this feature.
  - **Suggested default:** accept this as the honest state of the art (same as any streaming download from any web app); do not add complexity (e.g., checksums, trailers) to work around it unless real-world truncation turns out to be a problem post-ship.

## Known Limits (review PR #101)

- **Date-span bound:** `from..to` is capped at 90 days (`MAX_SPAN_MS` in `export.ts`) to keep a single request from forcing an unbounded full-store scan. Filter array params (`project`, `model`, `branch`, `host`, `entrypoint`) are capped at 20 comma-separated values each (`MAX_FILTER_VALUES_PER_KEY`). Both are generous defaults for a local single-user tool, not hard product requirements — revisit if real usage needs a wider range or more values.
- **Full-set memory materialization:** `store.listSessions()` is filtered, sorted, and projected to `SessionPageItem[]` entirely in memory before the response starts streaming (same cost profile as `GET /api/sessions?view=page`). Only the *serialized text* is streamed row-by-row; a very large matched population still holds its full row array in memory first. Acceptable at today's expected data volumes; would need a cursor/paginated population read to remove entirely.

## Out of Scope

- Export support for pages other than Sessions (Dashboard, Models, Projects, etc.) — the pages spec lists "Export current view" as a global-layer capability, but only Sessions has a tabular "current view" today; other pages are chart-composition pages with no equivalent row-level export target yet. Revisit per-page when/if a page defines its own exportable table.
- Any server-side generation of the permalink beyond `window.location.href` (e.g., a shortened URL) — not requested, and the URL-as-state architecture already makes the full URL a valid permalink by construction.

---

# Tasks

_This section is populated by the **generate-tasks** skill (Phase 3)._
_Run: `/generate-tasks from: specs/architecture/ARCH-csv-json-export.md`_
