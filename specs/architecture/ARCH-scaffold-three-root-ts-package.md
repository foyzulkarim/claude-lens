# Architecture: Scaffold three-root TS package (#P1-1)

> **Date:** 2026-07-10
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** `specs/requirements/REQ-scaffold-three-root-ts-package.md`
> **Type:** infrastructure

## Architecture Summary

Establish the V2 skeleton as **one npm package with three sibling TypeScript roots** (`shared/`,
`server/`, `client/`) at the repo root — no workspaces, one `package.json`, one dependency set.
Strict typechecking across all three roots is wired with **shared per-root configs**: one
`tsconfig.base.json` holds the common strict options, each root `extends` it with its environment
delta (server `types:["node"]`; client DOM `lib` + `jsx`), and one npm script chains `tsc --noEmit
-p` across all three. _(Revised from the original project-references/composite shape — `tsc -b
--noEmit` is incompatible with cross-root references in TS 7.0.2, TS6310; see # Tasks / T3.)_ The
package is **ESM** (`"type": "module"`, `NodeNext`
resolution), pinned to Node ≥ 22 and `npm@10.9.2`, with caret-ranged §2 dependencies and a committed
lockfile. Each root ships a single self-contained typed placeholder so the typecheck is a real
signal without pre-empting the tasks that own the real code (#P1-2 server/build, #P2-1 shared
contracts, #P3-2 client). Raising the Node floor from the spec's ≥18 to ≥22 carries a companion edit
to architecture §1/§12 and a plan decisions-log row (R8).

## High-Level Structure

```
claude-lens/
├── package.json            # NEW — name (placeholder scope), bin, engines>=22, packageManager npm@10.9.2,
│                           #        deps (§2 exact) / devDeps (§2 client+toolchain), "type":"module"
├── package-lock.json       # NEW — committed (R6)
├── LICENSE                 # NEW — MIT © 2026 Foyzul Karim (R7)
├── tsconfig.base.json      # NEW — common strict compiler options (strict, ES2022, NodeNext)
├── .gitignore              # MODIFIED — add dist/, *.tsbuildinfo
├── shared/
│   ├── tsconfig.json       # NEW — extends base, no DOM lib
│   └── placeholder.ts      # NEW — typed const; removed by #P2-1
├── server/
│   ├── tsconfig.json       # NEW — extends base, types:["node"]
│   └── placeholder.ts      # NEW — typed const; removed by #P1-2
└── client/
    ├── tsconfig.json       # NEW — extends base, lib DOM, jsx react-jsx
    └── src/placeholder.ts  # NEW — typed const; removed by #P3-2 (client code lives under src/ per §3)
```

**Data flow:** none — this is a build/config scaffold with no runtime path. The only "flow" is the
typecheck graph: `tsc -b` builds `shared` → then `server` and `client` (which reference it).

**Added vs modified:** everything above is new except `.gitignore` (add two ignore lines) and the two
spec docs edited for R8 (`specs/claude-lens-architecture.md`, `specs/claude-lens-plan.md`).

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|------|----------|-------------------------|-----------|
| Package topology | Single package, three sibling roots, no workspaces | npm workspaces (multi-package) | REQ R1/R4/R5 mandate one manifest + one dependency set; workspaces add per-package manifests the spec avoids |
| Typecheck config | Shared per-root configs (one base, `extends` per root) | project references/composite; 3 independent configs; single globbed config | (a) client DOM/JSX vs server Node compiler options via `extends` + env delta AND (b) cross-root imports resolve via NodeNext once #P2-1 adds them. _(Composite/references were the original plan but dropped — `tsc -b --noEmit` is incompatible with cross-root references in TS 7.0.2, TS6310; see T3.)_ |
| Typecheck command | `tsc --noEmit -p <root>` ×3, chained (npm script `typecheck`) | `tsc -b --noEmit`; bare `tsc --noEmit`; `tsc -b` (emits) | The REQ R2/R3 literal `tsc --noEmit`; checks each root without emitting. (`tsc -b --noEmit` was rejected — TS6310 under references.) |
| Module format | ESM — `"type":"module"`, `module/moduleResolution: NodeNext` | CommonJS | Node 22 target (§12), esbuild/vite defaults, and the whole §2 stack (fastify, fast-glob, open) are ESM-first |
| Placeholder shape | Self-contained typed const per root (no cross-root import) | Cross-root import placeholder | Satisfies R2/R3 non-vacuously; keeps #P1-1 minimal; defers the import-path convention + bundler resolution to #P2-1/#P1-2 where they're actionable |
| Node / npm pins | `engines.node ">=22"`, `packageManager "npm@10.9.2"` | ≥18 (spec); ≥20; pnpm/yarn | Node 18 EOL Apr 2025; 22 is active LTS shipping npm 10.9.x. Requires the R8 arch-doc edit |
| Dependency versions | Caret `^x.y.z` + committed `package-lock.json` | Exact pins; latest-at-install | REQ R6 — npm default, reproducible via lock |
| Type stubs | Install `@types/node` now; defer `@types/react`/`@types/react-dom` to first-JSX task | Install all @types now; install none | Server root is inherently Node (strict TS meaningless without it; #P1-2's cli uses `process`); no `.tsx`/JSX exists until #P3-2, so React stubs aren't needed yet. All @types are devDeps → `dependencies` stays exactly the §2 six (R4/N1 intact) |

## Patterns & Conventions

- **Per-root configs sharing one base** — `tsconfig.base.json` holds strict options; each root
  `extends` it and adds only its environment delta (Node types vs DOM/JSX lib). The npm `typecheck`
  script chains `tsc --noEmit -p` across the three roots so one command satisfies R2. _(Was
  solution-style composite/references; revised — see T3.)_
- **Shared base config** — `tsconfig.base.json` centralizes strict flags; each root `extends` it and
  adds only its environment delta (Node types vs DOM/JSX lib). Avoids drift across roots (R3).
- **Explicitly-temporary placeholders** — files named `placeholder.ts`, each removed by the task that
  adds its root's real code. Signals non-final intent; keeps the scaffold minimal (REQ ethos).
- **From CLAUDE.md** — deviations from the architecture spec require editing the doc first; the Node
  ≥22 raise therefore lands as R8 spec edits, not a silent `package.json` value.
- **Intentionally NOT applied** — no path aliases (`paths`), no barrel `index.ts`, no cross-root
  import yet; deferred to #P2-1/#P1-2 so the bundler-resolution decision is made alongside the
  bundlers that must honor it.

## Data Models

None — infrastructure scaffold, no entities.

## API Contracts / Interfaces

No runtime API. The **package manifest surface** established here (consumed by downstream tasks and,
eventually, npm):

| Field | Value | Notes |
|-------|-------|-------|
| `name` | `@foyzulkarim/claude-lens` | Placeholder scope; final rename before #P5-2 (two-field) |
| `bin` | `{ "claude-lens": "dist/cli.js" }` | Command name independent of package name; target built by #P1-2 |
| `engines.node` | `">=22"` | R1; requires R8 arch edit |
| `packageManager` | `"npm@10.9.2"` | Corepack-enforced |
| `license` | `"MIT"` | Matches root LICENSE |
| `type` | `"module"` | ESM |
| npm script `typecheck` | chained `tsc --noEmit -p <root>` | The R2/R3 acceptance command (REQ literally specifies `tsc --noEmit`) |

## Module Boundaries

| Module / Root | Responsibility | Allowed Dependencies |
|---------------|----------------|----------------------|
| `shared/` | (future) contracts — the leaf types module | none (no internal imports) |
| `server/` | (future) Fastify server, ingest, metrics | `shared/` only (references it now; imports it from #P2-1) |
| `client/` | (future) React SPA | `shared/` only; never `server/` |

At #P1-1 these boundaries exist only as `references` wiring + placeholders; enforcement lands when
real modules do.

## Change Footprint

### New files / modules

| Path | Purpose | Pattern reference |
|------|---------|-------------------|
| `package.json` | Root manifest: name/bin/engines/packageManager/license/type, §2 deps+devDeps (caret), `typecheck` script | §2/§3; standard npm ESM package |
| `package-lock.json` | Committed lockfile (R6) | generated by `npm install` |
| `LICENSE` | MIT © 2026 Foyzul Karim (R7) | SPDX MIT text |
| `tsconfig.base.json` | Common strict options (strict, target ES2022, `module`/`moduleResolution` NodeNext) | Shared base, `extends` target |
| `shared/tsconfig.json` | `extends` base, include `**/*.ts` | — |
| `shared/placeholder.ts` | Typed const marker; removed by #P2-1 | — |
| `server/tsconfig.json` | `extends` base, `types: ["node"]` | — |
| `server/placeholder.ts` | Typed const marker; removed by #P1-2 | — |
| `client/tsconfig.json` | `extends` base, `lib` incl. DOM, `jsx: react-jsx`, include `src/**/*` | — |
| `client/src/placeholder.ts` | Typed const marker; removed by #P3-2 (client code under `src/` per §3) | — |

### Modified files / modules

| Path | What changes here |
|------|-------------------|
| `.gitignore` | Add `dist/` and `*.tsbuildinfo` (build/incremental artifacts) |
| `specs/claude-lens-architecture.md` | **R8:** §1 constraint table + body "Bundle targets Node ≥ 18" → "≥ 22"; §12 esbuild `--target=node18` → `--target=node22` |
| `specs/claude-lens-plan.md` | **R8:** decisions-log row (2026-07-10) recording the ≥18→≥22 raise; note the #P1-3 CI Node-version source follow-up (now that `.nvmrc` is dropped and the floor is 22) |

### Deleted / replaced

None. (`legacy/` untouched; #P0-2 already isolated V1 there.)

### Touched but not changed (downstream consumers of this scaffold)

| Path / Task | Why it matters |
|-------------|----------------|
| #P1-2 (dev/build toolchain) | Inherits ESM + the tsconfig shape; esbuild target must be `node22` (R8); it decides the cross-root import convention when wiring vite/esbuild |
| #P2-1 (shared contracts) | Removes `shared/placeholder.ts`, adds real types; first real cross-root import |
| #P3-2 (React shell) | Removes `client/src/placeholder.ts`, adds `@types/react`/`@types/react-dom` + first `.tsx` |
| #P1-3 (CI) | `typecheck` job runs the chained `tsc --noEmit -p` script; Node-version source is now `engines`/setup-node (the dropped-`.nvmrc` follow-up) |

## Areas of Impact

| Area | Impact | Risk | Why |
|------|--------|------|-----|
| #P1-2 dev/build toolchain | Builds directly on the tsconfig shape + ESM chosen here; esbuild `--target=node22` | **M** | If the config shape can't be bundled cleanly, #P1-2 reworks it |
| #P2-1 / #P3-2 | Replace placeholders with real code; #P2-1 sets import-path convention | **L** | Additive; placeholders designed to be removed |
| #P1-3 CI | Typecheck command + Node-version source both originate here | **L** | Single OS/Node job; the `tsc --noEmit -p` chain is deterministic |
| Spec docs (arch §1/§12, plan) | R8 edits ripple to any reader relying on "Node ≥18"/`node18` | **L** | Internal docs; we control every consumer |
| npm / package identity | Placeholder `name`; final rename before #P5-2 | **L** | Tracked (#P0-4/#P5-2); nothing published yet |

**Contract changes:** package `name` is an explicit placeholder (final name a two-field rename before
#P5-2); `bin` command `claude-lens` seeded. No external/published contract exists yet.

**Cross-cutting ripples:** build pipeline (esbuild `node22` in #P1-2), CI Node-version source (#P1-3),
`.gitignore`. No auth/telemetry/migrations/flags — pure scaffold.

## Cross-Cutting Concerns

- **Errors:** none at runtime (no runtime). Type errors surface via the `typecheck` script (chained
  `tsc --noEmit -p`); a deliberately unsound placeholder must fail the check (R3).
- **Logging & metrics:** N/A.
- **Auth / authz:** N/A.
- **Performance:** keep `dependencies` to exactly the §2 six (N1) for npx cold-start weight; no build
  artifacts committed (`dist/`, `*.tsbuildinfo` gitignored).
- **Security:** no secrets (`.env*` already gitignored); all deps pure-JS, **no `postinstall`** (N2);
  committed `package-lock.json` pins the full dependency graph for reproducible, supply-chain-stable
  installs.
- **Migrations / rollout:** none. Purely additive at the repo root; V1 untouched in `legacy/`. Fully
  reversible (delete the new files, revert the two doc edits).

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies REQs |
|---|----------|--------------|----------------|----------------|
| A1 | Single package, three sibling roots, no workspaces | npm workspaces | One manifest/one dep set per REQ; no per-package overhead | R1, R4, R5 |
| A2 | Per-root strict configs sharing one base via `extends` (server `types:["node"]`; client DOM `lib`+`jsx`) | project references/composite; 3 independent configs; single globbed config | Per-root compiler options + cross-root graph checking (NodeNext resolves `../shared` once #P2-1 imports). _(Revised from composite/references at implementation — `tsc -b --noEmit` is incompatible with cross-root references in TS 7.0.2, TS6310; see T3.)_ | R2, R3 |
| A3 | Typecheck = chained `tsc --noEmit -p <root>` (npm script `typecheck`) | `tsc -b --noEmit` (TS6310 under references); bare `tsc --noEmit` on composite (TS5053); `tsc -b` (emits) | The REQ R2/R3 literal `tsc --noEmit`; checks each root without emitting | R2 |
| A4 | ESM (`type:module`, NodeNext) | CommonJS | Node 22 + ESM-first §2 stack + esbuild/vite | R1 (engines), §12 |
| A5 | Self-contained typed-const placeholders | Cross-root import placeholder | Minimal; defers import convention + bundler resolution to #P2-1/#P1-2 | R2, R3 |
| A6 | `@types/node` now; React stubs deferred | all @types now; none | Server is Node; no JSX until #P3-2; @types are devDeps so `dependencies` stays the §2 six | R3, R4, N1 |
| A7 | Node floor ≥22 + companion §1/§12 arch edit + plan log row | ≥18 (spec); ≥20 | 18 EOL; honor the "deviations edit the doc first" rule | R1, R8 |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|----------|---------------------------|
| `tsc -b --noEmit` fails with TS6310 (referenced project may not disable emit) in TS 7.0.2 | Use per-root `tsc --noEmit -p` (chained) — no composite/references, so neither TS5053 nor TS6310 can fire; this is the REQ R2/R3 literal command |
| Contributor clones on Node 20/older | `engines.node ">=22"` → npm warns (non-fatal unless `engine-strict`); Corepack enforces `npm@10.9.2`. Documented floor |
| `packageManager: "npm@10.9.2"` invalid/unavailable | 10.9.2 is a real published npm (Node 22 LTS line); bumpable to the implementer's local Node 22 npm — Corepack validates the exact string |
| A dependency's caret resolve is incompatible with Node 22 | Floor is ≥22 (not a ceiling); lockfile pins exact resolved versions; deviating from §2 deps requires a §2 edit first |
| `client/tsconfig` sets `jsx` but `@types/react` absent | No `.tsx`/JSX exists at #P1-1 (placeholder is `.ts`), so the react-jsx transform never triggers; stubs added by the first-JSX task |
| Stray build artifacts written into the tree | `tsc --noEmit` writes nothing; `.gitignore` also covers `*.tsbuildinfo` (+ `dist/`) as a belt-and-braces guard |

### Backward — regression risk

Greenfield — no existing runtime behavior to regress. The only modified existing artifacts are
`.gitignore` (additive) and the two spec docs (R8). Regression surface = **doc consistency**: any
reader or future task citing "Node ≥18"/`--target=node18` must now see ≥22/`node22`. Mitigation: R8
edits both mentions in §1 and the §12 mention in one pass; the plan decisions-log row records the
rationale so it isn't re-litigated.

## Open Questions

- **`@types/react` / `@types/react-dom` timing.**
  - **Impact if unresolved:** client typecheck fails the moment JSX lands without them (caught immediately).
  - **Suggested default:** #P3-2 (React shell) adds them with the first `.tsx`; #P1-1 ships only `@types/node`.
- **Exact `npm` pin may need to match the implementer's local Node 22 npm.**
  - **Impact if unresolved:** Corepack rejects a mismatched string.
  - **Suggested default:** `npm@10.9.2`; bump to the local Node 22 LTS npm if it differs.
- **Cross-root import convention (relative `.js` vs `paths` alias).**
  - **Impact if unresolved:** affects import ergonomics + which bundler-resolution config #P1-2 needs.
  - **Suggested default:** decide at #P2-1 (first real import) alongside #P1-2's vite/esbuild config; not needed for #P1-1.

## Out of Scope

- `cli.ts`, `app.ts`, hello-world SPA, `/api/ping`, dev server, `scripts/build.ts` (reason: #P1-2).
- `shared/` contracts — `types.ts`, `metrics-contract.ts`, `ws-protocol.ts` (reason: #P2-1).
- All other §3 sub-tree files — `ingest/`, `store/`, `metrics/`, `gates/`, `routes/`, `config/`, pages (reason: their own phase tasks).
- CI (#P1-3), Storybook (#P1-4), lint/format — Biome (#P1-5).
- Final non-placeholder package name + npm reservation (reason: #P0-4 / #P5-2).
- Path aliases / cross-root import convention (reason: deferred to #P2-1/#P1-2).

---

# Tasks

## Task T1: Node-floor spec consistency edit

> **Status:** done
> **Verification:** checklist
> **Effort:** xs
> **Priority:** high
> **Depends on:** None
> **Satisfies REQs:** R8
> **Footprint slice:** Modified: `specs/claude-lens-architecture.md` (§1, §12), `specs/claude-lens-plan.md` (decisions log)
> **High-risk areas touched:** None (Areas of Impact: "Spec docs" — Low risk, internal docs only)

### Description

Raise the documented Node floor from ≥18 to ≥22 in the architecture spec, and record the decision
in the plan's decisions log, *before* any manifest declares the deviating value. This satisfies the
repo rule that architecture deviations are edited into the doc first, not left implicit in config.

### Verification Checklist

- **§1 constraint table updated** — `grep -n "Node ≥ 22" specs/claude-lens-architecture.md` matches
  the §1 constraint-table row — expected: 1 match _(verifies R8)_
- **§1 body updated** — same grep also matches the §1 body sentence ("Bundle targets Node ≥ 22") —
  expected: 2 total matches across the file for "Node ≥ 22" _(verifies R8)_
- **§12 esbuild target updated** — `grep -n "target=node22" specs/claude-lens-architecture.md`
  matches the §12 esbuild line — expected: 1 match _(verifies R8)_
- **Old floor fully replaced, not supplemented** — `grep -n "Node ≥ 18\|target=node18"
  specs/claude-lens-architecture.md` — expected: 0 matches
- **Plan decisions log updated** — `grep -n "2026-07-10" specs/claude-lens-plan.md` includes a new
  row referencing #P1-1 and the ≥18→≥22 raise — expected: row present, rationale states Node 18 EOL
  _(verifies R8)_
- **CI follow-up preserved** — the existing 2026-07-10 decisions-log row about `.nvmrc` being dropped
  and #P1-3's Node-version-source follow-up is not deleted or contradicted by the new row

### Implementation Notes

- **Module(s):** N/A — documentation only.
- **Pattern reference:** existing decisions-log row format in `specs/claude-lens-plan.md` (dated rows
  with Decision / Where reflected columns).
- **Key decisions:** ARCH A7 — Node floor ≥22 requires this companion edit; this task *is* A7.
- **Libraries:** N/A.
- **High-risk callouts:** None — pure doc edit, Low risk per ARCH Areas of Impact.

### Scope Boundaries

- Do NOT touch `package.json`, any `tsconfig.json`, `LICENSE`, or `.gitignore` — those are T2/T3.
- Do NOT edit any other section of either spec doc beyond the cited §1/§12 (architecture) and the
  decisions-log table (plan) — no drive-by edits.
- Only implement the ≥18→≥22 / `node18`→`node22` text replacement and the one new decisions-log row.

### Files Expected

**New files:** None.

**Modified files:** _(from ARCH "Modified files / modules")_
- `specs/claude-lens-architecture.md` (§1 constraint table + body "Node ≥ 18" → "≥ 22"; §12
  `--target=node18` → `--target=node22`)
- `specs/claude-lens-plan.md` (new decisions-log row, 2026-07-10, documenting the raise)

**Must NOT modify:**
- `package.json`, `tsconfig*.json`, `LICENSE`, `.gitignore` (T2/T3 scope)

---

## Task T2: Package manifest & license

> **Status:** done
> **Verification:** checklist
> **Effort:** s
> **Priority:** critical
> **Depends on:** T1
> **Satisfies REQs:** R1, R4, R5, R6, R7, N1, N2
> **Footprint slice:** New: `package.json`, `package-lock.json`, `LICENSE`; Modified: `.gitignore`
> **High-risk areas touched:** None (Areas of Impact: "npm/package identity" — Low risk, nothing published yet)

### Description

Create the root `package.json` (placeholder scoped name, `bin`, `engines`/`packageManager` pins,
`license`, `type: module`, the exact §2 dependency lists as `dependencies`/`devDependencies` with
caret ranges), its committed lockfile, the MIT `LICENSE`, and extend `.gitignore` for build
artifacts. This is the first manifest in the repo since V1 moved to `legacy/` (#P0-2) and everything
in Phase 1+ depends on it.

### Verification Checklist

- **Package identity** — `npm pkg get name` → `"@foyzulkarim/claude-lens"` _(verifies R1)_
- **Bin** — `npm pkg get bin` → `{"claude-lens":"dist/cli.js"}` _(verifies R1)_
- **Engines** — `npm pkg get engines` → `{"node":">=22"}` — expected to match T1's already-updated
  spec floor _(verifies R1)_
- **Package manager pin** — `npm pkg get packageManager` → `"npm@10.9.2"` _(verifies R1)_
- **License + module type** — `npm pkg get license type` → `"MIT"` / `"module"` _(verifies R1, R7)_
- **Production deps exact match** — `npm pkg get dependencies` → exactly `fastify`,
  `@fastify/static`, `@fastify/websocket`, `fast-glob`, `open`, `pino-pretty`, each `^`-ranged, no
  extras — expected: set equality with ARCH's §2 server list _(verifies R4, N1)_
- **Dev deps include full §2 client + toolchain list** — `npm pkg get devDependencies` includes
  react, react-dom, wouter, @tanstack/react-query, @tanstack/react-table, @tanstack/react-virtual,
  echarts, minisearch, date-fns, tailwindcss, clsx, typescript, vite, @vitejs/plugin-react, esbuild,
  tsx, vitest, plus `@types/node` (ARCH A6) — expected: all present, `^`-ranged _(verifies R5)_
- **Lockfile committed** — `test -f package-lock.json && git ls-files --error-unmatch
  package-lock.json` — expected: tracked _(verifies R6)_
- **LICENSE correct** — `test -f LICENSE && grep -q "MIT License" LICENSE && grep -q "Foyzul Karim"
  LICENSE && grep -q "2026" LICENSE` — expected: all match _(verifies R7)_
- **.gitignore extended** — `grep -qx "dist/" .gitignore && grep -qx "*.tsbuildinfo" .gitignore` —
  expected: both present (needed before T3 runs `tsc -b`, per ARCH forward-stress scenario)
- **No install-time scripts** — `npm pkg get scripts.postinstall scripts.preinstall` → both
  `undefined` — expected: no lifecycle install scripts _(verifies N2)_
- **No native deps** — manual confirmation that every §2 library is pure-JS (already true by
  ARCH's dependency selection) — expected: `npm install` completes with no native build step
  _(verifies N2)_

### Implementation Notes

- **Module(s):** N/A — package manifest, not a code module.
- **Pattern reference:** none in-repo (greenfield); `legacy/package.json` confirmed as an unrelated
  CJS/Express stack — not a pattern to follow, only useful as a caret-range precedent (already true
  of R6).
- **Key decisions:** ARCH A1 (single package, no workspaces), A6 (`@types/node` now, React stubs
  deferred), A7 (engines ≥22 — value now consistent with T1's already-updated spec).
- **Libraries:** exact §2 lists — see ARCH Tech Choices table for the full dependency/devDependency
  enumeration.
- **High-risk callouts:** None.

### Scope Boundaries

- Do NOT create `tsconfig.base.json`, `tsconfig.json`, or any per-root `tsconfig.json`/placeholder —
  that's T3.
- Do NOT include any dependency outside the exact §2 lists (no chokidar, DB driver, zod,
  commander/yargs, date libs beyond `date-fns`, etc.) — N1.
- Do NOT set a final, non-placeholder package `name` — deferred to #P0-4/#P5-2.
- Do NOT add a `postinstall`/`preinstall` script or any native dependency — N2.

### Files Expected

**New files:** _(from ARCH "New files / modules")_
- `package.json` — root manifest: name/bin/engines/packageManager/license/type, §2 deps+devDeps
  (caret), `typecheck` script (`tsc -b --noEmit`, functional once T3 lands)
- `package-lock.json` — committed lockfile
- `LICENSE` — MIT © 2026 Foyzul Karim

**Modified files:** _(from ARCH "Modified files / modules")_
- `.gitignore` — add `dist/` and `*.tsbuildinfo`

**Must NOT modify:**
- `tsconfig.base.json`, `tsconfig.json`, `shared|server|client/tsconfig.json`,
  `shared/placeholder.ts`, `server/placeholder.ts`, `client/src/placeholder.ts` (T3 scope)
- `specs/claude-lens-architecture.md`, `specs/claude-lens-plan.md` (T1 scope, already landed)

---

## Task T3: TS project-references graph

> **Status:** done
> **Verification:** checklist
> **Effort:** m
> **Priority:** critical
> **Depends on:** T2
> **Satisfies REQs:** R2, R3
> **Footprint slice:** New: `tsconfig.base.json`, `shared/tsconfig.json`, `shared/placeholder.ts`, `server/tsconfig.json`, `server/placeholder.ts`, `client/tsconfig.json`, `client/src/placeholder.ts`; Modified: `package.json` (`typecheck` script — see resolution note). Root solution `tsconfig.json` from the original plan was **not** created (no function without composite/references).
> **High-risk areas touched:** "#P1-2 dev/build toolchain" — Medium risk (ARCH Areas of Impact: #P1-2 builds directly on this tsconfig shape + ESM; if the shape can't be bundled cleanly, #P1-2 reworks it)

### Description

> **Implementation resolution — A2/A3 conflict (recorded for the reviewer):** ARCH decisions A2
> (project references / `composite`) and A3 (`tsc -b --noEmit`) are **mutually incompatible** in
> TypeScript 7.0.2. `tsc -b --noEmit` errors **TS6310** ("Referenced project may not disable emit")
> whenever a project references another — confirmed by
> [microsoft/TypeScript#53979](https://github.com/microsoft/TypeScript/issues/53979) (still open):
> *"`tsc --build --noEmit` is supported unless a project references another project."* Resolved by
> deferring to the **REQ**, whose R2/R3 acceptance criteria literally specify `tsc --noEmit` (not
> `tsc -b --noEmit`): **`composite`/`references` dropped; each root is an independent strict config
> (`extends` base + env delta) typechecked by chained `tsc --noEmit -p <root>`.** A2's stated
> rationale (per-root compiler options + cross-root graph checking) is preserved — per-root options
> via `extends`; cross-root imports resolve via NodeNext relative paths once #P2-1 adds them. tsc is a
> type-checker only here (esbuild/vite bundle per §12), so composite's incremental-build payoff is
> unused. The solution-style root `tsconfig.json` was not created (no function without references).
> Recorded in this task section. **Action for the reviewer / next plan-architecture pass:** the A2/A3 rows in the Architecture Decisions Log (above `# Tasks`) and the plan decisions log should get a reconciling edit — both are outside T3's edit scope (above `# Tasks` / Must-NOT-modify), so left to the developer.

Three strict-TS roots share one `tsconfig.base.json` of common options (strict, ES2022, NodeNext).
Each root `extends` it and adds its environment delta: `server` sets `types: ["node"]` (exercised by
`process.version` in its placeholder); `client` adds DOM `lib` + `jsx: react-jsx`. One npm script —
`typecheck` — runs `tsc --noEmit -p` against each root in turn, typechecking all three without
emitting any artifacts.

### Verification Checklist

- **All three roots typecheck** — `npm run typecheck` (→ chained `tsc --noEmit -p <root>`) exits 0 —
  expected: exit code 0, no diagnostics _(verifies R2 — the REQ/issue literal `tsc --noEmit` AC)_
- **No emit, no TS5053/TS6310** — the command uses `--noEmit` on non-composite configs, so neither
  the noEmit+composite (TS5053) nor referenced-project (TS6310) error can fire — expected: clean
  _(confirms the A2/A3 resolution)_
- **Placeholder presence & shape** — `shared/placeholder.ts`, `server/placeholder.ts`,
  `client/src/placeholder.ts` each exist, each export one typed const — expected: exactly one file
  per root, `client`'s under `src/` per architecture §3 _(verifies R2 non-vacuously)_
- **Strict mode is real, not vacuous** — temporarily introduce an implicit-`any` into one
  placeholder → `npm run typecheck` fails with a strict-mode diagnostic (observed TS7006); revert and
  confirm it passes again — expected: fails while unsound, passes after revert _(verifies R3)_
- **Extends wiring** — `grep -l '"extends": "../tsconfig.base.json"' shared/tsconfig.json
  server/tsconfig.json client/tsconfig.json` → all three — expected: all 3/3
- **Server/client compiler-option split** — `server/tsconfig.json` includes `"types": ["node"]`;
  `client/tsconfig.json` includes a DOM `lib` entry and `"jsx": "react-jsx"` — expected: both present,
  confirming the per-root option divergence over a single config
- **No stray build artifacts** — after `npm run typecheck`, `git status --porcelain` shows no
  untracked `*.tsbuildinfo`, `.d.ts`, or `dist/` paths — expected: clean (`--noEmit` writes nothing)

### Implementation Notes

- **Module(s):** `shared/` (leaf, no internal imports), `server/`, `client/` — per ARCH Module
  Boundaries; boundaries are enforced by per-root configs at this task, no real cross-root imports
  exist yet (#P2-1 adds the first).
- **Pattern reference:** none in-repo (greenfield) — strict per-root configs sharing one base via
  `extends`; the npm `typecheck` script chains `tsc --noEmit -p` across the three roots.
- **Key decisions:** ARCH A4 (ESM/NodeNext), A5 (self-contained placeholders, no cross-root import
  yet), A6 (`@types/node` via `types: ["node"]`; no React stubs — no `.tsx` exists yet). **A2/A3
  resolved at implementation time** — see the Description resolution note (composite/project
  references + `tsc -b --noEmit` are incompatible in TS 7.0.2; dropped in favor of the REQ's literal
  `tsc --noEmit` per-root shape).
- **Libraries:** `typescript` (from T2's devDependencies) is the only library this task exercises.
- **High-risk callouts:** Medium risk — #P1-2 (dev/build toolchain) builds directly on this tsconfig
  shape and must target `esbuild --target=node22` to match. The extends/per-root-option greps confirm
  #P1-2 inherits a shape that's already correct, not one that "happens to typecheck" by accident.

### Scope Boundaries

- Do NOT create any real source file — `shared/types.ts`, `shared/metrics-contract.ts`,
  `shared/ws-protocol.ts` (#P2-1); `server/cli.ts`, `server/app.ts` (#P1-2); `client/src/main.tsx`,
  `App.tsx` (#P3-2). Placeholders only.
- Do NOT add `paths` aliases or any cross-root `import` statement — deferred to #P2-1/#P1-2 per ARCH
  Open Questions.
- Do NOT install `@types/react`/`@types/react-dom` — deferred to #P3-2 (first `.tsx`); `client`'s
  `jsx` compiler option is set now but nothing exercises the JSX transform yet.
- Do NOT modify `package.json`'s dependency lists — T2 scope, already landed.

### Files Expected

**New files:** _(from ARCH "New files / modules")_
- `tsconfig.base.json` — common strict options (strict, target ES2022, `module`/`moduleResolution`
  NodeNext)
- `shared/tsconfig.json` — extends base, no DOM lib
- `shared/placeholder.ts` — typed const; removed by #P2-1
- `server/tsconfig.json` — extends base, `types: ["node"]`
- `server/placeholder.ts` — typed const (`process.version`); removed by #P1-2
- `client/tsconfig.json` — extends base, DOM lib, `jsx: react-jsx`
- `client/src/placeholder.ts` — typed const; removed by #P3-2 (client code lives under `src/` per §3)

**Modified files:**
- `package.json` — `typecheck` script changed from the T2 placeholder (`tsc -b --noEmit`) to the
  per-root chain (`tsc --noEmit -p <root>`). T2's Files note stated the script is "functional once T3
  lands"; this edit makes it so. Dependency lists untouched (still T2's).

**Must NOT modify:**
- `package.json` **dependency lists**, `package-lock.json`, `LICENSE`, `.gitignore` (T2 scope, already landed). Note: the `typecheck` script *value* IS modified by T3 (see Modified files above) — only the dependency lists stay T2-owned.
- `specs/claude-lens-architecture.md`, `specs/claude-lens-plan.md` (T1 scope, already landed)
