# Claude Lens — Best-Practice Gates (V1)

Deterministic rules evaluated over the canonical `parseSession()` output (`turns[]`, `calls[]`) plus a filesystem check of the project dir. Fixed built-in set for V1 — not pluggable. All gates are transcript-only (🟢); no cost capture required.

Each gate emits: `{ gateId, status: pass|warn|fail, evidence: [{turnN?, callId?, filePath?, detail}] }`. `turnN` is present for the turn-scoped gates (V1, V2, P3, C3, K2) and their evidence deep-links to Turn Inspector (`/session/:id/turn/:n`). **E1/E2 is session-scoped**: its evidence is a filesystem check with no `turnN`/`callId` (`filePath` + `detail` only) and does not deep-link to a turn — consumers (Report Card UI, Dashboard gate feed) must not assume evidence is turn-keyed. Session score = weighted pass rate shown on the Report Card (Session Detail).

**Shared preprocessing (applies to every gate):**
- Dedup API calls by `message.id` before any counting.
- "Edit calls" = tool_use with name `Edit` or `Write`. "Command calls" = name `Bash`.
- Exclude `isSidechain: true` calls from V1 gates (subagent behavior isn't the user's prompting habit). Revisit in V2.
- A "turn" = calls grouped by `promptId`.

---

## V1 — Edit-without-verify

**Practice:** "Give Claude a way to verify its work."
**Rule:** Within a turn, if any edit call exists and no command call occurs *after the last edit call* (by call order), → **fail** for that turn. Session status: fail if ≥1 failing turn that isn't the final turn; the final turn alone → covered by the softer framing below.
**Evidence:** the turn, the last edit call, the edited file path(s).
**Notes:** Command *presence* is the check, not command success — success handling belongs to V2. Turns with zero edits are N/A, not pass; exclude from the score denominator.
**Why it matters:** without a runnable check after edits, the user is the verification loop; every mistake waits for a human to notice.

## V2 — Failing-command loop

**Practice:** verification should converge, not thrash.
**Rule:** Normalize each Bash command string (trim, collapse whitespace). If the same normalized command produces an error result ≥ `V2_REPEAT` times within one turn → **fail**. Error detection: `tool_result.is_error === true`, or exit-code markers in the result content.
**Default:** `V2_REPEAT = 3`.
**Evidence:** the turn, the repeated command string, the failing call ids in order.
**Why it matters:** repeated identical failures mean Claude is guessing; each guess re-bills a growing context. The fix is a user interrupt with the real error or constraint.

## P3 — Code-before-read

**Practice:** "Explore first" — edit only what was actually read.
**Rule:** For each edit call, if the target file path has no prior `Read` tool_use (same session, any earlier call, main thread) **and** the file existed before the session (i.e., the first touch is `Edit`, not `Write`-that-creates), → **fail** per file.
**Evidence:** file path, the first offending edit call, its turn.
**Notes:** `Write` to a brand-new path is creation, not blind editing — N/A. Files read via `@`-mention appear as content in the user message; treat a user-message attachment containing the path as a read (best-effort string match on the path; if unmatched, still fail — deterministic over what's in the transcript).
**Why it matters:** edits to unread files come from training-data patterning, not the actual code — the classic "invented an API" failure.

## C3 — Fat tool result

**Practice:** context is the scarce resource; giant reads recur as cache-read cost on every subsequent call.
**Rule:** Any single `tool_result` content length > `C3_MAX_CHARS` → **warn** (not fail — sometimes unavoidable).
**Default:** `C3_MAX_CHARS = 15000`.
**Evidence:** the call, the tool name, result size, and the recurring-cost estimate: `size/4 tokens × remaining API calls in session`.
**Why it matters:** one oversized read is paid once as write and then on *every* later call as read; the gate turns "context fills fast" into a specific number attached to a specific call.

## K2 — Unexplained cache invalidation

**Practice:** cost discipline — the prefix should be stable.
**Rule:** For each call with `cache_creation_input_tokens > K2_SPIKE` tokens, run the cause classifier (already built for Cache Lab):
1. first call of session → explained
2. `model` differs from previous call → explained (model switch)
3. previous call's `cache_read` cliff (drop > 50% vs its predecessor) → explained (compaction)
4. otherwise → **fail** (unexplained invalidation)
**Default:** `K2_SPIKE = 10000`.
**Evidence:** the call, spike size, classifier trace (which checks ran and their values).
**Why it matters:** unexplained spikes almost always mean mid-session prefix churn (CLAUDE.md/MCP/settings changed). No existing tool surfaces *why* the cache broke; this is Lens's most differentiated check.

## E1/E2 — CLAUDE.md missing / bloated

**Practice:** "Write an effective CLAUDE.md" — present, but short.
**Rule (one gate, three outcomes):**
- No `CLAUDE.md` at project root (transcript `cwd`) **and** none at `~/.claude/CLAUDE.md` → **fail (E1)**
- Present but size > `E2_MAX_CHARS` or lines > `E2_MAX_LINES` → **warn (E2)** — bloat causes instruction loss
- Otherwise → pass
**Defaults:** `E2_MAX_CHARS = 4000`, `E2_MAX_LINES = 60`.
**Evidence:** resolved path(s) checked, size/line count — session-scoped shape per the §1 contract: `{filePath, detail}` entries with no `turnN`/`callId`. Follows `@import` references one level for the size total.
**Notes:** filesystem check at analysis time, not session time — label the result "as of now" since the file may have changed since the session ran.
**Why it matters:** missing → conventions re-explained (and re-billed) every session. Bloated → rules get lost, experienced as "Claude ignores my instructions."

---

## Report Card scoring

- Per-gate status rolls up: any fail → gate fails for the session; else any warn → warn; else pass. N/A turns excluded from denominators.
- Session score = `passes / (passes + warns×0.5-credit + fails)` across the 6 gates — display as letter or fraction, not a percentage with false precision.
- Fleet trend (V2 of the product, not now): gate failure rate per week.

## Configurable constants (Settings → Gate thresholds)

| Constant | Default | Gate |
|---|---|---|
| `V2_REPEAT` | 3 | V2 |
| `C3_MAX_CHARS` | 15000 | C3 |
| `K2_SPIKE` | 10000 tokens | K2 |
| `E2_MAX_CHARS` / `E2_MAX_LINES` | 4000 / 60 | E2 |

## Deferred to V2+ (recorded so they're not re-litigated)

V3 unverified session end · V4 pasted-error ping-pong · P1 big-bang without plan · P2 plan overhead · C1 context ceiling · C2 compaction cost · C4 re-read churn · C5 session sprawl · K1 cache hit floor · K3 model/task mismatch · E3 rule-violation grep · S1/S2 prompt-specificity proxies · pluggable `gates/*.js` registry · sidechain gate coverage.
