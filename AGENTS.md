# Repository Guidelines

## Project Overview

Claude Lens V2 is a local-first observability dashboard for Claude Code sessions. It reads local
transcript and optional capture JSONL, derives calls/turns/sessions, and shows token usage, cost,
cache behavior, tools, gates, and trends. Data stays on the machine.

V2 is the active application. `legacy/` is maintenance-only and must not receive new features.

## Architecture & Data Flow

Production is one Node process and one loopback port:

```text
Claude transcripts + optional C/B/L sidecars
  -> discovery/polling/tailing
  -> transcript and premium parsers
  -> in-memory Store
  -> derivations, metrics, gates, health, and search
  -> Fastify JSON API + WebSocket invalidations
  -> TanStack Query cache
  -> React pages
```

- `shared/` is the cross-runtime contract leaf. Core atoms are `ApiCall -> Turn -> Session`;
  endpoint wire shapes belong in `*-contract.ts`.
- `server/ingest/` is the only production writer to `Store`. Routes read snapshots and call pure
  engines/projectors; route handlers do not parse source files.
- Transcript calls dedupe by `message.id`; turns derive from `promptId`. Parent and
  `subagents/agent-*.jsonl` files contribute to one session.
- WebSocket messages carry invalidations only. The client refetches data through HTTP using keys
  from `client/src/api/queryKeys.ts`.
- Metrics computation is store-independent: `server/metrics/engine.ts` operates on plain arrays
  using the shared `MetricsQuery` contract.
- Disk persistence is limited to a deletable warm cache plus small config/local JSON files. There
  is no database.
- Optional capture producers in `capture/` write C (`*.cost.jsonl`), B
  (`*.turn-boundaries.jsonl`), and L (`~/.claude/cost-log.jsonl`) records. Coordinate producer
  field changes with `server/ingest/parse-premium.ts`.

## Key Directories

- `shared/`: domain and API contracts used by server and client.
- `server/`: CLI, Fastify assembly, ingest, Store, metrics, gates, routes, and WebSocket fan-out.
- `client/src/`: React pages, typed API adapters, query keys, URL filters, charts, and components.
- `capture/`: defensive CommonJS statusline/Stop-hook producers and installer.
- `scripts/`: build, dev, port, Storybook, E2E, and field-survey orchestration.
- `test/fixtures/`: synthetic transcript fixtures; `test/fixtures-premium/` is the separate C/B/L
  overlay.
- `cypress/`: packaged-app browser journeys and the guarded fixture append task.
- `docs/`: canonical architecture document and explanatory release/presentation artifacts.
- `specs/`: page/data semantics, gates, plan, mockups, and active issue artifacts.

## Development Commands

```sh
npm ci                    # locked install; may build via the prepare lifecycle
npm run dev               # Fastify + Vite
npm run dev:server        # Fastify only
npm run dev:client        # Vite only
npm run typecheck         # all TS projects
npm run lint              # Biome lint
npm run format            # Biome write
npm run format:check      # Biome check
npm test                  # Vitest
npm run verify            # typecheck + lint + format check + Vitest
npm run build             # assemble dist/cli.js, dist/public/, dist/capture/
npm start                 # run the built CLI
npm run test:e2e          # build + isolated transcript/premium Cypress passes
npm run storybook         # component/page-state workbench
npm run build-storybook   # static Storybook smoke
npm run bench:ingest      # ingest benchmark
```

Set `CLAUDE_LENS_PORT_BASE=N` for parallel lanes: backend `N`, Vite `N+1`, E2E `N+2`,
Storybook `N+3`. Production uses `--port`; the CLI may scan upward if that port is occupied.

## Code Conventions & Common Patterns

- Strict TypeScript, ESM, two-space indentation, and a 100-column target. Relative TypeScript
  imports use emitted `.js` specifiers; use `import type` for type-only dependencies.
- Biome owns formatting and linting. Use PascalCase for React components/types, camelCase for
  functions/hooks, and descriptive kebab-case for server modules.
- Preserve module direction: shared contracts are leaves; ingest writes Store; routes read Store;
  computation modules receive plain values; transport stays in `app.ts`/`ws` modules.
- Prefer explicit dependency injection at composition boundaries: option objects, constructor
  arguments, route registration arguments, callback seams, clocks, and path overrides. Do not add
  hidden mutable singletons beside `server/cli.ts` or `buildApp()`.
- Common names: `registerXRoute`, `parseX`, `buildX`/`deriveX`, `createX`, API
  `get`/`list`/`post`/`update`, React `useX`, and shared `*-contract.ts`.
- Validate unknown HTTP input before dispatch; expected validation failures return HTTP 400 with
  `{ error }`. Unexpected failures flow to the normalized Fastify 500 handler.
- External JSONL is untrusted. Malformed records are counted/skipped rather than crashing ingest.
  Preserve `undefined`/`null` as unavailable; never replace an unavailable observed value with `0`.
- Background async work must recover after rejection: attach catches to timer fire-and-forget work,
  isolate callback/socket failures, and clean up timers/processes/resources.
- TanStack Query owns remote state; `qk` is the only query-key factory. API adapters accept
  `AbortSignal`, throw on non-2xx, and guard important 2xx response shapes.
- Global filters and shareable page state live in the URL query string. Use local React state only
  for transient display choices. Mutations invalidate the relevant `qk` prefix explicitly.
- Query-key arrays are order-sensitive. Keep measures, dimensions, and filter arrays canonical.
- Capture scripts are synchronous, failure-tolerant CommonJS so a logging failure cannot break a
  Claude Code statusline or hook; do not casually apply server async conventions there.

## Important Files

- `server/cli.ts`: production composition root and CLI flags.
- `server/app.ts`: Fastify plugins, routes, lifecycle, static SPA, and `/ws`.
- `server/ingest/pipeline.ts`: runnable discovery-to-Store assembly.
- `server/store/store.ts`: sole in-memory writer boundary and coherent session snapshots.
- `server/metrics/engine.ts`: series/distribution metrics over plain records.
- `shared/types.ts`: `ApiCall`, `Turn`, `Session`, and tier/availability vocabulary.
- `shared/metrics-contract.ts`: measures, dimensions, series/distribution/scatter query language.
- `client/src/main.tsx`: QueryClient, WebSocket startup, and React mount.
- `client/src/routes.ts`: single page/navigation route registry.
- `client/src/api/queryKeys.ts`: canonical query keys and invalidation prefixes.
- `client/src/ws.ts`: reconnecting, coalesced invalidation client.
- `client/src/filters/state.ts`: URL filter parsing/serialization and metrics conversion.
- `scripts/build.ts`: Vite/esbuild build and final package layout.
- `scripts/e2e.ts`: isolated packaged-runtime E2E harness.
- `docs/claude-lens-architecture.md`: authoritative implementation architecture.
- `specs/claude-lens-pages.md`: authoritative page/data semantics; overrides mockup section lists.
- `specs/gates.md`: Report Card algorithms and evidence contracts.
- `specs/claude-lens-plan.md`: scope and sequencing; live issue/PR state proves completion.

## Runtime/Tooling Preferences

- Required runtime: Node `>=22`. Required package manager: npm `10.9.2` with
  `package-lock.json`; use `npm ci` in clean worktrees/CI.
- Server/CLI runtime imports belong in `dependencies`. Browser-bundled, build, and test packages
  belong in `devDependencies`.
- `dist/` is the sole publishable artifact. Do not edit generated `dist/`, `client/dist/`, or
  `client/storybook-static/`.
- Keep the production package free of native modules, databases, postinstall work, and alternate
  runtimes. The supported distribution path is `npx @foyzulkarim/claude-lens@latest`.
- Vite proxies `/api` and `/ws` to the backend in development; production serves API, WS, and SPA
  from Fastify on one port.
- Authority is domain-specific: architecture (`docs/`) wins implementation mechanics; page specs
  win data semantics; `specs/gates.md` wins gate behavior; the plan owns task order.

## Testing & QA

- Tests are colocated as `*.test.ts(x)`. The central fixture directories contain test data, not
  test source.
- Vitest covers contracts, parsers, Store/metrics/gates, Fastify routes via `app.inject`, scripts,
  capture, and pure client logic. React Testing Library covers jsdom rendering and interactions.
- Use fixed timestamps, typed factories with `Partial<T>` overrides, temporary directories, injected
  clocks, or fake timers. Avoid wall-clock sleeps and shared mutable fixtures.
- UI tests should use roles and accessible names before test IDs, with a fresh retry-disabled
  QueryClient and isolated Wouter memory location.
- Cypress covers built-app page composition, navigation, persistence, accessibility, and the live
  ingest -> WebSocket -> refetch path. It runs against a temporary fixture copy.
- Fixtures must remain hand-authored and synthetic. Never copy real `~/.claude` prompts, paths, or
  identifiers. Preserve intentional malformed/truncated lines, chronology anchors, and dot-separated
  premium sidecar names; document fixture changes in `test/fixtures/README.md`.
- Storybook is a manual state workbench for populated/empty/loading/error/tier variants. It is not a
  behavior test and has no automated visual regression.
- Match verification to the change: targeted Vitest while iterating; Cypress for packaged runtime,
  cross-page, persistence, or live-update behavior; Storybook plus manual `specs/pages/*.html`
  comparison for visual states.
- Before pushing, run `npm run verify`. CI also runs blocking E2E; Storybook build is advisory.
