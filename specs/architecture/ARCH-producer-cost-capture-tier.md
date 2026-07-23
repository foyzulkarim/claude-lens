# Architecture: Producer side of the premium cost-capture tier

> **Date:** 2026-07-23
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Standalone brief — GitHub issue #112 (no REQ doc; see Inferred Requirements)
> **Type:** feature

## Architecture Summary

Phase 4 shipped the premium tier consumer-first: `server/ingest/parse-premium.ts` reads
three sidecar formats (C/B/L) that upgrade a session from computed 🟡 to observed 🟢, but
nothing in the repo ever *writes* them. This task vendors the four proven capture scripts
that are running live on the author's machine into a new top-level `capture/` directory,
adds an idempotent `install.sh` that merges them into `~/.claude/settings.json` without
clobbering existing config, and repoints `CostCaptureGuide.tsx` at real paths.

The one non-obvious problem is **reachability**: the package has 230+ npm installs and the
dominant install path is `npx @foyzulkarim/claude-lens`, which unpacks into an unguessable
`~/.npm/_npx/<hash>/…` directory. Static instructions cannot serve those users. So the build
copies `capture/` into `dist/`, a small server module resolves its own absolute location at
runtime, and a new one-field endpoint `GET /api/capture-assets` hands the guide a real
copy-pasteable path — either a `bash …/install.sh` command or a prompt the user can paste
into their own Claude Code session.

No existing contract changes. The scripts' emitted field names were verified line-by-line
against `parse-premium.ts` and already match exactly — this task vendors and wires proven
code, it does not redesign the capture format.

## Inferred Requirements (Mode B — from issue #112)

| ID  | Inferred Requirement                                                                                          | Source                     |
|-----|---------------------------------------------------------------------------------------------------------------|----------------------------|
| R1  | A `capture/` directory exists in the repo containing the capture scripts, a settings snippet, and a README     | #112 Acceptance 1          |
| R2  | Emitted C/B/L field names match `server/ingest/parse-premium.ts` exactly; filenames stay dot-separated         | #112 Acceptance 2, arch §4 |
| R3  | `install.sh` is idempotent, backs up `settings.json` before writing, and merges rather than overwrites         | #112 Acceptance 3          |
| R4  | `CostCaptureGuide.tsx` names only paths/commands that actually exist; the live `captureSummary` readout stays  | #112 Acceptance 4          |
| R5  | After install + one session, the session shows as observed 🟢 in Data Health / dashboard                       | #112 Acceptance 5          |
| R6  | A user's existing statusline keeps rendering after install                                                     | #112 Scope 1 (cost-logger) |
| R7  | The capture assets are reachable by users who installed via `npx`, not only by repo clones                     | User: 230+ npm installs    |
| R8  | Setup is completable either by the user directly or by delegating to Claude Code on the user's machine         | User: "let the Claude of user's pc take care of some things" |

## High-Level Structure

Capture rides on the **statusline**, not on hooks, for a reason worth stating up front:
cost data (`cost.total_cost_usd`, cache tokens, `total_api_duration_ms`) exists **only** in
the statusline stdin payload. Hook payloads do not carry it. That is why the producer is a
statusline wrapper plus one Stop hook, rather than two hooks.

```
Claude Code
  │
  ├── statusLine.command ──► statusline-command.cjs      (no prior statusline)
  │                          │  ├─ require('./cost-logger.cjs').logCost(payload)
  │                          │  └─ render model / $ / context bar / timers
  │                          │
  │                     OR ► statusline-wrapper.cjs      (user HAD a statusline)
  │                             ├─ require('./cost-logger.cjs').logCost(payload)
  │                             └─ spawn /bin/sh -c <statusline-original.json>, pass stdout through
  │                                    │
  │                          cost-logger.cjs  ──┬──► ~/.claude/projects/<slug>/<uuid>.cost.jsonl   (C)
  │                                             └──► ~/.claude/cost-log.jsonl                       (L)
  │
  └── hooks.Stop ──────────► turn-logger.cjs ──────────► ~/.claude/projects/<slug>/<uuid>.turn-boundaries.jsonl  (B)

                                          … files land next to the transcript, where
                                          server/ingest/discovery.ts already finds them.
```

Consumer side is untouched — discovery, `parse-premium.ts`, reconciliation, and the store
already handle C/B/L. This task closes the loop on the left-hand side of that diagram.

**Reachability path (new):**

```
capture/  ──[scripts/build.ts cp]──►  dist/capture/  ──[files:["dist"]]──►  published npm package
                                            │
              server/capture-assets.ts resolves its own dir from import.meta.url
                                            │
                            GET /api/capture-assets → { captureDir }
                                            │
                    CostCaptureGuide.tsx renders a real absolute path
```

## Tech Choices

| Area                  | Decision                                                        | Alternatives Considered                                                        | Rationale                                                                                                                                    |
|-----------------------|-----------------------------------------------------------------|--------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------|
| Script module format  | CommonJS with explicit `.cjs` extension                         | Keep `.js` verbatim; convert to ESM                                            | Repo is `"type": "module"`, so a `.js` CJS file cannot run from a repo checkout at all. `.cjs` runs correctly both in-repo and in `~/.claude/scripts`. ESM conversion would rewrite proven-working code for no runtime gain. |
| Settings merge engine | Node one-liner invoked by `install.sh`                          | `jq`; `python3`; hand-rolled `sed`                                             | `install.sh` must already resolve a `node` binary to write the hook commands — so node is guaranteed present. `jq` is not installed by default on macOS. |
| Asset distribution    | `scripts/build.ts` copies `capture/` → `dist/capture/`          | Add `"capture"` to `package.json` `files`; `curl \| bash` from the server; a `claude-lens setup-capture` CLI subcommand | Mirrors the existing `dist/public` copy idiom exactly, needs no `files` change, and gives one predictable in-package layout. A CLI subcommand was the user's non-choice and is much larger scope. |
| Path surfacing        | New `GET /api/capture-assets` → `{ captureDir: string \| null }` | Extend `HealthSnapshot`; extend `AppConfig`; hardcode static text              | `HealthSnapshot`'s contract states all its fields are required and non-nullable — a nullable path would violate it and ripple through ~4 test files. `AppConfig` is user-owned persisted settings, not server-derived facts. Static text cannot serve npx users (R7). |
| Lint/format scope     | Add `"capture/**"` to `biome.json` `includes`                   | Leave `capture/` unlinted to preserve byte-identical vendoring                 | User's explicit choice. Verified cost: 21 lint diagnostics, all `info`-level and auto-fixable (`node:` protocol, `parseInt` radix, template literals); `biome lint` already exits 0. `biome format` exits 1, so the files must be reformatted to repo style. |

## Patterns & Conventions

- **Vendor-then-conform** — the scripts are copied from `~/.claude/scripts/` as the source of
  truth for *behavior*, then reformatted to repo style. Behavior must not change during the
  copy; the only sanctioned edits are the `.cjs` rename (and its `require` targets), biome's
  safe fixes, and the two hardening fixes called out in A6.
- **Silent capture** — a capture failure must never break the user's statusline or Stop hook.
  `logCost` throws freely; every call site wraps it in `try { … } catch (_) {}`. This is
  existing behavior in the vendored code and is load-bearing.
- **Additive-only ingest contract** — `parse-premium.ts` is *not* modified. If a field
  mismatch had been found, the correct move would be fixing the producer, not the parser.
- **Two-candidate path resolution** — `capture-assets.ts` resolves relative to
  `import.meta.url`, trying `../capture` (dev, source tree) then `./capture` (the esbuild
  bundle at `dist/cli.js`). Same idiom as `scripts/build.ts` deriving `rootDir`.
- **CLAUDE.md** — `npm run verify` gate; PR body must carry `Closes #112`.

## Data Models

The producer's output *is* the data model, and it is already fixed by `parse-premium.ts`.
Verified against real emitted lines on this machine on 2026-07-23 — **all three match
exactly, no renames required.**

### C — `<uuid>.cost.jsonl` (one cost sample, ~5s resolution during activity)

**Purpose:** observed per-sample cost/duration/lines deltas, bucketed into turns by B.

| Field                 | Type   | Notes                                                                             |
|-----------------------|--------|-----------------------------------------------------------------------------------|
| `session_id`          | string | Mandatory partition key — a missing/empty value makes the line malformed           |
| `sample`              | number | Monotonic per session; paired with `epoch` (the epoch-indexed variant)             |
| `timestamp`           | string | ISO, seconds precision. **The reconciliation key** — variant-agnostic              |
| `epoch`               | number | Unix seconds                                                                       |
| `cost_delta_usd`      | number | Δ since previous sample, 6dp                                                       |
| `cumulative_cost_usd` | number | Session total at sample time                                                       |
| `api_duration_ms`     | number | Δ since previous sample                                                            |
| `cache_read_tokens`   | number | Point-in-time, not accumulated                                                     |
| `cache_write_tokens`  | number | Point-in-time, not accumulated                                                     |
| `lines_added`         | number | Δ since previous sample                                                            |
| `lines_removed`       | number | Δ since previous sample                                                            |
| `context_pct`         | number | Floored integer percentage                                                         |
| `prompt_id`           | —      | **Not emitted.** Optional in the parser; its absence makes the Data Health promptId-mismatch check skip these samples rather than count them as mismatches |
| `turn`                | —      | **Not emitted.** The turn-indexed variant; mutually exclusive with `epoch`+`sample` |

**Lifecycle:** created on first activity sample → appended ~every 5s while
`api_duration_ms` changes → never rotated or truncated by the producer.

### B — `<uuid>.turn-boundaries.jsonl` (one Stop-hook turn end)

| Field             | Type   | Notes                                                        |
|-------------------|--------|--------------------------------------------------------------|
| `session_id`      | string | Mandatory partition key                                      |
| `turn_end`        | string | ISO, seconds precision                                       |
| `turn_end_epoch`  | number | Unix seconds                                                 |
| `transcript_path` | string | Absolute path back into the T file, for turn investigation   |

### L — `~/.claude/cost-log.jsonl` (one row per session, upserted)

| Field         | Type   | Notes                                                                          |
|---------------|--------|--------------------------------------------------------------------------------|
| `session_id`  | string | Mandatory partition key; also the upsert key                                   |
| `timestamp`   | string | ISO of last update                                                             |
| `cost_usd`    | number | Session total (**not** a delta — differs from C by design)                      |
| `dir`         | string | Absolute `workspace.current_dir`                                                |
| `model`       | string | `model.display_name`                                                            |
| `duration_ms` | number | Session wall-clock (**not** `api_duration_ms`)                                  |
| `cache_read`  | number | **Accumulated** across samples (differs from C's point-in-time `cache_read_tokens`) |
| `cache_write` | number | Accumulated                                                                     |
| `lines_added` | number | Session total                                                                   |
| `lines_removed`| number| Session total                                                                   |
| `context_pct` | number | Latest                                                                          |

**Lifecycle:** upserted on every capture tick — the whole file is read, the session's prior
row filtered out, the new row appended. See A7 and the stress-test table for the concurrency
consequence.

### Project-directory slug rule (shared by C and B)

Both writers derive the target directory as `dir.replace(/[/.]/g, '-')` — slashes **and**
dots become dashes, underscores survive. This mirrors Claude Code's own project-dir naming
so sidecars land beside the transcript where `server/ingest/discovery.ts` globs for them.
Getting this wrong is silent: files are written successfully, just never discovered.

## API Contracts / Interfaces

### `GET /api/capture-assets` (new)

**Boundary:** HTTP API

| Method/Op | Path                  | Purpose                                           | Returns                                    |
|-----------|-----------------------|---------------------------------------------------|--------------------------------------------|
| GET       | `/api/capture-assets` | Absolute on-disk location of the vendored `capture/` dir, so the guide can render a runnable command | `200 { captureDir: string \| null }` — `null` when the directory cannot be resolved (e.g. a dev server started outside a build, or a stripped install) |

**Auth requirements:** none — same posture as every other `/api/*` route (localhost-only
single-user app).

### `capture/cost-logger.cjs`

**Boundary:** internal module + standalone CLI

| Op            | Signature                             | Purpose                          | Errors                                        |
|---------------|---------------------------------------|----------------------------------|-----------------------------------------------|
| `logCost`     | `(payload: StatuslineJson) => void`   | Write one C sample + upsert L    | Throws; **callers must wrap in try/catch**    |
| standalone    | `echo "$JSON" \| node cost-logger.cjs` | Same, from stdin                 | Swallowed internally                          |

Returns early without writing when: `session_id` is empty; `api_duration_ms` is unchanged
since the last tick (no activity); or cumulative counters went backwards (resume guard —
re-baselines instead of emitting a negative delta).

### `capture/install.sh`

**Boundary:** shell entrypoint

| Op | Invocation | Purpose | Exit codes |
|----|-----------|---------|------------|
| install | `bash capture/install.sh` | Resolve node, copy scripts to `~/.claude/scripts/`, merge settings | `0` installed or already-configured; `1` node not found, `settings.json` unparseable, or write failed |

**Merge behavior — `statusLine`:**

| Existing `statusLine.command`                              | Action                                                                                                  |
|------------------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| absent                                                     | set → `<node> ~/.claude/scripts/statusline-command.cjs`                                                  |
| already references `statusline-command` or `statusline-wrapper` (any extension) | treat as ours; rewrite the path to the `.cjs` form if needed, otherwise no-op                            |
| present, foreign                                           | write the original command into `~/.claude/scripts/statusline-original.json`, set → `statusline-wrapper.cjs` |

The "any extension" match matters: this machine currently runs `statusline-command.js`.
Matching on the basename stem upgrades it in place; matching on the full filename would
classify our own script as foreign and nest the wrapper around it — double capture.

**Merge behavior — `hooks.Stop`:** append one
`{ matcher: "", hooks: [{ type: "command", command: "<node> …/turn-logger.cjs" }] }` entry
**only if** no existing Stop entry already references `turn-logger`. All other Stop entries
and all other hook events are preserved untouched.

**Idempotency:** the merged object is serialized and compared against the original. If
identical, the script skips both the backup and the write and reports "already configured".
Re-running therefore produces zero backup files and zero settings churn.

**Ordering:** parse → merge → compare → backup → atomic write (`settings.json.tmp` +
`rename`). Parsing before backing up means an unparseable `settings.json` fails before any
side effect.

## Module Boundaries

| Module / Package             | Responsibility                                              | Allowed Dependencies                    |
|------------------------------|-------------------------------------------------------------|-----------------------------------------|
| `capture/*.cjs`              | Write C/B/L; render the statusline. Zero repo coupling — these run inside Claude Code, not inside claude-lens | Node stdlib only. **No** imports from `shared/`, `server/`, or npm packages |
| `capture/install.sh`         | Filesystem + `settings.json` wiring                         | POSIX shell + the resolved `node` binary |
| `server/capture-assets.ts`   | Resolve the absolute `capture/` dir at runtime              | `node:path`, `node:fs`, `node:url`      |
| `server/routes/capture-assets.ts` | Expose the resolved dir over HTTP                      | `server/capture-assets.ts`, Fastify     |
| `shared/capture-assets-contract.ts` | Wire type shared by server and client                | none                                    |
| `client/src/pages/settings/CostCaptureGuide.tsx` | Render setup steps + live verification    | `client/src/api/*` only                 |

The hard rule: **`capture/` never imports from the app, and the app never imports from
`capture/`.** The server only ever learns `capture/`'s *path*, never its contents. This is
what keeps the vendored scripts runnable on a machine that has no claude-lens checkout.

## Change Footprint

### New files / modules

| Path                                       | Purpose                                                                 | Pattern reference                          |
|--------------------------------------------|-------------------------------------------------------------------------|--------------------------------------------|
| `capture/cost-logger.cjs`                  | C + L writer; `logCost(payload)`                                        | Vendored from `~/.claude/scripts/cost-logger.js` |
| `capture/turn-logger.cjs`                  | B writer, Stop hook                                                     | Vendored from `~/.claude/scripts/turn-logger.js` |
| `capture/statusline-command.cjs`           | Full display statusline (model, $, context bar, timers) + capture call  | Vendored from `~/.claude/scripts/statusline-command.js` |
| `capture/statusline-wrapper.cjs`           | Capture + delegate to the user's original statusline                    | Vendored from `~/.claude/scripts/statusline-wrapper.js` |
| `capture/settings.snippet.json`            | Copy-paste `statusLine` + `hooks.Stop` wiring for manual users          | Shape mirrors live `~/.claude/settings.json` |
| `capture/install.sh`                       | Idempotent installer                                                    | new                                        |
| `capture/install.test.ts`                  | Runs `install.sh` twice against a temp `HOME`; asserts backup, merge preservation, and byte-identical second run | `server/**/*.test.ts` vitest style         |
| `capture/contract.test.ts`                 | Feeds synthetic statusline + Stop payloads through the `.cjs` scripts into a temp `HOME`; asserts output round-trips through `parseCostSampleLines` / `parseTurnBoundaryLines` / `parseCostLogLines` with `malformedCount === 0` and every field populated | `server/ingest/parse-premium.test.ts`      |
| `capture/README.md`                        | What each file does, the field contract, how to verify                  | new                                        |
| `shared/capture-assets-contract.ts`        | `CaptureAssets` wire type                                               | `shared/health-contract.ts`                |
| `server/capture-assets.ts`                 | `resolveCaptureDir(): string \| null`                                   | `scripts/build.ts` `rootDir` derivation    |
| `server/routes/capture-assets.ts`          | `GET /api/capture-assets`                                               | `server/routes/health.ts` (simplest route in the repo) |
| `server/routes/capture-assets.test.ts`     | Route test                                                              | `server/routes/health.test.ts`             |
| `client/src/api/captureAssets.ts`          | Typed fetch wrapper                                                     | `client/src/api/health.ts`                 |

### Modified files / modules

| Path                                            | What changes here                                                                                       |
|-------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| `client/src/pages/settings/CostCaptureGuide.tsx` | Replace the 3 static `STEPS` with real-path steps driven by `GET /api/capture-assets`; render both a `bash <dir>/install.sh` command and a paste-to-Claude prompt; keep the existing `captureSummary` verification `<li>` untouched |
| `client/src/pages/settings/CostCaptureGuide.stories.tsx` | Add/adjust stories for resolved-path and unresolved-path states                                  |
| `client/src/api/queryKeys.ts`                   | Add `captureAssets: () => ["capture-assets"]`                                                            |
| `server/app.ts`                                 | `registerCaptureAssetsRoute(app)` alongside the existing route registrations (~line 185)                  |
| `scripts/build.ts`                              | `await cp(join(rootDir,"capture"), join(distDir,"capture"), { recursive: true })` after the `public` copy  |
| `biome.json`                                    | Add `"capture/**"` to `files.includes`                                                                   |

### Deleted / replaced

None. Nothing in the repo is removed — the "phantom files" the guide referenced never
existed, so there is nothing to delete, only text to correct.

### Touched but not changed (silent-regression hotspots)

| Path                                          | Why it matters                                                                                                     |
|-----------------------------------------------|--------------------------------------------------------------------------------------------------------------------|
| `server/ingest/parse-premium.ts`              | The binding field contract. **Must not be edited.** If the vendored scripts appear to disagree, the producer is wrong |
| `server/ingest/discovery.ts`                  | Classifies C/B/L by dot-separated filename. The producer's slug rule must keep sidecars inside the globbed project dirs |
| `server/store/reconcile-premium.ts`           | Keys off `timestamp` alone. C's seconds-precision ISO stamps feed this directly                                     |
| `test/fixtures-premium/**`                    | Hand-written fixtures whose shape now has a real producer. If the contract test finds a divergence, the fixtures may be the stale side |
| `cypress/**`                                  | E2E may assert on Settings-page text; changing `STEPS` copy can break a selector or text assertion                  |
| `package.json` `files: ["dist"]`              | Unchanged, but only correct *because* build copies `capture/` into `dist/`. Breaking that copy silently ships a package with no capture assets |
| `~/.claude/settings.json` (author's machine)  | Live config currently pointing at the `.js` scripts. Running the new installer here exercises the `.js` → `.cjs` upgrade path for real |

## Areas of Impact

| Area                        | Impact                                                                              | Risk | Why                                                                                                     |
|-----------------------------|-------------------------------------------------------------------------------------|------|---------------------------------------------------------------------------------------------------------|
| User's `~/.claude/settings.json` | The installer edits config that governs the user's entire Claude Code experience | **H** | A bad merge can blank a statusline or break every hook, on a file the user did not ask us to own. Backup + parse-first + atomic write + idempotency test are all aimed here |
| npm-published package       | `dist/` grows by `capture/`; new install path for 230+ existing users                | M    | If the build copy is missed, the guide renders a path to a directory that does not exist                  |
| Statusline rendering        | Users with an existing statusline get it wrapped and re-spawned per tick             | M    | The wrapper path exists in the vendored code but has **never actually executed** on this machine (`statusline-original.json` is absent) — it is the least-proven component being shipped |
| Settings page (client)      | `CostCaptureGuide` gains a second query; new pending/error states                    | L    | Additive, isolated to one component; the existing verification readout is untouched                       |
| Ingest / store / metrics    | None                                                                                 | L    | Consumer side is complete and deliberately not touched                                                    |
| CI gate                     | `biome` now lints/formats `capture/`                                                 | L    | Measured: 21 auto-fixable infos, `lint` already exits 0; only `format` needs a pass                        |

**Contract changes:** one **additive** wire type, `CaptureAssets` on the new
`GET /api/capture-assets`. No existing contract (`SessionsResponse`, `HealthSnapshot`,
`AppConfig`, `ApiCall`) changes shape. Choosing a dedicated route over extending
`HealthSnapshot` is precisely what keeps this footprint additive — `HealthSnapshot`'s own
docblock forbids nullable fields, so a `string | null` path there would have forced either a
contract-posture violation or a sentinel value plus fixture churn across ~4 test files.

**Cross-cutting ripples:** build pipeline (`scripts/build.ts` copy step is now
load-bearing for a user-facing feature); npm packaging (`files` semantics depend on that
copy); lint/format config scope; and — uniquely for this task — the **developer's own
machine**, since the acceptance criterion is verified by running the installer against live
`~/.claude` config.

## Cross-Cutting Concerns

- **Errors:**
  - Capture scripts: `logCost` throws freely; every call site wraps in `try/catch` so a
    capture failure can never blank a statusline. `turn-logger.cjs` currently has **no**
    top-level guard — hardened per A6 so a malformed Stop payload or an `EACCES` cannot
    surface a hook error to the user.
  - `install.sh`: fails loudly and early. Node-not-found and unparseable-`settings.json`
    both exit `1` before any file is touched.
  - Route: `resolveCaptureDir()` returns `null` rather than throwing; the guide renders
    manual fallback instructions in that state.
- **Logging & metrics:** capture scripts stay silent by design — stdout on the statusline
  path *is* the statusline, so any stray write corrupts the user's terminal. The one
  exception is `turn-logger`'s existing `console.error` on missing `cwd` (stderr, safe).
  `install.sh` is the only chatty component.
- **Auth / authz:** none. Localhost single-user, consistent with every other route.
- **Performance:** `logCost` runs on every statusline tick (default `refreshInterval: 5`).
  Per tick it does ~2 small `/tmp` state reads plus one C append — cheap. The L upsert
  rewrites the whole `cost-log.jsonl` (currently 32 KB) each tick, which is the one
  non-constant cost; it stays trivial at realistic session counts. The `api_duration_ms`
  unchanged-guard means idle sessions do no work at all.
- **Security:** `install.sh` writes only under `$HOME/.claude/`. No network access, no
  `curl | bash`, no `sudo`. The node merge script is a heredoc in the repo, not a fetched
  payload. `resolveCaptureDir()` returns a server-derived path — it accepts no user input,
  so there is no traversal surface. Note the guide *does* surface an absolute filesystem
  path in the UI, which is consistent with `HealthSnapshot`'s existing absolute `filePath`
  handling.
- **Migrations / rollout:** no data migration. The `.js` → `.cjs` transition is handled by
  the installer's basename-stem match (A4); stale `.js` files left in `~/.claude/scripts`
  are harmless once nothing references them, and the README notes they can be deleted.
  Rollback is `cp` of the timestamped backup — documented in the README and printed by the
  installer.

## Architecture Decisions Log

| #   | Decision                                                                       | Alternatives                                                          | Chosen Because                                                                                                                                     | Satisfies |
|-----|--------------------------------------------------------------------------------|-----------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------|-----------|
| A1  | Vendor all four scripts, keeping the capture/display split                     | Merge capture+delegation into one `cost-logger.js` as #112's text describes; ship capture only | User's choice. Preserves the proven separation and gives users with no statusline a working one instead of the minimal fallback line                | R1, R6    |
| A2  | `.cjs` extension                                                               | `.js` verbatim; ESM                                                   | `"type": "module"` makes `.js` CJS unrunnable from the repo, which would also block the contract test. Zero risk at the install target               | R1, R2    |
| A3  | Copy `capture/` → `dist/capture/` in the build; leave `files: ["dist"]`         | Add `"capture"` to `files`; CLI subcommand; repo-only                 | Mirrors the existing `dist/public` idiom, one predictable published layout, no packaging-semantics change                                            | R7        |
| A4  | Installer matches existing statusline by **basename stem**, not full filename   | Exact-filename match; always overwrite; always wrap                   | This machine runs `statusline-command.js`; a filename match would treat our own script as foreign and nest the wrapper around it — double capture     | R3, R6    |
| A5  | Dedicated `GET /api/capture-assets` route                                      | Extend `HealthSnapshot`; extend `AppConfig`; static text              | `HealthSnapshot` forbids nullable fields by its own docblock; `AppConfig` is user-owned persisted settings; static text cannot serve npx users        | R4, R7    |
| A6  | Two behavior fixes during vendoring: wrap `turn-logger`'s handler in try/catch, and adopt biome's `parseInt` radix fix | Vendor byte-identical                                                 | Both are genuine robustness gains on a hook that runs in the user's session; radix comes free with the lint pass the user asked for                   | R3        |
| A7  | Vendor the L-file upsert **as-is**, documenting the concurrency caveat rather than fixing it | Add a lockfile; convert L to append-only with last-wins-at-read       | Blast radius is bounded and self-healing (see stress-test S1), and rewriting the file format would break the already-shipped `parseCostLogLines` reader | R2        |
| A8  | Add `"capture/**"` to biome; reformat the vendored scripts                     | Exclude `capture/` to preserve byte-identical vendoring               | User's choice. Measured cost is 21 info-level auto-fixable diagnostics plus a format pass — no correctness rules trip                                 | R1        |
| A9  | Ship both an `install.sh` idempotency test and a producer↔parser contract test  | Idempotency only; manual verification only                            | **My call, flagging it:** the user selected the idempotency test but left the contract test ambiguous. Acceptance criterion R2 ("field names match exactly") is otherwise enforced by nothing, and the test is ~30 lines once A2 makes the scripts runnable. Easy to drop if unwanted | R2, R3    |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario                                                                                  | How the design handles it                                                                                                                                                                                                                                                                    |
|-------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **S1.** Several Claude Code sessions run concurrently (this repo routinely uses parallel worktrees). Each statusline ticks every ~5s and rewrites the whole L file read→filter→write | **Real lost-update race, accepted (A7).** A reads N rows, B reads N rows, A writes, B writes over A's snapshot → A's row is lost. Bounded and self-healing: C is per-session and append-only so the 🟢 upgrade survives; the losing session re-appends its L row on its next tick (~5s). Documented in `capture/README.md` |
| **S2.** `/tmp` is cleared (reboot, cleaner) mid-session, wiping `statusline-prevstate-<sid>` | **GAP.** The resume guard only catches counters going *backwards*. After a wipe `PREV_COST` is 0, so the next sample emits `cost_delta_usd` = the full cumulative → one inflated sample, and delta-summing reconciliation over-counts. See Open Questions for the seed-from-last-C-line fix    |
| **S3.** `~/.claude/settings.json` is malformed JSON when the installer runs                | Parse happens **before** backup and before any write. Exits `1` with the parse error, leaving the file untouched                                                                                                                                                                              |
| **S4.** `install.sh` is run twice (or three times)                                          | Merged object is compared against the original; identical → no backup, no write, "already configured". Asserted by `capture/install.test.ts`                                                                                                                                                  |
| **S5.** `node` is not on PATH in the installer's shell, or resolves differently than in the hook's non-login shell (this machine has both homebrew and volta node) | The installer resolves `command -v node` once and writes that **absolute** path into `settings.json` — matching what the live config already does. Missing node → exit `1` with an actionable message                                                                                          |
| **S6.** The user's original statusline is slow or hangs after being wrapped                 | `statusline-wrapper.cjs` already uses `spawnSync(..., { timeout: 10000 })` and falls back to a minimal cost line on empty stdout. Worst case is a stale statusline, never a lost capture — capture runs *before* delegation                                                                     |
| **S7.** Server started from a source tree with no `dist/`, or an install missing `capture/` | `resolveCaptureDir()` tries both candidates and returns `null`; the guide renders manual instructions instead of a broken path. No throw, no 500                                                                                                                                              |
| **S8.** A session's `cwd` contains dots (e.g. `~/work/my.project`)                          | The slug rule maps both `/` and `.` to `-`, matching Claude Code's own naming, so sidecars land in the same directory as the transcript. This is exactly the rule that makes files discoverable — the contract test should cover a dotted path                                                  |

### Backward — regression risk per touched area

| Touched area                                    | What could regress                                                                                              | How we'd know / mitigation                                                                                                                    |
|-------------------------------------------------|------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------|
| `~/.claude/settings.json` (author's machine)    | Installer misclassifies the live `statusline-command.js` as foreign and wraps our own script → double capture, duplicated C samples | A4's basename-stem match; `install.test.ts` covers the `.js`-already-ours case explicitly; the timestamped backup makes it one `cp` to undo      |
| `hooks.Stop` (author's machine)                 | Merge appends a second `turn-logger` entry → every turn writes two B lines                                       | Merge is guarded on "no existing Stop command references `turn-logger`"; covered by the idempotency test                                        |
| `client/src/pages/settings/CostCaptureGuide.tsx` | The live `captureSummary` verification `<li>` breaks while the static steps are rewritten                        | The verification `<li>` and its `useQuery` are explicitly out of the edit's blast radius; existing stories keep rendering it                     |
| `cypress/**` Settings specs                     | Text/selector assertions on the old `STEPS` copy fail                                                            | `npm run test:e2e` before PR; grep cypress for the old step strings during implementation                                                       |
| `scripts/build.ts`                              | The new `cp` runs before `dist/` exists, or throws and leaves a half-built `dist/`                               | Place it next to the existing `public` copy, after the `rm`/build block that already owns half-built cleanup                                     |
| `biome.json` `includes`                         | Formatting the vendored scripts introduces a behavior change while reflowing aligned assignments                 | Run the contract test before **and** after the format pass; diff emitted JSONL for equality                                                     |
| `test/fixtures-premium/**`                      | Hand-written fixtures encode a shape the real producer does not emit, and nobody notices                          | The contract test compares producer output against the *parser*, not the fixtures — a divergence surfaces as a failing assertion, not silence   |

## Open Questions

- **S2 — should the producer re-baseline from the last C line when `/tmp` state is missing?**
  - **Impact if unresolved:** after a reboot mid-session, one C sample carries an inflated
    `cost_delta_usd` equal to the full session cumulative; delta-summing reconciliation
    over-counts that session.
  - **Suggested default:** vendor as-is for this task and document it. The fix (read the last
    line of `<uuid>.cost.jsonl` and seed `PREV_COST` / `PREV_API_MS` from it when the `/tmp`
    file is absent) is ~8 lines and could fold in cheaply if the developer wants it now.
- **Should `prompt_id` be emitted on C samples?**
  - **Impact if unresolved:** the Data Health boundary-mismatch panel skips all locally
    produced samples, so that check stays permanently inert for real users.
  - **Suggested default:** leave it out. The statusline payload's field inventory has not been
    confirmed to carry a prompt identifier; verifying that is its own investigation.
- **Does `A9`'s contract test stay in scope?**
  - **Impact if unresolved:** R2 is enforced only by human inspection.
  - **Suggested default:** keep it — the developer can strike it at `/generate-tasks` time.

## Out of Scope

- Modifying `server/ingest/parse-premium.ts`, discovery, or reconciliation (reason: consumer
  side is complete and verified matching; changing it would be fixing the wrong end).
- A `claude-lens setup-capture` CLI subcommand (reason: considered and not chosen; `install.sh`
  plus the resolved path covers both audiences at a fraction of the surface).
- Windows support for `install.sh` (reason: the whole tier assumes a POSIX `~/.claude` layout;
  no evidence of Windows users yet).
- Uninstall / revert tooling (reason: the timestamped backup plus documented `cp` covers it;
  a first-class uninstaller is speculative).
- The hostname field in `cost-logger` (reason: already deferred by `claude-lens-pages.md` ⚑N —
  labeled scan roots cover the common case).
- Fixing the L-file lost-update race (reason: A7 — bounded, self-healing, and a fix would
  change a file format the shipped reader already depends on).

---

# Tasks

_Draft breakdown prepared directly from this architecture doc. The user-level `/generate-tasks`
skill remains the authoritative Phase-3 producer of the implementation task list — this draft
is a starting point the developer can hand to it or edit directly; it does not replace running
`/generate-tasks from: specs/architecture/ARCH-producer-cost-capture-tier.md` if a formal
task-file artifact is wanted._

**Status:** Groups 1–7 and 9 implemented and verified (`npm run verify` clean: typecheck, lint,
format, and the full `vitest` suite — 141 files, 1601 tests — including the new
`capture/install.test.ts` and `capture/contract.test.ts`; `npm run test:e2e`'s `settings.cy.ts`
passes, and the two unrelated failures elsewhere in that run were confirmed pre-existing on
`main`, not a regression from this task). **Group 8 was asked about and explicitly declined by
the developer** — every sub-task there writes to the real `~/.claude/settings.json` (Areas of
Impact rates this **H** risk), and the developer chose to run `bash capture/install.sh`
themselves rather than have it run for them. Remains unchecked below for that reason, not
because it's blocked.

## 1. Vendor the capture scripts (R1, R2, A1, A2, A6, A8)

- [x] 1.1 Copy the four scripts from `~/.claude/scripts/` into `capture/*.cjs`
      (`cost-logger.cjs`, `turn-logger.cjs`, `statusline-command.cjs`, `statusline-wrapper.cjs`),
      renaming `.js` → `.cjs` and updating internal `require` targets to match.
- [x] 1.2 Apply the two sanctioned hardening edits from A6: wrap `turn-logger.cjs`'s handler
      body in a top-level `try/catch` so a malformed Stop payload or `EACCES` can't surface a
      hook error, and fix the `parseInt` radix.
- [x] 1.3 Confirm every `logCost` call site is already wrapped in `try { } catch (_) {}` per the
      Silent-capture pattern; do not change this behavior, only verify it survived the copy.
- [x] 1.4 Add `"capture/**"` to `biome.json` `files.includes` (A8) and run `biome format --write`
      over `capture/`; leave `biome lint` as-is (already exits 0 per the measured 21 auto-fixable
      infos).
- [x] 1.5 Diff emitted JSONL from the scripts before and after the format pass (feed the same
      synthetic payload through) to confirm reflowing didn't change behavior — this can reuse the
      contract-test harness built in task 3. (Confirmed via `capture/contract.test.ts` passing
      against the post-format `.cjs` files.)

## 2. Author `capture/install.sh` (R3, A4, A6, S3–S5)

- [x] 2.1 Implement `command -v node` resolution to an absolute path; exit `1` with an actionable
      message if not found (S5).
- [x] 2.2 Implement the settings-merge engine: parse `~/.claude/settings.json`
      first (fail before any side effect on unparseable JSON — S3), merge `statusLine` per the
      three-case table (absent / already-ours by basename-stem match / foreign-and-wrap — A4),
      merge `hooks.Stop` by appending one `turn-logger` entry only if none already references it.
      Implemented as `capture/merge-settings.cjs`, a standalone script `install.sh` invokes with
      node (not a literal one-liner, but the same "node is already guaranteed present" rationale
      — split out for direct testability).
- [x] 2.3 Implement the ordering contract exactly: parse → merge → compare → backup → atomic
      write (`settings.json.tmp` + `rename`).
- [x] 2.4 Implement idempotency: serialize the merged object, compare against the original: if
      identical, skip both backup and write and report "already configured" (S4).
- [x] 2.5 On foreign-statusline detection, write the original command into
      `~/.claude/scripts/statusline-original.json` before pointing `statusLine.command` at
      `statusline-wrapper.cjs`.
- [x] 2.6 Copy the four `.cjs` scripts into `~/.claude/scripts/` as part of install.

## 3. Test the producer (A9, R2, R3, S8)

- [x] 3.1 `capture/install.test.ts` — run `install.sh` twice against a temp `HOME`: assert a
      backup file is created on the first run only, assert existing unrelated `settings.json`
      content (other Stop hooks, other config keys) survives untouched, assert byte-identical
      output on the second run (S4), and cover the `.js`-already-ours basename-stem case
      explicitly (A4 regression risk). 7 cases, all passing.
- [x] 3.2 `capture/contract.test.ts` — feed synthetic statusline + Stop payloads through the
      vendored `.cjs` scripts into a temp `HOME`, then assert the emitted C/B/L lines round-trip
      through `parseCostSampleLines` / `parseTurnBoundaryLines` / `parseCostLogLines` with
      `malformedCount === 0` and every field populated. Includes a dotted-`cwd` case (S8) and an
      L-upsert case. Required adding `capture` to `vitest.config.ts`'s `test.include` glob and a
      new `capture/tsconfig.json` (wired into the `typecheck` script) since neither existed for
      this directory — not called out in the Change Footprint but needed for these tests to run
      under `npm run verify` at all.
- [x] 3.3 Decide whether to keep A9's contract test in scope per the Open Questions default
      (keep) — kept.

## 4. Author supporting docs (R1)

- [x] 4.1 `capture/settings.snippet.json` — copy-paste `statusLine` + `hooks.Stop` wiring for
      users who prefer manual setup, matching the live `~/.claude/settings.json` shape.
- [x] 4.2 `capture/README.md` — what each file does, the C/B/L field contract, how to verify
      capture is working, the L-file concurrency caveat (A7 / S1), and the rollback procedure
      (`cp` of the timestamped backup).

## 5. Reachability plumbing — server (R4, R7, A3, A5, S7)

- [x] 5.1 `shared/capture-assets-contract.ts` — define the `CaptureAssets` wire type
      (`{ captureDir: string | null }`), following the `shared/health-contract.ts` pattern.
- [x] 5.2 `server/capture-assets.ts` — `resolveCaptureDir(): string | null` using the
      two-candidate resolution idiom (`../capture` dev/source tree, then `./capture` at the
      `dist/cli.js` bundle location), relative to `import.meta.url`; return `null` rather than
      throw when neither candidate exists (S7). Verified against a simulated stripped install
      (only `dist/` present, no sibling source `capture/`) — resolves to `dist/capture` correctly.
- [x] 5.3 `server/routes/capture-assets.ts` — `GET /api/capture-assets` handler returning the
      resolved value, following `server/routes/health.ts` as the simplest existing route.
- [x] 5.4 `server/routes/capture-assets.test.ts` — route test covering both the resolved-path and
      `null` cases.
- [x] 5.5 Wire `registerCaptureAssetsRoute(app)` into `server/app.ts` alongside the existing route
      registrations. Also added a test-only `captureDir` override to `BuildAppOptions` (matching
      the existing `configPath`/`userHomeDir`/`localStorePath` pattern) so route tests don't
      depend on the filesystem state of the machine running the suite.

## 6. Reachability plumbing — build & packaging (R7, A3)

- [x] 6.1 `scripts/build.ts` — copies `capture/` → `dist/capture/` after the existing `public`
      copy, with a `filter` excluding `*.test.ts` and `tsconfig.json` (repo-only files with no
      runtime purpose in a published package).
- [x] 6.2 Confirmed `package.json` `files: ["dist"]` needs no change — `npm pack --dry-run` shows
      `dist/capture/*` (cjs scripts, `install.sh`, `merge-settings.cjs`, `README.md`,
      `settings.snippet.json`) in the packed tarball after a build.

## 7. Client — Cost Capture Guide (R4, R8)

- [x] 7.1 `client/src/api/captureAssets.ts` — typed fetch wrapper over
      `GET /api/capture-assets`, following `client/src/api/health.ts`.
- [x] 7.2 `client/src/api/queryKeys.ts` — add `captureAssets: () => ["capture-assets"]`.
- [x] 7.3 `client/src/pages/settings/CostCaptureGuide.tsx` — replace the 3 static `STEPS` with
      real-path steps driven by the new query; render both a `bash <dir>/install.sh` command and
      a paste-to-Claude-Code prompt (R8: delegatable setup) for the resolved-path case, and
      manual fallback instructions for the `null` case. Left the existing `captureSummary`
      verification `<li>` and its `useQuery` untouched.
- [x] 7.4 `client/src/pages/settings/CostCaptureGuide.stories.tsx` — added/adjusted stories for
      the resolved-path and unresolved-path (`null`) states.
- [x] 7.5 Grepped `cypress/**` Settings specs for assertions against the old `STEPS` copy —
      `cypress/e2e/settings.cy.ts` only asserts `[data-testid="cost-capture-guide"]` is visible
      and contains a case-insensitive "cost...capture" match; nothing broke.

## 8. Live verification (R5, R6, R8 — author's machine) — PENDING, needs go-ahead

- [ ] 8.1 Run `capture/install.sh` against the real `~/.claude/settings.json`, exercising the
      `.js` → `.cjs` upgrade path for the currently-running `statusline-command.js`.
- [ ] 8.2 Confirm the statusline keeps rendering after install (R6) and that
      `statusline-original.json` is written correctly if a wrap occurs.
- [ ] 8.3 Run one real Claude Code session end-to-end and confirm it shows as observed 🟢 in Data
      Health / the dashboard (R5).
- [ ] 8.4 Re-run `install.sh` and confirm the "already configured" no-op path (ties back to 3.1
      but against real config, not a temp `HOME`).

## 9. Gate

- [x] 9.1 `npm run verify` (typecheck → lint → format:check → test) clean — 141 test files, 1601
      tests passing.
- [x] 9.2 `npm run test:e2e` — `settings.cy.ts` (touched in 7.5) passes clean, 2/2. Two unrelated
      specs (`dashboard.cy.ts`'s `CaptureBanner` assertion, `data-health.cy.ts`'s
      `ReconciliationPanel` assertion) fail on this run; confirmed **pre-existing on `main`** by
      stashing every change in this task and re-running the same two specs against the clean
      tree — both fail identically with no capture-tier code present. Not this task's regression;
      out of scope to fix here.
- [ ] 9.3 PR body carries `Closes #112`.

## Deferred / explicitly out of scope for this task

- S2's re-baseline-from-last-C-line fix (Open Questions default: vendor as-is, document only).
- Emitting `prompt_id` on C samples (Open Questions default: leave out).
- Everything under **Out of Scope** above (parser/discovery/reconciliation changes, a CLI
  subcommand, Windows support, uninstall tooling, hostname field, L-file lost-update fix).
