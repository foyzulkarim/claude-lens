# Requirements: Data Model & Contracts Spec

> **Date:** 2026-07-08
> **Type:** infrastructure
> **Source:** GitHub issue #12 (#P0-7, `specs/claude-lens-plan.md` Phase 0)
> **Phase:** 1 of 5 (Requirement Engineering)

## Summary

`specs/claude-lens-architecture.md` names types like `CompactCall`, `Turn`, `Session`, `TierFlags`, and `Series` throughout but never defines them field-for-field. This work investigates real Claude Code data on the author's machine and produces `specs/claude-lens-data-model.md` — the authoritative, field-level contract that `#P2-1` (shared contracts implementation) transcribes verbatim and every Phase 4 page cites for its measure/dimension formulas. This is spec-only: no implementation code. Because every later phase builds directly on this doc, an error here cascades through the whole system — this REQ treats it with the same rigor as a system-critical feature, not a routine docs task.

The doc's content is field tables, type definitions, and prose behavior contracts — **no JSONL content, real or synthetic, is embedded anywhere in it.** The investigator has direct, standing access to real local data (`~/.claude/projects`, `~/.claude/cost-log.jsonl`) and verifies every claim by reading it directly, at investigation time and at any future revision. An embedded example would be evidence for a reader who doesn't trust that verification happened; that reader doesn't exist here, so the doc doesn't carry the artifact.

## Problem & Motivation

Without a field-level contract, `#P2-1` would invent field shapes at implementation time, and each Phase 4 page would separately negotiate with whatever got invented — silent divergence multiplied across 11 pages. The trigger is architectural: Phase 2 (data engine) cannot start safely until the fields, derivation rules, and behavior contracts it implements are pinned down against real observed data, not assumed from the architecture doc's prose.

## Users & Consumers

- **`#P2-1` (shared contracts)** — transcribes this doc's field tables directly into TypeScript types; needs zero ambiguity.
- **`#P0-3` (fixture author)** — blocked on this doc; needs to know which fields/edge cases fixtures must exercise.
- **Phase 4 page implementers** — cite this doc's measure/dimension catalog for chart formulas instead of re-deriving them per page.
- **The author (sign-off owner)** — must explicitly approve the handful of decisions below that change what numbers show up on real pages (see R8, R9).

## Functional Requirements

| ID  | Requirement                                                                                     | Acceptance Criterion                                                                                                                    |
|-----|---------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------|
| R1  | Source inventory of observed raw record shapes for all four file types (T, C, B, L)               | Doc has a source-inventory section enumerating every field name/nesting path/type observed in T/C/B/L, based on direct inspection of real local files — field tables only, no example blob |
| R2  | `CompactCall` defined field-for-field                                                             | Every field has: type, source JSON path, nullability, tier (🟢/🟡), and deliberate-exclusion notes (e.g. tool_result bodies → byte sizes) |
| R3  | `Turn`/`Session` derivation rules documented, including sidechain, model-switch, compaction edges  | Each derivation rule is a standalone, unambiguous prose statement — precise enough for `#P2-1` to implement without an accompanying illustration |
| R4  | `TierFlags` + all three premium file schemas (C/B/L) defined field-for-field                       | Each premium file type has a field table verified against real local instances (C: 93 files, B: 33 files, L: 1 file) — field tables only, no example blob |
| R5  | Measure & dimension catalog complete                                                              | Every measure/dimension in `pages.md`'s Data source legend has a formula or source field; "gate pass rate" cites `gates.md`'s existing rollup rule rather than redefining it |
| R6  | API envelopes documented (`Series`, sessions list/detail, health, `config.json`/`local.json`)      | Each envelope has a field-level shape in the doc                                                                                          |
| R7  | Behavior contracts specified: dedupe scope, malformed/truncated line & file handling, time bucketing & timezone, query-key serialization, rounding | Each behavior contract is a standalone, testable statement (not just prose embedded in another section)                                  |
| R8  | Multi-model-session and sidechain session-level attribution rule proposed                          | Doc proposes a default; **author explicitly signs off before the doc is considered merged**                                              |
| R9  | Premium coverage granularity (file-presence-only vs. per-turn coverage) proposed                   | Doc proposes a default; **author explicitly signs off before the doc is considered merged**                                              |
| R10 | Prompt-text size distribution measured against real data; cap proposed only if warranted            | Doc states the measured distribution (aggregate stats, not example content) and either "no cap" (investigator's own call) or a proposed cap (needs sign-off only in that case) |
| R11 | Cross-session `message.id` collision checked against real data                                     | Doc states whether collisions were found and the resulting dedupe-scope decision (per-session, as architecture.md currently says, or revised) |
| R12 | 0-byte file, malformed-first-line file, and garbage-format file each handled explicitly             | Behavior contracts section enumerates each of the three cases separately, not folded into one general statement                          |
| R13 | Any `architecture.md`/`pages.md` correction arising from a spec-vs-reality conflict is captured      | Each correction appears as a follow-up note/diff referenced from the data-model doc                                                       |

## Non-Functional Requirements

| ID  | Requirement                                                                                   | Acceptance Criterion                                                                                          |
|-----|-------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------|
| N1  | No JSONL content of any kind — real or synthetic — embedded anywhere in the doc                   | Doc contains zero raw/example JSON blobs; content is limited to field tables, type definitions, and prose     |

## Behaviors & Domain Rules

**Source classification** — filename pattern (`<uuid>.jsonl`, `.cost.jsonl`, `.turn-boundaries.jsonl`, `cost-log.jsonl`) determines tier per session; `cost-log.jsonl` lives one level up from the projects scan root and must be discovered explicitly.

**Dedup & turn/session derivation** — dedupe by `message.id`; turns group by `promptId`; sessions roll up turns. Sidechain calls, mid-session model switches, and compaction lines are known interleaving hazards the doc must resolve with precise prose rules (R3) — no illustration will accompany them, so the rules themselves carry the full weight of removing ambiguity.

**Tier detection** — a session's tier today is presence-of-file; whether that's sufficient or needs per-turn coverage checking is an open decision (R9) because it changes what "observed" vs "computed" $ means on real pages.

**Why these rules matter:**
- Turn/session derivation errors don't fail loudly — they silently shift every measure that groups by turn or session (wall minutes, turns count, cache-hit %), which is exactly the "cascades to the whole system" risk this REQ was scoped to guard against.
- Tier-detection errors produce plausible-looking but wrong dollar figures (computed labeled as observed, or vice versa) — a correctness bug that's invisible without cross-checking against a second source.

**Common mistakes:**
- No single highest-risk area was identified in advance (the author had no strong guess). Rather than betting on one area, every derivation rule (R3) is held to the same precision bar in prose — no worked example exists to catch an ambiguity later, so the rule has to be unambiguous on first write.

## Edge Cases & Failure Modes

| Scenario | Decision | Rationale |
|---|---|---|
| Premium file (C/B/L) present but architecture/pages spec text turns out to not match the real observed shape | Doc reflects observed reality; `architecture.md`/`pages.md` get a follow-up correction | The data-model doc is the ground truth other tasks build against — it can't inherit a stale spec's error (Decision 3) |
| Session spans multiple models (mid-session switch) | Investigate → propose a default for session-level attribution (e.g. Dashboard/Sessions "model" column) | Changes real page output; needs explicit sign-off (R8) |
| Session includes sidechain calls | Investigate → propose default for whether/how sidechain calls count toward session-level aggregates (turns, wall-min) | Same reasoning as above (R8) |
| Premium file exists but only covers part of the session (hook crashed mid-session) | Investigate → propose whether tier needs per-turn coverage granularity vs. file-presence-only | Affects "observed vs computed $" semantics and Data Health's reconciliation story (R9) |
| Same `message.id` appears in two different session files (e.g. resumed/forked session) | Investigate real data before trusting architecture.md's "per-session dedupe" claim as correct | If collisions occur, per-session-only dedupe is a double-counting bug, not a settled fact (R11) |
| User prompt contains a large paste (logs, file dump) | Measure real prompt-size distribution; propose a cap only if outliers warrant it | Architecture.md's "retain in full; small" claim is untested against real data (R10) |
| Transcript file is 0 bytes | Specified explicitly in behavior contracts | Removes ambiguity for `#P2-1`'s parser implementation (R12) |
| Transcript file's first line is malformed JSON | Specified explicitly in behavior contracts | Same as above — general "skip malformed lines" rule shouldn't have to be interpreted for this case (R12) |
| File has the right extension but is entirely wrong format (garbage) | Specified explicitly in behavior contracts | Same as above (R12) |

## Decisions Log

| #   | Decision | Alternatives Considered | Chosen Because |
|-----|---|---|---|
| 1   | Investigation reads real local data across all four tiers (T/C/B/L) directly to verify every field/rule claim; nothing from it is transcribed into the doc | Inferring C/B/L schemas from `legacy/server.js` without checking real data | All tiers are present on this machine (93 `.cost.jsonl`, 33 `.turn-boundaries.jsonl`, `cost-log.jsonl`); direct access makes verification a standing capability, not a one-time artifact to embed |
| 2   | Investigator has default authority to decide and document spec-silent points (timezone, rounding, query-key serialization) | Flag every silent point as an open question blocking on author sign-off | Keeps this a single-pass, sprint-sized deliverable; author sign-off is reserved for the handful of decisions that change real page output (see #4, #5) |
| 3   | Real data wins over stale spec text; `architecture.md`/`pages.md` get follow-up corrections | Doc defers to existing spec text when they conflict | The data-model doc's entire purpose is being ground truth for `#P2-1` onward — it cannot propagate a spec error forward |
| 4   | Multi-model/sidechain session-level attribution is investigated and proposed, but requires explicit author sign-off (carve-out from Decision 2) | Let investigator decide freely like other silent points | Changes what the Dashboard/Sessions page displays for real users — high-visibility enough to warrant a checkpoint |
| 5   | Premium coverage granularity (file-presence vs. per-turn) is investigated and proposed, but requires explicit author sign-off (carve-out from Decision 2) | Let investigator decide freely | Changes "observed vs. computed $" semantics fleet-wide — same reasoning as #4 |
| 6   | No JSONL content — real, redacted, or synthetic — appears anywhere in the doc. Field tables and prose are the entire deliverable; verification happens by reading real data directly, not by embedding an artifact of having done so | (a) anonymized real excerpts with field-by-field redaction, (b) synthetic examples matching real shapes, (c) a brief "verified against N sessions" note without a full example | All three solve a problem that doesn't exist here: the investigator has explicit, standing permission to read the real data directly, at any time, including during future revisions — an embedded example only matters for a reader who can't or won't do that themselves |
| 7   | Cross-session `message.id` dedupe scope is investigated against real data, not assumed correct from architecture.md | Trust architecture.md's per-session-dedupe claim as-is | If collisions across session files occur, current per-session-only dedupe silently double-counts — worth one real check before locking it in |
| 8   | Prompt-text size is measured against real distribution; a cap is proposed only if outliers warrant it | Take "retain in full, no cap" as already settled | Architecture.md's "small" claim about prompt text is untested; author had no strong prior either way |
| 9   | Every derivation rule (not just the riskiest-seeming one) is held to the same prose-precision bar | Focus extra rigor only on whichever single area seems riskiest | No single highest-risk area could be confidently predicted in advance, so the same bar applies uniformly |
| 10  | Gate pass rate measure cites `gates.md`'s existing rollup rule rather than re-deriving it | Independently define gate pass rate formula in the data-model doc | `gates.md` is already the authority on gate semantics (weighted pass rate, fail/warn/pass rollup); redefining it risks the two docs disagreeing later |

## Scope Boundaries

### In Scope
- Field-level contract writing for `CompactCall`, `Turn`, `Session`, `TierFlags`, `Series`, and API envelopes
- Real-data investigation across all four file tiers (T/C/B/L) on this machine, by direct inspection — not summarized into an embedded artifact
- Derivation-rule documentation as precise, standalone prose (turn grouping, session rollup, tier detection, cache TTL bucketing)
- The two sign-off-gated decisions: multi-model/sidechain attribution (R8), premium coverage granularity (R9)
- Cross-session dedupe check against real data (R11)
- Prompt-text size distribution check (R10) — aggregate statistics only, no example content
- Malformed/edge-case file enumeration (R12)
- Measure/dimension catalog completion, citing `gates.md` for gate pass rate
- Zero JSONL content in the doc, real or synthetic (N1)
- Any follow-up correction note to `architecture.md`/`pages.md` arising from a spec-vs-reality conflict (R13)

### Out of Scope
- Implementation code for the parser, store, or API (reason: that's `#P2-1` onward — this task is design/investigation only)
- Redefining gate pass-rate formula independently of `gates.md` (reason: `gates.md` is already the authority; this doc cites it)
- Fixture creation (reason: `#P0-3`, blocked on this doc, handles fixtures separately — note: `#P0-3`'s own acceptance criteria currently calls for fixtures "produced from real `~/.claude/projects` data." Fixtures are a different case from this doc: they're consumed by test code and need to *be* real/realistic data, not just describe it, so the "no examples" decision here doesn't automatically transfer. Worth a deliberate look before `#P0-3` starts, not assumed either way.)
- Data Health page's reconciliation/capture-gap UI (reason: `#P4-14`, a later implementation task)
- Redesigning the tailer/ingest algorithm itself — offset tracking, truncation fallback, polling intervals (reason: already settled in `architecture.md` §5; this doc documents resulting data shapes and behavior contracts, not the pipeline mechanics, unless investigation finds a genuine conflict per Decision 3)

## Open Questions

- **Multi-model/sidechain session-level attribution default** (R8)
  - **Impact if unresolved:** Dashboard/Sessions page numbers for mixed-model or sidechain-heavy sessions are undefined until sign-off lands
  - **Suggested default:** investigator proposes a default (e.g. "model" = most-token-weighted model in session; sidechain calls excluded from default turn/wall-min aggregates but available via the existing main-vs-sidechain dimension filter) for author sign-off
- **Premium coverage granularity** (R9)
  - **Impact if unresolved:** "observed vs. computed $" labeling may be technically true (file exists) but misleading (file covers only part of the session) until sign-off lands
  - **Suggested default:** investigator proposes file-presence-only for v1, with a documented known-limitation note, deferring true per-turn coverage checking to the Data Health page work (`#P4-14`) if real data shows it's a frequent problem
- **Prompt-text cap threshold, if any** (R10)
  - **Impact if unresolved:** none — "no cap" requires no sign-off; only a proposed cap would need one
  - **Suggested default:** no cap unless real data shows outliers large enough to matter for memory/search-index/API payload size
- **Cross-session `message.id` collision finding** (R11)
  - **Impact if unresolved:** per-session dedupe scope in architecture.md stays unverified against real data
  - **Suggested default:** if no collisions are found in real data, architecture.md's per-session dedupe stands as documented; if collisions are found, escalate to author before locking in a fix

---
_This requirements document is the input for the **plan-architecture** skill._
_Next step: `/plan-architecture from: specs/requirements/REQ-data-model-contracts-spec.md`_
