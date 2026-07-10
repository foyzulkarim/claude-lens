# Requirements: Scaffold three-root TS package (#P1-1)

> **Date:** 2026-07-10
> **Type:** infrastructure
> **Source:** GitHub issue #13 (`specs/context/13.md`) · architecture `specs/claude-lens-architecture.md` §1–§3, §12 · plan `specs/claude-lens-plan.md` Phase 1 + decisions log (2026-07-10). Mode B gap-fill — §2/§3 are the source-of-truth for dependency lists and layout; this REQ captures only the decisions those docs leave open.
> **Phase:** 1 of 5 (Requirement Engineering)

## Summary

Create the V2 skeleton: one npm package with three strict-TypeScript roots (`shared/`, `server/`,
`client/`), a root `package.json` carrying the runtime/toolchain pins and the exact §2 dependency
lists, and an MIT LICENSE at the repo root. This is the first task with a root `package.json` after
V1 was moved to `legacy/` (#P0-2); it establishes structure and toolchain only — no feature code.

## Problem & Motivation

Phase 0 emptied the repo root of V1. Every Phase 1–5 task assumes a booting three-root TS package
exists to build on: #P1-2 (dev/build toolchain) wires `tsx`/`vite`/`esbuild` into these roots,
#P2-1 designs the `shared/` contracts inside `shared/`, and so on. Without this scaffold there is
nowhere for that work to land. It also absorbs the LICENSE and `engines`/`packageManager` pins
(dissolved from #P0-5, 2026-07-10) since this is the first task with a `package.json` to hold them.

## Users & Consumers

- **Downstream plan tasks (#P1-2 … #P5-4)** — need the roots, package manifest, and pinned
  toolchain in place to attach their code and tooling.
- **Contributors** — a fresh clone must typecheck (`tsc --noEmit`) and use the pinned package
  manager/Node version deterministically.
- **End users** — unaffected at this task (they consume the eventual `npx`), but the `bin` and
  package identity are seeded here.

## Functional Requirements

| ID  | Requirement | Acceptance Criterion |
|-----|-------------|----------------------|
| R1  | Root `package.json` exists with `name: "@foyzulkarim/claude-lens"` (placeholder), `license: "MIT"`, `engines.node: ">=22"`, `packageManager: "npm@<pinned>"`, and `bin: { "claude-lens": "dist/cli.js" }`. | `npm pkg get engines packageManager license` returns the pinned values (issue AC); `npm pkg get name bin` returns the placeholder name and the `claude-lens → dist/cli.js` bin. |
| R2  | Three roots `shared/`, `server/`, `client/` exist, each containing at least one real placeholder `.ts`, and `tsc --noEmit` passes across all three. | `tsc --noEmit` exits 0 for all three roots; removing the placeholder from a root is what would make its check vacuous (see edge cases). |
| R3  | Strict TypeScript is enabled everywhere. | `strict` is on in the TS config(s); a deliberately unsound placeholder (e.g. implicit `any`) fails `tsc --noEmit`. |
| R4  | Production `dependencies` are **exactly** the §2 server list — `fastify`, `@fastify/static`, `@fastify/websocket`, `fast-glob`, `open`, `pino-pretty` — and nothing else. | `package.json` `dependencies` set equals the §2 server set; no extras (chokidar, any DB driver, zod, commander/yargs, server-side date libs are absent per §2). |
| R5  | Client + toolchain libraries are present as `devDependencies` per §2 (client: react, react-dom, wouter, @tanstack/react-query, @tanstack/react-table, @tanstack/react-virtual, echarts, minisearch, date-fns, tailwindcss, clsx; toolchain: typescript, vite, @vitejs/plugin-react, esbuild, tsx, vitest). | `devDependencies` include the full §2 client + toolchain lists. |
| R6  | Dependency versions use caret ranges (`^x.y.z`) with a committed lockfile. | `dependencies`/`devDependencies` use `^` ranges; `package-lock.json` is committed. |
| R7  | An MIT LICENSE (© 2026 Foyzul Karim) exists at repo root. | `LICENSE` at repo root; standard MIT text with that holder and year; matches the `license` field in R1. |
| R8  | Companion spec edit for the Node-floor deviation: architecture §1 (constraint table + body "Node ≥ 18") and §12 (esbuild `--target=node18`) are updated to Node ≥ 22 / `--target=node22`, and a plan decisions-log row records the raise. | Architecture §1 says "Node ≥ 22"; §12 says `--target=node22`; `claude-lens-plan.md` decisions log has a 2026-07-10 row for the ≥18→≥22 raise; the two are internally consistent. |

## Non-Functional Requirements

| ID  | Requirement | Acceptance Criterion |
|-----|-------------|----------------------|
| N1  | Minimal-tooling / npx-weight discipline: no production dependency outside the §2 server list. | `dependencies` count == §2 server-list count; deviations would require editing §2 first. |
| N2  | No native modules and no `postinstall` script, even at scaffold (hard rules, §12). | No `postinstall`/lifecycle install scripts; all deps are pure-JS (trivially met by the §2 libs). |

## Behaviors & Domain Rules

**Scope is deliberately minimal — structure + toolchain only.**

- The three roots each get **one placeholder `.ts`** so `tsc --noEmit` is a real signal, and
  nothing from the §3 sub-tree (`ingest/`, `store/`, `metrics/`, `routes/`, `config/`, pages,
  `shared/*` contracts) is created here.
- `bin` command name stays `claude-lens` even though the package name is the scoped placeholder —
  the bin command is independent of the package name (plan decisions log, 2026-07-10; #P0-4 finding).
- `dist/cli.js` (the `bin` target) does not exist yet — it is built by #P1-2. Declaring the `bin`
  now, pointing at that future build output, is expected and explicitly allowed.

**Why these rules matter:**
- **#P1-2 owns `cli.ts`/`app.ts`/hello-world SPA/build; #P2-1 owns the `shared/` contracts.**
  Creating any of that here pre-empts tasks that explicitly own it (§14 build order) and invites
  merge/ownership drift.
- The Node-floor raise **must** be reflected in the architecture doc, not just `package.json` —
  §2's "deviations require editing the architecture doc first" is a repo-wide rule; skipping it
  leaves `engines: ">=22"` contradicting §1/§12.

**Common mistakes (what a developer gets wrong first):**
- Leaving a root with zero `.ts` files — `tsc --noEmit` then passes *vacuously* and R2 is meaningless.
- Adding a stray production dep (e.g. a date lib, or `zod`) that §2 deliberately excludes.
- Bumping `engines` to `>=22` but forgetting the §12 esbuild `--target` and the arch-doc/decisions-log edits.
- Pinning `packageManager` to a non-existent `npm@x.y.z` string (Corepack validates it exactly).

## Edge Cases & Failure Modes

| Scenario | Decision | Rationale |
|----------|----------|-----------|
| A root has no `.ts` files | Each root ships one real placeholder `.ts` | Otherwise `tsc --noEmit` passes vacuously and R2 verifies nothing |
| Scoped package name + `claude-lens` bin | Keep bin command `claude-lens`, independent of the scoped `name` | §3 fixes the bin; #P0-4 finding — bin name unaffected by package rename |
| `engines >=22` but esbuild still targets `node18` | Update §12 target to `node22` in the same arch edit (R8) | Keep the doc internally consistent; #P1-2 implements the target as written |
| `bin` points at `dist/cli.js` which doesn't exist yet | Declare `bin` now anyway | Path is a build output produced by #P1-2; harmless until publish; plan decisions log allows it |
| `packageManager: "npm@X.Y.Z"` names a bad version | Pin to the npm that ships with the Node 22 LTS used at implement time | Corepack validates the exact string on install |
| Final (non-placeholder) package name later | Deferred to before #P5-2 as a small rename, not a rescaffold | Issue scope; #P0-4 (`claude-lens` taken by an unrelated package) |

## Decisions Log

| #   | Decision | Alternatives Considered | Chosen Because |
|-----|----------|-------------------------|----------------|
| 1   | Minimal roots: three root dirs + one placeholder `.ts` each; no §3 sub-tree | Full skeleton stubs; minimal + `shared/` contract stubs | #P1-2 owns `cli.ts`/`app.ts`/SPA; #P2-1 owns `shared/` contracts — don't pre-empt (§14 build order) |
| 2   | Placeholder name `@foyzulkarim/claude-lens` | `claude-lens-dashboard`; `claude-lens-placeholder` | npm scope sidesteps the taken-name collision cleanly; final name is a two-field rename before #P5-2 |
| 3   | MIT, © 2026 Foyzul Karim | Apache-2.0 | Issue default; lightweight for a local-first tool |
| 4   | packageManager: npm + committed `package-lock.json` | pnpm; yarn | Ships with Node; minimal-tooling ethos; npx-native distribution story |
| 5   | `engines.node: ">=22"` (+ companion §1/§12 arch edit, R8) | `>=18` (per spec); `>=20` | Node 18 EOL Apr 2025; 22 is active LTS. Informed acceptance of the required arch-doc edit |
| 6   | Caret ranges `^x.y.z` + committed lockfile | Exact pins + lockfile; latest-at-install | npm default; reproducible via the lock; low-friction upgrades |

## Scope Boundaries

### In Scope
- Root `package.json`: placeholder scoped `name`, `license: "MIT"`, `engines.node: ">=22"`, `packageManager: "npm@<pinned>"`, `bin: { "claude-lens": "dist/cli.js" }`, `dependencies`/`devDependencies` per §2 with caret ranges; committed `package-lock.json`.
- Three roots `shared/`, `server/`, `client/`, each with one placeholder `.ts`; strict TS coverage; `tsc --noEmit` green across all three.
- MIT `LICENSE` at repo root.
- Companion edit: architecture §1/§12 Node ≥ 18 → ≥ 22 (and `--target=node18` → `node22`) + a plan decisions-log row (R8).

### Out of Scope
- `cli.ts`, `app.ts`, hello-world SPA, `/api/ping`, dev server, `scripts/build.ts` (reason: #P1-2).
- `shared/types.ts`, `shared/metrics-contract.ts`, `shared/ws-protocol.ts` and all `shared/` contract design (reason: #P2-1).
- Every other §3 sub-tree file — `ingest/`, `store/`, `metrics/`, `gates/`, `routes/`, `config/`, `client/src/**` pages (reason: their own phase tasks).
- CI (#P1-3), Storybook (#P1-4), lint/format — Biome (#P1-5).
- Final non-placeholder package name + npm reservation (reason: #P0-4 / #P5-2).
- **tsconfig structure** — per-root vs project-references vs solution-style, and the exact placeholder `.ts` content (reason: implementation "how" — belongs to `/plan-architecture`).

## Open Questions

- **Exact `packageManager` npm version string and the Node 22 minor used locally.**
  - **Impact if unresolved:** Corepack rejects an invalid `npm@x.y.z`.
  - **Suggested default:** pin `packageManager` to the npm bundled with the current Node 22 LTS at implement time; `engines` stays the `">=22"` range (not an exact pin).
- **Which two fields the eventual rename touches** ("two-field rename" per the issue).
  - **Impact if unresolved:** minor; cosmetic at #P5-2.
  - **Suggested default:** treat as the `name` field plus one reference (bin/README); confirm at #P5-2.

---
_This requirements document is the input for the **plan-architecture** skill._
_Next step: `/plan-architecture from: specs/requirements/REQ-scaffold-three-root-ts-package.md`_
