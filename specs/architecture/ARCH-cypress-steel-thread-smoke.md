# Architecture: Cypress Setup + Steel-Thread Smoke Spec

> **Date:** 2026-07-16
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Standalone plan-task brief — `specs/context/32.md`; authoritative sources `specs/claude-lens-plan.md` #P3-5 and `specs/claude-lens-architecture.md` §13
> **Type:** infrastructure

## Architecture Summary

This task adds a black-box Cypress harness around the already-built V2 steel thread: a Node/TypeScript runner builds `dist/`, copies the synthetic transcript fixtures into an isolated temporary root, starts `dist/cli.js` on loopback, waits for the existing readiness endpoint, and launches Cypress against that URL. The browser spec exercises the real Dashboard, URL-backed filters, navigation, and the ingest → store → WebSocket invalidation → TanStack Query refetch → ECharts render path; filesystem mutation crosses one narrow, path-restricted Cypress Node-task boundary. A small semantic extension to the chart layer makes rendered series state observable through accessible metadata rather than ECharts internals or a test-only production endpoint. CI runs the same local entry point in a separate blocking job on its ephemeral GitHub-hosted runner, so no deployed environment or persistent VM is required.

## Inferred Requirements (if Mode B / no REQ)

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
               +--> claim configured loopback port
               |
               +--> spawn node dist/cli.js
               |       --roots <isolated-root>
               |       --no-open
               |       --port <test-port>
               |
               +--> wait for GET /api/ping and verify bound port
               |
               '--> spawn Cypress (baseUrl = http://127.0.0.1:<test-port>)
                       |
                       +--> browser: Dashboard / filters / navigation
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
| Readiness and synchronization | Existing `GET /api/ping` for boot; Cypress retryability for UI convergence | Fixed sleeps; custom application polling hook | Separates legitimate process readiness from the behavior under test and avoids timing hacks in the live-update assertion. |
| Chart observability | Optional accessible chart summary derived by `ChartCard` and passed to `Chart` | `data-cy` revision; ECharts instance exposure; canvas pixel diff; API response only | Observes rendered application state through a user-relevant semantic contract and remains stable across ECharts internals. |
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
- **Existing one-package, one-port topology** — Fastify serves SPA, API, and WS on the same loopback origin exactly as described in CLAUDE.md.
- **Existing delivery gates remain stable** — `npm run verify` and the Husky pre-push hook remain unchanged; E2E is an explicit local command and separate CI job.
- **ESM and strict TypeScript conventions** — new TypeScript follows the repository's Node 22, `type: module`, Biome, and existing `scripts/` conventions.

## Data Models

### E2eRunContext

**Purpose:** Represents the transient resources and configuration owned by one harness invocation. It is process-local and is never persisted.

**Key fields:**
| Field | Type / Constraint | Notes |
|-------|-------------------|-------|
| `sourceFixtureRoot` | repository-relative path; read-only | Always resolves to canonical `test/fixtures/`. |
| `runFixtureRoot` | absolute path under the OS temp directory; unique | The only root the built CLI and append task may mutate/read for this run. |
| `requestedPort` | integer 1–65535 | Defaults to the agreed E2E port and may be overridden by `CLAUDE_LENS_E2E_PORT`. |
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
| Describe chart | `ChartProps.ariaLabel?: string` | Apply a user-relevant semantic description to the ECharts container. | Optional so existing callers remain source-compatible. |
| Derive summary | `ChartCard` derives label from its title and loaded series | Make initial and updated rendered data observable without ECharts internals. | Pending/error states keep their existing visible messages; loaded state supplies the semantic label. |

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

## Module Boundaries

| Module / Package | Responsibility | Allowed Dependencies |
|------------------|----------------|----------------------|
| `scripts/e2e.ts` | Run-level orchestration, temp-copy lifecycle, port/readiness checks, child processes, cleanup, diagnostics | Node standard library and spawned package binaries; must not import `server/` or `client/` source modules. |
| `cypress.config.ts` | Cypress E2E configuration, base URL/run-root intake, and the restricted append task | Cypress config API and Node filesystem/path APIs; must not import production server modules. |
| `cypress/e2e/steel-thread.cy.ts` | Browser-visible steel-thread flow and retryable assertions | Cypress browser API and the named Node task; no direct filesystem access, production-module imports, or test-only HTTP calls. |
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

### Modified files / modules

| Path | What changes here |
|------|-------------------|
| `package.json` | Add Cypress dev dependency and `test:e2e` entry point while leaving `verify` unchanged. |
| `package-lock.json` | Lock Cypress and its transitive development dependencies. |
| `.github/workflows/ci.yml` | Add a separate blocking Ubuntu E2E job that checks out, sets up Node, installs, and runs `npm run test:e2e`; upload screenshots on failure. |
| `.gitignore` | Ignore local Cypress screenshots and any other configured run artifacts. |
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
| Local developer workflow | Adds explicit `npm run test:e2e` command and optional port override | L | `npm run verify` and pre-push duration remain unchanged. |
| Future Phase 4 E2E work | #P4-18 can reuse the runner, config, isolated roots, and mutation boundary | M | Reuse is intentional, but this task must not pre-build future journeys or page assertions. |
| Production runtime | No transport, API, ingest, storage, auth, or startup behavior changes | L | The packaged app is consumed as a black box; only semantic chart metadata shifts. |

**Contract changes:** No external/public application API, CLI flag, WebSocket payload, metrics shape, or stored-data contract changes. Internal additions are `ChartProps.ariaLabel?`, the test-only `appendJsonl` Cypress task, `CLAUDE_LENS_E2E_PORT`, and the developer-facing `npm run test:e2e` command.

**Cross-cutting ripples:** CI gains a blocking browser job and failure-artifact upload; package installation gains Cypress; local run output gains E2E diagnostics. There are no auth, telemetry, database, migration, feature-flag, deployment, or public-hosting changes.

## Cross-Cutting Concerns

- **Errors:** The runner treats build failure, invalid/occupied port, readiness timeout, unexpected CLI exit, Cypress non-zero exit, invalid append request, and cleanup failure as non-zero outcomes. Server and Cypress output is forwarded and retained in the failing job; cleanup runs from `finally` and signal handlers.
- **Logging & metrics:** Runner messages use a stable `[e2e]` prefix and identify lifecycle phase, requested URL, and child exit without printing fixture contents. Existing Fastify/Cypress logs pass through. CI uploads failure screenshots; no production metrics or telemetry are added.
- **Auth / authz:** No application auth surface changes. The app remains loopback-only with its existing WebSocket origin policy. The append task is available only in Cypress's Node process and enforces run-root containment.
- **Performance:** The Phase 3 suite remains one serial smoke flow over the small synthetic tree. Readiness uses a bounded, short boot check; live-update convergence uses Cypress's normal retry window sized above the existing filesystem-poll and invalidation-debounce budget. No cache or production interval is altered for tests.
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

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|----------|---------------------------|
| Build fails or produces no runnable `dist/cli.js` | `npm run test:e2e` stops before acquiring browser state and returns the build's non-zero exit. |
| Configured port is already occupied | Preflight fails with the requested port before the CLI starts; the developer may stop the owner or set `CLAUDE_LENS_E2E_PORT`. |
| Another process claims the port after preflight and the CLI auto-increments | The runner verifies the actual bound/logged URL matches the request; mismatch stops the CLI and fails rather than launching Cypress against the wrong URL. |
| CLI never becomes ready or exits during boot | Bounded `/api/ping` readiness races the child exit; failure includes captured output and triggers cleanup. |
| CLI dies while Cypress is running | The runner observes the unexpected exit, terminates Cypress, preserves both outputs, and fails the run. |
| Cypress fails or is interrupted | Its exit code is preserved; the CLI is terminated and the temporary root removed in the common cleanup path. |
| Two developers start the default-port run simultaneously | Each has an isolated root; the second fails the port check before mutation. An explicit override allows intentional parallel runs. |
| Append request attempts traversal or an absolute path | The Cypress Node task rejects before filesystem access after normalized containment validation. |
| Append payload is partial, multi-line, or malformed | The task requires one complete JSON object with no embedded newline and appends exactly one terminator. |
| WS is briefly disconnected when the file changes | Existing client reconnect invalidates all queries; the retryable semantic UI assertion still observes convergence without manual reload/refetch. |
| Ingest/debounce is slower on CI for several seconds | The assertion timeout covers the documented polling/debounce envelope; no production interval is shortened and no fixed sleep guesses at timing. |
| GitHub runner lacks a user-managed server or public URL | The job's ephemeral `ubuntu-latest` machine starts the built CLI locally and passes its loopback URL to Cypress; no external infrastructure is involved. |
| Cypress install or Electron launch fails | The blocking job fails during install/start with native logs; no application process is left running after job teardown. |
| Future #P4-18 grows the suite | The lifecycle/config/root contracts are reusable; flows remain serial initially, and future parallel jobs must use unique ports and already-unique roots. |
| The E2E gate must be rolled back | Remove additive test/CI files and optional chart semantics; no migration, protocol rollback, or data restoration is required. |

### Backward — regression risk per touched area (brownfield only)

| Touched area (from Change Footprint) | What could regress | How we'd know / mitigation |
|--------------------------------------|--------------------|----------------------------|
| `package.json` / lockfile | Existing install, build, `verify`, or pre-push behavior changes unintentionally | `verify` script is unchanged; existing CI job and pre-push gate remain green. |
| `.github/workflows/ci.yml` | Existing checks become non-blocking, duplicated incorrectly, or starved by the new job | New E2E job is separate; current typecheck/lint/format/test/Storybook sequence remains intact. |
| `Chart.tsx` / `ChartCard.tsx` | Chart lifecycle, query stability, stories, or existing render states break | Semantic prop is optional and presentation-only; existing 302 tests, typecheck, lint, format, and Storybook continue to gate. |
| `server/cli.ts` / `server/app.ts` | Harness relies on a false assumption about flags, port, readiness, or shutdown | Runner uses the documented CLI and `/api/ping` contracts and verifies the bound URL before Cypress starts. |
| Ingest/store/invalidation/broadcaster | Existing live update stops or emits the wrong invalidation | The smoke flow fails at the semantic chart assertion after a real append, with server/browser logs preserved. |
| `client/src/ws.ts` / query keys | Message no longer invalidates the mounted metrics query | The post-append chart summary never converges, making this silent unit-level integration regression visible. |
| Filter and navigation modules | Query parameters are dropped, reordered incorrectly, or fail to drive the chart query | Browser-visible URL and destination state are exercised through existing controls and links. |
| Canonical `test/fixtures/` | A failed run corrupts or leaves appended data in tracked files | Only the copied temp root is passed to CLI/task; source fixtures are read-only inputs. |
| `scripts/build.ts` / `dist/` layout | E2E accidentally exercises stale or development output | `test:e2e` builds first and starts only the resulting `dist/cli.js`. |

## Open Questions

- None — the developer confirmed all eight architecture decisions and the Phase 2 readiness gate on 2026-07-16.

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

_This section is populated by the **generate-tasks** skill (Phase 3)._
_Run: `/generate-tasks from: specs/architecture/ARCH-cypress-steel-thread-smoke.md`_
