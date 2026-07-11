# Code Review — Branch `feat/13/scaffold-three-root-ts-package`

**Scope:** code-only (task-completion + docs skipped per request) · **Date:** 2026-07-10
**Stack:** TypeScript 7.0.2, ESM/NodeNext, no runtime code yet (Fastify/React deps declared only)
**Checks run:** config-dependencies, typescript-strictness, code-quality
**Verdict:** ✅ **APPROVE** — no Critical or High. Four Low findings, all latent/optional; none block merge.

## Review Process
- [x] Preflight passed (git repo, `main` default, branch exists)
- [x] Diff gathered (16 files, ~50 code lines + 4032 generated lockfile lines)
- [x] Stack detected: TS 7.0.2 / ESM / no runtime code
- [x] Triage confirmed: config&deps + TS config + code-quality
- [x] Reviewed inline (surface too small to warrant agent dispatch)
- [x] `npm run typecheck` → exit 0 confirmed

## Findings

### 💭 L1 — `client/tsconfig.json` include glob won't match `.tsx` files
`client/tsconfig.json:7` → `"include": ["src/**/*.ts"]`. TypeScript treats an **explicit** `.ts` extension in an include glob literally — it does **not** expand to `.tsx`. The client root sets `"jsx": "react-jsx"` specifically to compile JSX, but when #P3-2 adds `main.tsx`/`App.tsx` under `src/`, this pattern silently won't pick them up. Latent (no `.tsx` exists yet, so typecheck passes today), but it's a trap the next task inherits. Fix is `["src"]` or `["src/**/*"]` (no extension → TS appends `.ts`/`.tsx`/`.d.ts`). `shared/` and `server/` use `**/*.ts` correctly since they only hold `.ts`.

### 💭 L2 — `@types/node ^26` vs `engines.node ">=22"`
`package.json` — `@types/node@^26.1.1` tracks Node 24+ typings while the supported floor is Node 22. The compiler will type-allow `node:` APIs that don't exist at runtime on 22 (green typecheck, runtime `undefined`). Conventionally `@types/node` major is pinned to the **minimum** supported Node (`^22`). Low because no server code consumes Node APIs yet beyond `process.version`.

### 💭 L3 — No `noEmit`/`outDir` in any tsconfig
The `typecheck` script always passes `--noEmit`, so the graph is safe. But a bare `tsc -p server/tsconfig.json` (a natural thing for a contributor to type) would **emit `.js` next to the `.ts` sources** — and those stray files aren't covered by `.gitignore` (only `dist/` + `*.tsbuildinfo` are). Adding `"noEmit": true` to `tsconfig.base.json` makes the footgun structurally impossible. (ARCH's own stress-test table calls out "stray build artifacts" as a concern — this closes the last gap.)

### 💭 L4 — `isolatedModules` / `verbatimModuleSyntax` not set (optional, likely #P1-2)
§12 bundles per-file via esbuild/vite. `isolatedModules: true` makes `tsc` reject the file-by-file-unsafe patterns esbuild can't catch, and `verbatimModuleSyntax: true` disambiguates type-only imports for the bundler. Reasonable to defer to #P1-2 (which owns the bundler wiring), but worth a decision rather than an omission.

### Nit — redundant `: string` on placeholders
`shared/placeholder.ts:5`, `client/src/placeholder.ts:5` annotate a string literal with `: string` (widening, redundant). Harmless, and plausibly intentional to make strict mode a "non-vacuous" signal per T3's checklist — leaving as-is is fine.

## What's correct
- Six prod `dependencies` exactly match ARCH §2, all caret-ranged; full devDep toolchain present; `@types/node` correctly a devDep (keeps `dependencies` at the §2 six per N1). ✅
- No `postinstall`/`preinstall`; all deps pure-JS (N2). ✅
- Fastify v5 ↔ `@fastify/static@9` ↔ `@fastify/websocket@11` are mutually compatible majors. ✅
- Per-root `extends ../tsconfig.base.json`; `types:["node"]` (server) vs `lib` DOM + `jsx` (client) split is clean; committed lockfile; MIT LICENSE. ✅
- `.gitignore` covers `dist/` + `*.tsbuildinfo`. ✅

---

None of L1–L4 block merge — L1 is the only one with downstream teeth (it'll cost #P3-2 a few minutes if unfixed), and L3 is a cheap one-line hardening.
