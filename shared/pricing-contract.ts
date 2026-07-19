/**
 * Pricing table wire contract (ARCH-settings-local-store.md; architecture
 * §9). Moved out of `server/metrics/measures.ts` — a rate shape edited by
 * both the client's pricing editor (#P4-15) and the server's ingest pricer
 * is a contract, not server-internal code. `measures.ts` re-exports these
 * types unchanged so its 11 existing importers need no changes.
 */

/** $ per 1,000,000 tokens, per rate category. */
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

const RATE_FIELDS = ["input", "output", "cacheRead", "cacheCreate"] as const;

/**
 * Known model keys the server ships with default pricing entries
 * (`server/metrics/measures.ts`'s `DEFAULT_PRICING_TABLE`). Exported from the
 * shared contract so the client pricing editor (#P4-15) and the server's
 * default pricing table can never drift — adding a model server-side makes
 * the editor's "ships with defaults" list pick it up automatically.
 */
export const DEFAULT_MODEL_KEYS = [
  "claude-sonnet-5",
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-haiku-4-5",
] as const;

function isValidModelRate(value: unknown): value is ModelRate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(RATE_FIELDS as readonly string[]).includes(key)) return false;
  }
  for (const field of RATE_FIELDS) {
    const v = record[field];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return false;
  }
  return true;
}

/**
 * Validates a `PUT /api/config` `pricing` field: an object keyed by model
 * name, each value a complete `ModelRate` (all 4 fields required — partial
 * rates aren't representable). Unknown fields on a rate, or a rate missing
 * a required field, are rejected so a typo surfaces as 400, not a silent
 * $0 rate.
 */
export function isValidPricingTable(value: unknown): value is PricingTable {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  for (const model of Object.keys(record)) {
    if (!isValidModelRate(record[model])) return false;
  }
  return true;
}
