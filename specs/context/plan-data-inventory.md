# Plan — Data Inventory (observed-field evidence)

> **Task:** #P0-7 — Data inventory (observed-field evidence) — re-scoped from the hallucinated GitHub issue #12's "Data model & contracts spec."
> **Mode:** This file is a **plan**. It is not an executed artifact. Any future agent reads this top-to-bottom and follows the steps verbatim.
> **Date authored:** 2026-07-09.
> **Specs already deleted** by the user prior to this plan: `specs/requirements/REQ-data-model-contracts-spec.md`, `specs/architecture/ARCH-data-model-contracts-spec.md`. No audit-trail requirement (user direction: not obsessed with those docs).

---

## 1. Background — why this plan exists

The filed GitHub issue #12 (`#P0-7`) was hallucinated. Its scope text mumbled together an evidence catalog (the user's actual want) with a forward-looking derived contract spec (`CompactCall`, `Turn`/`Session` derivation rules, `TierFlags`, measure formulas, API envelopes, behavior contracts, sign-off decisions). A prior agent took the issue at its word and produced `specs/claude-lens-data-model.md` — a 404-line "merged contract spec" that embeds zero JSONL examples (the REQ it followed explicitly forbade examples) and skips `system/*` subtypes (`turn_duration`, `stop_hook_summary`, `compact_boundary`, `away_summary`, `api_error`, `local_command`) as "not investigated further."

The user's **clear expectation**:
1. Gather **all** observed fields across T (transcript `.jsonl`), C (`.cost.jsonl`), B (`.turn-boundaries.jsonl`), and L (`cost-log.jsonl`).
2. Each field documented with: name, JSON type, presence (n/N), inline anonymized example value.
3. No interpretation. No retain/drop decisions. No derived contracts. No measures. No API envelopes. No behavior contracts. No sign-off gates.
4. The three premium file types are **first-class sections**, with their own dedicated field tables. They are opt-in (statusline/hooks); absence is not corruption.

The user has deleted the REQ + ARCH docs that mandated the merged-contract version. This plan supersedes the merged contract version in place.

---

## 2. Deliverables (six file operations)

| #  | Path                                         | Action                                                                                                                                                           |
|----|----------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1  | `specs/context/12.md`                         | **REWRITE** — full rewrite of YAML front-matter + body to match the evidence-only scope. See §13. Author first so the GitHub issue body (deliverable 2) and the `plan.md` edits (deliverables 5–6) all point at the same re-scoped source-of-truth. |
| 2  | GitHub issue #12 (remote)                    | **EDIT** via `gh issue edit 12` — title + body to match the rewritten `context/12.md`. Subject to the in-flight preview gate (§14 step 2). See §14. |
| 3  | `scripts/survey-fields.py`                   | **NEW** — committed Phase-1 survey script per §5.1, parameterized over four passes, emits JSON to stdout. See §15. |
| 4  | `specs/claude-lens-data-model.md`            | **REPLACE BODY** with pure observed-field evidence inventory produced by running `scripts/survey-fields.py` and formatting per the methodology in §5 and the doc structure in §6. |
| 5  | `specs/claude-lens-plan.md` lines 34–36      | **EDIT** — rename task to `#P0-7 — Data inventory (observed-field evidence)`; rewrite description to drop the 7-point contract scope; rewrite acceptance criteria to evidence-only. |
| 6  | `specs/claude-lens-plan.md` line 50          | **EDIT** — change "data-model spec merged" → "data-model inventory merged".                                                                                     |

**Order is intentional and mandatory.** Deliverables 1–2 align the issue trail first (local context file, then the GitHub issue it points at) so the scope of work is honest before any content is produced. Deliverable 3 authors the committed survey script; deliverable 4 runs it and formats the data-model doc. Deliverables 5–6 land the planning-doc edits last so `plan.md` reflects the re-scope after the artifacts it tracks are already in place.

---

## 3. Pre-flight (read-only, run before any edit)

```
rg -n "REQ-data-model-contracts-spec|ARCH-data-model-contracts-spec" specs/ --glob "*.md"
   # Expect: zero results. Confirms deletes are clean and no dangling refs remain.
rg -n "claude-lens-data-model" specs/ --glob "*.md" | rg -v "claude-lens-data-model.md:"
   # Expect: P2-1-shared-contracts.md, P2-8-*.md, P0-3-*.md, plan.md, context/12.md
   # This is the downstream filename-citation set; must match.
wc -l specs/claude-lens-data-model.md
   # Baseline (will drop after rewrite).
git status
```

**Stop-and-ask gate:** if pre-flight surfaces any non-zero reference to the deleted REQ or ARCH docs (other than in `claude-lens-data-model.md` front-matter, which we'll replace anyway), STOP. Some downstream file may need a re-pointing edit you did not scope.

---

## 4. Anonymization rules (apply uniformly across the doc)

Inline per-field example cells follow these rules at survey extraction time, *before* any value reaches the doc:

- `/Users/foyzul` → `/Users/<redacted>`
- UUIDs (36-char hex-with-dash strings — `sessionId`, `uuid`, `parentUuid`, `messageId`, etc.) → `<uuid:…>` (keep enough chars to disambiguate visually; e.g. `<uuid:866138e1...>`)
- Strings > 80 chars → first 77 chars + `…`
- Long tool_result bodies / file-snapshot content → `<bytes, len=N>` where N is the real byte length
- Arrays > 3 elements → first 3 elements + `…`
- Model names kept literal (e.g. `claude-fable-5`, `Sonnet 4.6`) — not personally identifying
- Timestamps kept literal (e.g. `2026-07-07T21:40:01.857Z`)
- **L's `dir` field** (and any other path-bearing field that isn't `cwd`) gets the same `/Users/foyzul` → `/Users/<redacted>` treatment, producing values like `/Users/<redacted>/personal/agentic-swe-vod`. The general rule above already covers this; stated explicitly because L uniquely has `dir` as the cwd-equivalent (C has no `dir` at all — see §7).

Net effect: every example cell is non-empty and faithful, without leaking data.

---

## 5. Methodology (inline, reproducible)

Two phases: **survey** (read-only against `~/.claude`), then **format** (assemble markdown from survey output). The body of `claude-lens-data-model.md` is produced by Phase 2.

### 5.1 Phase 1 — Survey

One Python script, **four passes**. Each pass walks a file set line-by-line, parses JSON, and for a given *scope* (line-type key + optional nested-object path) collects three things per field:

- field name (distinct key union across the scope)
- presence count (n / N total in scope)
- one anonymized example value (from the first line where the key appears)

**Script is parameterized by:**
- `files` — the glob set to walk
- `filter_fn` — a predicate on each parsed line (e.g. `r.get('type') == 'assistant'`)
- `path` — dotted/bracket path into the record to the object being inventoried. `[]` for top-level, `['message','usage']` means "walk into `r['message']['usage']` and inventory its keys."
- For array-of-objects scopes (`content[]`, `hookInfos[]`, `iterations[]`): walk the array, inventory each element's keys, group by a discriminator field (e.g. `block['type']` for content blocks).

**Per-tool `tool_use.input`**: group blocks by `block['name']`, then inventory `block['input']` keys per group. Emit top-10 by occurrence count.

**The four passes — file sets are deliberately separate:**

| Pass | Files globbed | Filter | Purpose | Expected output (from prior survey) |
|---|---|---|---|---|
| **A — Transcript (T)** | `~/.claude/projects/**/*.jsonl` **excluding** any path containing `.cost.` or matching `.turn-boundaries.` | all lines, grouped by `type`/`subtype` | 21 line-type tables + nested objects | 108 files, 19,545 lines, 21 distinct line-type keys |
| **B — Cost (C)** | `~/.claude/projects/**/*.cost.jsonl` | all lines — **shared 10-field core** with two mutually-exclusive indexing variants on top: `turn`-indexed (adds `turn`), `epoch`/`sample`-indexed (adds `epoch` + `sample`). The script inventoried all C lines into one record set; §4's `notes` column carries the variant-per-field label. | 95 files, 3,472 lines; 10-field core on every line, +1 (`turn`) on turn-indexed lines, +2 (`epoch`, `sample`) on epoch-indexed lines |
| **C — Turn-boundaries (B)** | `~/.claude/projects/**/*.turn-boundaries.jsonl` | all lines | B field table | 34 files, 242 lines, single stable shape |
| **D — Cost-log (L)** | `~/.claude/cost-log.jsonl` only | all lines | L field table | 1 file, 48 lines, single stable shape |

**Survey script home:** the script live-committed at `scripts/survey-fields.py` is the canonical Phase-1 tool (deliverable 3, §15). Any future re-survey runs `python3 scripts/survey-fields.py > /tmp/survey.json` and refreshes §6 counts; the script survives the session, so revisions to this doc do not re-author survey logic.

**Why exclude `.cost.` and `.turn-boundaries.` from pass A:** the glob `**/*.jsonl` matches all three file types. C/B lines have completely different shapes (no `type`/`subtype`, different key set) and would contaminate the T line-type tally. They are **not** omitted from the doc — they get their own dedicated passes (B/C/D). Separation is structural, not dismissive.

**Output of Phase 1:** structured records — one per (scope, field) pair — carrying `{field, type, present_count, total_count, example}`. Kept in memory (or temp working area) and fed to Phase 2.

### 5.2 Phase 2 — Format

Walk the survey output in doc order (§6 below):

1. §1 File classification — fill the 4-row table from per-pass file/line counts (the survey produces these as a byproduct of walking files).
2. §2 T line-type distribution — sort the 21 line-type keys by count, emit one row each.
3. §3 Per-line-type tables — for each key in §2 order, emit a `### [{key}]` heading, then a field table (sorted by presence desc), then recurse into nested objects (emit `####` sub-tables for each named nested object).
4. §3.1 `content[]` special handling — one overview table of block-type counts (text / thinking / tool_use on assistant; text / tool_result on user), then per-shape block-internal-keys tables.
5. §3.1 `tool_use.input` — top-10 tools by occurrence count, each with its input-key union.
6. §4/§5/§6 — emit C/B/L tables from passes B/C/D; `notes` column carries the shape-variant flag for C.
7. §7 Cross-tier collision table — compare C and L field names for the same concepts (manual, side-by-side: `cache_read_tokens` vs `cache_read`, `cost_delta_usd`/`cumulative_cost_usd` vs `cost_usd`, `api_duration_ms` vs `duration_ms`, C lacks `dir` vs L uses `dir` as cwd).
8. §8 Out of scope — static text, no survey input.

**Output of Phase 2:** the full markdown body, written to `specs/claude-lens-data-model.md` in a single `write` call after a required `read` of the existing file.

### 5.3 Why this is reproducible

Any future agent executes Phase 1 against the *current* `~/.claude` corpus — numbers and example values refresh naturally if the corpus drifts. The doc structure (§6) is fixed and stable; only the numbers update. If a 22nd line type appears in a future corpus, Phase 1 picks it up automatically and Phase 2 emits a new §3 sub-section for it (stop-and-ask gate in §9 covers this).

---

## 6. Doc structure — `specs/claude-lens-data-model.md`

### Front-matter

```
# Claude Lens — Data Inventory (observed-field evidence)

> Evidence-only — every observed field across T/C/B/L, with name / type / presence / inline
> anonymized example. **No** CompactCall contract, no Turn/Session derivation rules, no
> TierFlags design, no measure formulas, no API envelopes, no behavior contracts, no sign-off
> gates. Downstream `#P2-1` cites this as the field source-of-truth; the derived contract layer
> is a separate future task.
>
> Draft — supersedes the merged "Data Model & Contracts" doc dated 2026-07-08 whose REQ/ARCH
> scaffolding has been deleted.
>
> Corpus at investigation time (2026-07-09 snapshot): 108 T files (19,545 lines),
> 95 C files (3,472 lines), 34 B files (242 lines), 1 L file (48 lines). Every count in
> §3–§6 is a snapshot, not a contract — refresh by re-running `scripts/survey-fields.py`.
```

### §1 File classification

One 4-row table, columns: `tier | pattern | location | file count | line count | notes`.

| Tier | Pattern | Location | File count | Line count | Notes |
|---|---|---|---|---|---|
| **T** | `<uuid>.jsonl` | `~/.claude/projects/**` | 108 | 19,545 | Default — every user has this |
| **C** | `<uuid>.cost.jsonl` | same dirs as T | 95 | 3,472 | Premium — opt-in via statusline setup; two mutually-exclusive indexing shapes (turn-indexed / epoch-indexed) |
| **B** | `<uuid>.turn-boundaries.jsonl` | same dirs as T | 34 | 242 | Premium — opt-in via stop-hook setup; single stable shape |
| **L** | `cost-log.jsonl` | `~/.claude/` (parent of projects scan root — discovery must search explicitly) | 1 | 48 | Premium — opt-in via statusline setup; **one shared file across all sessions**, not per-session |

**Defensive note:** Absence of C/B/L files is **not corruption** — they appear only when the user has set up cost-capturing statuslines/stop-hooks. Their optional nature is exactly why they need their own first-class tables.

### §2 T line-type distribution

One table listing every observed `type` / `type+subtype` key, ordered by count desc. 21 rows from the current corpus.

> **Note on counts in this table:** every count below is the observation at 2026-07-09. The executing agent must re-run `scripts/survey-fields.py` and refresh the numbers; these are placeholders, not constants. The plan uses them so the doc structure is concrete enough to scaffold without re-inventing.

| `type/subtype` | Count | Description | See |
|---|---|---|---|
| `assistant` | 6,928 (at investigation time) | API response records — primary source | §3.1 |
| `user` | 4,327 (at investigation time) | User input + tool_result continuation records | §3.2 |
| `attachment` | 1,434 (at investigation time) | Deferred tools, file attachments, etc. | §3.3 |
| `mode` | 1,032 (at investigation time) | Operating mode notifications | §3.4 |
| `last-prompt` | 989 (at investigation time) | Last-prompt snapshot | §3.5 |
| `file-history-snapshot` | 988 (at investigation time) | File history snapshots | §3.6 |
| `ai-title` | 929 (at investigation time) | Auto-generated session titles | §3.7 |
| `permission-mode` | 811 (at investigation time) | Permission mode notifications | §3.8 |
| `system/stop_hook_summary` | 546 (at investigation time) | Stop-hook summaries | §3.9 |
| `system/turn_duration` | 492 (at investigation time) | Per-turn duration record | §3.10 |
| `bridge-session` | 484 (at investigation time) | Bridge session IDs | §3.11 |
| `queue-operation` | 252 (at investigation time) | Queue operations | §3.12 |
| `agent-name` | 123 (at investigation time) | Sub-agent names | §3.13 |
| `system/away_summary` | 94 (at investigation time) | Away summaries | §3.14 |
| `system/local_command` | 63 (at investigation time) | Local command outputs | §3.15 |
| `pr-link` | 20 (at investigation time) | Pull request links | §3.16 |
| `worktree-state` | 18 (at investigation time) | Worktree session records | §3.17 |
| `system/informational` | 6 (at investigation time) | Informational notices | §3.18 |
| `custom-title` | 4 (at investigation time) | User-set session titles | §3.19 |
| `system/api_error` | 3 (at investigation time) | API retry/error events | §3.20 |
| `system/compact_boundary` | 2 (at investigation time) | Conversation compaction markers | §3.21 |

### §3 Per-line-type field tables

One sub-section per line type, ordered by the count above. Each sub-section:

- `### [{key}]` heading, with the count
- A field table, sorted by presence desc, columns: `field | type | presence (n/N) | example | notes`
- For any named nested object that recurs in this line type: a `####` sub-table under the parent, recursing one level into the nested object's keys

**Sub-sections in order:**

- **§3.1 `assistant`** (n=6,928 at investigation time) — top-level field table; then nested sub-tables:
  - §3.1.1 `message.*` (n=6,928 — every assistant carries `message`)
  - §3.1.2 `content[]` block shapes — one overview table of block-type counts (`text` 1,616 / `thinking` 1,905 / `tool_use` 3,407 — all at investigation time), then per-shape block-internal-keys tables for `text`, `thinking`, `tool_use`
  - §3.1.3 `message.usage.*` (n=6,689 at investigation time — present on all non-synthetic/error assistant records; the 39-record gap vs 6,928 covers records with `message.model === "<synthetic>"` or `isApiErrorMessage === true` that carry no `usage` block — observation only, not an interpretation of why) with sub-tables:
    - §3.1.3a `cache_creation.*` (n=6,689 at investigation time — `ephemeral_5m_input_tokens`, `ephemeral_1h_input_tokens`)
    - §3.1.3b `iterations[0].*` (n=6,520 at investigation time — per-iteration token breakdown. Note on the gap vs n=6,689: the ~169-record difference corresponds to assistant records that carry a `usage` block but no `iterations` field. Observed, not causally attributed in this doc.)
    - §3.1.3c `server_tool_use.*` (n=6,543 at investigation time — `web_search_requests`, `web_fetch_requests`)
  - §3.1.4 `tool_use.input` keys per tool name — top 10 tools by occurrence, each with input-key union (e.g. Edit: `replace_all`, `file_path`, `old_string`, `new_string`)

- **§3.2 `user`** (n=4,327 at investigation time) — top-level; then:
  - §3.2.1 `message.*` (n=4,327)
  - §3.2.2 `content[]` block shapes — overview of counts (`text` 111 / `tool_result` 3,398, at investigation time), per-shape block-internal-keys table for `tool_result` (note: `content` field on `tool_result` blocks is `str` 3,214 times / `array` 184 times — show `str` as example, flag array variant)
  - §3.2.3 `origin.*` (n=287 — present only when `origin` field exists; `kind` observed)
  - §3.2.4 `toolUseResult.*` — top-level field observed on 3,094 user records. **Treated exactly like any other nested object** — enumerate its keys (union of observed keys), presence (n/3,094), and one anonymized example value per key. The §4 anonymization rules cover large string values (`<bytes, len=N>`); apply uniformly. The earlier "byte size is what matters, not full internal schema" framing is a derived interpretation not in scope for this evidence-only doc — drop it. If the values are consistently large, the examples column just shows `<bytes, len=N>` per the existing rule; the keys still get tabulated.

- **§3.3** `attachment` (n=1,434 at investigation time) + `attachment.*` sub-table (n=1,434 — many variant discriminator values observed; show union of all keys)
- **§3.4** `mode` (n=1,032 at investigation time)
- **§3.5** `last-prompt` (n=989 at investigation time)
- **§3.6** `file-history-snapshot` (n=988 at investigation time) + `snapshot.*` sub-table (n=988 — `messageId`, `timestamp`, `trackedFileBackups`)
- **§3.7** `ai-title` (n=929 at investigation time)
- **§3.8** `permission-mode` (n=811 at investigation time)
- **§3.9** `system/stop_hook_summary` (n=546 at investigation time) + `hookInfos[0].*` sub-table (n=546 — `command`, `durationMs`)
- **§3.10** `system/turn_duration` (n=492 at investigation time) — `durationMs`, `messageCount`
- **§3.11** `bridge-session` (n=484 at investigation time) — `bridgeSessionId`, `lastSequenceNum`
- **§3.12** `queue-operation` (n=252 at investigation time) — `operation`, `content`
- **§3.13** `agent-name` (n=123 at investigation time) — `agentName`
- **§3.14** `system/away_summary` (n=94 at investigation time) — `content`, `level`
- **§3.15** `system/local_command` (n=63 at investigation time) — `content`, `level`
- **§3.16** `pr-link` (n=20 at investigation time) — `prNumber`, `prRepository`, `prUrl`
- **§3.17** `worktree-state` (n=18 at investigation time) + `worktreeSession.*` sub-table (n=16 — `enteredExisting`, `originalCwd`, `sessionId`, `worktreeBranch`, `worktreeName`, `worktreePath`)
- **§3.18** `system/informational` (n=6 at investigation time) — `content`, `level`
- **§3.19** `custom-title` (n=4 at investigation time) — `customTitle`
- **§3.20** `system/api_error` (n=3 at investigation time) + `error.*` sub-table (n=3 — `connection`, `formatted`, `isNetworkDown`, `message`, `rateLimits`, `status`)
- **§3.21** `system/compact_boundary` (n=2 at investigation time) + nested:
  - §3.21.1 `compactMetadata.*` (n=2/2 — `trigger`, `preTokens`, `postTokens`, `cumulativeDroppedTokens` on 1/2, `durationMs` on 2/2, `preservedSegment` object on 2/2, `preservedMessages` object on 2/2 — fill counts from the executing survey)
  - §3.21.2 `compactMetadata.preservedSegment.*` (n=2/2 — all three keys `headUuid`, `anchorUuid`, `tailUuid` observed on both compact_boundary lines that carried `compactMetadata.preservedSegment`)
  - §3.21.3 `preservedMessages` shape (n=2/2 — keys observed: `anchorUuid`, `uuids[]`, `allUuids[]`; both as objects with the array-keyed sub-structure)

### §4 C corpus field table (`.cost.jsonl`)

Single combined table, columns: `field | type | presence (n/N) | example | notes`. `notes` column carries one of:

- `core (all lines)` — present on every line of every C file
- `turn-indexed only` — present only on turn-indexed lines
- `epoch-indexed only` — present only on epoch-indexed lines

**Fields expected (from prior survey):**
- Core (all 3,472): `session_id`, `timestamp`, `cost_delta_usd`, `cumulative_cost_usd`, `api_duration_ms`, `cache_read_tokens`, `cache_write_tokens`, `lines_added`, `lines_removed`, `context_pct`
- Turn-indexed only (1,883/3,472): `turn`
- Epoch-indexed only (1,589/3,472): `epoch`, `sample`

**Bottom note:** "Two line schemas observed (turn-indexed vs epoch-indexed); mutually exclusive within a single line. Both shapes co-occur in some files — 3 files exhibit a version-era switchover (Claude Code version upgrade during a long-running or resumed session)."

### §5 B corpus field table (`.turn-boundaries.jsonl`)

Same column convention. Single shape, no sub-sections.

**Fields expected (all 242 lines):** `session_id`, `transcript_path`, `turn_end`, `turn_end_epoch`.

### §6 L corpus field table (`cost-log.jsonl`)

Same column convention. Single shape, no sub-sections.

**Fields expected (all 48 lines):** `session_id`, `timestamp`, `cost_usd`, `dir`, `model`, `duration_ms`, `cache_read`, `cache_write`, `lines_added`, `lines_removed`, `context_pct`.

**Explicit preamble note:** "L lives at `~/.claude/` — the parent of the projects scan root — not under `~/.claude/projects/`. Discovery must search it explicitly, not rely on the projects glob."

### §7 Cross-tier field-name collision table

One row per concept named differently across tiers, columns: `concept | C field | L field | note`.

| Concept | C field | L field | Note |
|---|---|---|---|
| Cache reads | `cache_read_tokens` | `cache_read` | Same concept, different names |
| Cache writes | `cache_write_tokens` | `cache_write` | Same concept, different names |
| Cost (delta) | `cost_delta_usd` | (none — L only has cumulative) | L carries one row per session, no delta |
| Cost (cumulative) | `cumulative_cost_usd` | `cost_usd` | L's per-session total; C's running cumulative |
| API duration | `api_duration_ms` | `duration_ms` | L's is session-total wall; C's is per-sample |
| Working directory | (none — C has no dir) | `dir` | L carries the cwd equivalent; C relies on the session-id mapping back to T's `cwd` |
| Indexing | `epoch` + `sample` | (none — L is one row per session) | C uses both turn-indexed and epoch/sample schemes |
| Indexing | `turn` | (none) | C turn-indexed shape only |

**No interpretation, no remediation** — just observed differences. The downstream `#P2-1` will reconcile at code-time.

### §8 Out of scope (explicit list)

- Per-tool `tool_use.input` schemas beyond the top-10 (only the union of input keys is tabulated)
- `attachment.*` per-type discriminator breakdown (only the key union is tabulated, not a per-`type` breakdown)
- Any future JSONL fields not observed in the actual corpus surveyed
- Interpretation of any field's *meaning*
- Retain/drop decisions for `CompactCall` (that's `#P2-1`'s scope)
- Tier assignment (`🟢`/`🟡`/`🔴` classification is a derived concept — not in this doc)
- `CompactCall`, `Turn`, `Session`, `TierFlags` field-for-field contract design
- Measure formulas (cache hit %, wall minutes, etc.)
- API envelopes (`Series`, sessions list/detail, health)
- Behavior contracts (dedupe semantics, malformed-line handling, time bucketing, query-key serialization, rounding)
- Sign-off decisions (multi-model attribution, premium coverage granularity)
- Corrections to `architecture.md` / `pages.md`

---

## 7. Edits to `specs/claude-lens-plan.md` (deliverables 3 & 4)

### 7.1 Edit plan.md line 34–36

Replace the current text:

```
- [ ] **#P0-7 — Data model & contracts spec** *(added 2026-07-06; ordered here — before #P0-3 — because the field investigation and the fixture cut are the same pass over real data)*
  Investigate real `~/.claude/projects` JSONL (plus the three premium capture files) and write `specs/claude-lens-data-model.md` — the field-level contract the architecture doc names but never defines. Contents: (1) source inventory of observed raw record shapes with anonymized examples; (2) `CompactCall` field-for-field — type, source JSON path, nullability, tier; (3) `Turn`/`Session` derivation rules incl. edge cases (sidechains, mid-session model switch, compaction); (4) `TierFlags` + premium file schemas; (5) measure catalog with formulas and dimension catalog with source fields; (6) API envelopes (`Series`, sessions list/detail, health, `config.json`/`local.json`); (7) behavior contracts (dedupe, malformed/truncation handling, time bucketing & timezone, query-key serialization, rounding). Design only — no implementation; #P2-1 implements this doc verbatim and Phase 4 pages cite its catalogs.
  *Acceptance:* `specs/claude-lens-data-model.md` merged; every type named in architecture §3/§5/§8 is defined field-for-field with source provenance; each measure/dimension in pages.md's Data source legend (lines 19-20) has a formula or source field; every claim about raw data cites an observed example; #P2-1's acceptance re-pointed to this doc.
```

With:

```
- [ ] **#P0-7 — Data inventory (observed-field evidence)** *(added 2026-07-06, re-scoped 2026-07-09; ordered here — before #P0-3 — because the field investigation and the fixture cut are the same pass over real data)*
  Survey every observed field across T (`<uuid>.jsonl`), C (`<uuid>.cost.jsonl`), B (`<uuid>.turn-boundaries.jsonl`), and L (`cost-log.jsonl` at `~/.claude/`), and write `specs/claude-lens-data-model.md` as a pure observed-field inventory — every field with name, JSON type, presence count (n/N), and one inline anonymized example value. Covers all 21 observed transcript line-types including `system/*` subtypes (`turn_duration`, `stop_hook_summary`, `compact_boundary`, `away_summary`, `api_error`, `local_command`, `informational`), nested objects (`message.*`, `usage.*`, `cache_creation.*`, `iterations[0].*`, `hookInfos[0].*`, `compactMetadata.*`, etc.), content block shapes (text / thinking / tool_use / tool_result), and per-tool `tool_use.input` keys. Evidence only — no `CompactCall` contract, no derivation rules, no measures, no API envelopes, no behavior contracts, no sign-off gates. The originally-planned 7-point contract spec scope was hallucinated from the filed issue and has been dropped; the REQ + ARCH docs that scaffolded that scope have been deleted.
  *Acceptance:* `specs/claude-lens-data-model.md` covers every observed line type as a first-class field table with anonymized inline example values; C/B/L each have dedicated first-class tables; cross-tier field-name collisions (C vs L) are documented; downstream `#P2-1` cites this doc as the field source-of-truth.
```

### 7.2 Edit plan.md line 50

Replace:

```
**Exit criteria:** repo root empty of V1; data-model spec merged; fixtures merged; package name locked; license committed; issue tracking scaffolded.
```

With:

```
**Exit criteria:** repo root empty of V1; data-model inventory merged; fixtures merged; package name locked; license committed; issue tracking scaffolded.
```

---

## 8. Do-not-touch perimeter

- `architecture.md`, `pages.md`, `gates.md` — no changes
- All `specs/issues/*.md` drafts (they cite `data-model.md` by filename — unchanged)
- `~/.claude` — read-only
- Git — no commits unless explicitly asked
- The deleted REQ + ARCH docs are intentionally gone — do not recreate or audit-trail them
- **Note:** `specs/context/12.md` *is* in scope (deliverable 1 — see §13). The earlier "leave stale" framing has been dropped per user direction.
- **Note:** `scripts/survey-fields.py` *is* in scope as a new file (deliverable 3 — see §15). The earlier "throwaway, never committed" framing from the deleted ARCH's A4 has been overridden per user direction.

---

## 9. Verification (run after all six file operations)

```
git status
   # Expect exactly four changed/added files:
   #   specs/context/12.md (full rewrite, deliverable 1)
   #   scripts/survey-fields.py (new, deliverable 3)
   #   specs/claude-lens-data-model.md (body rewritten, deliverable 4)
   #   specs/claude-lens-plan.md (lines 34-36 + line 50 edited, deliverables 5 & 6)
   #
   # GitHub issue #12 change is remote-only (not visible in git status).

python3 scripts/survey-fields.py --help 2>&1 | head -5
   # Expect: usage banner showing the four passes. Confirms the script is callable.
   # Optional sanity: run it end-to-end and diff one §3 count against the doc; should match.

rg -n "REQ-data-model-contracts-spec|ARCH-data-model-contracts-spec" specs/ --glob "*.md"
   # Expect zero matches — confirms deletes are clean and no dangling refs after the rewrite.

rg -n "CompactCall|TierFlags|Series|Sign-Off|merged" specs/claude-lens-data-model.md
   # Expect zero matches — confirms the contract content was fully stripped.

rg -n "Data model & contracts spec" specs/claude-lens-plan.md
   # Expect zero matches — confirms the old task title is gone.

rg -n "Data inventory" specs/claude-lens-plan.md
   # Expect at least one match (line 34) — confirms the rename landed.

rg -n "data-model inventory merged" specs/claude-lens-plan.md
   # Expect one match (line 50) — confirms the exit-criteria edit landed.

rg -n "Data model & contracts spec" specs/context/12.md
   # Expect zero matches — confirms the old title in the context file is gone.

rg -n "Data inventory" specs/context/12.md
   # Expect at least one match — confirms the rewritten context file's new title landed.

rg -n "CompactCall|TierFlags|API envelopes|behavior contracts|sign-off" specs/context/12.md
   # Expect zero matches — confirms the rewritten context file dropped the 7-point contract scope.

gh issue view 12 --json title,body
   # Confirm title is "#P0-7 — Data inventory (observed-field evidence)" and body matches
   # specs/context/12.md (minus YAML front-matter). NOTE: this requires `gh` to be authed.
   # If the body returned by GitHub does NOT match the local context file after the edit
   # landed without error, STOP — see stop-and-ask gate §10.8.

rg -n "claude-lens-data-model" specs/ --glob "*.md" | rg -v "claude-lens-data-model.md:"
   # Expect: P2-1-shared-contracts.md, P2-8-*.md, P0-3-*.md, plan.md, context/12.md
   # Downstream filename citations must be unchanged.

rg -c "^### \[" specs/claude-lens-data-model.md
   # Expect 21 — confirms all line-type tables landed in §3.
```

---

## 10. Stop-and-ask gates

1. **Pre-flight §3** raises non-zero results → STOP. Some downstream file may need a re-pointing edit you did not scope.
2. **Verification** finds CompactCall/TierFlags/Series/Sign-Off/merged still in `data-model.md` → the write from §13.2 didn't replace the body cleanly (likely a mis-routed `edit` rather than a fresh `write`). Stop, re-read the actual current file, redo the `write` — do not patch in place.
3. **Verification** finds dangling REQ/ARCH references in other specs → STOP. Some downstream file needs a re-pointing edit.
4. **Phase 1 re-survey** finds a 22nd line type not enumerated in §6 → emit a new §3 sub-section, add a row to §2, do **not** interpret beyond name/type/presence/example.
5. **Status-language sweep:** if verification finds the strings `"Merged"` / `"sign-off received"` / `"REQ-data-model-contracts-spec"` / `"ARCH-data-model-contracts-spec"` anywhere in the new `data-model.md` body, the write didn't land fresh — redo from §13.2. The new body is authored from scratch per §6 front-matter and should contain none of the prior "merged-with-sign-off" framing.
6. **`gh issue edit 12` fails** (auth, network, permissions) → STOP and surface. Do not retry silently; the local `context/12.md` rewrite (deliverable 1) is still valid; the GitHub push is a separate concern.
7. **In-flight preview gate for GitHub issue body** (see §14) — write body file, show user the diff, wait for explicit OK, *then* `gh issue edit`. Do not push to GitHub without that OK.
8. **Post-edit GitHub body discrepancy:** if `gh issue view 12 --json body` returns a body that does not match `specs/context/12.md` (minus YAML) after `gh issue edit` reported success → STOP. Re-investigate the `gh issue edit` invocation (flag mismatch, encoding, body-file truncation). Do not silently leave the issue desynced from the local context file.
9. **Failed anonymization in unexpected form:** if a field's example value contains a non-anonymized project-name path (e.g. `/Users/<redacted>/personal/agentic-swe-vod` — the embedded `agentic-swe-vod` is itself identifying for a future public-npm-publish trajectory), or any other surprise that the §4 rules don't cover, STOP and surface. Do not auto-extend the anonymization rules — that's a §4 amendment you did not scope. Ask the user how to treat it.

---

## 11. Loose end flagged, not actioned

None now — deliverables 1 through 6 close every loose end surfaced during planning, including the `context/12.md` rewrite (deliverable 1, now lands first), the GitHub issue body update (deliverable 2 — preview-gated), the committed survey script (deliverable 3, addresses the "re-run §5 to refresh" implication in §6 front-matter that previously had no script home), and the `plan.md` edits landing last so they reflect a fully-formed artifact set.

---

## 13. Deliverable 1 — rewrite `specs/context/12.md`

Full rewrite of the YAML front-matter + body so the local context file matches the evidence-only scope. This is deliverable 1 per §2 (reordered — issue-trail alignment first).

### 13.1 New YAML front-matter

```yaml
---
name: 12
description: "#P0-7 — Data inventory (observed-field evidence)"
type: task
source: github
---
```

### 13.2 New body

```markdown
# Task 12: #P0-7 — Data inventory (observed-field evidence)

- **Type:** feat
- **Source:** GitHub issue #12
- **State:** OPEN
- **Labels:** phase-0
- **Created:** 2026-07-08
- **Re-scoped:** 2026-07-09 (see Notes)

## Summary

Survey every observed field across T (`<uuid>.jsonl`), C (`<uuid>.cost.jsonl`), B (`<uuid>.turn-boundaries.jsonl`), and L (`cost-log.jsonl` at `~/.claude/`), and write `specs/claude-lens-data-model.md` as a pure observed-field inventory — every field with name, JSON type, presence count (n/N), and one inline anonymized example value. Evidence only — no `CompactCall` contract, no derivation rules, no measures, no API envelopes, no behavior contracts, no sign-off gates.

## Scope

- **Source inventory** — every observed field across all four file types (T/C/B/L), each with name, JSON type, presence (n/N), and one inline anonymized example value. Covers all 21 observed transcript line types (including `system/*` subtypes: `turn_duration`, `stop_hook_summary`, `compact_boundary`, `away_summary`, `api_error`, `local_command`, `informational`). Nested objects (`message.*`, `usage.*`, `cache_creation.*`, `iterations[0].*`, `hookInfos[0].*`, `compactMetadata.*`, etc.) recursed one level. Content block shapes (`text` / `thinking` / `tool_use` / `tool_result`) documented per shape with their block-internal keys.
- **First-class sections for C/B/L** — each premium file type gets its own dedicated field table. C carries two mutually-exclusive indexing shapes (turn-indexed / epoch-indexed) documented in one combined table.
- **Cross-tier field-name collision table** — concepts named differently across tiers (e.g. C's `cache_read_tokens` vs L's `cache_read`) are documented, not reconciled.
- **Out-of-scope explicit list** — names what the doc deliberately does *not* cover (CompactCall retain/drop, derivation rules, measures, API envelopes, behavior contracts, sign-off decisions, tier assignments).

## Acceptance criteria

- `specs/claude-lens-data-model.md` covers every observed line type as a first-class field table with inline anonymized example values
- C/B/L each have dedicated first-class tables
- Cross-tier field-name collisions (C vs L) are documented
- Downstream `#P2-1` cites this doc as the field source-of-truth

## Dependencies

- Depends on: none — spec-only; can run in parallel with #P0-2
- Unblocks: #P0-3 (the field investigation decides which fields fixtures must exercise); #P2-1 cites this doc as field source-of-truth (no longer a verbatim contract transcription — `#P2-1`'s own scope is responsible for any derived types)

## References

- [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 0 #P0-7 entry (re-scoped to evidence-only)
- [plan-data-inventory.md](../blob/main/specs/context/plan-data-inventory.md) — the governing plan for this task

## Notes

The originally-planned 7-point contract scope (CompactCall / Turn/Session derivation rules / TierFlags / measure formulas / API envelopes / behavior contracts / sign-off decisions) was hallucinated from the filed GitHub issue's scope text; the user's actual intent is an evidence catalog only. The REQ + ARCH docs that scaffolded the contract version (`specs/requirements/REQ-data-model-contracts-spec.md`, `specs/architecture/ARCH-data-model-contracts-spec.md`) have been deleted by the user. The prior 404-line "merged contract spec" version of `claude-lens-data-model.md` has been superseded — see `specs/context/plan-data-inventory.md` for the governing plan and methodology.
```

### 13.3 Edits

- Replace the entire contents of `specs/context/12.md` with the new YAML front-matter + body above.
- One `write` call, after the required `read` of the existing file.

---

## 14. Deliverable 2 — edit GitHub issue #12

### 14.1 Title change

New title: `#P0-7 — Data inventory (observed-field evidence)`

### 14.2 Body change

Body = the content of `specs/context/12.md` minus the YAML front-matter and with markdown link paths adjusted to GitHub-resolvable ones (i.e. `../blob/main/specs/...` is already correct since the GitHub issue body renders relative to repo root — same convention the current `context/12.md` uses).

### 14.3 Procedure (with in-flight preview gate)

**Step 1 — author body file to a temp location for review:**

```
# Extract body (no YAML) into a temp file the user can preview
python3 - <<'PY'
import re, pathlib
src = pathlib.Path('specs/context/12.md').read_text()
# strip leading YAML front-matter
body = re.sub(r'^---\n.*?\n---\n', '', src, count=1, flags=re.DOTALL)
out = pathlib.Path('/tmp/issue-12-body.md')
out.write_text(body)
print(f'wrote {out} ({len(body)} chars)')
PY
```

**Step 2 — show the user the diff** between the current GitHub issue body and the new body file, and wait for explicit OK. Do **not** push without that OK (per stop-and-ask gate §10.7).

To fetch the current body for diff:

```
gh issue view 12 --json body --jq .body > /tmp/issue-12-current-body.md
diff /tmp/issue-12-current-body.md /tmp/issue-12-body.md | head -200
```

**Step 3 — on explicit user OK, push:**

```
gh issue edit 12 \
  --title "#P0-7 — Data inventory (observed-field evidence)" \
  --body-file /tmp/issue-12-body.md
```

### 14.4 Notes

- The `phase-0` label and the issue's milestone are unchanged — still a Phase 0 task.
- Do not close the issue. It remains OPEN; the data-inventory work is the deliverable that closes it, but closing is a separate user action.
- If `gh` is not authed or the network is unavailable, surface immediately. Do not silently skip; the local `context/12.md` rewrite (deliverable 1) is still valid, and the GitHub push can be retried later.

---

## 15. Deliverable 3 — `scripts/survey-fields.py` (committed)

The Phase-1 survey script is a first-class committed artifact, not throwaway per-session tooling. This addresses the prior plan's "re-run §5 to refresh" implication by giving §5 a concrete, executable specification future revisions can call.

### 15.1 Interface

```
python3 scripts/survey-fields.py [--pretty] [--out <path>]
   # Default: emit structured JSON to stdout
   # --pretty: indented JSON for human review
   # --out <path>: write to a file (caller's choice of /tmp/...)
```

### 15.2 Required behavior

- Self-contained stdlib only (no third-party deps; runs on Python ≥ 3.8).
- Hard-codes the four pass configurations (A/B/C/D per §5.1) — no CLI flags needed for the file-set or filter; the script knows them.
- For each pass, walks every file in the glob set, parses each JSON line, and emits one record per (scope, field) pair: `{"scope": "<line-type-key or nested path>", "field": "<name>", "type": "<python type name>", "present": <int>, "total": <int>, "example": "<anonymized value>"}`.
- Applies the §4 anonymization rules *inside the script* before emitting — example values in the JSON are already redacted, so downstream Phase-2 formatting doesn't have to re-anonymize.
- **Recurses to the depths named in §6 §3.1–§3.21 (up to two levels from the line-type root).** Sub-tables enumerated: `message`, `usage`, `cache_creation`, `iterations[0]`, `server_tool_use`, `attachment`, `snapshot`, `hookInfos[0]`, `worktreeSession`, `error`, `compactMetadata`, `compactMetadata.preservedSegment` (two levels deep), and `preservedMessages` (one level under `compactMetadata`, two from the line-type root). The script's recursion depth budget is two; deeper structures named in §6 are not surveyed.
- For `iterations[0].*`: **only the first iteration's keys are inventoried**. The `[0]` subscript is doing real work, not the "every record has ≥1 element" convention used elsewhere — the `iterations` array can carry N elements and only the first is surveyed. The `present` count reflects records where `iterations[0]` exists and is an object.
- Inventories `content[]` blocks grouped by `block['type']`, recursing into each block's keys.
- Inventories `tool_use.input` keys grouped by `block['name']`, emitting one record-set per tool (top 10 by occurrence).
- **Malformed lines are skipped, not counted in scope totals.** A separate `meta.malformed_count` per pass tracks them for later Data Health use — the count is not "always 0 by definition"; it reflects garbage lines actually encountered during walking.
- Exit code 0 on success, non-zero on filesystem error or unrecoverable parse failure on a *non-line* boundary (parse failures *on lines* are normal — increment the `meta.malformed_count` and continue).
- **Phase 2 consumption is a manual walk by the executing agent** (no second formatter script — keep the toolchain lean). The agent reads `/tmp/survey.json` (or wherever the script was redirected), walks the records in the doc order specified by §6, and formats them into markdown tables in a single `write` call to `specs/claude-lens-data-model.md`. The "do not hand-edit counts" rule in §15.3 is a *soft* guideline — if counts drift in a future revision, re-run the script and re-emit; there is no structural enforcement against hand-edits on the markdown body.

### 15.3 Authoring constraints

- Author it as **deliverable 3**, after the issue-trail alignment (deliverables 1–2) is complete. The data-model doc (deliverable 4) is produced by running it and formatting the output.
- No shebang-mode lock-in (`python3` is fine); no executable bit required.
- No comments inside the script body except a module-level docstring explaining the four passes. The script is short (~150 lines), self-documenting by structure.
- The script is the source of truth for §6 counts. Do not hand-edit counts in `data-model.md` after Phase 2 formats them — re-run the script and re-emit.

### 15.4 Why commit it (decision rationale)

- **Re-runs without re-authoring.** A future agent re-surveying after a Claude Code version upgrade runs `python3 scripts/survey-fields.py`, gets fresh numbers, and Phase-2-formats them. No risk of two slightly different survey scripts drifting across sessions.
- **Auditability.** Anyone reading `data-model.md` can inspect the script and verify the survey was exhaustive, not selective.
- **Matches the §6 front-matter implication.** The "re-run `scripts/survey-fields.py` to refresh" wording in §6 only stands if the script exists.
- **Tradeoff accepted:** this reintroduces a small piece of committed investigation tooling that the deleted ARCH's A4 explicitly excluded. The user's preference (see plan-mode question) overrides A4 — the convenience of a durable refresh path outweighs the small risk of throwaway-script accumulation.

---

## 16. Hand-off note for any executing agent

- The Phase 1 survey script lives at `scripts/survey-fields.py` (deliverable 3, §15). Author it after the issue-trail alignment (deliverables 1–2); everything content-downstream reads from it.
- The Phase 1 survey methodology (§5.1) is fully reproducible from this plan alone and from the script in §15. No need to consult prior conversation history.
- The Phase 2 formatting (§5.2) walks survey output in the doc order of §6.
- All file counts and example expectations in §6 are snapshots from a survey taken 2026-07-09; the executing agent treats them as placeholders and refreshes by running `scripts/survey-fields.py`.
- The anonymization rules (§4) are applied inside the script at extraction time, before any value reaches the doc.
- **Execution order:**
  1. Pre-flight (§3)
  2. Rewrite `context/12.md` (§13) — **deliverable 1**
  3. Preview GitHub issue body → wait for user OK → `gh issue edit 12` (§14) — **deliverable 2**
  4. Author `scripts/survey-fields.py` (§15) — **deliverable 3**
  5. Run script → format output into `data-model.md` (§5 Phase 2, §6 structure) — **deliverable 4**
  6. Edit `plan.md` twice (§7) — **deliverables 5 & 6**
  7. Verification (§9)
- If anything unexpected appears in pre-flight or verification, STOP — do not improvise scope expansions without user direction.
- The in-flight preview gate for the GitHub issue body (§14 step 2) is mandatory — do not skip it. Surface the diff, wait for OK, then push.
- Section ordering in this plan is deliberately: §1–§10 (methodology + verification + gates), §11 (loose end), §13–§15 (deliverable detail), §16 (hand-off). Numerical order matches reading order.