import type { FastifyInstance } from "fastify";
import { DIMENSIONS, type Dimension, GRAINS, type Grain } from "../../shared/metrics-contract.js";
import type { CacheLabAnalysis, CacheLabQuery } from "../../shared/cache-lab-contract.js";
import { analyzeCacheLab } from "../cache/analysis.js";
import { DEFAULT_PRICING_TABLE, type PricingTable } from "../metrics/measures.js";
import type { Store } from "../store/store.js";

// POST /api/cache-lab — Cache Lab analysis (#P4-9, T3). Mirrors the
// metrics route's "validate, snapshot, delegate" pattern. The route
// never classifies or aggregates; that lives in server/cache/. The
// runtime pricing table is closed over at registration so a future
// Settings override (#P4-15) flows through this same seam and never
// disagrees with the Store's derivation.

const DIMENSION_SET = new Set<Dimension>(DIMENSIONS);
const GRAIN_SET = new Set<Grain>(GRAINS as Grain[]);

function isParseableDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function isValidFilters(filters: unknown): boolean {
  if (filters === undefined) return true;
  if (typeof filters !== "object" || filters === null || Array.isArray(filters)) return false;
  return Object.entries(filters).every(([key, values]) => {
    if (!DIMENSION_SET.has(key as Dimension)) return false;
    return (
      Array.isArray(values) &&
      values.length > 0 &&
      values.every((v) => typeof v === "string" || typeof v === "number")
    );
  });
}

/**
 * Validates a request body into a typed `CacheLabQuery`. Returns either
 * the validated query or a human-readable error message — never throws.
 * The shape mirrors `parseMetricsQuery` (same Fastify convention) so a
 * parallel `routes/{x}.ts` route tester learns one validator style.
 *
 * Rejection categories (every line below renders as a `400 { error }`):
 *   - non-object body
 *   - missing/unparseable or reversed range
 *   - unknown grain
 *   - unknown filter keys, empty filter arrays, non-scalar values
 */
export function parseCacheLabQuery(body: unknown): CacheLabQuery | string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "request body must be an object";
  }
  const q = body as Record<string, unknown>;

  const range = q.range as Record<string, unknown> | undefined;
  if (
    !range ||
    typeof range !== "object" ||
    typeof range.from !== "string" ||
    typeof range.to !== "string"
  ) {
    return "range must be an object with string from/to timestamps";
  }
  if (!isParseableDate(range.from) || !isParseableDate(range.to)) {
    return "range.from and range.to must be parseable date strings";
  }
  if (Date.parse(range.from) > Date.parse(range.to)) {
    return "range.from must be <= range.to";
  }

  if (typeof q.grain !== "string" || !GRAIN_SET.has(q.grain as Grain)) {
    return "grain must be one of hour, day, week, month";
  }

  if (!isValidFilters(q.filters)) {
    return "filters must be an object mapping known Dimension keys to non-empty arrays of string|number";
  }

  const result: CacheLabQuery = {
    range: { from: range.from, to: range.to },
    grain: q.grain as Grain,
    ...(q.filters !== undefined ? { filters: q.filters as CacheLabQuery["filters"] } : {}),
  };
  return result;
}

export interface RegisterCacheLabRouteOptions {
  /**
   * Runtime pricing table. The CLI builds one RuntimeMetadata at process
   * start and threads its `pricing` here so `/api/cache-lab` and the
   * Store's costComputed agree on rates. Optional: when omitted, falls
   * back to `DEFAULT_PRICING_TABLE` for tests that don't care about
   * pricing.
   */
  pricing?: PricingTable;
}

/**
 * Registers `POST /api/cache-lab`. The route validates the body, takes
 * one synchronous snapshot of the Store (calls + turns + sessions) and
 * hands the array snapshot plus runtime pricing to the analyzer. No
 * per-event Store lookup happens here — the analyzer is Store-
 * independent and reads the snapshot once.
 */
export function registerCacheLabRoute(
  app: FastifyInstance,
  store: Store,
  options: RegisterCacheLabRouteOptions = {},
): void {
  const pricing = options.pricing ?? DEFAULT_PRICING_TABLE;

  app.post("/api/cache-lab", async (request, reply): Promise<CacheLabAnalysis> => {
    const parsed = parseCacheLabQuery(request.body);
    if (typeof parsed === "string") {
      reply.code(400);
      return { error: parsed } as unknown as CacheLabAnalysis;
    }

    // Single Store snapshot per request — no lazy per-event reads.
    // The analyst walks arrays in-memory; this captures the exact
    // fleet state the analysis corresponds to so concurrent ingest
    // can't interleave mid-analysis.
    const input = {
      calls: store.listCalls(),
      turns: store.listTurns(),
      sessions: store.listSessions(),
      pricing,
    };
    return analyzeCacheLab(input, parsed);
  });
}
