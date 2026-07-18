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
import { DEFAULT_PRICING_TABLE, priceUsage, type PricingTable } from "./metrics/measures.js";
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
 *
 * Review #8: `pricer` delegates to `priceUsage(usage, model, pricing)` (the
 * single-source primitive also used by `priceCall`) rather than hand-
 * copying the formula. A future pricing change (rounding, new token
 * category) now has one site to land.
 */
export function buildRuntimeMetadata(overrides: Partial<RuntimeMetadata> = {}): RuntimeMetadata {
  const pricing = overrides.pricing ?? DEFAULT_PRICING_TABLE;
  const pricer: Pricer = (usage, model) => priceUsage(usage, model, pricing);
  const contextResolver = overrides.contextResolver ?? ((model) => resolveContextWindow(model));
  return { pricing, pricer, contextResolver };
}
