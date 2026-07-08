# Architecture: Data Model & Contracts Spec

> **Date:** 2026-07-08
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** specs/requirements/REQ-data-model-contracts-spec.md
> **Type:** infrastructure (documentation deliverable — no code)

## Architecture Summary

This task produces one artifact, `specs/claude-lens-data-model.md` — no code, no running system. The "architecture" is therefore the shape of the investigation and the shape of the deliverable (an 11-section doc mirroring REQ's R1–R13 one-to-one, with uniform field-table conventions so `#P2-1` can transcribe it verbatim). Investigation is **page-ordered**: walk `pages.md`'s 11 per-page row tables in sequence, resolving each row's coarse deps mark (`T+P`, `C adds...`) down to real fields verified against local data, and write directly into the shared model — a field defined while studying one page is reused, never redefined, when a later page needs it (REQ Decision 11). This builds the doc as a single continuous artifact rather than 11 independent ones merged afterward, which both matches the actual downstream use (an implementer reading page by page) and avoids the duplicate-definition risk a per-page task split would carry. Two sections (source-of-truth sign-off decisions, and any real-data-driven correction back into `architecture.md`/`pages.md`) are structurally set apart because they gate the doc's own "merged" status on the developer's explicit approval, not just internal consistency. The filed GitHub issue #12's acceptance criteria conflict with the REQ on one point (embedded examples) — the REQ governs, and the issue text is a tracked follow-up, not part of this footprint.

## High-Level Structure

```
pages.md §1 Dashboard → §2 Sessions → ... → §11 Explore   (investigation order)
                    │  each row's coarse dep mark (T+P, C adds...)
                    ▼  resolved against real data, first-definition-wins
~/.claude/projects/** (T/C/B/L) ──┐
~/.claude/cost-log.jsonl ─────────┤→ resolved fields → specs/claude-lens-data-model.md (single growing document)
architecture.md/pages.md ─────────┘   (cross-checked against current claims)
                                          │
                                          ├─ §8 sign-off decisions (R8/R9) → blocks "merged" on developer approval
                                          ├─ §10 message.id collision (R11) → same sign-off gate, only if found
                                          └─ conflicts found → §11 correction note back into architecture.md/pages.md
```

Nothing is added to `src/`, `shared/`, `server/`, or `client/` — those roots don't exist yet (Phase 1 scaffolds them) and this task is explicitly spec-only.

## Tech Choices

| Area                  | Decision                                                              | Alternatives Considered                                  | Rationale                                                                                     |
|------------------------|------------------------------------------------------------------------|------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| Investigation tooling  | Ad hoc `find`/`jq`/shell during the session; not committed to the repo | Committing a reusable investigation script under `scripts/` | Direct data access is a *standing* capability (REQ Decision 1) — any future agent can re-derive the same commands; committing throwaway tooling would be scaffolding outside a plan task, which CLAUDE.md flags as off-limits during this transitional repo state |
| Field-path extraction  | Structural union-of-paths across the full C/B/L corpus (93/33/1 files), sampled + targeted reads across T corpus | Eyeballing a handful of files per tier                    | Small premium-tier counts make exhaustive inspection cheap; T corpus is large, so sampling is broad plus specifically targeted at known hazards (sidechain, model-switch, compaction, malformed lines) |

No framework, storage, or service-communication choices apply — there is no running system.

## Patterns & Conventions

- **Uniform field-table schema** — every typed entity (`CompactCall`, `Turn`/`Session` notes, `TierFlags`, C/B/L schemas) uses the same columns: field name · type · source JSON path · nullability · tier (🟢/🟡) · notes. Applied throughout §2–§4 so `#P2-1` transcribes mechanically.
- **No embedded JSONL, real or synthetic** (REQ N1 / Decision 6) — field tables and prose are the entire deliverable. Followed throughout; see Cross-Cutting Concerns → Security for the second rationale.
- **Standalone, uniform-rigor prose rules** (REQ Decision 9) — every derivation rule in §3 is held to the same precision bar; none gets extra illustration because it "seems" riskier.
- **Cite, don't restate** — §5's gate-pass-rate formula cites `gates.md` (REQ Decision 10); §3/§4 cite §8's sign-off defaults rather than repeating them.
- **Page-ordered investigation, first-definition-wins** (REQ Decision 11) — fields are investigated in the order `pages.md`'s 11 pages present them, but written once into the shared model; a later page citing an already-defined field reuses it rather than redefining it. Applied throughout §2–§6.

## Data Models

Not applicable in the conventional sense — this task doesn't build entities, it documents them. What *is* architecturally fixed is the row schema every entity table in the target doc must follow, so the output is uniform and machine-transcribable.

### Field-table row (applies to `CompactCall`, `TierFlags`, and the C/B/L premium schemas)

**Purpose:** one consistent representation for every typed entity the doc defines.

**Key fields:**
| Field              | Type / Constraint         | Notes                                                        |
|---------------------|----------------------------|-----------------------------------------------------------------|
| Field name           | string                     | as it appears in source JSON                                   |
| Type                 | string (TS-transcribable) | e.g. `string \| null`, `number`                                |
| Source JSON path     | string                     | dotted/bracket path into the raw record                        |
| Nullability          | enum: required / optional / claimed-not-observed | reflects *actual* observed data, not majority-rounding — if a field is absent in any real file, it's marked optional/nullable with the observed ratio noted (e.g. "present in 80/93"); see Decisions Log A10, A13 |
| Tier                 | 🟢 exact / 🟡 estimated    | per architecture.md §4's tier system                            |
| Notes                | free text                 | deliberate exclusions (e.g. tool_result bodies → byte sizes only) |

**Relationships:** §5 (measures) and §6 (API envelopes) cite these tables by field name rather than restating shapes.

**Lifecycle:** static document content; amendments are appended with a dated change note, not silently overwritten (Decisions Log A14).

## API Contracts / Interfaces

Not applicable — this task produces documentation, not a running interface. The API envelope *shapes* (`Series`, sessions list/detail, health, `config.json`/`local.json`) are catalogued as §6 content in the target doc, using the field-table schema above. They are not interfaces this architecture task itself exposes.

## Module Boundaries

Reinterpreted as **section-ownership rules** within the target doc, since there are no code modules:

| Section                          | Owns                                    | May cite (never restate)                          |
|-----------------------------------|-------------------------------------------|------------------------------------------------------|
| §1 Source inventory                | observed raw record shapes, T/C/B/L      | —                                                     |
| §2 `CompactCall`                   | field-for-field definition               | §1                                                    |
| §3 `Turn`/`Session` derivation      | grouping/rollup rules                    | §2, §8 (attribution defaults)                         |
| §4 `TierFlags` + C/B/L schemas      | premium file schemas                     | §1                                                    |
| §5 Measures & dimensions           | formulas, source fields                  | §2–§4, `gates.md` (gate pass rate — never redefined)  |
| §6 API envelopes                   | `Series`, sessions, health, config shapes | §2–§5                                                 |
| §7 Behavior contracts              | dedupe, malformed/0-byte/garbage handling, timezone, query-key serialization, rounding | —                            |
| §8 Sign-off decisions              | R8/R9 defaults                           | authoritative — §3/§4 cite it, never restate          |
| §9 Prompt-text size finding         | R10 distribution + cap decision           | —                                                     |
| §10 `message.id` collision finding  | R11 finding                              | blocks "merged" if a collision is found, same gate as §8 |
| §11 Corrections                    | diffs to `architecture.md`/`pages.md`     | —                                                     |

## Change Footprint

_Doc-only — this is the primary reason Phase D2 is intentionally thin for this task._

### New files / modules

| Path                                    | Purpose                                              | Pattern reference                          |
|-------------------------------------------|---------------------------------------------------------|------------------------------------------------|
| `specs/claude-lens-data-model.md`         | The field-level contract itself — this task's entire deliverable | Section outline fixed above; no existing file to mirror |

### Modified files / modules

| Path                              | What changes here                                                              |
|-------------------------------------|------------------------------------------------------------------------------------|
| `specs/claude-lens-architecture.md` | Conditional — only if investigation finds real data contradicts current text (REQ Decision 3); recorded as a correction note in §11 |
| `specs/claude-lens-pages.md`        | Same as above, conditional                                                        |

### Deleted / replaced

None.

### Touched but not changed (silent-regression hotspots)

| Path                                            | Why it matters                                                                                     |
|----------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| `specs/issues/P2-1-shared-contracts.md`             | Cites `architecture.md` §3/§5/§8 by section; mitigated by A15 — §11 correction notes now cross-reference citing issues explicitly |
| `specs/issues/P2-3-discovery-polling.md`            | Cites `architecture.md` §4 by section — same mitigation (A15)                                             |
| `specs/issues/P4-13-premium-tier-cbl-parsers-upgrades.md` | Cites `architecture.md` §4 by section — same mitigation (A15)                                      |
| `specs/issues/P0-3-anonymized-jsonl-fixtures.md`    | Blocked on this doc for which fields/edge cases fixtures must exercise (sequencing dependency, not a citation risk) |

## Areas of Impact

| Area                                  | Impact                                                         | Risk (L/M/H) | Why                                                                                   |
|------------------------------------------|---------------------------------------------------------------------|----------------|-------------------------------------------------------------------------------------------|
| `#P2-1` (shared contracts)                | Transcribes this doc's field tables verbatim into TS types            | H              | Any field/derivation error here propagates directly into typed contracts — the exact "cascades through the whole system" risk the REQ names |
| Phase 4 pages (11 pages)                  | Cite the doc's measure/dimension catalog for chart formulas            | M              | Errors surface as wrong numbers on real pages, not build failures — silent, per REQ's stated risk framing |
| `architecture.md` / `pages.md`            | Possible correction notes if reality conflicts with current text       | L              | Already-filed issues cite these docs by section number; mitigated by A15 (correction notes now cross-reference citing issues) |
| `#P0-3` (fixture author)                  | Blocked on this doc for which fields/edge cases fixtures must exercise | L              | Sequencing dependency only, not a design risk                                             |
| Filed GitHub issue #12                    | Acceptance criteria currently stale vs. REQ (wants embedded examples)  | L              | Process/cosmetic risk, tracked separately in memory — doesn't affect doc content correctness |

**Contract changes:** None in the software sense (no running system yet). The doc's field tables *are* the contract `#P2-1` depends on as ground truth going forward.

**Cross-cutting ripples:** None — no auth, telemetry, migrations, feature flags, or build pipeline are touched by this task.

## Cross-Cutting Concerns

- **Errors:** ambiguity in observed data (inconsistent shapes, fields claimed by `architecture.md` but not locally observed) is documented explicitly via the three-state nullability enum (required / optional / claimed-not-observed), never resolved by silent omission or majority-rounding — Decisions Log A10, A13.
- **Logging & metrics:** n/a — no running system.
- **Auth / authz:** n/a.
- **Performance:** n/a for the doc itself; investigation is a single pass over a bounded corpus (93 C, 33 B, 1 L, sampled T), no repeated re-parsing needed.
- **Security:** N1's "no embedded JSONL" rule does double duty — beyond "no reader needs proof of verification" (REQ Decision 6), raw prompt text can contain credentials, proprietary code, or PII, and this repo is destined for a public npm publish (`#P5-4`). The doc structurally cannot leak that, since R10 requires aggregate stats only, never example content.
- **Migrations / rollout:** the doc's "merged" status is gated on developer sign-off for §8 (R8/R9) and, conditionally, §10 (R11, if a `message.id` collision is found — Decisions Log A12). Post-merge amendments are append-with-dated-note, not silent overwrite (Decisions Log A14).

## Architecture Decisions Log

| #   | Decision                                                                                                    | Alternatives                                                          | Chosen Because                                                                                          | Satisfies REQs        |
|-----|----------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------|------------------------|
| A1  | This architecture designs the investigation methodology and doc structure only — no code, no parser/store/API implementation | Treating this as a conventional software architecture with modules/services | The deliverable is `specs/claude-lens-data-model.md`; REQ's Out of Scope explicitly excludes implementation code | REQ scope framing      |
| A2  | `REQ-data-model-contracts-spec.md` is authoritative over filed issue #12's stale "with anonymized examples" criteria; issue text gets a tracked follow-up edit, not addressed by this footprint | Treating the filed issue's text as still-binding             | REQ is the later, more deliberate artifact; developer confirmed explicitly                                | N1, Decision 6          |
| A3  | Doc outline mirrors REQ R1–R13 sections 1:1                                                                    | A narrative structure not keyed to requirement IDs                       | Free traceability — every doc section maps to exactly one acceptance criterion                            | R1–R13                 |
| A4  | Investigation tooling (`find`/`jq`/shell) is ad hoc per-session, never committed to the repo                    | Committing a reusable investigation script                               | Direct data access is a standing capability (Decision 1); committing tooling would be out-of-plan scaffolding | Decision 1              |
| A5  | Uniform field-table columns (name, type, source path, nullability, tier, notes) across all typed entities        | Freeform prose per entity                                                | `#P2-1` needs mechanical transcription, zero ambiguity                                                    | R2, R4                 |
| A6  | Derivation rules are standalone, numbered, uniform-rigor prose — no illustrative examples                        | Extra rigor only on the "riskiest-seeming" rule                          | No single highest-risk area was identifiable in advance (REQ Decision 9); N1 forbids examples anyway       | R3, N1                  |
| A7  | §8 (sign-off decisions) is authoritative; §3/§4 cite it rather than restating defaults                           | Repeating the attribution/coverage default inline wherever it's used     | Prevents the two docs-within-a-doc from silently disagreeing after an amendment                            | R8, R9                  |
| A8  | §5 measure catalog cites `gates.md` for gate pass rate rather than re-deriving it                                | Independently defining the formula                                       | `gates.md` is already the authority; redefining risks drift (REQ Decision 10)                              | R5                      |
| A9  | N1's "no embedded JSONL" rule is justified on two grounds: no reader needs proof of verification, and prompt text may carry PII/secrets into a soon-to-be-public repo | Justifying N1 on verification grounds alone                | Both rationales independently support the same rule; worth stating explicitly given the npm-publish trajectory | N1                      |
| A10 | Field-table nullability reflects actual observed data, not majority-rounding — if a field is absent in any real file, it's marked optional/nullable with the observed ratio noted (e.g. "present in 80/93") | Rounding a majority-present field up to "required"           | Prevents a false nullability guarantee that would break `#P2-1`'s TypeScript types the first time real data hits the gap | R2, R4                 |
| A11 | Investigation explicitly searches for sessions exhibiting *combined* derivation hazards (e.g. sidechain + mid-session model switch in the same session) before finalizing §3, not just one isolated example per hazard | Verifying each hazard type only in isolation                 | Rules individually correct for isolated hazards can still be ambiguous or wrong under overlap, discovered too late if only checked separately | R3                      |
| A12 | If a `message.id` collision is found across session files (R11), §10 documents the finding and blocks "merged" status on developer sign-off — the same mechanism as §8 — rather than guessing at a fix inline | Silently picking a mitigating dedupe-scope change without sign-off | An unverified collision fix could itself be wrong; R11 already treats this as a real correctness risk, not a formality | R11                     |
| A13 | Fields `architecture.md` claims exist but that are never observed in local data get a third nullability state — "claimed by architecture.md, not observed locally" — flagged rather than resolved either way | Silently omitting the field, or silently asserting it unverified | Omission understates the schema for `#P2-1`; unverified assertion violates the doc's "verified against real data" premise | R2, R4, Decision 3      |
| A14 | Post-merge doc corrections are appended with a dated change note, not overwritten in place | Editing field tables in place with no change history         | Preserves the doc's "ground truth" claim — a silent overwrite would undermine trust for anyone who already transcribed from it | doc integrity (no single REQ ID) |
| A15 | §11's correction-note mechanic explicitly lists which filed issues cite the `architecture.md`/`pages.md` section being corrected, so citation drift is visible instead of silent | Correction note describes only the diff, with no cross-reference to dependent issues | `#P2-1`/`#P2-3`/`#P4-13` already cite specific sections; an invisible renumbering would silently break their citations | R13                     |
| A16 | Investigation is ordered page-by-page against `pages.md` (Dashboard → ... → Explore), resolving each page's coarse dep marks into real fields verified against local data, written once into the shared model with first-definition-wins reuse | (a) tier-first investigation with no page-ordering; (b) one independent task per page with a final merge/de-dup pass | (a) doesn't force every page's actual field needs to be checked against the model; (b) risks divergent per-page definitions reconciled only at the end, and a page task can't have a real done-signal independent of the other 10. This gets (b)'s coverage guarantee without its duplication risk, and keeps (a)'s single ground-truth definition | REQ Decision 11         |
| A17 | Task split is by **phase** (model-building vs. cross-cutting hardening), not by page — two tasks total, not eleven-plus-consolidation | Eleven page tasks + one consolidation/refactor task | Each page task's "done" status would depend on what the other 10 define, so it isn't independently verifiable — the phase split gives each task a real, self-contained done-signal instead | REQ Decision 11         |

## Risk & Stress-Test Scenarios

### Forward — investigation-time failure scenarios

| Scenario                                                                                     | How the Design Handles It                     |
|--------------------------------------------------------------------------------------------------|----------------------------------------------------|
| A field appears in most but not all files of a tier (e.g. 80/93 C files)                          | Marked optional/nullable with observed ratio noted — never rounded up to required (A10) |
| Multiple derivation hazards co-occur in one real session (e.g. sidechain + mid-session model switch) | Investigation specifically searches for combined-hazard sessions before finalizing §3 (A11) |
| `message.id` collision is actually found across session files (R11)                                | §10 documents the finding; "merged" status blocks on developer sign-off, same gate as §8 (A12) |
| A field `architecture.md` claims exists is never observed in local data                           | Flagged as a distinct "claimed, not observed" nullability state, never silently omitted or asserted (A13) |
| The doc is found wrong after merge (by `#P2-1` or a Phase 4 implementer)                          | Corrections appended with a dated change note, never overwritten in place (A14) |

### Backward — regression risk per touched area

| Touched area (from Change Footprint)                                     | What could regress                                                        | How we'd know / mitigation      |
|------------------------------------------------------------------------------|---------------------------------------------------------------------------------|-------------------------------------|
| Filed issues citing `architecture.md`/`pages.md` by section (`#P2-1`, `#P2-3`, `#P4-13`) | A §11 correction shifts section content/numbering; the issue's citation goes silently stale | §11 correction notes explicitly list which filed issues cite the corrected section (A15) |

## Open Questions

All six items raised in the Phase F stress-test pass are resolved — the developer confirmed the suggested defaults (with the nullability question stated explicitly as "use nullable assertions on the fields," which matches A10/A13's design). See Architecture Decisions Log **A10–A15** for the resolved decisions and their rationale:

| Former open question | Resolved as |
|---|---|
| Inconsistent field shape across the sample | A10 — nullable assertion + observed ratio, never rounded up |
| Co-occurring derivation hazards | A11 — investigation searches for combined-hazard sessions |
| `message.id` collision found, doc state pending sign-off | A12 — §10 documents finding, blocks "merged" on sign-off |
| Field claimed by `architecture.md`, not locally observable | A13 — third nullability state: "claimed, not observed" |
| Amendment path post-merge | A14 — append-with-dated-note, never silent overwrite |
| Correction-note mechanic vs. stale issue citations | A15 — correction notes cross-reference citing issues |

No open questions remain.

## Out of Scope

- Implementation code for the parser, store, or API (reason: that's `#P2-1` onward — this task is design/investigation only, per REQ)
- Redefining the gate pass-rate formula independently of `gates.md` (reason: `gates.md` is already the authority)
- Fixture creation (reason: `#P0-3`, blocked on this doc, handles fixtures separately)
- Data Health page's reconciliation/capture-gap UI (reason: `#P4-14`, a later implementation task)
- Redesigning the tailer/ingest algorithm itself (reason: already settled in `architecture.md` §5; this doc documents resulting shapes, not pipeline mechanics)
- Editing filed GitHub issue #12's acceptance criteria to match the REQ (reason: tracked separately in project memory — real but not part of this architecture's footprint)

---

# Tasks

## Task T1: Model drafting via page-ordered investigation

> **Status:** not started
> **Verification:** checklist
> **Effort:** l
> **Priority:** critical
> **Depends on:** None
> **Satisfies REQs:** R1, R2, R3, R4, R5, R6
> **Footprint slice:** New: `specs/claude-lens-data-model.md` (§1 Source inventory, §2 `CompactCall`, §3 `Turn`/`Session` derivation, §4 `TierFlags`+C/B/L schemas, §5 Measure & dimension catalog, §6 API envelopes)
> **High-risk areas touched:** `#P2-1` (H) — transcribes this doc's field tables verbatim into TypeScript; errors here propagate directly into typed contracts

### Description

Investigate real `~/.claude/projects` T/C/B/L data and draft §1–§6 of `specs/claude-lens-data-model.md`. Investigation is ordered by walking `pages.md`'s 11 pages in sequence (Dashboard → Sessions → Session Detail → Turn Inspector → Projects → Models → Cache Lab → Trends/Calendar/Budget → Data Health → Settings → Explore); each page's coarse dep marks (`T+P`, `C adds...`) get resolved into real fields verified against local data and written once into the shared model. A field defined while studying one page is reused, never redefined, when a later page needs it (REQ Decision 11 / ARCH A16).

### Verification Checklist

- **Raw source inventory complete** — §1 enumerates field name/nesting path/type for T/C/B/L based on direct inspection of real files; zero embedded JSON anywhere in §1 (`grep -c '\`\`\`json' specs/claude-lens-data-model.md` → 0). Expected: present and clean. _(verifies R1, N1)_
- **Derivation rules cover combined hazards** — §3's `Turn`/`Session` rules are standalone numbered prose covering sidechain, mid-session model-switch, and compaction *individually and in combination* (a session exhibiting more than one hazard is specifically checked, not just one isolated example per hazard). Expected: rules hold up against a real combined-hazard session. _(verifies R3, guards ARCH forward-stress scenario 2 / A11)_
- **Dashboard (`pages.md` §1) rows fully resolved** — every row in the Dashboard table resolves to a defined field in §2/§4/§5 (name, type, source path, nullability, tier), not left at a coarse `T+P`/`C` mark. _(verifies R2, R4, R5)_
- **Sessions (§2) rows fully resolved** — same standard as above. _(verifies R2, R4, R5)_
- **Session Detail (§3) rows fully resolved** — same standard. _(verifies R2, R4, R5)_
- **Turn Inspector (§4) rows fully resolved** — same standard. _(verifies R2, R4, R5)_
- **Projects (§5) rows fully resolved** — same standard. _(verifies R2, R4, R5)_
- **Models (§6) rows fully resolved** — same standard. _(verifies R2, R4, R5)_
- **Cache Lab (§7) rows fully resolved** — same standard. _(verifies R2, R4, R5)_
- **Trends, Calendar & Budget (§8) rows fully resolved** — same standard. _(verifies R2, R4, R5)_
- **Data Health (§9) rows fully resolved** — same standard. _(verifies R2, R4, R5)_
- **Settings (§10) rows fully resolved** — same standard. _(verifies R2, R4, R5)_
- **Explore (§11) rows fully resolved** — same standard, including the "any dimension × any measure" escape-hatch framing `pages.md` gives it. _(verifies R2, R4, R5)_
- **No duplicate-with-drift definitions** — grep repeated measure names across the doc (e.g. "cache hit", "wall minutes", `$`) that appear on multiple pages; each resolves to exactly one canonical definition, cited not restated, on subsequent pages. Expected: zero divergent re-definitions. _(guards REQ Decision 11 / A16)_
- **`TierFlags` + premium schemas exhaustive** — §4's C/B/L field tables verified against all 93 real `.cost.jsonl`, all 33 real `.turn-boundaries.jsonl`, and the 1 real `cost-log.jsonl` on this machine — not a sample. _(verifies R4)_
- **API envelopes field-level** — §6's `Series`, sessions list/detail, health, and `config.json`/`local.json` shapes each have a full field-level table, not prose description. _(verifies R6)_
- **Nullability reflects observed reality** — every field-table nullability entry uses the 3-state enum (required / optional / claimed-not-observed) and, where optional, states the observed ratio (e.g. "present in 80/93"); nothing is rounded up to required from a majority. _(verifies R2, R4; guards ARCH forward-stress scenario 1 / A10, A13)_

### Implementation Notes

- **Module(s):** §1–§6 per ARCH's Module Boundaries table
- **Pattern reference:** none — first document of its kind, no existing file to mirror
- **Key decisions:** A3 (outline mirrors R1–R13), A4 (ad hoc uncommitted tooling), A5 (uniform field-table columns), A6 (standalone uniform-rigor derivation rules), A8 (§5 cites `gates.md`, never redefines gate pass rate), A10/A13 (3-state nullability), A16 (page-ordered, first-definition-wins)
- **Libraries:** none — `find`/`jq`/shell during the session, not committed (A4)
- **High-risk callouts:** `#P2-1` is the H-risk Area of Impact this task feeds directly — any field/derivation error here propagates into typed contracts. Mitigate by exhaustively inspecting the full C/B/L corpus (small enough: 93+33+1 files) rather than sampling, and by the "no duplicate-with-drift" checklist item above.

### Scope Boundaries

- Do NOT write implementation code for the parser, store, or API (REQ/ARCH Out of Scope)
- Do NOT define the R8/R9 sign-off-gated defaults, write §7's behavior contracts, or run the R10/R11 checks (prompt-size distribution, `message.id` collision) — those are T2's scope, even if §3's derivation work surfaces the *need* for an attribution default; note the need, don't resolve it here
- Do NOT modify `architecture.md` or `pages.md` — any correction those files need is drafted and finalized in T2's §11, after the full model is stable
- Do NOT embed JSONL content, real or synthetic, anywhere (N1)

### Files Expected

**New files:**
- `specs/claude-lens-data-model.md` — §1–§6 drafted (§7–§11 remain placeholders for T2)

**Must NOT modify:**
- `specs/claude-lens-architecture.md` (owned by T2 §11, conditional)
- `specs/claude-lens-pages.md` (owned by T2 §11, conditional)

---

## Task T2: Cross-cutting hardening — sign-offs, behavior contracts, corrections

> **Status:** not started
> **Verification:** checklist
> **Effort:** m
> **Priority:** critical
> **Depends on:** T1
> **Satisfies REQs:** R7, R8, R9, R10, R11, R12, R13, N1 (final sweep)
> **Footprint slice:** Modified: `specs/claude-lens-data-model.md` (§7 Behavior contracts, §8 Sign-off decisions, §9 Prompt-text size finding, §10 `message.id` collision finding, §11 Corrections); conditionally modified: `specs/claude-lens-architecture.md`, `specs/claude-lens-pages.md`
> **High-risk areas touched:** R8/R9 sign-off gates (M risk — changes real Dashboard/Sessions page output; Areas of Impact) and R11's collision-found gate (same mechanism, conditional)

### Description

Complete `specs/claude-lens-data-model.md` by writing the cross-cutting sections that don't belong to any single page: behavior contracts (dedupe, malformed/0-byte/garbage file handling, timezone, query-key serialization, rounding), the two sign-off-gated defaults (multi-model/sidechain attribution, premium coverage granularity), the prompt-text size and `message.id` collision findings against real data, and any `architecture.md`/`pages.md` correction T1's investigation surfaced. This task pauses for explicit developer sign-off before the doc can be considered merged (REQ R8/R9, and R11 if a collision is found).

### Verification Checklist

- **Behavior contracts are standalone testable statements** — §7 covers dedupe scope, time bucketing & timezone, query-key serialization, and rounding, each as its own precise prose rule. _(verifies R7)_
- **Three edge-case files handled explicitly and separately** — §7 has distinct statements for a 0-byte file, a malformed-first-line file, and a garbage-format file (not folded into one general "skip malformed lines" statement). _(verifies R12)_
- **Multi-model/sidechain attribution default proposed and gated** — §8 states a concrete default (e.g. most-token-weighted model for session "model" attribution; sidechain calls excluded from default turn/wall-min aggregates), explicitly marked pending developer sign-off. Expected: doc does not claim "merged" status until sign-off recorded. _(verifies R8)_
- **Premium coverage granularity default proposed and gated** — §8 states a concrete default (file-presence-only vs. per-turn), explicitly marked pending developer sign-off. _(verifies R9)_
- **Prompt-text size distribution measured** — §9 states the measured aggregate distribution (percentiles, max) from real data, no example content; proposes a cap only if outliers warrant it, "no cap" otherwise requires no sign-off. _(verifies R10)_
- **`message.id` collision check run project-wide** — §10 states whether a collision was found scanning across *all* real session files (not just within-session); if found, §10 blocks "merged" status pending developer sign-off, same mechanism as §8. _(verifies R11, A12)_
- **Correction notes cross-reference dependent issues** — if T1 or T2's investigation found `architecture.md`/`pages.md` text conflicting with real data, §11 documents each correction and explicitly lists which filed issues (`#P2-1`, `#P2-3`, `#P4-13`) cite the corrected section. If no conflicts were found, §11 states that explicitly rather than being left empty. _(verifies R13, A15)_
- **Full-document N1 sweep** — grep the *entire* doc (not just §1) for embedded JSON/JSONL content; zero hits. _(verifies N1)_
- **Developer sign-off recorded before "merged"** — §8's two decisions (and §10's finding, if a collision was found) carry an explicit developer approval note, not just a proposed default. _(verifies R8, R9, guards ARCH Cross-Cutting Concerns → Migrations/rollout)_

### Implementation Notes

- **Module(s):** §7–§11 per ARCH's Module Boundaries table
- **Pattern reference:** T1's §1–§6 field-table and prose-rule conventions (A5, A6) — §7's behavior contracts follow the same standalone-statement discipline
- **Key decisions:** A7 (§8 authoritative, §3/§4 cite it — may require a one-line update to T1's §3/§4 to point at §8 once it exists), A9 (N1's dual rationale — verification vs. PII/security), A12 (collision-found sign-off gate), A14 (append-only amendments), A15 (correction cross-references), A17 (phase-split rationale)
- **Libraries:** none — same ad hoc tooling discipline as T1 (A4)
- **High-risk callouts:** R8/R9 are M-risk Areas of Impact — they change what real users see on Dashboard/Sessions for mixed-model or sidechain-heavy sessions. Do not resolve these unilaterally; stop and present the proposed default for explicit sign-off per the Cross-Cutting Concerns → Migrations/rollout note. Same discipline applies to R11 if a collision is found.

### Scope Boundaries

- Do NOT redefine fields already established in T1's §2–§6 — cite them, per the "cite, don't restate" pattern
- Do NOT write `architecture.md`/`pages.md` corrections unless real data actually conflicts with current text (REQ Decision 3) — no speculative rewrites
- Do NOT resolve R8, R9, or a found R11 collision without stopping for explicit developer sign-off — these are blocking checkpoints, not investigator's-call defaults like the rest of the doc (REQ Decision 2's carve-outs)
- Do NOT embed JSONL content, real or synthetic, anywhere (N1)

### Files Expected

**Modified files:**
- `specs/claude-lens-data-model.md` (adds §7–§11, completing the doc)

**Conditionally modified:**
- `specs/claude-lens-architecture.md` (only if T1/T2 investigation found a real conflict — REQ Decision 3)
- `specs/claude-lens-pages.md` (same condition)

---

_Status values: `not started` (defined, not picked up) | `in progress` (implementation underway) | `done` (verification evidence produced) | `blocked` (cannot proceed — see notes). The implement skill updates this field as it works._
