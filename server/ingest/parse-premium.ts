import { LOCAL_STORE_STRING_MAX } from "../../shared/local-store-contract.js";
import { isRecord } from "../util.js";

// Premium capture-file parsers (#P4-13, architecture §4). Three optional
// sidecar file types upgrade a session from computed (🟡) to observed (🟢):
//
//   C  `<uuid>.cost.jsonl`          — per-line cost samples (observed $,
//                                      api_duration_ms, lines ±, context_pct).
//   B  `<uuid>.turn-boundaries.jsonl` — Stop-hook turn-end markers.
//   L  `cost-log.jsonl`             — one row per session, session totals. Lives
//                                      at ~/.claude/ (parent of the projects
//                                      root); discovery routes it here globally.
//
// These files are small (one session for C/B; one row per session for L), so
// the pipeline re-reads and re-parses each whole on change with full-replace
// store semantics — no byte-offset tailing, no dedupe (unlike the transcript
// parser). Malformed lines are counted, never thrown, mirroring
// `parse-transcript.ts`; the counters surface on the Data Health page (#P4-14).

// --- C: cost samples -------------------------------------------------------

/**
 * One parsed line of a `<uuid>.cost.jsonl` file. The 10-field core is present
 * on every line; the two index variants (`turn` vs `epoch`+`sample`) are
 * mutually exclusive per line and retained but **not** used for attribution —
 * reconciliation keys off `timestamp` alone (reconcile-premium.ts), which every
 * line carries, so it is variant-agnostic.
 */
export interface CostSample {
  sessionId: string;
  timestamp: string;
  costDeltaUsd: number;
  cumulativeCostUsd: number;
  apiDurationMs: number;
  contextPct: number;
  linesAdded: number;
  linesRemoved: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /**
   * The turn's `promptId` at the time the sample was emitted (#P4-14,
   * Data Health §4 boundary-mismatches panel). Optional because the
   * source field is not always present (statusline writers vary);
   * undefined samples are skipped by the promptId-mismatch check in
   * `reconcilePremium` rather than counted as a mismatch. Empty
   * string is treated as missing.
   */
  promptId?: string;
  /** Turn-indexed variant only. */
  turn?: number;
  /** Epoch-indexed variant only (paired with `sample`). */
  epoch?: number;
  /** Epoch-indexed variant only (paired with `epoch`). */
  sample?: number;
}

// --- B: turn boundaries ----------------------------------------------------

/** One parsed line of a `<uuid>.turn-boundaries.jsonl` file. */
export interface TurnBoundary {
  sessionId: string;
  transcriptPath: string;
  turnEnd: string;
  turnEndEpoch: number;
}

// --- L: cost log -----------------------------------------------------------

/**
 * One parsed row of the global `cost-log.jsonl` file — a per-session total.
 * Field names differ from C for the same concepts (`cache_read` vs
 * `cache_read_tokens`, `cost_usd` (session total) vs `cost_delta_usd`/
 * `cumulative_cost_usd`, `duration_ms` (session wall) vs `api_duration_ms`);
 * see the cross-tier collision table in `specs/claude-lens-data-model.md` §7.
 */
export interface CostLogRow {
  sessionId: string;
  timestamp: string;
  costUsd: number;
  durationMs: number;
  model: string;
  dir: string;
  contextPct: number;
  cacheRead: number;
  cacheWrite: number;
  linesAdded: number;
  linesRemoved: number;
}

// --- shared result shape ---------------------------------------------------

export interface ParseCostSamplesResult {
  samples: CostSample[];
  malformedCount: number;
}

export interface ParseTurnBoundariesResult {
  boundaries: TurnBoundary[];
  malformedCount: number;
}

export interface ParseCostLogResult {
  rows: CostLogRow[];
  malformedCount: number;
}

// Value coercers — same defensive style as parse-transcript.ts. A required
// string missing/of-wrong-type yields "" (the caller decides whether "" is
// fatal via a session-id guard); numbers coerce to 0.
function toStr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toNum(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function toOptionalNum(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

type ParsedLine<T> = { kind: "record"; record: T } | { kind: "skipped" } | { kind: "malformed" };

// Cheap pre-parse DoS guard (security #5). `JSON.parse` is bounded by V8's
// recursion limit, but a hostile capture-file could still construct a
// pathologically nested payload that takes many seconds to reject. Counting
// the structural-open chars is the cheapest signal — bail before
// `JSON.parse` if the line carries an obvious attack shape. The threshold is
// generous (64 opens → at least depth 64); string-literal-aware depth
// tracking is fiddly and rejected here in favor of the simpler heuristic.
const MAX_JSON_OPEN_STRUCT_CHARS = 64;

function exceedsOpenStructCharLimit(rawLine: string): boolean {
  let count = 0;
  for (let i = 0; i < rawLine.length; i++) {
    const c = rawLine.charCodeAt(i);
    if (c === 0x7b /* { */ || c === 0x5b /* [ */) {
      count++;
      if (count > MAX_JSON_OPEN_STRUCT_CHARS) return true;
    }
  }
  return false;
}

/**
 * Parse one JSONL line into a record of type `T` via `build`, applying the
 * shared skipped/malformed discipline: blank → skipped; pre-parse depth
 * guard tripped → malformed; unparseable or non-object JSON → malformed;
 * any string field over `LOCAL_STORE_STRING_MAX` → malformed (security #3,
 * bounds the downstream Map key + WS broadcast size); a record whose
 * `session_id` is missing/empty → malformed (the partition key is mandatory
 * for every premium line — unlike transcripts, premium files carry no
 * legitimately session-less line).
 */
function parsePremiumLine<T extends { sessionId: string }>(
  rawLine: string,
  build: (obj: Record<string, unknown>) => T,
): ParsedLine<T> {
  const trimmed = rawLine.trim();
  if (trimmed === "") return { kind: "skipped" };

  if (exceedsOpenStructCharLimit(trimmed)) return { kind: "malformed" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: "malformed" };
  }
  if (!isRecord(parsed)) return { kind: "malformed" };

  const record = build(parsed);
  if (record.sessionId === "") return { kind: "malformed" };
  // M4: bound the string-length attack surface. Any string field over
  // LOCAL_STORE_STRING_MAX (mirrored from local-store-contract.ts) is treated
  // as malformed rather than silently truncated — this matches the security
  // posture on `local.json` fields and bounds WS broadcast / query-key sizes
  // downstream. Numbers are already bounded by `Number.MAX_SAFE_INTEGER`
  // inside V8, so no parallel check is needed for numeric fields.
  for (const value of Object.values(record)) {
    if (typeof value === "string" && value.length > LOCAL_STORE_STRING_MAX) {
      return { kind: "malformed" };
    }
  }
  return { kind: "record", record };
}

function buildCostSample(obj: Record<string, unknown>): CostSample {
  // M7: declare every optional at construction with `undefined` when absent
  // so all records share the same hidden-class shape. The pre-M7 form
  // appended turn/epoch/sample via separate `if` blocks, producing 4-8
  // hidden classes across a mixed-variant C file — measurably slower in V8
  // because every new shape forces a megamorphic inline-cache miss. Same
  // fields are declared `turn?: number` on the interface, so `undefined` is
  // assignable and the public shape is unchanged.
  const promptId = toStr(obj.prompt_id);
  return {
    sessionId: toStr(obj.session_id),
    timestamp: toStr(obj.timestamp),
    costDeltaUsd: toNum(obj.cost_delta_usd),
    cumulativeCostUsd: toNum(obj.cumulative_cost_usd),
    apiDurationMs: toNum(obj.api_duration_ms),
    contextPct: toNum(obj.context_pct),
    linesAdded: toNum(obj.lines_added),
    linesRemoved: toNum(obj.lines_removed),
    cacheReadTokens: toNum(obj.cache_read_tokens),
    cacheWriteTokens: toNum(obj.cache_write_tokens),
    ...(promptId !== "" ? { promptId } : {}),
    turn: toOptionalNum(obj.turn),
    epoch: toOptionalNum(obj.epoch),
    sample: toOptionalNum(obj.sample),
  };
}

function buildTurnBoundary(obj: Record<string, unknown>): TurnBoundary {
  return {
    sessionId: toStr(obj.session_id),
    transcriptPath: toStr(obj.transcript_path),
    turnEnd: toStr(obj.turn_end),
    turnEndEpoch: toNum(obj.turn_end_epoch),
  };
}

function buildCostLogRow(obj: Record<string, unknown>): CostLogRow {
  return {
    sessionId: toStr(obj.session_id),
    timestamp: toStr(obj.timestamp),
    costUsd: toNum(obj.cost_usd),
    durationMs: toNum(obj.duration_ms),
    model: toStr(obj.model),
    dir: toStr(obj.dir),
    contextPct: toNum(obj.context_pct),
    cacheRead: toNum(obj.cache_read),
    cacheWrite: toNum(obj.cache_write),
    linesAdded: toNum(obj.lines_added),
    linesRemoved: toNum(obj.lines_removed),
  };
}

/**
 * Parse the lines of a `<uuid>.cost.jsonl` file. When `expectedSessionId`
 * is supplied, every parsed record whose `session_id` does not match is
 * counted as malformed (H6 — a record with `session_id: "B"` inside
 * `A.cost.jsonl` would otherwise be silently applied to A's session, leaking
 * observed values into the wrong session).
 */
export function parseCostSampleLines(
  rawLines: string[],
  expectedSessionId?: string,
): ParseCostSamplesResult {
  const result: ParseCostSamplesResult = { samples: [], malformedCount: 0 };
  for (const rawLine of rawLines) {
    const parsed = parsePremiumLine(rawLine, buildCostSample);
    if (parsed.kind === "record") {
      if (expectedSessionId !== undefined && parsed.record.sessionId !== expectedSessionId) {
        result.malformedCount++;
      } else {
        result.samples.push(parsed.record);
      }
    } else if (parsed.kind === "malformed") {
      result.malformedCount++;
    }
  }
  return result;
}

/**
 * Parse the lines of a `<uuid>.turn-boundaries.jsonl` file. Same
 * `expectedSessionId` mismatch discipline as `parseCostSampleLines` (H6).
 */
export function parseTurnBoundaryLines(
  rawLines: string[],
  expectedSessionId?: string,
): ParseTurnBoundariesResult {
  const result: ParseTurnBoundariesResult = { boundaries: [], malformedCount: 0 };
  for (const rawLine of rawLines) {
    const parsed = parsePremiumLine(rawLine, buildTurnBoundary);
    if (parsed.kind === "record") {
      if (expectedSessionId !== undefined && parsed.record.sessionId !== expectedSessionId) {
        result.malformedCount++;
      } else {
        result.boundaries.push(parsed.record);
      }
    } else if (parsed.kind === "malformed") {
      result.malformedCount++;
    }
  }
  return result;
}

/**
 * Parse the rows of the global `cost-log.jsonl` file. L is intentionally
 * routed by its own `session_id` (one row may upgrade any session in the
 * fleet) — no `expectedSessionId` parameter.
 */
export function parseCostLogLines(rawLines: string[]): ParseCostLogResult {
  const result: ParseCostLogResult = { rows: [], malformedCount: 0 };
  for (const rawLine of rawLines) {
    const parsed = parsePremiumLine(rawLine, buildCostLogRow);
    if (parsed.kind === "record") result.rows.push(parsed.record);
    else if (parsed.kind === "malformed") result.malformedCount++;
  }
  return result;
}
