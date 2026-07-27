# Requirements: Cache Scorecard — session grade + "Biggest Lever" dashboard card

> **Date:** 2026-07-27
> **Issue:** #124
> **Type:** feature
> **Source:** verbal brief (conversation, 2026-07-27; reference prototype `specs/session_scorecard.py`)
> **Phase:** 1 of 5 (Requirement Engineering)

## Summary

Add a per-session **cache scorecard** that grades how efficiently a Claude Code session used prompt caching — quantifying tokens that were re-written after already being cached ("waste"), attributing each waste event to a cause, and rolling it up into a letter grade. Surface it in two places: a scorecard section on Session Detail, and one dashboard card ("Biggest lever this week") that shows the single largest attributable waste event so the user is prompted to investigate. The goal is behavioral: turn the dashboard from cosmetic aggregates into questions the user wants to answer.

## Problem & Motivation

The current dashboard shows state ("cache hit 92.6%") with no deviation, cause, or consequence — nothing invites investigation. Yet the underlying data is dramatic: a scan of the author's own 97 scoreable sessions found **72.5% of all cache-creation tokens (20.2M) were re-writes of already-cached content**, split between fixable prefix busts (11.4M) and idle-time cache expiry (8.8M). A cache re-write costs ~12.5× what a cache hit would have, so this is the single biggest cost lever a Claude Code user has — and no existing tool surfaces it, making this the product's most differentiated insight (it builds directly on the existing K2 cache-cause classification).

A Python prototype (`specs/session_scorecard.py`) validated the rubric against real transcripts. This REQ productizes it inside the app's ingest → derive → serve pipeline.

If we don't do it: the dashboard stays a passive readout, users keep paying for prefix churn they can't see, and the app's strongest differentiator stays unshipped.

## Users & Consumers

- **Claude Code users running claude-lens locally** — want to know "am I wasting money on cache re-writes, which session/event caused it, and what do I change?"
- **Session Detail page** — consumes the per-session scorecard (grade + metrics + event list).
- **Dashboard** — consumes the fleet-wide "biggest waste event in period" query for the Biggest Lever card.
- **Future REQs** (repeat-offender / trend cards, fleet measures) — will consume the same per-session scorecard outputs; this REQ's outputs must be reusable, not page-private.

## Functional Requirements

| ID  | Requirement | Acceptance Criterion |
|-----|-------------|----------------------|
| R1  | Compute a per-session cache scorecard from transcript data alone: total cache reads, cache-creation decomposed as warmup + incremental + wasted re-writes, waste ratio (wasted / total creation), hit ratio, and a chronological list of waste events. | For a synthetic fixture session with a known bust pattern, the computed decomposition and event list match hand-calculated expected values exactly. |
| R2  | Classify every waste event with a cause, reusing the app's single existing cache-cause classification (first call / model switch / compaction / idle expiry / unexplained). The scorecard and the app's existing cache-cause surfaces must never disagree about the same call. | For the same fixture call, the scorecard event's cause equals the cause shown by existing cache-cause surfaces (same classification, same inputs → same output). |
| R3  | Produce a **hygiene grade** (letter) covering only fixable events (prefix busts, duplicated warm-up writes). Idle-expiry cost is reported alongside as informational and never lowers the grade. | A fixture session whose only waste is idle-expiry re-writes grades the same as an otherwise-identical session with no waste; adding one prefix bust lowers the grade. |
| R4  | Grade only sessions at or above a minimum main-thread call floor (default 10, configurable alongside existing gate thresholds). Below the floor, show computed metrics with an explicit "not graded — session too short" state. | A 9-call fixture session returns metrics and no grade with the too-short reason; an 11-call session returns a grade. Changing the configured floor changes the boundary. |
| R5  | Grade bands start from fixed built-in defaults; once the fleet has ≥ 20 graded sessions, bands calibrate to the user's own session distribution so grades stay discriminating (a healthy long session must be able to earn an A; the calibrated bands must not grade every long real session F). | With < 20 graded sessions, a fixture fleet grades on documented default bands. With ≥ 20, the same session's grade reflects the fleet-calibrated bands, and a fleet where all sessions are similar does not grade them all F. |
| R6  | Session Detail shows a scorecard section: grade badge (or ungraded state), the R1 metrics, and each waste event with its timestamp, cause (including explicit "unexplained"), tokens re-written, and a deep link to the event's turn in Turn Inspector. | On a fixture session, the section renders grade, metrics, and one row per waste event; clicking an event lands on that turn; an unexplained event displays "unexplained", not a guessed cause. |
| R7  | Dashboard shows a "Biggest lever" card: the single largest waste event (by re-written tokens) across all sessions within the dashboard's active time range, with its cause (or "unexplained"), consequence in tokens and estimated dollars, session/project identification, and a deep link to that session's scorecard section. | With fixture data containing multiple waste events, the card shows the largest one in the selected range with cause, token count, dollar estimate, and a working deep link; changing the time range changes the selection accordingly. |
| R8  | When the active time range contains no waste events, the Biggest Lever card shows a positive summary of the period's cache health (e.g. first-write share of creation tokens) rather than hiding or manufacturing urgency. | With fixture data containing zero waste events in range, the card renders the positive state with real period numbers; it is visually distinct from a loading/error state. |
| R9  | Scorecards stay current with live sessions: as new transcript lines are ingested, an open session's scorecard reflects them via the app's existing live-update behavior (no manual refresh). | Appending fixture lines that introduce a bust to a session being viewed updates the visible scorecard without a page reload. |
| R10 | Dollar estimates on waste events use the app's existing pricing/tier semantics: shown when computable, marked estimated where estimated, and **never rendered as 0 when unavailable**. | For a model with no pricing data, the card/section shows the token count with cost marked unavailable — not `$0.00`. |

## Non-Functional Requirements

| ID  | Requirement | Acceptance Criterion |
|-----|-------------|----------------------|
| N1  | Transcript-only (🟢 tier): every scorecard value derives from transcript files alone; no premium capture files required or consulted. | Scorecard output is identical for a fixture session with and without premium sidecar files present. |
| N2  | Scorecard computation must not degrade ingest or page responsiveness; it follows the same per-session derive/invalidate cycle as existing derived data (no full-fleet recompute per line). | The existing ingest benchmark (`npm run bench:ingest`) shows no material regression after the feature lands. |
| N3  | Deterministic: same transcript input → same scorecard output (no wall-clock dependence in the computation itself; "as of" stamps applied at the serving layer, matching the gates precedent). | Running the engine twice over the same fixture yields byte-identical results. |

## Behaviors & Domain Rules

**Waste event.** A call whose cache-creation re-writes content that the session had already established in cache. Each event carries: kind (fixable prefix bust / duplicated warmup write vs. informational idle expiry), cause, tokens re-written, timestamp, and its turn.

**Hygiene vs. weather.** Fixable events (prefix busts from mid-session prefix churn; duplicated parallel warmup writes) are the user's lever and drive the grade. Idle-expiry events ("weather" — the user stepped away past the cache TTL and resumed) are real cost but not a behavior to shame; they are shown, priced, and excluded from the grade.

**Explained ≠ penalized.** Events the classifier explains as inherent session mechanics (first call of session, model switch, post-compaction re-write) are not waste and never appear as waste events. Only genuine re-writes count.

**Honest unknowns.** When no cause can be attributed, the event says "unexplained" — prominently, not apologetically. (Today's prototype could not attribute ~82% of events; the explicit unknown is both honest and the in-product motivation for the follow-up event-capture REQ.)

**Main-thread only.** Grades and metrics count main-thread calls; sidechain (subagent) traffic is excluded from this scorecard, consistent with the existing gates convention. Duplicate API-response lines are deduplicated by message identity before any counting (existing shared preprocessing).

**One investigation per visit.** The Biggest Lever card surfaces exactly one event — the largest — never a list. Its job is to start an investigation, not to be a report.

**Spec ownership.** The scorecard algorithm, its thresholds (grade floor, calibration history minimum, bands), and its evidence contract must be recorded in `specs/gates.md` (the domain owner for Report Card–style scoring) as part of this work.

**Why these rules matter:**
- Blending idle-expiry into the grade makes long real sessions fail unfairly (prototype: 35 of the author's 72 real sessions graded F) — users learn to dismiss a card that is always red, killing the whole behavioral premise.
- A second, disagreeing definition of "cache bust" (scorecard vs. existing cache-cause surfaces) would destroy trust the first time a user cross-checks; R2 makes agreement a requirement, not an implementation nicety.
- Faking certainty on unexplained events (or rendering unavailable cost as $0) violates the app's established tier honesty and would poison every other 🟢/🟡 claim the product makes.

**Common mistakes (first-attempt traps):**
- Porting the prototype's thresholds verbatim (70% read drop + >5k creation; TTL = >5-min gap with zero read) instead of reusing the app's existing classification — creating two conflicting bust definitions.
- Penalizing idle expiry in the headline grade because "the prototype did".
- Treating zero-read first calls or post-compaction re-writes as busts.
- Counting sidechain calls, or double-counting the multiple transcript lines that share one API response.
- Rendering "no grade" (below floor) as an F or a 0, or unavailable pricing as $0.00.
- Making the dashboard card compute over raw transcripts at request time instead of consuming per-session derived output.

## Edge Cases & Failure Modes

| Scenario | Decision | Rationale |
|----------|----------|-----------|
| Session has no scoreable main-thread calls (subagent-only transcript, empty/aborted session — 278 of the author's 375 files) | Session Detail shows "no scorecard — no main-thread API calls"; session is invisible to the Biggest Lever query | Real, common case; must read as N/A, never as error or F |
| Session below grade floor (< 10 main-thread calls by default) | Metrics shown; grade replaced by "not graded — session too short" | Tiny sessions ace any rubric and pollute averages, but a 5-call session can still contain one expensive, investigable bust |
| No waste events in the dashboard's active time range | Biggest Lever card shows positive summary with real period numbers | "No problems" must be distinguishable from "no data / broken"; confirming good behavior keeps the habit loop |
| Fresh install, < 20 graded sessions in fleet | Fixed default bands apply; calibration activates at the threshold | Predictable day-one behavior; personal calibration once meaningful |
| Largest waste event in range has no attributable cause | Card still shows it, labeled "unexplained", with full consequence and deep link | Biggest lever means biggest, honestly; an unexplained big event is exactly what merits investigation |
| Waste event's turn cannot be resolved for deep-linking | Event row renders with all data; link degrades to the session's scorecard section | Data without navigation still beats hiding the event |
| Model switch or compaction mid-session causes a large cache write | Classified as explained; not a waste event; no grade impact | Inherent mechanics, not user-fixable behavior |
| Session still live while being viewed | Scorecard recomputes on ingest invalidation and the UI refreshes per existing live-update behavior; grade may legitimately change as the session grows | Consistency with every other live-updating surface |
| Malformed/unparseable transcript lines within a session | Skipped and counted per existing parser behavior; scorecard computes over parseable calls | Established ingest invariant: malformed lines are counted, never thrown |
| Session spans the boundary of the dashboard time range | A waste event belongs to the range containing its own timestamp, regardless of session start | Events, not sessions, are the card's unit; avoids boundary double-counting |
| Pricing unknown for a model in a waste event | Token consequence always shown; dollar figure marked unavailable | Tier honesty (R10); never substitute 0 |

## Decisions Log

| # | Decision | Alternatives Considered | Chosen Because |
|---|----------|-------------------------|----------------|
| 1 | First slice = engine + Session Detail section + one dashboard card (Biggest Lever) | (a) engine + session view only; (b) full vision incl. all cards + event capture in one REQ | Delivers the dashboard-behavioral value that motivated the work while staying sprint-sized; (b) is 2–3 sprints |
| 2 | Biggest Lever is the one card in this slice; repeat offender, weekly trend, fixable/weather tile queued to the next REQ | Shipping 2–4 cards now | User wants all four; sizing rule caps this REQ at one; top-ranked card chosen |
| 3 | Split scores: hygiene grade (fixable only) + idle-expiry cost as informational | Single blended 0–100 grade (as prototype); no grade at all | Blended grade fails every long real session (35/72 F in prototype data) and penalizes lunch breaks — reads unfair, gets ignored; no-grade loses the curiosity hook |
| 4 | Grade bands: fixed defaults, calibrating to the user's fleet after ≥ 20 graded sessions | Always-fixed bands + percentile; no grade until calibrated | Predictable on day one, personally meaningful later; alternatives are either forever-harsh or invisible for weeks |
| 5 | Grade floor: ≥ 10 main-thread calls (configurable); metrics always shown when computable | Grade everything; hide scorecard entirely below floor | Trivial sessions all ace the rubric and dilute trends; hiding would suppress real, investigable metrics |
| 6 | Empty period → positive summary card | Hide the card; fall back to next-best insight | Distinguishes "healthy" from "broken"; fallback manufactures urgency |
| 7 | Reuse the app's single existing cache-cause classification; prototype thresholds are not ported verbatim | Port `session_scorecard.py` logic as-is | Two disagreeing bust definitions in one product is a trust-killer; the existing classifier already handles more causes correctly |
| 8 | Unexplained causes shown explicitly as "unexplained" | Hide unattributed events; guess a cause | Tier-honesty philosophy; the unknown itself motivates the follow-up event-capture REQ |
| 9 | Transcript-only (🟢); no premium capture dependency | Use premium cost sidecars when present | Maximizes reach (works for every user immediately); premium enrichment can layer on later |
| 10 | Idle-expiry ("weather") events shown and priced but never graded | Penalize TTL expiries (as prototype: −5 each) | Walking away from the desk is not a prompting behavior to correct |

## Scope Boundaries

### In Scope
- Per-session cache scorecard computation (metrics, waste events with causes, hygiene grade) — transcript-only
- Grade floor + fixed-then-calibrated band behavior, with thresholds configurable alongside existing gate thresholds
- Session Detail scorecard section with per-event turn deep links
- Dashboard "Biggest lever this week" card (largest waste event in active time range, positive empty state)
- Live-update behavior for open sessions
- Recording the scorecard algorithm, thresholds, and evidence contract in `specs/gates.md`
- Synthetic fixtures covering the acceptance criteria above (never copied from real transcripts)

### Out of Scope
- Repeat-offender, weekly-grade-trend, and fixable-vs-weather dashboard cards (reason: next REQ — decision #2)
- Parser capture of context events (permission grants, skill/slash-command loads, task notifications) and "what happened N seconds before this bust" annotations (reason: separate follow-up REQ; touches the ingest hot path and store footprint; today's causes come from the existing classifier only)
- Fleet-level scorecard measures for Trends/metrics queries (waste-ratio-over-time etc.) (reason: belongs with the trend card REQ)
- Premium capture (`*.cost.jsonl`) enrichment of scorecard values (reason: 🟢-only slice; decision #9)
- Recommendations/remediation advice (e.g. "front-load an allowlist") (reason: belongs with the repeat-offender card, which aggregates recurring causes)
- Notifications, streaks, or any gamification beyond the grade itself (reason: unvalidated; risk of alert fatigue)
- Warmup-race *penalties* beyond counting/display (reason: zero occurrences in 97 real sessions; counted as a fixable event if seen, but no dedicated UX)

## Open Questions

- Exact default grade bands and the calibration mapping (e.g. percentile cutoffs) once the ≥ 20-session threshold is met.
  - **Impact if unresolved:** grades could be uniformly harsh or uniformly flattering at launch, weakening the hook either way.
  - **Suggested default:** start from the prototype's bands applied to the hygiene-only score, validated against the author's own fleet so that healthy long sessions land A/B and the known-bad sessions land D/F; tune the calibration rule in Phase 2 against `specs/gates.md`.
- Whether the Biggest Lever card ranks events by raw re-written tokens or by estimated dollar cost when pricing is available.
  - **Impact if unresolved:** a large-token event on a cheap model could outrank a costlier event on an expensive model.
  - **Suggested default:** rank by tokens (always available, tier-honest); show dollars as context. Revisit when premium pricing enrichment lands.

---
_This requirements document is the input for the **plan-architecture** skill._
_Next step: `/plan-architecture from: specs/requirements/REQ-124-cache-scorecard.md`_

