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
import type { ScanRootConfig } from "../shared/settings-contract.js";
import { DEFAULT_PRICING_TABLE, type PricingTable, priceUsage } from "./metrics/measures.js";
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
  /**
   * Active scan roots (#P4-14, Data Health §2). Surfaced on the page
   * so the user can see which directories are being polled; defaults
   * to `[]` when not configured (the page then renders a CTA to
   * open Settings). Mirrors how `pricing` is threaded — single
   * source of truth per process, never duplicated per consumer.
   */
  scanRoots?: ScanRootConfig[];
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

/**
 * Builds the root-path -> label lookup the Store uses to resolve
 * `Session.host` (ARCH-settings-local-store.md). Called once at CLI boot
 * and again on every `PUT /api/config` that changes `scanRoots`, feeding
 * `Store.updateHostLabels()` — a relabel takes effect on the next session
 * recompute, no restart needed. Roots without a `label` are simply absent
 * from the map; `deriveSession` falls back to the raw root path.
 */
export function buildHostLabels(scanRoots: ScanRootConfig[] = []): Map<string, string> {
  const labels = new Map<string, string>();
  for (const root of scanRoots) {
    if (root.label) labels.set(root.path, root.label);
  }
  return labels;
}
