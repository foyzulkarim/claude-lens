# Claude Lens — Data Model & Contracts

> **Source:** Task `#P0-7` / issue #12, per `specs/requirements/REQ-data-model-contracts-spec.md` and `specs/architecture/ARCH-data-model-contracts-spec.md` (T1/T2).
> **Status:** Merged. §1–§11 complete (T1 + T2); §8.1 and §8.2 have received explicit developer sign-off.
> **Method:** every field/rule below was verified against real local data (`~/.claude/projects/**/*.jsonl` and the three premium capture files) at investigation time, ordered by walking `specs/claude-lens-pages.md`'s 11 pages (ARCH Decision 11/A16). No JSONL content, real or synthetic, is embedded anywhere in this document — see §7 (N1) once T2 lands; until then, treat this rule as already in force throughout §1–§6.
> **Corpus at investigation time:** 106 real transcript (T) files (18,851 lines, 0 malformed, 0 zero-byte), 94 `.cost.jsonl` (C) files (3,285 lines), 34 `.turn-boundaries.jsonl` (B) files (180 lines), 1 `cost-log.jsonl` (L) file (47 lines) at `~/.claude/cost-log.jsonl`. These counts will drift as more sessions are recorded; re-run the investigation method (ad hoc `find`/Python/jq, not committed — ARCH A4) to refresh them on revision, per ARCH A14 (append, don't silently overwrite).

---

## 1. Source Inventory

### 1.1 File classification

| Tier | Pattern | Location | Observed count | Notes |
|---|---|---|---|---|
| **T** | `<uuid>.jsonl` | `~/.claude/projects/**` | 106 files, 18,851 lines | 0 malformed lines, 0 zero-byte files, 0 malformed-first-line files observed in this corpus — see §7/R12 (T2) for the contract anyway, since absence of an example in one corpus doesn't mean the case can't occur |
| **C** | `<uuid>.cost.jsonl` | same dirs as T | 94 files, 3,285 lines | Two mutually-exclusive-per-line schema shapes observed — §1.7 |
| **B** | `<uuid>.turn-boundaries.jsonl` | same dirs as T | 34 files, 180 lines | Single stable shape, no drift |
| **L** | `cost-log.jsonl` | `~/.claude/` (parent of the projects scan root — confirmed) | 1 file, 47 lines | **One shared file across all sessions**, not per-session — a single line per (session, log event); only 47 lines vs. 94 C-covered sessions is a real coverage gap, not a sampling artifact — relevant to §8/R9 (T2) |

### 1.2 T-tier record `type` distribution (18,851 lines)

| `type` value | Count | Relevant to `CompactCall`? |
|---|---|---|
| `assistant` | 6,689 | Yes — primary source |
| `user` | 4,175 | Yes — supplies `promptId`, prompt text, tool-result byte sizes |
| `attachment` | 1,324 | No — not investigated further (out of scope: no page in `pages.md` consumes it) |
| `system` | 1,132 | No |
| `mode` | 1,002 | No |
| `file-history-snapshot` | 980 | No |
| `last-prompt` | 959 | No |
| `ai-title` | 900 | No |
| `permission-mode` | 811 | No |
| `bridge-session` | 483 | No |
| `queue-operation` | 240 | No — possible explanation for multi-"genuine-user"-record `promptId` groups observed in §3 Rule 2; not conclusively confirmed, flagged there |
| `agent-name` | 123 | No |
| `pr-link` | 20 | No |
| `worktree-state` | 18 | No |
| `custom-title` | 4 | No |

**Note:** the filed GitHub issue #12's scope text (not `architecture.md`, which was checked directly and makes no such claim) describes T as containing "assistant/user/summary lines." Zero `"type": "summary"` records were observed (0/18,851) — the actual compaction mechanism is a `type: "user"` record carrying `isCompactSummary: true` (§3 Rule 5). This is not an `architecture.md`/`pages.md` correction (R13 doesn't apply — neither doc makes the claim); it's already tracked as a stale-issue-text follow-up separate from this doc (see project memory `p0-7-req-supersedes-filed-issue`).

### 1.3 `assistant`/`user` top-level field table (10,864 records)

| Field | Type | Present in | Notes |
|---|---|---|---|
| `type` | string (`"assistant"` \| `"user"`) | 10,864/10,864 | |
| `uuid` | string | 10,864/10,864 | This record's own id — distinct from `message.id` |
| `parentUuid` | string \| null | 10,864/10,864 | `null` only for a genuine session-opening record |
| `isSidechain` | boolean | 10,864/10,864 | Always present, never absent — no null-check needed |
| `sessionId` | string | 10,864/10,864 | |
| `timestamp` | string (ISO 8601, ms precision) | 10,864/10,864 | |
| `cwd` | string | 10,864/10,864 | |
| `gitBranch` | string | 10,864/10,864 | Observed value `"HEAD"` for detached-HEAD state |
| `version` | string | 10,864/10,864 | Claude Code version |
| `entrypoint` | string | 10,864/10,864 | Observed value: `"cli"` |
| `userType` | string | 10,864/10,864 | Observed value: `"external"` |
| `message` | object | 10,864/10,864 | See §1.4 |
| `promptId` | string | 4,171/10,864 — **only ever on `user`-type records** (4,171/4,175 user records; 0/6,689 assistant records) | Turn-grouping key — see §3 Rule 1 for the resolution algorithm this asymmetry requires |
| `requestId` | string | 6,612/10,864 (~99% of real, non-synthetic assistant calls) | |
| `isCompactSummary` | boolean | 2 occurrences in this corpus, both `true`, both on `type: "user"` records | See §3 Rule 5 |
| `isVisibleInTranscriptOnly` | boolean | 2 occurrences, co-occurring with `isCompactSummary: true` both times | |
| `agentId` | string | 828/10,864 | Correlates 1:1 with `isSidechain: true` (495/495 in the refined check — see §3 Rule 3) |
| `sourceToolAssistantUUID` | string | 3,316/10,864 | Sidechain/subagent correlation field, not in `architecture.md` |
| `sourceToolUseID` | string | 12/10,864 | Low-frequency; not investigated further |
| `toolUseResult` | present | 3,261/10,864 | Raw tool-result payload — excluded from `CompactCall` per architecture §5.4, byte size retained only |
| `attributionSkill` / `attributionAgent` / `attributionMcpServer` / `attributionMcpTool` / `attributionPlugin` | string | 774 / 494 / 215 / 215 / 134 of 10,864 | **Not in `architecture.md`.** Attributes a call to the skill/subagent/MCP tool/plugin that triggered it |
| `isMeta` | boolean | 164/10,864 | Not investigated further — flagged as observed, low-frequency |
| `permissionMode` | string | 463/10,864 | |
| `promptSource` | string | 463/10,864 | Co-occurs with `permissionMode` at identical count — possibly the same origin event, not confirmed |
| `origin` | string | 283/10,864 | |
| `slug` | string | 4,467/10,864 | Human-readable session slug |
| `session_id` (snake_case) | string | 4,284/10,864 | **Distinct from `sessionId`** (camelCase) — both present together on a subset of records; exact sub-population not fully resolved, flagged for follow-up rather than guessed |
| `imagePasteIds` | array | 17/10,864 | |
| `isApiErrorMessage` | boolean | 10/10,864 | See "synthetic/error calls" below |
| `error` | string | 7/10,864 | Observed value: `"rate_limit"` |
| `apiErrorStatus` | number | 7/10,864 | Observed value: `429` |
| `toolDenialKind` | string | 7/10,864 | |
| `interruptedMessageId` | string | 4/10,864 | |

**Synthetic/error calls:** `message.model === "<synthetic>"` (co-occurring with `isApiErrorMessage: true` in observed cases) marks a non-billable, non-real API call — e.g. a rate-limit retry marker. These records carry no `usage` block. They must be excluded before computing token/cost measures and before computing a session's distinct-model set for §8's multi-model attribution decision (T2) — an unfiltered count overstates multi-model sessions (11/71 raw vs. 6/71 after exclusion, in this corpus).

### 1.4 `message.*` field table (assistant + user)

| Field | Type | Present in | Notes |
|---|---|---|---|
| `role` | string (`"user"` \| `"assistant"`) | 10,864/10,864 | |
| `content` | string \| array | 10,864/10,864 | String form: 750 occurrences (simple text); array of content blocks otherwise — see §1.7 |
| `model` | string | 6,689/6,689 assistant records | Includes the `<synthetic>` placeholder — see above |
| `id` | string | 6,689/6,689 assistant records | The API response id — this is `message.id`, the dedupe key (architecture §5.4). Never present on `user` records |
| `usage` | object | 6,629/6,689 assistant records (missing on synthetic/error calls) | See §1.5 |
| `stop_reason` | string | 6,644/6,704 real (non-synthetic) assistant calls (~99%) | |
| `stop_details` | object | 6,629/6,689 | |
| `stop_sequence` | string \| null | 6,593/6,689 | |
| `diagnostics` | object | 6,568/6,689 | Not investigated further — low priority, no page consumes it per `pages.md` |
| `container` | object | 10/10,864 | Rare/experimental |
| `context_management` | object | 10/10,864 | Rare/experimental, co-occurs with `container` |

### 1.5 `message.usage.*` field table (6,629 assistant records with a usage block)

| Field | Type | Present in | Notes |
|---|---|---|---|
| `input_tokens` | number | 6,629/6,629 | |
| `output_tokens` | number | 6,629/6,629 | |
| `cache_creation_input_tokens` | number | 6,629/6,629 | |
| `cache_read_input_tokens` | number | 6,629/6,629 | |
| `service_tier` | string | 6,629/6,629 | |
| `cache_creation` | object | 6,629/6,629 | See §1.6 |
| `inference_geo` | string | 6,629/6,629 | Not in `architecture.md` |
| `server_tool_use` | object | 6,331/6,629 | Not in `architecture.md` |
| `iterations` | number | 6,331/6,629 | Not in `architecture.md` |
| `speed` | number \| string | 6,331/6,629 | Not in `architecture.md` |

### 1.6 `message.usage.cache_creation.*` field table

| Field | Type | Present in | Notes |
|---|---|---|---|
| `ephemeral_5m_input_tokens` | number | 6,629/6,629 | Confirms `architecture.md` §4's claim (exact field name verified) |
| `ephemeral_1h_input_tokens` | number | 6,629/6,629 | Same |

### 1.7 Content block types (`message.content` array elements)

| Block `type` | Count | Notes |
|---|---|---|
| `tool_use` | 3,326 | On `assistant` records |
| `tool_result` | 3,317 | On `user` records — this is the tool-result-continuation shape (see §3 Rule 1); body excluded per architecture §5.4, byte size retained |
| `thinking` | 1,824 | |
| `text` | 1,649 | |
| `image` | 19 | Multimodal input observed in real data — not previously called out in `architecture.md` or `pages.md` |

### 1.8 C-tier (`.cost.jsonl`) schema — two mutually-exclusive-per-line shapes

All 94 files, 3,285 lines, 0 malformed. Every line has the common core; exactly one of the two indexing schemes below, never both on the same line (0/3,285 lines have both).

**Common core (94/94 files, 3,285/3,285 lines):** `session_id` (string) · `timestamp` (string) · `cost_delta_usd` (number) · `cumulative_cost_usd` (number) · `api_duration_ms` (number) · `cache_read_tokens` (number) · `cache_write_tokens` (number) · `lines_added` (number) · `lines_removed` (number) · `context_pct` (number)

**Turn-indexed shape:** `turn` (number) — present in 60/94 files (57 turn-only + 3 mixed)
**Epoch-indexed shape:** `epoch` (number), `sample` (number) — present in 37/94 files (34 epoch-only + 3 mixed)

3 files contain both shapes on different lines (a schema-version transition mid-session, likely a Claude Code version upgrade during a long-running or resumed session). Earliest observed timestamp in this corpus: `2026-06-07T09:25:30Z`; latest: `2026-07-08T00:38:34Z` — the two shapes are time-ordered eras, not randomly interleaved.

### 1.9 B-tier (`.turn-boundaries.jsonl`) schema

All 34 files, 180 lines, 0 malformed, single stable shape: `session_id` (string) · `transcript_path` (string) · `turn_end` (string, ISO 8601) · `turn_end_epoch` (number, Unix epoch seconds)

### 1.10 L-tier (`cost-log.jsonl`) schema

1 shared file, 47 lines, 0 malformed, single stable shape: `session_id` (string) · `timestamp` (string) · `cost_usd` (number) · `dir` (string — the `cwd` equivalent) · `model` (string) · `duration_ms` (number) · `cache_read` (number) · `cache_write` (number) · `lines_added` (number) · `lines_removed` (number) · `context_pct` (number)

**Note for #P2-1:** L's field names do **not** match C's for the same concepts (`cache_read`/`cache_write` vs. C's `cache_read_tokens`/`cache_write_tokens`; `cost_usd` vs. C's `cost_delta_usd`/`cumulative_cost_usd`; `dir` vs. C's absence of a directory field, `duration_ms` vs. C's `api_duration_ms`). Do not assume a unified premium-tier vocabulary — see §4.

---

## 2. `CompactCall` (field-for-field)

One `CompactCall` per real `assistant`-type API response (keyed by `message.id`), enriched with turn/session correlation resolved from its `user`-type ancestors. Synthetic/error records (§1.3) are parsed into `CompactCall` but flagged via `isSyntheticOrError` rather than dropped, so Data Health (§9 page) can still count them.

| Field | Type | Source JSON path | Nullability | Tier | Notes |
|---|---|---|---|---|---|
| `id` | string | `message.id` | required | 🟢 | Dedupe key (architecture §5.4) |
| `uuid` | string | `uuid` | required | 🟢 | This record's own id — used for `parentUuid` chain resolution, not the dedupe key |
| `sessionId` | string | `sessionId` | required | 🟢 | |
| `promptId` | string | resolved — see §3 Rule 1 | optional — claimed-not-always-resolvable (~21% of records in this corpus don't resolve; §3 Rule 2) | 🟢 | Never read directly off the assistant record — always resolved via ancestor walk |
| `timestamp` | string (ISO 8601) | `timestamp` | required | 🟢 | |
| `model` | string | `message.model` | required | 🟢 | Value `"<synthetic>"` observed — see `isSyntheticOrError` |
| `isSyntheticOrError` | boolean | derived: `message.model === "<synthetic>"` or `isApiErrorMessage === true` | required (defaults false) | 🟢 | Excludes the record from cost/usage/multi-model aggregates |
| `apiErrorStatus` | number | `apiErrorStatus` | optional — claimed-not-observed unless `isSyntheticOrError` | 🟢 | Observed value `429` |
| `isSidechain` | boolean | `isSidechain` | required, always present | 🟢 | |
| `agentId` | string | `agentId` | optional — present only when `isSidechain === true` (1:1 observed) | 🟢 | |
| `cwd` | string | `cwd` | required | 🟢 | |
| `gitBranch` | string | `gitBranch` | required | 🟢 | Observed value `"HEAD"` for detached-HEAD |
| `version` | string | `version` | required | 🟢 | |
| `entrypoint` | string | `entrypoint` | required | 🟢 | |
| `promptText` | string | resolved from the initiating `user` ancestor's `message.content` (string form or joined `text` blocks); tool-result-continuation `user` records excluded from this resolution | optional — present only on the call that begins a turn | 🟢 | Retained in full per architecture §5.4; size distribution measured in §9 (T2) |
| `inputTokens` / `outputTokens` | number | `message.usage.input_tokens` / `output_tokens` | optional — absent iff `isSyntheticOrError` | 🟢 | |
| `cacheReadInputTokens` / `cacheCreationInputTokens` | number | `message.usage.cache_read_input_tokens` / `cache_creation_input_tokens` | optional — same rule | 🟢 | |
| `cacheCreation5mTokens` / `cacheCreation1hTokens` | number | `message.usage.cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` | optional — same rule | 🟢 | Confirms architecture §4's claim |
| `serviceTier` | string | `message.usage.service_tier` | optional — same rule | 🟢 | |
| `stopReason` | string | `message.stop_reason` | optional — present on ~99% of real calls (6,644/6,704) | 🟢 | |
| `toolUseCount` | number | derived: count of `tool_use` blocks in `message.content` | required (defaults 0) | 🟢 | |
| `toolNames` | string[] | derived: `name` of each `tool_use` block | required (defaults `[]`) | 🟢 | Feeds tool-mix panel (Session Detail, `pages.md` §3) |
| `toolResultByteSize` | number | derived: summed byte length of `tool_result` blocks in the **following** `user` record(s) that continue this call | required (defaults 0) | 🟢 | The architecture §5.4 exclusion — body dropped, size kept. Cross-record join, not a direct field read |
| `requestId` | string | `requestId` | optional — present on ~99% of real calls (6,612/6,689... /6,704 real) | 🟢 | |
| `attributionSkill` / `attributionAgent` / `attributionMcpServer` / `attributionMcpTool` / `attributionPlugin` | string | same-named top-level fields | optional — low-frequency (774/494/215/215/134 of 10,864 assistant+user records) | 🟢 | **Not in `architecture.md`** — attributes the call to the skill/subagent/MCP tool/plugin that triggered it |

**Deliberate exclusions (architecture §5.4):** `toolUseResult` (raw tool-result body) is never retained — only `toolResultByteSize`. `attachment`/`system`/`mode`/`file-history-snapshot`/`last-prompt`/`ai-title`/`permission-mode`/`bridge-session`/`queue-operation`/`agent-name`/`pr-link`/`worktree-state`/`custom-title` record types (§1.2) are not parsed into `CompactCall` at all — no page in `pages.md` consumes them.

---

## 3. `Turn` / `Session` Derivation Rules

**Rule 1 — Turn grouping.** A turn is the set of records sharing one `promptId`. `promptId` is present **only** on `type: "user"` records — never on `assistant` records (0/6,689 observed). Every `assistant` record's turn membership must therefore be resolved by walking its `parentUuid` chain upward (via the `uuid`/`parentUuid` links within the same session file) until a record carrying `promptId` is found; memoize per session to avoid re-walking shared ancestors. This is a real resolution algorithm, not a direct field read — `architecture.md`'s "promptId is the turn-grouping key" undersells the indirection required (§11 correction candidate, T2).

**Rule 2 — Unresolved chains (flagged, not silently resolved).** In this corpus, 1,402 of 6,689 assistant records (~21%) do not resolve to any `promptId` even after walking the full `parentUuid` chain to the root of their session file. This is overwhelmingly a main-chain phenomenon (1,343/1,402, ~96%), not a sidechain one — ruling out "sidechain roots don't carry `promptId`" as the primary explanation. Root cause not conclusively determined during this investigation; candidate explanations include `/clear`/context-reset events severing the visible chain, or `queue-operation` records (§1.2) batching multiple human inputs under mechanics not yet understood (165 `promptId` groups in this corpus contain more than one non-tool-result `user` record, which is inconsistent with "one `promptId` = one human-submitted message" as a strict rule). **Contract:** an assistant record whose chain doesn't resolve gets `promptId: null` and is excluded from turn-grouped measures (turns count, per-turn cost bars) but still counts toward session-level and dimension-only aggregates. **This needs verification against a larger corpus before `#P2-1` treats it as final.**

**Rule 3 — Sidechain handling.** `isSidechain` is always present (boolean, never absent) — no null-check needed. `isSidechain: true` correlates 1:1 with presence of `agentId` in this corpus (495/495). Whether sidechain calls count toward main-chain turn/wall-minute aggregates by default is a sign-off-gated decision — see §8 (T2), not decided here.

**Rule 4 — Model-switch / session-level attribution.** 6 of 71 real sessions in this corpus (~8.5%) use more than one distinct model, **after** excluding the `<synthetic>` placeholder (11/71 before exclusion — the unfiltered count overstates this by including rate-limit-retry markers as if they were a "model"). 8.5% is common enough to need an explicit default, not a rare edge case worth hand-waving. The default itself is sign-off-gated — see §8 (T2).

**Rule 5 — Compaction.** Compaction is **not** a distinct `"type": "summary"` record — `architecture.md` itself makes no such claim (checked directly, §1.2 note); the "summary lines" phrasing traces only to filed issue #12's scope text, already tracked separately as stale. In real data (0/18,851 lines with that type), the actual compaction mechanism is a `type: "user"` record carrying `isCompactSummary: true` and `isVisibleInTranscriptOnly: true`, with its own ordinary `promptId` (both observed instances in this corpus had one). Treat it as a turn boundary marker on an otherwise normal user-turn record, not a separate record kind.

**Rule 6 — Session rollup.** A session is every `CompactCall` (and the turns they resolve into per Rule 1) sharing one `sessionId` (always present, §1.3). A session's tier is derived per §4, not redefined here.

---

## 4. `TierFlags` + Premium Schemas (C/B/L)

### 4.1 `TierFlags` (derived per session, file-presence-only for this pass — granularity default is sign-off-gated, §8/R9, T2)

| Field | Type | Derivation | Nullability | Tier |
|---|---|---|---|---|
| `hasCost` | boolean | a `<sessionId>.cost.jsonl` file exists | required (defaults false) | 🟢 |
| `hasTurnBoundaries` | boolean | a `<sessionId>.turn-boundaries.jsonl` file exists | required (defaults false) | 🟢 |
| `hasCostLog` | boolean | `sessionId` appears as a `session_id` value in the **shared** `cost-log.jsonl` (§1.10 — this is a lookup, not a file-existence check, since L is one file for all sessions) | required (defaults false) | 🟢 |
| `tier` | `"🟢"` \| `"🟡"` \| `"🔴"` | per architecture §4's existing tier rules — not redefined here | required | 🟢 |

### 4.2 C schema (`.cost.jsonl`) — see §1.8 for the full field table and the two-shape finding.

### 4.3 B schema (`.turn-boundaries.jsonl`) — see §1.9.

### 4.4 L schema (`cost-log.jsonl`) — see §1.10, including the field-name mismatch note against C.

---

## 5. Measure & Dimension Catalog

### 5.1 Dimensions

| Dimension | Source | Notes |
|---|---|---|
| time | `CompactCall.timestamp` | Bucketing/timezone rules land in §7 (T2) |
| project | `CompactCall.cwd` | |
| model | `CompactCall.model` | Exclude `isSyntheticOrError` rows |
| gitBranch | `CompactCall.gitBranch` | |
| ccVersion | `CompactCall.version` | |
| entrypoint | `CompactCall.entrypoint` | Observed value: `"cli"` only in this corpus — `"ide"`/`"sdk"` named in `pages.md` not observed locally, claimed-not-observed |
| mainVsSidechain | `CompactCall.isSidechain` | |
| toolName | `CompactCall.toolNames` (fan-out) | |
| gateStatus | Evaluated by `gates.md`, not a raw field | Cited, never redefined (REQ Decision 10 pattern) |
| host | Not in any file | 🔴/⚑N — Settings labeled scan roots (architecture §4) |

### 5.2 Measures

| Measure | Formula / Source | Tier |
|---|---|---|
| computed $ | tokens × pricing table (Settings `config.json`) | 🟢 |
| observed $ | C: `cumulative_cost_usd` delta between samples, or L: `cost_usd` | 🟡 — requires `TierFlags.hasCost` or `hasCostLog` |
| tokens by type | `CompactCall.inputTokens` / `outputTokens` / `cacheReadInputTokens` / `cacheCreationInputTokens`, split further by `cacheCreation5mTokens` / `cacheCreation1hTokens` | 🟢 |
| API calls | count of `CompactCall` rows where `isSyntheticOrError === false` | 🟢 |
| turns | count of distinct resolved `promptId` groups (§3 Rule 1); excludes unresolved-chain rows per Rule 2's contract | 🟢 |
| sessions | count of distinct `sessionId` | 🟢 |
| tool calls | sum of `CompactCall.toolUseCount` | 🟢 |
| cache hit % | `cacheReadInputTokens` ÷ (`cacheReadInputTokens` + `inputTokens` + `cacheCreationInputTokens`) | 🟢 — exact formula/rounding convention finalized in §7 (T2) |
| wall minutes | B: `turn_end`/`turn_end_epoch` deltas; fallback: consecutive `CompactCall.timestamp` deltas | 🟡 |
| api ms | C: `api_duration_ms` | 🔴 — no transcript fallback for this specific field |
| lines ± | C: `lines_added` / `lines_removed` | 🔴 — T tier carries no line-diff data |
| gate pass rate | Cites `gates.md`'s existing rollup rule | 🟢 — never redefined here (REQ Decision 10) |

### 5.3 Per-page field resolution

Every row below cites a `pages.md` section and confirms it resolves to fields/measures already defined above — no row is left at a coarse `T+P`/`C`/`B` mark. Fields not yet in §2/§4 are called out explicitly rather than invented.

**1. Dashboard** (`pages.md` §1) — stat cards, cost-over-time, burn-rate, most-recent-session, leaderboards, anomaly feed, records strip, subscription tracker, leverage ratio, savings decomposition, failed-work stat, cost-capture banner. All resolve to: computed/observed $ (§5.2), tokens by type, sessions/turns/API-calls counts, cache hit %, `TierFlags` (for the 🟡/🔴 badges and banner), `cwd`/model dimensions (leaderboards). Burn-rate's budget value and subscription tracker's calibration value are `⚑N` (Settings, out of this doc's scope per REQ). Failed-work stat needs `error tool_results` — resolves to `CompactCall.toolResultByteSize > 0` combined with tool-result content inspection at parse time (byte-size-only per §2 exclusion — a "failed" classification needs a lightweight heuristic on the tool_result before it's discarded, not stored; flagged as a parser-time concern, not a stored field).

**2. Sessions** (§2) — full-text prompt search (`CompactCall.promptText`), filter bar (all §5.1 dimensions), sessions table (all §5.2 measures + `TierFlags`), timeline/gantt (`timestamp` + wall-minutes), efficiency scatter (any two measures), cost distribution histogram (computed/observed $ distribution — percentile mechanics land in §7 T2), compare mode (no new fields), tags (`⚑N`, out of scope).

**3. Session Detail** (§3) — header (session rollup fields, §3 Rule 6, plus computed-vs-observed drift needs both `TierFlags.hasCost`/`hasCostLog` present simultaneously), cumulative $ timeline + compaction flags (`isCompactSummary`, §3 Rule 5), per-turn cost bars (turns measure, `isSidechain` split), turn table (all core measures per turn), turn cost percentile (needs full turn-cost distribution, §7 T2), cache strip (cache hit % per call), tool mix (`toolNames`), prompt list (`promptText` per turn), Report Card (cites `gates.md`, not redefined), workflow funnel (`toolNames` classified into read/plan/edit/verify/commit — classification rule is a `gates.md` concern, cited not redefined here), token funnel (tokens by type), context composition (`toolResultByteSize` grouped by tool name).

**4. Turn Inspector** (§4) — turn summary (per-turn measures), API-call waterfall (`api_duration_ms` where available, else `timestamp` deltas — matches §5.2's wall-minutes fallback pattern), cache narrative (tokens by type + TTL split), transcript peek (raw file read, not a stored field — architecture §5.4 already specifies this is lazy/on-demand), sidechain breakdown (`isSidechain`, `agentId`).

**5. Projects** (§5) — spend by project (`cwd` dimension), per-project efficiency table (measures grouped by `cwd`), per-branch breakdown (`gitBranch` dimension), project → sessions (no new fields).

**6. Models** (§6) — call-level token/$ split, model mix over time, efficiency ratios, CC-version dimension (`version`), $/1k-lines (C `lines_added`/`lines_removed` — 🔴), latency by model (C `api_duration_ms` — 🔴, fallback timestamp deltas per §5.2's wall-minutes pattern), throughput (`outputTokens` ÷ `api_duration_ms` — 🔴), entrypoint breakdown (`entrypoint` dimension — noting only `"cli"` observed locally, §5.1).

**7. Cache Lab** (§7) — fleet totals/hit-rate (cache hit % measure), input composition (tokens by type), busts headline (needs a cache-miss classifier — same "classification rule, not a stored field" pattern as the Dashboard's failed-work stat; flagged, not resolved to a field here), TTL bucket mix (`cacheCreation5mTokens`/`cacheCreation1hTokens` — directly confirmed in §1.6/§2), baseline weight trend (first `cacheCreationInputTokens` per session over time — no new field), $ saved (computed vs. counterfactual — derived from tokens by type, no new field), invalidation gallery/cost-by-cause (same classifier pattern as busts headline), context growth curves (C-tier only, 🔴 — `context_pct` field, §1.8).

**8. Trends, Calendar & Budget** (§8) — calendar/hour-of-day heatmaps (`timestamp` bucketing, §7 T2), stacked weekly bars (`cwd`/`model` dimensions), Pareto panel (turn-level $ distribution, §7 T2 for percentile mechanics), rolling efficiency (time-series of existing measures), gate pass-rate trend (cites `gates.md`), budget/forecast (`⚑N`, out of scope).

**9. Data Health** (§9) — dedup stats (parse-time counter, not a `CompactCall` field — architecture §5.4's "malformed line counter"), pricing coverage (cross-reference `CompactCall.model` against the Settings pricing table — no new field), scan coverage (`fs`, parser/discovery-layer state, not a data-model field), reconciliation (computed vs. C vs. L $ — needs all three simultaneously, 🔴), boundary/promptId mismatches (directly Rule 2's unresolved-chain finding — this page is where that gap becomes user-visible), capture gaps (`TierFlags` presence vs. actual data completeness — ties to §8/R9's granularity decision, T2).

**10. Settings** (§10) — pricing table editor, scan roots, budget/alert thresholds, gate/anomaly thresholds, saved views/tags manager, cost-capture setup guide — all `config.json`/`local.json` concerns (§6.4) or `⚑N`, no `CompactCall`/`TierFlags` fields involved.

**11. Explore** (§11) — pivot builder over any dimension (§5.1) × any measure (§5.2); no new fields, this page is explicitly the generic layer over everything already catalogued above.

**No duplicate-with-drift check:** measures repeated across multiple pages above (computed/observed $, tokens by type, cache hit %, turns, sessions) resolve to exactly one definition each in §5.2, cited by section number in every page row rather than restated — consistent with ARCH A16 (page-ordered investigation, first-definition-wins).

---

## 6. API Envelopes

### 6.1 `Series` (metrics engine output — `POST /api/metrics`)

Per architecture §8's `MetricsQuery` contract (cited, not redefined): request shape is `{measures, dimensions, grain, range, filters, compare?, smoothing?, mode?}`. Response `Series[]`:

| Field | Type | Notes |
|---|---|---|
| `measure` | string | One of §5.2's measure names |
| `dimensionValues` | `Record<string, string>` | One entry per requested dimension |
| `points` | `{bucket: string, value: number, tier: "🟢"\|"🟡"\|"🔴"}[]` | `bucket` format depends on `grain` — timezone/formatting rules land in §7 (T2) |
| `compareTo`? | same shape as `points` | Only present when `compare: "previous-period"` was requested |

### 6.2 Sessions list / detail (`GET /api/sessions`, `GET /api/sessions/:id`)

**List row:** `sessionId`, `cwd`, `gitBranch`, `models: string[]` (all distinct real models used in the session, per §8.1 — decided, not a single dominant value), computed $, observed $ (nullable — absent without `TierFlags.hasCost`/`hasCostLog`), token totals, turn count, duration (wall-minutes), cache hit %, gate score (cites `gates.md`), `TierFlags`.

**Detail payload:** list row fields plus the full turn array (each turn: resolved `promptId`, `CompactCall[]` in that turn, `isCompactSummary` boundary flags per §3 Rule 5, per-turn measures from §5.2).

### 6.3 Health (`GET /api/health`)

Per architecture §9: dedup stats (parse-time counters), parse errors (malformed-line counts per §1.1 — zero in this corpus, but the counter always exists), scan coverage (roots scanned, files found/parsed/failed), reconciliation (premium-only, 🔴 — needs C+L simultaneously per §5.3's Data Health row).

### 6.4 `config.json` / `local.json`

Per architecture §10, not redefined here — field-level detail for these is a Settings-page (`pages.md` §10) concern and doesn't touch `CompactCall`/`Turn`/`Session`/`TierFlags` at all (§5.3's Settings row).

---

## 7. Behavior Contracts

**Dedupe scope.** Per-session, by `message.id` (architecture §5.4, confirmed correct against real data — see §10). Within-session raw duplication is real and substantial (3,793 duplicate `message.id` occurrences observed across 2,936 distinct ids in the T corpus — roughly 2.3 raw lines per distinct call on average), confirming dedupe is necessary; a per-session `Set<message.id>` (seen-set) at parse time is sufficient — no cross-session tracking is needed (§10 found zero cross-session collisions).

**0-byte file.** Treated as a valid, empty session: zero `CompactCall`s, zero turns, no parse error recorded. Not an error condition — a session file can legitimately be created by Claude Code and not yet written to at discovery time (architecture §5.1's discovery/poll race).

**Malformed-first-line file.** The per-file malformed-line counter (architecture §5.4) increments as normal; parsing continues from line 2 onward. A malformed first line does not invalidate the rest of the file — there is no "give up on this file" path. (Not observed in this corpus — 0/106 T files — but the contract holds regardless of local observation, per REQ R12.)

**Garbage-format file** (right extension, entirely non-JSONL content). Every line fails to parse; the malformed-line counter reaches the file's total line count. The file produces zero `CompactCall`s and surfaces on Data Health (`pages.md` §9) as 100% malformed for that file — same mechanism as the malformed-first-line case, just exhaustive rather than partial. No special-cased "garbage file" detection is needed; it falls out of the general malformed-line counter naturally.

**Time bucketing & timezone.** All source timestamps are ISO 8601 UTC (`Z` suffix, observed with and without millisecond precision — e.g. second-precision in C/B/L, millisecond-precision in T's `message`-level timestamps). Bucketing (`hour`/`day`/`week`/`month` per architecture §8) uses the **server process's local timezone**, not UTC — this is a single-user, local-first tool (CLAUDE.md: "one npm package, one port," no multi-tenancy), and a user's "day" boundary should match their own clock, not an arbitrary UTC cutoff. Investigator's call per REQ Decision 2 — no sign-off required.

**Query-key serialization.** Per architecture §11's requirement that "the key factory must serialize the full query... into the key": the concrete rule is `JSON.stringify` over the `MetricsQuery` object with **object keys sorted** before serialization, so two logically-identical queries built with different property insertion order produce the same cache key. Array-valued fields (`measures`, `dimensions`, filter value arrays) are not re-sorted — their order is significant (e.g. measure display order) and already deterministic from the caller.

**Rounding.** `$` values: stored at full floating-point precision internally (raw values like `1.8167905999999998` observed in real L-tier data are floating-point artifacts of the source, not a rounding bug to fix at parse time); rounded to 2 decimal places only at display/API-response time. Token counts: integers, no rounding applicable. Percentages (cache hit %, gate pass rate): rounded to 1 decimal place at display time. Investigator's call per REQ Decision 2 — no sign-off required.

---

## 8. Sign-Off Decisions

**⚠️ Both decisions below are proposed defaults, not final.** Per REQ R8/R9 and ARCH Cross-Cutting Concerns → Migrations/rollout, this document is not "merged" until the developer explicitly signs off on both.

### 8.1 Multi-model / sidechain session-level attribution (R8)

**Finding:** 6 of 71 real sessions in this corpus (~8.5%) use more than one distinct real model (after excluding the `<synthetic>` error-marker placeholder — §1.3, §3 Rule 4). This is common enough to matter for the Dashboard/Sessions "model" column, not a rare edge case.

**Decided (developer sign-off received):**
- **Session-level "model" attribution:** show **all** distinct real models used in the session (`models: string[]`, excluding the `isSyntheticOrError` placeholder), not a single dominant value. Dashboard/Sessions "model" column renders every model the session touched (e.g. as multiple chips) rather than collapsing to one. This changes §6.2's session list/detail row shape: `model: string` becomes `models: string[]`.
- **Sidechain calls in default aggregates:** approved as proposed — excluded from default turn/wall-minute aggregates (main-chain only), available via the existing main-vs-sidechain dimension filter (§5.1).

**Status:** decided (developer sign-off received).

### 8.2 Premium coverage granularity (R9)

**Finding:** the L tier (`cost-log.jsonl`) has only 47 lines total, covering a small fraction of the 94 sessions that have C-tier coverage — a real, observed coverage gap, not a hypothetical one. File-presence (`TierFlags.hasCost`/`hasCostLog`/`hasTurnBoundaries`) doesn't guarantee the premium file covers the *entire* session (e.g. cost-logger enabled mid-session, or a hook that crashed partway through).

**Decided (developer sign-off received):** file-presence-only for this pass (matches current `TierFlags` design in §4.1) — a session with *any* C/B/L coverage is labeled with that tier's badge, with a known-limitation note that "observed" may reflect partial coverage, not full-session coverage. True per-turn coverage checking is deferred to the Data Health page work (`#P4-14`), consistent with REQ's original suggested default.

**Status:** decided (developer sign-off received).

---

## 9. Prompt-Text Size Finding (R10)

Measured against 856 genuine user prompts in this corpus (tool-result-continuation and compaction-summary records excluded — §1.3, §3 Rule 1):

| Percentile | Size (bytes, UTF-8) |
|---|---|
| min | 1 |
| p50 | 130 |
| p90 | 2,644 |
| p99 | 12,990 |
| mean | 2,123 |
| max | 603,252 |

Only 19 prompts (2.2%) exceed 10 KB; only 2 (0.23%) exceed 100 KB; none exceed 1 MB. The tail is real (p99→max is a ~46× jump — a handful of large pastes) but small in absolute terms relative to architecture §6's stated "low hundreds of MB" acceptable footprint for months of heavy usage.

**Decision: no cap.** At this corpus's observed scale, a 590 KB outlier prompt is not a meaningful memory or payload-size threat, and introducing a cap adds truncation-handling complexity (partial-prompt display, "truncated" indicators in search results) for a 0.23%-frequency case. Per REQ R10/Decision 2, "no cap" is the investigator's call and requires no sign-off.

---

## 10. `message.id` Collision Finding (R11)

Checked across all 106 real T files (2,936 distinct `message.id` values, 6,689 total assistant records before dedupe):

- **Cross-session collisions found: 0.** No `message.id` value appears under more than one `sessionId`.
- **Within-session duplication: 3,793 occurrences** (real, and already accounted for by the per-session dedupe contract in §7 — this is the normal "raw lines collapse to distinct calls" behavior architecture §5.4 already expects, not a new problem).

**Outcome:** `architecture.md`'s per-session dedupe scope stands as documented — no revision needed. Per REQ R11's suggested default ("if no collisions are found in real data, architecture.md's per-session dedupe stands as documented"), this does not require developer sign-off; only a *found* collision would have triggered that gate.

---

## 11. Corrections to `architecture.md` / `pages.md`

One genuine correction surfaced during investigation:

**`architecture.md` §4** currently states: *"`promptId` is the turn-grouping key."* This is true but incomplete in a way that matters for `#P2-1`'s implementation: `promptId` is present **only** on `type: "user"` records (0/6,689 assistant records carry it directly — §1.3). Every `assistant` record's turn membership must be resolved by walking its `parentUuid` chain to the nearest ancestor carrying `promptId` (§3 Rule 1) — a real algorithm, not a direct field read. Suggested amendment to §4: *"`promptId` is the turn-grouping key, present only on `user`-type records; `assistant` records resolve their turn via the `parentUuid` ancestor chain (see `claude-lens-data-model.md` §3 Rule 1)."*

**Filed issues citing `architecture.md` §4** (per ARCH A15 — listed so this correction's ripple is visible, not silently absorbed): `#P2-3` (discovery/polling), `#P4-13` (premium tier C/B/L parsers). Neither issue's citation depends on the specific sentence being corrected (both cite §4 for the filename-pattern/tier-detection rules, which are unchanged), so this correction does not invalidate either citation — noted for completeness per A15, not because a citation actually broke.

**No correction needed for `pages.md`** — nothing investigated during T1/T2 conflicted with its content; its coarse dependency marks (§5.3 of this document) were confirmed accurate at the field level throughout.

**One open item carried forward, not a correction (§3 Rule 2):** ~21% of assistant records don't resolve to a `promptId` via the parentUuid chain, root cause not conclusively determined. This isn't a documented claim in either spec to correct — it's a genuine gap in current understanding, flagged for follow-up investigation (larger corpus, or instrumented capture) before `#P2-1` treats the turn-derivation algorithm as fully specified for that ~21%.

---

**Document status:** §1–§11 complete. §8.1 and §8.2 have received explicit developer sign-off (REQ R8, R9) — this document is merged.
