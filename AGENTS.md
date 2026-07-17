# Repository Guidelines

Claude Lens V2 is active; `legacy/` is maintenance-only.

## Project Structure & Module Organization

- `shared/`: TypeScript contracts shared by server and client.
- `server/`: Fastify API, ingest pipeline, metrics engine, store, and WebSocket invalidation bus.
- `client/`: React/Vite SPA, page components, filters, charts, API/query helpers, and Storybook.
- `scripts/`: build, development, ports, Storybook, and E2E runners.
- `cypress/`: cross-page browser tests; `test/fixtures/`: JSONL fixture histories.
- `specs/`: authoritative architecture, page, gate, plan, issue, and visual-mockup documents.
- Tests are colocated as `*.test.ts(x)`; stories use `*.stories.tsx`.

## Build, Test, and Development Commands

- `npm ci`: install the locked dependency tree; run once per worktree.
- `npm run dev`: start Fastify on 4128 and Vite on 4129.
- `npm run verify`: typecheck, lint, format-check, and run Vitest. Required before pushing.
- `npm run build`: assemble the production CLI and SPA under `dist/`.
- `npm run test:e2e`: build and run the isolated Cypress fixture harness.
- `npm run storybook`: open the component workbench.

Set `CLAUDE_LENS_PORT_BASE` to isolate parallel checkouts; backend, Vite, E2E, and Storybook use
base through base+3.

## Coding Style & Naming Conventions

Use strict TypeScript, ESM imports, two-space indentation, and a 100-column target. Biome owns
formatting and linting. Follow neighboring filename patterns:
PascalCase for React components, descriptive kebab-case for server modules, and camelCase for
functions. Keep server/client boundaries explicit; shared contracts belong in `shared/`.

## Testing Guidelines

Vitest covers unit and integration behavior; React Testing Library covers client interactions;
Cypress covers built-app journeys. Add regression tests for behavior changes. Phase 4 pages require
a fixture-backed Cypress smoke test, Storybook state coverage, and manual comparison
with `specs/pages/*.html`. The page tables in `specs/claude-lens-pages.md` override mockups.

## Commit & Pull Request Guidelines

Use focused, imperative subjects consistent with history, such as `feat(32): add Cypress smoke
test`, `docs(plan): clarify dependencies`, or `chore: archive issue artifacts`. Keep one issue per
branch/worktree. PR bodies must include `Closes #N`, verification evidence, and screenshots or
visual sign-off for UI work. Squash-merge, then promptly update the plan checkbox and archive the
closed issue artifacts.

## Agent-Specific Instructions

Do not extend `legacy/` or work outside the active plan task. Specs win over code or mockups;
`specs/claude-lens-plan.md` owns scope and sequencing, while
`specs/claude-lens-phase4-parallelization.md` owns Phase 4 start gates and lane execution. Use
project-local `/create-issue`, `/move-to-worktree`, `/finish-worktree`, and `/archive-issue` for
their named workflows. Never auto-invoke user-level `/start-task`, `/plan-*`, `/generate-tasks`,
`/implement`, `/review`, or `/commit` skills; suggest them by exact name.
