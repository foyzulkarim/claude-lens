import type { Measure } from "../../shared/metrics-contract.js";
import type { ApiCall, Session, Turn } from "../../shared/types.js";

export interface ModelRate {
  /** $ per 1,000,000 input tokens */
  input: number;
  /** $ per 1,000,000 output tokens */
  output: number;
  /** $ per 1,000,000 cache-read tokens */
  cacheRead: number;
  /** $ per 1,000,000 cache-write tokens */
  cacheCreate: number;
}

/** Keyed by exact `ApiCall.model`. A missing key means unpriced -> $0, never fabricated. */
export type PricingTable = Record<string, ModelRate>;

// Placeholder values (V1's flat legacy rates), applied identically across all
// four known model names for now — explicit decision this session: assume
// numbers now, real per-model structure is what matters. #P4-15's Settings
// pricing editor overrides this at runtime; a follow-up commit corrects the
// numbers.
const PLACEHOLDER_RATE: ModelRate = { input: 5.0, output: 25.0, cacheRead: 0.5, cacheCreate: 6.25 };

export const DEFAULT_PRICING_TABLE: PricingTable = {
  "claude-sonnet-5": PLACEHOLDER_RATE,
  "claude-fable-5": PLACEHOLDER_RATE,
  "claude-opus-4-8": PLACEHOLDER_RATE,
  "claude-haiku-4-5": PLACEHOLDER_RATE,
};

/** An already-filtered/grouped/bucketed slice of data for one (measure x group x bucket) cell. */
export interface MeasureScope {
  calls: ApiCall[];
  turns: Turn[];
  sessions: Session[];
}

export function priceCall(call: ApiCall, pricing: PricingTable): number {
  const rate = pricing[call.model];
  if (!rate) return 0;
  const { inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens } = call.usage;
  return (
    (inputTokens * rate.input +
      outputTokens * rate.output +
      cacheReadTokens * rate.cacheRead +
      cacheCreateTokens * rate.cacheCreate) /
    1_000_000
  );
}

/**
 * The uncached-cost counterfactual for one call: price it as if no tokens were
 * served from cache — cache-read tokens are priced at the input rate instead.
 * Returns null if the call's model is unpriced.
 */
export function uncachedPrice(call: ApiCall, pricing: PricingTable): number | null {
  const rate = pricing[call.model];
  if (!rate) return null;
  const { inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens } = call.usage;
  return (
    ((inputTokens + cacheReadTokens) * rate.input +
      outputTokens * rate.output +
      cacheCreateTokens * rate.cacheCreate) /
    1_000_000
  );
}

/**
 * The all-Opus-uncached counterfactual: prices every call at the Opus model's
 * rates with zero cache benefit. Returns null if Opus is unpriced (shouldn't
 * happen with DEFAULT_PRICING_TABLE, but defensive).
 */
function opusUncachedPrice(call: ApiCall, opusRate: ModelRate): number {
  const { inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens } = call.usage;
  return (
    ((inputTokens + cacheReadTokens) * opusRate.input +
      outputTokens * opusRate.output +
      cacheCreateTokens * opusRate.cacheCreate) /
    1_000_000
  );
}

function sumBy(calls: ApiCall[], pick: (call: ApiCall) => number): number {
  return calls.reduce((sum, call) => sum + pick(call), 0);
}

/**
 * Aggregates one measure over an already-scoped group. Activity measures
 * (token/count/cost) return 0 for an empty scope — a true "no activity"
 * fact. Measures whose backing field doesn't exist in any shipped parser yet
 * (#P4-11/#P4-13) return null — the "unavailable" signal, never fabricated
 * as 0. wallMinutes is the one turn-grain measure that's real today, since
 * Turn.startedAt/endedAt are always populated by deriveTurns.ts (unlike the
 * optional, still-unpopulated Turn.wallMs/gateStatus).
 */
export function computeMeasure(
  measure: Measure,
  scope: MeasureScope,
  pricing: PricingTable,
): number | null {
  switch (measure) {
    case "costComputed":
      return sumBy(scope.calls, (call) => priceCall(call, pricing));
    case "inputTokens":
      return sumBy(scope.calls, (call) => call.usage.inputTokens);
    case "outputTokens":
      return sumBy(scope.calls, (call) => call.usage.outputTokens);
    case "cacheReadTokens":
      return sumBy(scope.calls, (call) => call.usage.cacheReadTokens);
    case "cacheCreateTokens":
      return sumBy(scope.calls, (call) => call.usage.cacheCreateTokens);
    case "apiCalls":
      return scope.calls.length;
    case "turns":
      return scope.turns.length;
    case "sessions":
      return scope.sessions.length;
    case "toolCalls":
      return sumBy(scope.calls, (call) => call.tools.length);
    case "cacheHitPct": {
      const input = sumBy(scope.calls, (call) => call.usage.inputTokens);
      const cacheRead = sumBy(scope.calls, (call) => call.usage.cacheReadTokens);
      const cacheCreate = sumBy(scope.calls, (call) => call.usage.cacheCreateTokens);
      const eligible = input + cacheRead + cacheCreate;
      return eligible > 0 ? cacheRead / eligible : 0;
    }
    case "wallMinutes":
      // A malformed/empty startedAt or endedAt (toStr()-coerced by the parser
      // on a bad line) makes Date.parse -> NaN; skip that turn's contribution
      // rather than let it poison the whole bucket's sum (review finding H1).
      return scope.turns.reduce((sum, turn) => {
        const ms = Date.parse(turn.endedAt) - Date.parse(turn.startedAt);
        return sum + (Number.isFinite(ms) ? ms / 60_000 : 0);
      }, 0);
    case "toolErrors": {
      // Turn-grain only: calls don't have classified tool-result failure metadata.
      // Return null for call/distribution scopes that have no turns.
      if (scope.turns.length === 0) return null;
      return scope.turns.reduce((sum, turn) => sum + (turn.errorToolResults ?? 0), 0);
    }
    case "cacheSavingsComputed": {
      // Cache savings = (uncached cost at current model rates) - (actual cost).
      // Any unpriced call makes the whole bucket's result null.
      // Returns null for a completely empty call list too (no data → no savings claim).
      if (scope.calls.length === 0) return null;
      let savings = 0;
      for (const call of scope.calls) {
        const uncached = uncachedPrice(call, pricing);
        if (uncached === null) return null; // unpriced model poisons the whole bucket
        const actual = priceCall(call, pricing);
        savings += uncached - actual;
      }
      return savings;
    }
    case "routingSavingsComputed": {
      // Routing savings = (all-Opus uncached cost) - (actual cost).
      // Non-overlapping with cache savings: cacheSavings + routingSavings =
      //   (uncached - actual) + (opusUncached - actual)
      //   = opusUncached - actual  ← single counterfactual, no double-count
      // Opus is assumed to be in the pricing table (default entry always present).
      // Any unpriced call makes the whole bucket's result null.
      const opusRate = pricing["claude-opus-4-8"];
      if (!opusRate || scope.calls.length === 0) return null;
      let savings = 0;
      for (const call of scope.calls) {
        // opusUncachedPrice always succeeds (opusRate confirmed above).
        // But if the call's model is unpriced, actual cost is $0 and the
        // counterfactual savings claim is meaningless — poison the bucket.
        if (!(call.model in pricing)) return null;
        const actual = priceCall(call, pricing);
        savings += opusUncachedPrice(call, opusRate) - actual;
      }
      return savings;
    }
    case "costObserved":
    case "apiMs":
    case "linesAdded":
    case "linesRemoved":
    case "gatePassRate":
      return null;
  }
}
