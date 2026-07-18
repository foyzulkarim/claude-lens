/**
 * Runtime metadata shared between the ingest Store and the Fastify HTTP
 * routes. ARCH T5 (Dashboard / issue #34): one PricingTable + one
 * ContextResolver must be built exactly once in the CLI process and passed
 * into both the ingest pipeline and the metrics route so derived sessions
 * and `/api/metrics` aggregations can never disagree about prices.
 *
 * Replacing this seam in #P4-15's Settings work only requires the CLI to
 * call `buildRuntimeMetadata(custom)` once with the user's overrides —
 * every downstream consumer reads the same shape.
 */
import { DEFAULT_PRICING_TABLE, type PricingTable } from "./metrics/measures.js";
import { resolveContextWindow } from "./metrics/model-metadata.js";
import type { ContextResolver, Pricer } from "./store/derive-session.js";

export interface RuntimeMetadata {
  /**
   * Pricing table used by both the ingest Store (for `costComputed`,
   * `cacheSavingsComputed`, `maxTurnCostComputed`) and the metrics route
   * (for the same measures over time-bucketed aggregates). One instance —
   * never duplicated per consumer.
   */
  pricing: PricingTable;
  /**
   * Built from `pricing`. Stored once on the Store so `deriveSession`'s
   * per-call `costComputed` accumulation reads the same rates as the
   * `pricing` table the metrics engine reads.
   */
  pricer: Pricer;
  /**
   * Resolves a model's context window in tokens. Forwarded to the Store
   * so `deriveSession`'s `contextPctEstimated` works in production.
   */
  contextResolver: ContextResolver;
}

/**
 * Build the default runtime metadata: V2 placeholder pricing + the
 * local model-metadata catalog. The CLI calls this once at startup.
 *
 * Partial overrides are deep-merged — passing only `{ pricing }` keeps the
 * default resolver; the `pricer` is always rebuilt from the final
 * `pricing` so the two never drift.
 */
export function buildRuntimeMetadata(overrides: Partial<RuntimeMetadata> = {}): RuntimeMetadata {
  const pricing = overrides.pricing ?? DEFAULT_PRICING_TABLE;
  const pricer: Pricer = (usage, model) => {
    const rate = pricing[model];
    if (!rate) return 0;
    // Mirrors `priceCall` from measures.ts: rate-per-1M-token * tokens / 1M.
    // Kept inline so the runtime doesn't synthesize a fake ApiCall just to
    // reuse the public `priceCall(call, pricing)` shape.
    return (
      (usage.inputTokens * rate.input +
        usage.outputTokens * rate.output +
        usage.cacheReadTokens * rate.cacheRead +
        usage.cacheCreateTokens * rate.cacheCreate) /
      1_000_000
    );
  };
  const contextResolver = overrides.contextResolver ?? ((model) => resolveContextWindow(model));
  return { pricing, pricer, contextResolver };
}
