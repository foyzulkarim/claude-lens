# Architecture: Cypress Setup + Steel-Thread Smoke Spec

> **Date:** 2026-07-16
> **Status:** Final
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Standalone plan-task brief — `specs/context/32.md`; authoritative sources `specs/claude-lens-plan.md` #P3-5 and `specs/claude-lens-architecture.md` §13
> **Type:** infrastructure
> **Consolidates:** former `specs/architecture/ARCH-e2e-smoke.md` draft

## Architecture Summary

This task adds a black-box Cypress harness around the already-built V2 steel thread: a Node/TypeScript runner builds `dist/`, copies the synthetic transcript fixtures into an isolated temporary root, starts `dist/cli.js` on loopback, waits for process and fixture-data readiness through existing public endpoints, and launches Cypress against that URL. The browser spec uses a fixed custom range covering the 2026-07-03 fixtures and exercises the real Dashboard, URL-backed filters, navigation, and ingest → store → WebSocket invalidation → TanStack Query refetch → ECharts render path; filesystem mutation crosses one narrow, path-restricted Cypress Node-task boundary. A small semantic extension to the chart layer makes rendered series state observable through accessible metadata rather than ECharts internals or a test-only production endpoint. CI runs the same local entry point in a separate blocking job on its ephemeral GitHub-hosted runner, so no deployed environment or persistent VM is required.

## Resolved Requirements (Mode B — plan task, no REQ)

| ID  | Inferred Requirement | Source |
|-----|----------------------|--------|
| R1 | A single local command builds and boots the packaged application through `node dist/cli.js --roots <isolated-fixture-root> --no-open --port <test-port>`. | `specs/context/32.md` Scope and Acceptance criteria |
| R2 | The smoke flow proves that the Dashboard renders the cost-over-time chart from the synthetic transcript fixtures. | `specs/context/32.md` Scope |
| R3 | Changing a global filter updates the URL, and the filter query survives navigation to another route. | `specs/context/32.md` Scope; existing #P3-3 behavior |
| R4 | Appending one complete JSONL record causes the mounted chart to change through the real filesystem ingest, store, WS invalidation, query refetch, and render path without reloads, sleeps, or application-level polling hooks. | `specs/context/32.md` Scope and Acceptance criteria |
| R5 | The smoke flow is a blocking CI check and runs against built `dist/`, not the Vite development server. | `specs/context/32.md` Summary and Acceptance criteria |
| R6 | Each run mutates only a unique temporary copy of `test/fixtures/`; canonical fixtures remain immutable and concurrent data state cannot leak between runs. | Confirmed architecture session, 2026-07-16 |
| R7 | The harness owns server/browser lifecycle, reports child-process failures, and cleans up the server and temporary root on success, failure, or ordinary interruption. | Confirmed architecture session, 2026-07-16 |
| R8 | No production ingest, API, WebSocket, query, filter, navigation, or legacy contract is changed to make the E2E flow pass. | CLAUDE.md boundaries; confirmed architecture session |
| R9 | Chart change is asserted through user-relevant accessible metadata, not private ECharts state, pixel comparison, or a test-only server endpoint. | Confirmed architecture session, 2026-07-16 |
| R10 | CI uses the same `npm run test:e2e` entry point as local development and supplies its URL from a server started inside the GitHub Actions runner. | Confirmed architecture session, 2026-07-16 |
| R11 | Fixture-backed assertions use an explicit custom range covering 2026-07-03, so the smoke remains deterministic regardless of the wall-clock date. | Consolidated prior draft; `test/fixtures/README.md` |

## High-Level Structure

```text
npm run test:e2e
        |
        +--> npm run build ------------------------------> dist/cli.js + dist/public/
        |
        '--> scripts/e2e.ts
               |
               +--> mkdtemp + copy test/fixtures/ ------> isolated scan root
               |
               +--> claim configured loopback port (default 4200)
               |
               +--> spawn node dist/cli.js
               |       --roots <isolated-root>
               |       --no-open
               |       --port <test-port>
               |
               +--> wait for GET /api/ping and verify bound port
               +--> poll POST /api/metrics until fixture series is non-empty
               |
               '--> spawn Cypress (baseUrl = http://127.0.0.1:<test-port>)
                       |
                       +--> browser: Dashboard at fixed custom range
                       |       / filters / navigation
                       |
                       +--> cy.task("appendJsonl", ...)
                       |       '--> append complete line under isolated root
                       |
                       '--> filesystem poller -> tailer -> parser -> store
                               -> invalidation -> /ws -> query refetch
                               -> ChartCard accessible summary + ECharts update

finally: stop children -> preserve diagnostics -> remove isolated root
```

The test harness is new and stays outside the production module graph. The built CLI, readiness route, client application, and live-update pipeline are existing black-box contracts. Only the chart presentation boundary gains optional accessible metadata derived from data it already owns.

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|------|----------|-------------------------|-----------|
| E2E framework | Cypress as a dev dependency | Playwright; browserless API integration test | Required by #P3-5 and reused by #P4-18; its retryable assertions and Node task boundary fit the browser + filesystem flow. |
| Lifecycle orchestration | Custom Node/TypeScript runner at `scripts/e2e.ts` | `start-server-and-test`; shell background process; Cypress config lifecycle hooks | Gives one owner for build, temp data, port, readiness, child exit, signals, and cleanup without another orchestration dependency or shell-specific behavior. |
| Application under test | Built `dist/cli.js` and `dist/public/` | Vite dev server; importing `buildApp` directly | Exercises the shipped assembly and CLI contract required by the issue rather than a development-only topology. |
| Fixture storage | Unique OS-temporary copy of `test/fixtures/` per run | Mutate tracked fixtures and restore; generate all data in the spec | Protects fixture integrity and makes failed or overlapping runs data-isolated. |
| Test port | Fixed default loopback port with `CLAUDE_LENS_E2E_PORT` override, preflight ownership check, and bound-port verification | Fully dynamic port; rely on CLI auto-increment | Keeps Cypress configuration deterministic while preventing the CLI from silently moving the test server to a URL Cypress is not using. |
| Filesystem mutation | Path-restricted Cypress Node task | Test-only HTTP endpoint; browser filesystem access; direct production-module import | Keeps privileged I/O outside the browser and adds no production surface. |
| Readiness and synchronization | Existing `GET /api/ping` for process boot, bounded `POST /api/metrics` probe for cold fixture ingest, and Cypress retryability for post-mutation UI convergence | Fixed sleeps; test-only readiness endpoint; live-update polling hook | Separates legitimate setup readiness from the behavior under test and avoids timing hacks in the live-update assertion. |
| Chart observability | Optional accessible chart summary derived by `ChartCard` and passed to `Chart` | `data-cy` revision; ECharts instance exposure; canvas pixel diff; API response only | Observes rendered application state through a user-relevant semantic contract and remains stable across ECharts internals. |
| Time determinism | Visit with `from=2026-07-01T00:00:00.000Z&to=2026-08-01T00:00:00.000Z`; append within that range | Default `7d`; preset relative to today; runtime-generated dates | The tracked fixtures are fixed at 2026-07-03, so a relative range would eventually render an empty chart. |
| Cypress source quality | Add `cypress/tsconfig.json`, include `cypress/**` in Biome, and include the Cypress project in `typecheck`; set `supportFile: false` until shared support exists | Transpile only during Cypress run; generated support scaffold | Keeps test/config code under normal static gates without adding an unused scaffold or running the browser suite in `verify`. |
| CI browser | Cypress bundled Electron | System Chrome matrix; headed browser | Lowest setup surface for the single blocking steel-thread flow; browser matrices are outside this task. |
| CI topology | Separate blocking `e2e` job invoking `npm run test:e2e` | Add E2E to `npm run verify`; deployed preview environment; Cypress GitHub Action orchestration | Uses the GitHub-hosted runner itself as the machine and leaves the fast pre-push verification contract unchanged. |
| Failure evidence | Forward runner/server/Cypress logs and upload failure screenshots | Video on every run; no artifacts | Provides actionable evidence with bounded storage and runtime cost. |

## Patterns & Conventions

- **Black-box packaged-app testing** — the runner spawns `dist/cli.js` and uses HTTP/WS/browser boundaries; it never imports server internals.
- **Single lifecycle owner** — `scripts/e2e.ts` owns every acquired resource and releases them in reverse order from a single cleanup path.
- **Copy-on-run test data** — tracked synthetic fixtures are inputs, never mutable run state.
- **Least-privilege test bridge** — the Cypress task accepts one append operation and validates containment under the run root.
- **Semantic observability** — chart state is exposed as accessible presentation metadata rather than a test-only implementation hook.
- **Retry at the assertion boundary** — Cypress retries observable UI state; the application is not modified to poll or signal the test.
- **Deterministic date window** — the initial visit, readiness query, and appended record all use the fixed `[2026-07-01, 2026-08-01)` UTC range that contains the canonical 2026-07-03 fixtures.
- **Existing one-package, one-port topology** — Fastify serves SPA, API, and WS on the same loopback origin exactly as described in CLAUDE.md.
- **Existing delivery gates remain stable** — `npm run verify` and the Husky pre-push hook remain unchanged; E2E is an explicit local command and separate CI job.
- **ESM and strict TypeScript conventions** — new TypeScript follows the repository's Node 22, `type: module`, Biome, and existing `scripts/` conventions; Cypress source is statically checked by the existing `typecheck`, lint, and format commands.

## Data Models

### E2eRunContext

**Purpose:** Represents the transient resources and configuration owned by one harness invocation. It is process-local and is never persisted.

**Key fields:**
| Field | Type / Constraint | Notes |
|-------|-------------------|-------|
| `sourceFixtureRoot` | repository-relative path; read-only | Always resolves to canonical `test/fixtures/`. |
| `runFixtureRoot` | absolute path under the OS temp directory; unique | The only root the built CLI and append task may mutate/read for this run. |
| `requestedPort` | integer 1–65535 | Defaults to `4200` and may be overridden by `CLAUDE_LENS_E2E_PORT`. |
| `baseUrl` | loopback HTTP URL | Must contain the verified requested port. |
| `serverProcess` | child-process handle; optional until spawned | Its unexpected exit fails the run. |
| `cypressProcess` | child-process handle; optional until spawned | Its exit code becomes the E2E result after cleanup. |
| `state` | `preparing | starting | ready | running | cleaning | complete` | Prevents double cleanup and makes interruption handling idempotent. |

**Relationships:**
- `E2eRunContext` owns exactly one temporary fixture root and at most one server and one Cypress child process.
- `AppendJsonlRequest` is valid only while its owning run is in `running` state.

**Lifecycle:**
- Created when `scripts/e2e.ts` starts → resources acquired through `preparing/starting` → Cypress executes in `running` → all exit paths enter `cleaning` → temp data is deleted and children are stopped before `complete`.

### AppendJsonlRequest

**Purpose:** Carries the single privileged mutation requested by the browser spec to the Cypress Node process.

**Key fields:**
| Field | Type / Constraint | Notes |
|-------|-------------------|-------|
| `relativePath` | non-empty relative POSIX-style path; no `..`; resolves under run root | Identifies a copied transcript file without exposing arbitrary filesystem access. |
| `line` | string containing one valid complete JSON object; no embedded newline | The task adds exactly one trailing newline before appending. |

**Relationships:**
- Resolves against one `E2eRunContext.runFixtureRoot`.
- Targets a copied transcript whose canonical source remains unchanged.

**Lifecycle:**
- Constructed in the browser spec → validated and appended once by the Cypress Node task → discarded; never stored.

## API Contracts / Interfaces

### E2E command

**Boundary:** npm script / developer and CI interface

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|-----------|------------------|---------|------------------|
| Run | `npm run test:e2e` | Build the package, create an isolated run, boot the app, run Cypress, and clean up. | Exit `0` only when build, readiness, Cypress, and cleanup-critical operations succeed; otherwise non-zero with forwarded diagnostics. |
| Port override | `CLAUDE_LENS_E2E_PORT=<port> npm run test:e2e` | Select a non-default loopback port. | Invalid or occupied ports fail before Cypress starts. |

**Auth requirements:** Local developer or CI process access only; no application authentication contract is introduced.

### E2E runner

**Boundary:** internal module / child-process orchestrator

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|-----------|------------------|---------|------------------|
| Run lifecycle | `runE2e(): Promise<void>` | Acquire resources, start the built app, launch Cypress, and always clean up. | Rejects on setup, readiness, unexpected child exit, Cypress failure, or cleanup failure that leaves a child alive. |
| Readiness | `GET http://127.0.0.1:<port>/api/ping` | Confirm the same-origin Fastify application is serving before Cypress starts. | Bounded retry during boot only; timeout includes captured server output. |
| Fixture readiness | `POST http://127.0.0.1:<port>/api/metrics` with the fixed range and `costComputed` daily series query | Confirm cold-boot discovery/tailing has populated the public metrics surface before the browser flow begins. | Bounded runner-side retry until the response contains at least one non-null point; this is setup synchronization, not the live-update oracle. |
| Shutdown | signal/`finally` cleanup | Stop Cypress if needed, then CLI, then delete run root. | Idempotent; ordinary `SIGINT`/`SIGTERM` produces a non-zero interrupted result after cleanup. |

**Auth requirements:** Loopback process boundary only.

### Cypress Node task

**Boundary:** Cypress browser-to-Node internal test interface

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|-----------|------------------|---------|------------------|
| Append | `appendJsonl(request: AppendJsonlRequest): null` | Append one complete JSONL record to a copied transcript. | Returns `null` on success; rejects invalid paths, invalid line shape, missing targets, and write failures. |

**Auth requirements:** Available only inside the E2E Cypress process; containment is enforced against the runner-supplied temporary root.

### Chart semantic presentation

**Boundary:** internal React component API / accessibility contract

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|-----------|------------------|---------|------------------|
| Describe chart | `ChartProps.ariaLabel?: string` | Apply `role="img"` and a user-relevant semantic description to the ECharts container. | Optional so existing callers remain source-compatible; `role` is present only with a label. |
| Derive summary | `ChartCard` derives `"<title> chart; <n> series; total <formatted-total>"` from the same loaded series used to build the option | Make initial and updated rendered data observable without ECharts internals. | Pending/error states keep their existing visible messages; loaded state supplies the semantic label. Null points are excluded and all finite point values are summed using the active unit formatter. |

**Auth requirements:** None; client presentation only.

### Existing production contracts under test

**Boundary:** existing CLI, HTTP, WebSocket, and client-query interfaces

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|-----------|------------------|---------|------------------|
| Launch | `node dist/cli.js --roots <run-root> --no-open --port <port>` | Start the packaged app over copied fixtures. | Existing CLI behavior; harness rejects a bound port different from the request. |
| Readiness | `GET /api/ping` | Confirm app availability. | Existing response contract, unchanged. |
| Metrics | `POST /api/metrics` | Supply chart series before and after invalidation. | Existing metrics contract, unchanged. |
| Invalidation | `GET /ws` upgrade and `session-updated` message | Mark metrics queries stale after the append. | Existing invalidation-only protocol, unchanged. |

**Auth requirements:** Existing loopback-origin policy remains unchanged.

### Browser smoke flow

**Boundary:** Cypress browser specification / user-visible behavior

| Step | Action | Required assertion |
|------|--------|--------------------|
| Initial render | Visit `/?from=2026-07-01T00%3A00%3A00.000Z&to=2026-08-01T00%3A00%3A00.000Z`. | The `Cost over time` heading and labeled chart image render; capture its initial formatted total. A metrics response alone is insufficient. |
| URL sync | Select the `30D` range preset through the visible filter control. | The URL contains `range=30d` and no stale custom `from`/`to` pair. |
| Navigation persistence | Use an existing sidebar link to navigate to another route. | The pathname changes and `range=30d` remains in the destination URL. |
| Restore fixture range | Navigate back to Dashboard using the same visible controls, then restore the fixed custom range. | The labeled cost chart again reports the fixture-backed initial total. |
| Live update | Call `cy.task("appendJsonl", ...)` once with a fresh `message.id`, an in-range timestamp, and usage large enough to change the formatted USD total. | Without reload, direct refetch, fixed sleep, or API-response-only assertion, the same labeled chart's formatted total eventually becomes greater than the captured total. |

Network interception may label requests for diagnostics, but pass/fail is determined by browser-visible URL and semantic chart state.

## Module Boundaries

| Module / Package | Responsibility | Allowed Dependencies |
|------------------|----------------|----------------------|
| `scripts/e2e.ts` | Run-level orchestration, temp-copy lifecycle, port/readiness checks, child processes, cleanup, diagnostics | Node standard library and spawned package binaries; must not import `server/` or `client/` source modules. |
| `cypress.config.ts` | Cypress E2E configuration, base URL/run-root intake, and the restricted append task | Cypress config API and Node filesystem/path APIs; must not import production server modules. |
| `cypress/e2e/steel-thread.cy.ts` | Browser-visible steel-thread flow and retryable assertions | Cypress browser API and the named Node task; no direct filesystem access, production-module imports, or test-only HTTP calls. |
| `cypress/tsconfig.json` | Isolated strict typechecking for Cypress config/spec globals | Extends `tsconfig.base.json`; includes `../cypress.config.ts` and `**/*.ts`; no production project references. |
| `client/src/charts/ChartCard.tsx` | Derive accessible chart summary from the same loaded series used to build the option | Existing API/query/filter/chart modules; no Cypress imports or test-environment branching. |
| `client/src/charts/Chart.tsx` | Apply optional accessible metadata while retaining dumb ECharts lifecycle ownership | React and ECharts only; no API, filter, server, or Cypress dependencies. |
| Existing server/client pipeline | Production behavior exercised as a black box | Unchanged dependency directions from CLAUDE.md. |

## Change Footprint

_The concrete answer to "where does this land in the codebase?" — produced during the Phase D2 walk._

### New files / modules

| Path | Purpose | Pattern reference |
|------|---------|-------------------|
| `scripts/e2e.ts` | Cross-platform lifecycle runner for build output, temp fixtures, port/readiness, server/Cypress children, signals, and cleanup. | `scripts/build.ts` for repository-level TypeScript orchestration; `server/cli.ts` for process behavior. |
| `cypress.config.ts` | Cypress E2E configuration plus the contained `appendJsonl` Node task. | Cypress configuration conventions; repository ESM/TypeScript style. |
| `cypress/e2e/steel-thread.cy.ts` | Single Phase 3 browser smoke flow over render, URL/navigation persistence, and live update. | Existing accessible names in `FilterBar.tsx`, `AppShell.tsx`, and `ChartCard.tsx`. |
| `cypress/tsconfig.json` | Strict Cypress project configuration covering the root config and E2E spec. | `server/tsconfig.json` and `client/tsconfig.json`. |

### Modified files / modules

| Path | What changes here |
|------|-------------------|
| `package.json` | Add Cypress dev dependency and `test:e2e` entry point; extend `typecheck` to the Cypress project while leaving the `verify` command sequence unchanged. |
| `package-lock.json` | Lock Cypress and its transitive development dependencies. |
| `.github/workflows/ci.yml` | Add a separate blocking Ubuntu E2E job that checks out, sets up Node, installs, and runs `npm run test:e2e`; upload screenshots on failure. |
| `.gitignore` | Ignore local Cypress screenshots and any other configured run artifacts. |
| `biome.json` | Add `cypress/**` to the existing include allowlist; the root `cypress.config.ts` remains covered by `*.ts`. |
| `client/src/charts/Chart.tsx` | Accept and apply an optional accessible chart label without changing ECharts lifecycle behavior. |
| `client/src/charts/ChartCard.tsx` | Derive the loaded chart's semantic summary from its title and series and pass it to `Chart`. |

### Deleted / replaced

| Path | Reason |
|------|--------|
| _None_ | The design is additive and replaces no production or test module. |

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|------|----------------|
| `scripts/build.ts` | `test:e2e` relies on it to assemble the exact `dist/` layout; the harness must not duplicate its build logic. |
| `server/cli.ts` | Supplies the exact flags, loopback binding, logged URL, live ingest assembly, and shutdown behavior the runner depends on. |
| `server/app.ts` | Owns static SPA serving, `/api/ping`, metrics registration, and `/ws` on the single origin. |
| `server/ingest/pipeline.ts` | Must discover and tail the appended line without an E2E-only shortcut. |
| `server/store/store.ts` and `server/store/invalidation.ts` | Convert the parsed append into the debounced session invalidation that drives the live path. |
| `server/ws/broadcaster.ts` | Fans the existing invalidation event to the connected browser. |
| `client/src/main.tsx` and `client/src/ws.ts` | Establish the socket and map `session-updated` to query invalidation; reconnect still invalidates all queries. |
| `client/src/api/queryKeys.ts` and `client/src/api/metrics.ts` | The chart query key must remain under the metrics prefix and refetch the existing endpoint. |
| `client/src/filters/FilterBar.tsx`, `client/src/filters/useFilters.ts`, and `client/src/filters/state.ts` | Visible filter controls must continue serializing global state into the URL. |
| `client/src/layout/AppShell.tsx` and `client/src/routes.ts` | Navigation must preserve the current query string across routes. |
| `client/src/pages/Dashboard.tsx` | Continues mounting exactly one `ChartCard` and is the browser entry surface. |
| `test/fixtures/README.md` and `test/fixtures/projects/**/*.jsonl` | Define the canonical synthetic input and file layout; copied for the run but never edited in place. |
| `client/src/charts/Chart.test.tsx`, `client/src/charts/ChartCard.test.tsx`, and stories | Existing callers must remain compatible with the optional semantic prop and keep passing under `npm run verify`/Storybook. |

## Areas of Impact

_Broader-than-files impact — modules, services, teams, contracts, cross-cutting effects._

| Area | Impact | Risk (L/M/H) | Why |
|------|--------|--------------|-----|
| E2E process harness | New owner for build-server-browser lifecycle and cleanup | M | Child exits, signals, port races, and temp cleanup must converge on one deterministic result. |
| Full live-update steel thread | Existing filesystem-to-render path becomes a blocking regression gate | H | Multiple asynchronous boundaries and debounce/poll intervals can expose real regressions or timing-sensitive test design. |
| Canonical fixture corpus | Becomes the source copied into E2E run roots | L | Copy-on-run prevents mutation and cross-run data leakage. |
| Client chart semantics | Adds optional accessible description derived from loaded data | L | Presentation-only and source-compatible, but existing chart tests/stories are regression hotspots. |
| CI | Adds Cypress installation, build, Electron execution, and failure artifacts | M | Increases CI duration and introduces browser/runtime failure modes that block merges. |
| Local developer workflow | Adds explicit `npm run test:e2e` command and optional port override | L | Browser execution remains outside `npm run verify`; Cypress source still participates in its static checks. |
| Future Phase 4 E2E work | #P4-18 can reuse the runner, config, isolated roots, and mutation boundary | M | Reuse is intentional, but this task must not pre-build future journeys or page assertions. |
| Production runtime | No transport, API, ingest, storage, auth, or startup behavior changes | L | The packaged app is consumed as a black box; only semantic chart metadata shifts. |

**Contract changes:** No external/public application API, CLI flag, WebSocket payload, metrics shape, or stored-data contract changes. Internal additions are `ChartProps.ariaLabel?` plus its conditional `role="img"`, the test-only `appendJsonl` Cypress task, `CLAUDE_LENS_E2E_PORT`, and the developer-facing `npm run test:e2e` command.

**Cross-cutting ripples:** CI gains a blocking browser job and failure-artifact upload; package installation gains Cypress; local run output gains E2E diagnostics. There are no auth, telemetry, database, migration, feature-flag, deployment, or public-hosting changes.

## Cross-Cutting Concerns

- **Errors:** The runner treats build failure, invalid/occupied port, readiness timeout, unexpected CLI exit, Cypress non-zero exit, invalid append request, and cleanup failure as non-zero outcomes. Server and Cypress output is forwarded and retained in the failing job; cleanup runs from `finally` and signal handlers.
- **Logging & metrics:** Runner messages use a stable `[e2e]` prefix and identify lifecycle phase, requested URL, and child exit without printing fixture contents. Existing Fastify/Cypress logs pass through. CI uploads failure screenshots; no production metrics or telemetry are added.
- **Auth / authz:** No application auth surface changes. The app remains loopback-only with its existing WebSocket origin policy. The append task is available only in Cypress's Node process and enforces run-root containment.
- **Performance:** The Phase 3 suite remains one serial smoke flow over the small synthetic tree. Readiness uses bounded `/api/ping` and fixture-series checks; live-update convergence uses Cypress's normal retry window sized above the existing filesystem-poll and invalidation-debounce budget. No cache or production interval is altered for tests.
- **Security:** All data is synthetic. User input to the privileged task is validated against absolute paths, traversal, embedded newlines, invalid JSON, and containment after resolution. The runner does not expose a public port, test endpoint, secret, or arbitrary command interface.
- **Migrations / rollout:** Additive dev/CI infrastructure only. The E2E job becomes blocking when merged and needs no deployed environment. Rollback removes the job, harness/config/spec, dependency, npm script, and optional chart semantic prop; there is no persisted state to migrate or restore.

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies REQs |
|---|----------|--------------|----------------|----------------|
| A1 | Use a custom Node/TypeScript runner as the sole lifecycle owner. | `start-server-and-test`; shell backgrounding; Cypress lifecycle hooks | Handles temp data, exact URL, multiple children, signals, diagnostics, and cleanup in one cross-platform module without an extra orchestrator. | R1, R6, R7, R10 |
| A2 | Build and spawn `dist/cli.js` as a black box. | Vite dev server; import `buildApp` | The issue explicitly gates the shipped assembly and forbids a development topology from substituting for it. | R1, R2, R5, R8 |
| A3 | Copy `test/fixtures/` into a unique OS-temp root for every run. | Edit-and-restore tracked data; browser-generated corpus | Preserves canonical fixtures and isolates failure/concurrency state. | R4, R6 |
| A4 | Use a fixed default port with `CLAUDE_LENS_E2E_PORT` override, preflight, and bound-port verification. | Dynamic port; accept CLI auto-increment | Gives Cypress a deterministic URL and fails clearly instead of testing the wrong process. | R1, R7, R10 |
| A5 | Append through one path-restricted Cypress Node task. | Production test endpoint; private module import; browser filesystem | Exercises the real ingest boundary without widening production capabilities. | R4, R6, R8 |
| A6 | Expose chart change through accessible semantic metadata. | Test attribute; ECharts instance; pixel diff; API-only assertion | Verifies rendered application state through a stable, user-relevant contract. | R2, R4, R9 |
| A7 | Run bundled Electron in a separate blocking CI job and upload screenshots only on failure. | Browser matrix; deployed preview; fold into `verify`; always-on video | Needs no external VM, keeps pre-push fast, and supplies useful diagnostics at modest cost. | R5, R7, R10 |
| A8 | Synchronize boot with `/api/ping` and behavior with retryable UI assertions; add no sleeps or polling hooks. | Fixed waits; application test signals; manual refetch | Matches real asynchronous behavior while avoiding timing hacks and production drift. | R4, R7, R8 |
| A9 | Pin the fixture range, wait for cold-boot data through the existing metrics API, and assert live change through the chart's semantic label. | Relative presets; fixed startup sleep; API interception as pass/fail oracle | Removes wall-clock and cold-ingest races while keeping the live-update proof at the rendered UI boundary. | R2, R4, R9, R11 |
| A10 | Typecheck and format/lint Cypress source, but keep browser execution out of `verify`. | Transpile-only Cypress source; add browser execution to pre-push | Applies normal source-quality gates without adding build/browser latency to every push. | R5, R8 |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|----------|---------------------------|
| Build fails or produces no runnable `dist/cli.js` | `npm run test:e2e` stops before acquiring browser state and returns the build's non-zero exit. |
| Configured port is already occupied | Preflight fails with the requested port before the CLI starts; the developer may stop the owner or set `CLAUDE_LENS_E2E_PORT`. |
| Another process claims the port after preflight and the CLI auto-increments | The runner verifies the actual bound/logged URL matches the request; mismatch stops the CLI and fails rather than launching Cypress against the wrong URL. |
| CLI never becomes ready or exits during boot | Bounded `/api/ping` readiness races the child exit; failure includes captured output and triggers cleanup. |
| `/api/ping` succeeds before cold-boot ingest settles | The runner's bounded fixed-range metrics probe waits for at least one non-null fixture point before Cypress starts; no fixed settle sleep is used. |
| CLI dies while Cypress is running | The runner observes the unexpected exit, terminates Cypress, preserves both outputs, and fails the run. |
| Cypress fails or is interrupted | Its exit code is preserved; the CLI is terminated and the temporary root removed in the common cleanup path. |
| Two developers start the default-port run simultaneously | Each has an isolated root; the second fails the port check before mutation. An explicit override allows intentional parallel runs. |
| Append request attempts traversal or an absolute path | The Cypress Node task rejects before filesystem access after normalized containment validation. |
| Append payload is partial, multi-line, or malformed | The task requires one complete JSON object with no embedded newline and appends exactly one terminator. |
| WS is briefly disconnected when the file changes | Existing client reconnect invalidates all queries; the retryable semantic UI assertion still observes convergence without manual reload/refetch. |
| Ingest/debounce is slower on CI for several seconds | The assertion timeout covers the documented polling/debounce envelope; no production interval is shortened and no fixed sleep guesses at timing. |
| The test runs months or years after the fixture timestamps | The initial/readiness queries and appended record remain inside the fixed July 2026 range; wall-clock presets are used only for the URL-persistence step. |
| GitHub runner lacks a user-managed server or public URL | The job's ephemeral `ubuntu-latest` machine starts the built CLI locally and passes its loopback URL to Cypress; no external infrastructure is involved. |
| Cypress install or Electron launch fails | The blocking job fails during install/start with native logs; no application process is left running after job teardown. |
| Future #P4-18 grows the suite | The lifecycle/config/root contracts are reusable; flows remain serial initially, and future parallel jobs must use unique ports and already-unique roots. |
| The E2E gate must be rolled back | Remove additive test/CI files and optional chart semantics; no migration, protocol rollback, or data restoration is required. |

### Backward — regression risk per touched area (brownfield only)

| Touched area (from Change Footprint) | What could regress | How we'd know / mitigation |
|--------------------------------------|--------------------|----------------------------|
| `package.json` / lockfile / `biome.json` | Existing install, build, `verify`, or pre-push behavior changes unintentionally | `verify` sequence is unchanged; Cypress source joins static checks, while browser execution remains separate. Existing CI and pre-push gates remain green. |
| `.github/workflows/ci.yml` | Existing checks become non-blocking, duplicated incorrectly, or starved by the new job | New E2E job is separate; current typecheck/lint/format/test/Storybook sequence remains intact. |
| `Chart.tsx` / `ChartCard.tsx` | Chart lifecycle, query stability, stories, or existing render states break | Semantic prop is optional and presentation-only; the existing test suite, typecheck, lint, format, and Storybook continue to gate. |
| `server/cli.ts` / `server/app.ts` | Harness relies on a false assumption about flags, port, readiness, or shutdown | Runner uses the documented CLI and `/api/ping` contracts and verifies the bound URL before Cypress starts. |
| Ingest/store/invalidation/broadcaster | Existing live update stops or emits the wrong invalidation | The smoke flow fails at the semantic chart assertion after a real append, with server/browser logs preserved. |
| `client/src/ws.ts` / query keys | Message no longer invalidates the mounted metrics query | The post-append chart summary never converges, making this silent unit-level integration regression visible. |
| Filter and navigation modules | Query parameters are dropped, reordered incorrectly, or fail to drive the chart query | Browser-visible URL and destination state are exercised through existing controls and links. |
| Canonical `test/fixtures/` | A failed run corrupts or leaves appended data in tracked files | Only the copied temp root is passed to CLI/task; source fixtures are read-only inputs. |
| `scripts/build.ts` / `dist/` layout | E2E accidentally exercises stale or development output | `test:e2e` builds first and starts only the resulting `dist/cli.js`. |

## Open Questions

- None — all ten architecture decisions are resolved and the consolidated document is final as of 2026-07-16.

## Out of Scope

- Cross-page Cypress journeys planned for #P4-18 (reason: this task establishes the reusable harness and one Phase 3 smoke flow only).
- Full Dashboard section coverage or Phase 4 page acceptance flows (reason: those pages have their own ordered plan tasks).
- A deployed preview environment, persistent VM, container service, or public test URL (reason: the built app and Cypress run together on loopback locally and in the GitHub-hosted runner).
- Production test endpoints, ingest shortcuts, reduced poll/debounce intervals, or special WS messages (reason: the regression value comes from exercising unchanged production behavior).
- Adding E2E to `npm run verify` or the Husky pre-push hook (reason: explicitly kept as a separate local command and blocking CI job).
- Chrome/Firefox browser matrices, visual pixel baselines, and always-on video recording (reason: not required for the single steel-thread gate).
- Any extension or refactor of `legacy/` (reason: V1 is maintenance-only and unrelated to #P3-5).

---

# Tasks

## Task T1: Add Accessible Chart-Series Summaries

> **Status:** not started
> **Date:** 2026-07-16
> **Verification:** tdd
> **Effort:** s
> **Priority:** high
> **Depends on:** None
> **Satisfies REQs:** R2, R4, R8, R9
> **Footprint slice:** Modified: `client/src/charts/Chart.tsx`, `client/src/charts/ChartCard.tsx`; regression tests in their existing colocated test files
> **High-risk areas touched:** None — Client chart semantics is rated L

### Description

Add the optional semantic chart contract that lets the smoke flow verify rendered data without inspecting ECharts internals. `ChartCard` derives the specified title, series count, and formatted total from its loaded series, while `Chart` applies that description as accessible image metadata without changing its existing lifecycle.

### Test Plan

#### Test File(s)

- `client/src/charts/Chart.test.tsx`
- `client/src/charts/ChartCard.test.tsx`

#### Test Scenarios

##### Chart Accessibility Contract

- **applies semantic image metadata when labeled** — GIVEN a `Chart` with an `ariaLabel` WHEN it renders THEN its container has `role="img"` and the supplied accessible name _(verifies R9)_
- **keeps unlabeled callers source-compatible** — GIVEN a `Chart` without an `ariaLabel` WHEN it renders THEN it adds neither an invented image role nor an accessible label _(guards ARCH backward-regression risk for existing Chart callers and stories)_

##### Chart Summary Derivation

- **derives the loaded chart summary** — GIVEN loaded series with finite and null points WHEN `ChartCard` renders THEN it passes `"<title> chart; <n> series; total <formatted-total>"` using the active unit formatter and excludes null values _(verifies R2, R9)_
- **excludes non-finite values from totals** — GIVEN loaded series containing a non-finite numeric value WHEN the summary is derived THEN only finite point values contribute to the formatted total _(verifies R9; covers ARCH semantic-presentation contract)_
- **updates the summary when series data changes** — GIVEN a mounted loaded chart WHEN its query data changes THEN the accessible total changes without remounting or exposing the ECharts instance _(verifies R4, R9)_

##### Regression Guard

- **preserves existing chart behavior** — GIVEN the optional semantic prop WHEN the complete existing chart test suite runs THEN ECharts init/update/resize/dispose, click handling, controls, query stability, loading/error states, and unchanged stories remain compatible _(verifies R8; guards ARCH backward-regression risk for `Chart.tsx`, `ChartCard.tsx`, their tests, and stories)_

### Implementation Notes

- **Module(s):** `client/src/charts/Chart.tsx` owns dumb ECharts lifecycle and optional DOM metadata; `client/src/charts/ChartCard.tsx` owns loaded-series summary derivation.
- **Pattern reference:** Extend the existing optional `onPointClick`/`className` prop pattern in `Chart.tsx`; use `formatUnitValue` from `client/src/charts/units.ts` and the current `useMemo` style in `ChartCard.tsx`.
- **Key decisions:** A6 requires accessible semantic metadata rather than test attributes, ECharts instance access, pixel comparison, or an API-only assertion.
- **Libraries:** React, ECharts, TanStack Query, Testing Library, Vitest.
- **High-risk callouts:** None rated M/H; the regression scenario explicitly preserves the chart lifecycle and smart/dumb component boundary.

### Scope Boundaries

- Do NOT expose ECharts instances, add `data-cy` revision hooks, or add visual/pixel baselines.
- Do NOT change metrics queries, filter state, WebSocket behavior, chart styling, or production API contracts.
- Only implement the optional accessible label and loaded-series summary required by the ARCH semantic-presentation contract.

### Files Expected

_Anchored on ARCH's Change Footprint — every entry below maps to its chart-semantics rows._

**New files:**

- _None._

**Modified files:**

- `client/src/charts/Chart.tsx` (accept and apply optional accessible image metadata without changing ECharts lifecycle behavior)
- `client/src/charts/ChartCard.tsx` (derive the loaded chart's semantic summary and pass it to `Chart`)
- `client/src/charts/Chart.test.tsx` (cover the optional accessibility contract and retain lifecycle regression guards)
- `client/src/charts/ChartCard.test.tsx` (cover summary calculation, formatting, and data-change behavior)

**Must NOT modify:**

- `client/src/charts/Chart.stories.tsx` and `client/src/charts/ChartCard.stories.tsx` (existing callers must remain compatible)
- `client/src/api/**`, `client/src/filters/**`, and `server/**` (production contracts and live-update wiring are unchanged)

### TDD Sequence

1. Add failing `Chart` accessibility-contract tests, then make the optional prop pass without disturbing lifecycle tests.
2. Add failing `ChartCard` summary and update tests, then implement derivation through the existing unit formatter.
3. Run the complete chart tests and repository static gates as regression evidence.

---

## Task T2: Establish the Cypress Foundation

> **Status:** not started
> **Date:** 2026-07-16
> **Verification:** checklist
> **Effort:** m
> **Priority:** high
> **Depends on:** T1
> **Satisfies REQs:** R5, R6, R8, R9
> **Footprint slice:** New: `cypress.config.ts`, `cypress/tsconfig.json`; Modified: `package.json`, `package-lock.json`
> **High-risk areas touched:** E2E process harness (M)

### Description

Install Cypress and establish the strict TypeScript project plus the least-privilege browser-to-Node mutation boundary. This task delivers configuration only; the packaged-app runner and browser smoke flow land in T3.

### Verification Checklist

- **Install and verify Cypress with `npm ci` followed by `npm exec cypress verify`** — expected: Cypress and its transitive development dependencies install from the lockfile, the binary is executable, and production dependencies are unchanged.
- **Inspect the Cypress configuration** — expected: E2E mode consumes the runner-supplied base URL and temporary root, `supportFile` is disabled, and only the named `appendJsonl` Node task is registered.
- **Inspect the append-task boundary** — expected: normalized containment under the runner root, existing-target enforcement, complete JSON validation, embedded-newline rejection, and exactly one appended terminator are all explicit; no production module is imported.
- **Run `npm run typecheck`** — expected: the new Cypress project covers `../cypress.config.ts` and `**/*.ts` and exits 0 alongside the existing shared/server/client projects.
- **Run `npm run verify`** — expected: typecheck, lint, format check, and Vitest all exit 0; no Cypress browser process is launched _(guards R8 and the existing pre-push contract)_

### Implementation Notes

- **Module(s):** `cypress.config.ts` owns Cypress E2E configuration and the contained `appendJsonl` task; `cypress/tsconfig.json` owns isolated Cypress typing.
- **Pattern reference:** Mirror strict-project settings from `server/tsconfig.json` and `client/tsconfig.json`; follow the repository's root ESM config style used by `vitest.config.ts`.
- **Key decisions:** A5 restricts filesystem mutation to one contained Node task; A10 adds Cypress source to static gates without adding browser execution to `verify`.
- **Libraries:** Cypress as a development dependency; Node filesystem/path APIs inside the Node task; TypeScript.
- **High-risk callouts:** The E2E harness is rated M because an over-broad task could mutate arbitrary paths. The containment and payload checks above are the task's primary safety gate; T3 exercises them against the isolated run root.

### Scope Boundaries

- Do NOT add `scripts/e2e.ts`, the browser smoke spec, CI wiring, or Cypress support scaffolding in this task.
- Do NOT add a production test endpoint, import server/client internals, or mutate `test/fixtures/`.
- Only install/configure Cypress, define its restricted Node task, and add its TypeScript project to static checking.

### Files Expected

_Anchored on ARCH's Cypress configuration and package footprint rows._

**New files:**

- `cypress.config.ts` (Cypress E2E configuration and contained `appendJsonl` Node task)
- `cypress/tsconfig.json` (strict Cypress project covering the root config and future E2E specs)

**Modified files:**

- `package.json` (add the Cypress development dependency and include the Cypress project in `typecheck`; do not add `test:e2e` until T3)
- `package-lock.json` (lock Cypress and its transitive development dependencies)

**Must NOT modify:**

- `server/**` and `client/**` (the test boundary must not alter production contracts)
- `test/fixtures/README.md` and `test/fixtures/projects/**/*.jsonl` (canonical fixtures remain immutable)
- `.github/workflows/ci.yml`, `.gitignore`, and `biome.json` (owned by later tasks)

---

## Task T3: Implement the Packaged-App Runner and Steel-Thread Smoke

> **Status:** not started
> **Date:** 2026-07-16
> **Verification:** test-after
> **Effort:** l
> **Priority:** critical
> **Depends on:** T2
> **Satisfies REQs:** R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11
> **Footprint slice:** New: `scripts/e2e.ts`, `cypress/e2e/steel-thread.cy.ts`; Modified: `package.json`, `biome.json`
> **High-risk areas touched:** E2E process harness (M); Full live-update steel thread (H); Future Phase 4 E2E work (M)

### Description

Build the cross-platform lifecycle runner and single Cypress steel-thread specification that exercise the packaged application as a black box. This is the integration gate proving deterministic boot plus the real filesystem ingest → store → WebSocket invalidation → TanStack Query refetch → semantic chart-render path.

### Test Plan

#### Test File(s)

- `cypress/e2e/steel-thread.cy.ts`
- Command-level runner resilience checks executed through the `npm run test:e2e` entry point and controlled failure inputs; no production test hook or separate application endpoint is permitted.

#### Test Scenarios

##### Packaged Harness Boot

- **boots only the packaged app on isolated fixtures** — GIVEN canonical synthetic fixtures WHEN `npm run test:e2e` starts THEN it builds first, copies the fixtures to a unique OS-temporary root, launches `node dist/cli.js --roots <run-root> --no-open --port <requested-port>`, and gives Cypress the verified same-origin URL _(verifies R1, R6, R10; guards `scripts/build.ts`, `server/cli.ts`, and the `dist/` layout)_
- **waits for process and fixture-data readiness** — GIVEN the CLI has bound before cold ingest settles WHEN the runner checks readiness THEN it waits boundedly for `/api/ping` and a non-empty fixed-range `costComputed` series without a fixed sleep or test-only endpoint _(verifies R7, R11; covers ARCH cold-boot forward stress-test)_

##### Browser Steel Thread

- **renders fixture-backed semantic chart state** — GIVEN the fixed July 2026 Dashboard URL WHEN the page loads THEN the `Cost over time` heading and labeled chart image render with a capturable formatted total _(verifies R2, R9, R11; guards `Dashboard.tsx`, metrics API/query keys, and canonical fixtures)_
- **persists URL filters through navigation** — GIVEN the custom fixture range WHEN the user selects `30D` and follows an existing sidebar link THEN `range=30d` replaces stale `from`/`to` parameters and survives the pathname change _(verifies R3; guards `FilterBar.tsx`, `useFilters.ts`, `state.ts`, `AppShell.tsx`, and `routes.ts`)_
- **live-updates the rendered total after a real append** — GIVEN the Dashboard is restored to the fixed range and its initial total is captured WHEN one valid in-range record with a fresh `message.id` and cost-bearing usage is appended through `cy.task("appendJsonl", ...)` THEN the same labeled chart eventually reports a greater formatted total without reload, direct refetch, fixed sleep, or an API-only assertion _(verifies R4, R9; guards ingest, store, invalidation, broadcaster, WebSocket, query refetch, and chart rendering)_

##### Security and Lifecycle Resilience

- **rejects unsafe append requests without changing data** — GIVEN absolute/traversal paths, missing targets, malformed JSON, or embedded newlines WHEN the Node task receives them THEN each request is rejected and neither the run copy nor canonical fixtures receive an invalid append _(verifies R6, R8; covers ARCH path/payload forward stress-tests)_
- **fails process and lifecycle errors cleanly** — GIVEN an invalid/occupied port, bound-port mismatch, readiness timeout, early or mid-run CLI death, Cypress failure, `SIGINT`, or `SIGTERM` WHEN the run starts or ends THEN it exits non-zero with phase-tagged diagnostics, never launches against the wrong URL, preserves the originating failure, stops both children, and removes temporary state through idempotent cleanup _(verifies R7, R10; covers ARCH startup/lifecycle forward stress-tests)_

##### Regression Guard

- **keeps existing gates and fixtures clean** — GIVEN a successful smoke run WHEN `npm run verify` and fixture-integrity checks run afterward THEN all existing static/unit gates pass and `test/fixtures/` has no diff _(verifies R8; guards package, chart, build, fixture, and production-pipeline backward-regression risks)_

### Implementation Notes

- **Module(s):** `scripts/e2e.ts` is the single run-level lifecycle owner; `cypress/e2e/steel-thread.cy.ts` owns browser-visible assertions; the existing production pipeline remains a black box.
- **Pattern reference:** Follow `scripts/build.ts` for repository TypeScript orchestration and `server/cli.ts` for child-process flags/logged URL; use accessible names already exposed by `FilterBar.tsx`, `AppShell.tsx`, and T1's chart contract.
- **Key decisions:** A1–A5 require one custom runner, built `dist/`, unique OS-temp roots, exact-port verification, and the restricted Node task. A8–A9 require public readiness checks, the fixed July 2026 range, and retryable semantic UI assertions without sleeps or polling hooks.
- **Libraries:** Node standard library, Cypress bundled Electron, existing build CLI, Fastify public endpoints, React/TanStack Query/ECharts behavior under test.
- **High-risk callouts:** The live-update steel thread is H risk because it crosses every async layer. The fixed readiness barrier, real append, semantic UI assertion, captured diagnostics, and cleanup scenarios make failures observable without weakening production behavior. The runner/config/root contracts must remain reusable for #P4-18 without implementing future journeys now.

### Scope Boundaries

- Do NOT add cross-page #P4-18 journeys, full Dashboard/Phase 4 page coverage, export flows, gate fixtures, or premium-capture scenarios.
- Do NOT add production test endpoints, ingest shortcuts, reduced poll/debounce intervals, special WS messages, fixed sleeps, or application polling hooks.
- Do NOT add E2E execution to `verify`/Husky, browser matrices, visual regression, video recording, or deployed infrastructure.
- Only implement the reusable local runner and one Phase 3 steel-thread smoke flow against built `dist/`.

### Files Expected

_Anchored on ARCH's runner, browser-spec, package-script, and Biome footprint rows._

**New files:**

- `scripts/e2e.ts` (cross-platform build/temp-root/port/readiness/child-process/cleanup lifecycle runner, following `scripts/build.ts` and `server/cli.ts`)
- `cypress/e2e/steel-thread.cy.ts` (single browser smoke flow over render, URL/navigation persistence, secure append, and live semantic update)

**Modified files:**

- `package.json` (add the `test:e2e` entry point while leaving the `verify` sequence unchanged)
- `biome.json` (include `cypress/**`; the root `cypress.config.ts` remains covered by `*.ts`)

**Must NOT modify:**

- `scripts/build.ts` and `server/cli.ts` (packaged build/CLI contracts consumed as black boxes)
- `server/app.ts`, `server/ingest/pipeline.ts`, `server/store/**`, and `server/ws/broadcaster.ts` (production readiness and live-update path must remain unchanged)
- `client/src/main.tsx`, `client/src/ws.ts`, `client/src/api/**`, `client/src/filters/**`, `client/src/layout/AppShell.tsx`, `client/src/routes.ts`, and `client/src/pages/Dashboard.tsx` (existing client behavior is under test, not altered)
- `client/src/charts/Chart.tsx` and `client/src/charts/ChartCard.tsx` (T1 owns the semantic contract)
- `test/fixtures/README.md` and `test/fixtures/projects/**/*.jsonl` (copy-only canonical inputs)
- `cypress.config.ts` and `cypress/tsconfig.json` (T2-owned foundation consumed unchanged)

---

## Task T4: Add the Blocking E2E CI Gate

> **Status:** not started
> **Date:** 2026-07-16
> **Verification:** checklist
> **Effort:** s
> **Priority:** critical
> **Depends on:** T3
> **Satisfies REQs:** R5, R7, R8, R10
> **Footprint slice:** Modified: `.github/workflows/ci.yml`, `.gitignore`
> **High-risk areas touched:** CI (M)

### Description

Wire the proven local E2E entry point into a separate blocking GitHub Actions job and keep generated failure evidence out of the repository. Preserve the existing fast verification job and its deliberately non-blocking Storybook smoke step.

### Verification Checklist

- **Inspect the new `e2e` job in `.github/workflows/ci.yml`** — expected: a separate `ubuntu-latest` job checks out the repository, uses the existing Node/npm setup, runs `npm ci`, and invokes exactly `npm run test:e2e` _(verifies R5, R10)_
- **Inspect job failure semantics** — expected: the E2E job has no job- or step-level `continue-on-error`, so a failed smoke run blocks CI _(verifies R5)_
- **Inspect failure-artifact handling** — expected: Cypress screenshots upload only after a failed run and no always-on video artifact is configured _(verifies R7)_
- **Compare the existing CI job before and after** — expected: typecheck, lint, format check, Vitest, and the non-blocking Storybook build retain their current order and semantics _(verifies R8; guards ARCH CI backward-regression risk)_
- **Inspect `.gitignore` and repository status after a local E2E run** — expected: configured Cypress screenshots/artifacts are ignored, while canonical fixtures remain tracked and unchanged; OS-temporary run roots never appear in the worktree _(verifies R6, R8)_
- **Run `npm run verify` followed by `npm run test:e2e`** — expected: both commands exit 0 locally, proving the separate fast/static gate and browser gate use their intended entry points _(verifies R5, R10)_

### Implementation Notes

- **Module(s):** `.github/workflows/ci.yml` owns the CI job topology; `.gitignore` owns local Cypress artifact hygiene.
- **Pattern reference:** Reuse the existing `actions/checkout`, `actions/setup-node`, `node-version-file`, npm cache, and `npm ci` setup from the current `typecheck-test` job.
- **Key decisions:** A7 requires bundled Electron in a separate blocking job with screenshots only on failure; A10 keeps browser execution outside `verify` and the pre-push hook.
- **Libraries:** GitHub Actions, Cypress bundled Electron, npm scripts established by T3.
- **High-risk callouts:** CI is rated M because a topology mistake can silently make the gate advisory or disturb existing checks. Explicit blocking-semantics and existing-job comparison checks guard that risk.

### Scope Boundaries

- Do NOT add E2E to `npm run verify`, `.husky/pre-push`, or the existing `typecheck-test` job.
- Do NOT add Chrome/Firefox matrices, always-on video, deployed previews, containers, public URLs, or release automation.
- Only add the blocking local-runner job and ignore the artifacts that job/local Cypress can generate.

### Files Expected

_Anchored on ARCH's CI and artifact-hygiene footprint rows._

**New files:**

- _None._

**Modified files:**

- `.github/workflows/ci.yml` (add the separate blocking Ubuntu E2E job and failure screenshot upload)
- `.gitignore` (ignore configured local Cypress run artifacts)

**Must NOT modify:**

- `package.json` and `package-lock.json` (T2/T3 own dependencies and scripts)
- `.husky/pre-push` (E2E stays outside the pre-push gate)
- Existing application, fixture, and test source files (CI consumes the completed local entry point unchanged)
