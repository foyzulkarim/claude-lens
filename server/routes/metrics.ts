import type { FastifyInstance } from "fastify";
import {
  DIMENSIONS,
  type Dimension,
  GRAINS,
  MEASURES,
  type Measure,
  type MetricsQuery,
} from "../../shared/metrics-contract.js";
import { metrics } from "../metrics/engine.js";
import { DEFAULT_PRICING_TABLE, type PricingTable } from "../metrics/measures.js";
import type { Store } from "../store/store.js";

// routes/ may only import store/ for data (architecture §3) — the metrics/
// engine is computation, not a data source, so it's fine to call directly.
// This route never touches ingest/ or the filesystem.

export interface RegisterMetricsRouteOptions {
  /**
   * Runtime pricing table (ARCH T5). The CLI builds one
   * `RuntimeMetadata` and threads its `pricing` here so every
   * `/api/metrics` request prices its calls identically to the way the
   * ingest Store priced them on derivation — preventing the
   * "store says $0, route says $0 from defaults, real catalog disagrees"
   * drift that motivated T5. Optional: when omitted (e.g. legacy
   * tests), falls back to `DEFAULT_PRICING_TABLE`.
   */
  pricing?: PricingTable;
}

const MEASURE_SET = new Set<Measure>(MEASURES);
const DIMENSION_SET = new Set<Dimension>(DIMENSIONS);
const GRAIN_SET = new Set<string>(GRAINS);

/** `true` for a string that `Date.parse` can turn into a real instant — a type-correct-but-unparseable range boundary must 400, not silently admit/exclude every call (review findings #2/typescript-strictness #2). */
function isParseableDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

/** Validates `filters`' keys/values match `BaseMetricsQuery["filters"]`'s shape — every key a known Dimension, every value a non-empty array of string|number. Closes the gap engine.ts's `callMatchesFilters` comment flagged as this task's job (review finding L6): unvalidated filters previously reached `matchesFilter`'s `allowed.map(String)` and threw on a non-array value instead of 400ing. */
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

/** A parse failure message, or the validated query on success — never throws. */
export function parseMetricsQuery(body: unknown): MetricsQuery | string {
  if (typeof body !== "object" || body === null) {
    return "request body must be an object";
  }
  const q = body as Record<string, unknown>;

  if (
    !Array.isArray(q.measures) ||
    q.measures.length === 0 ||
    !q.measures.every((m) => MEASURE_SET.has(m as Measure))
  ) {
    return "measures must be a non-empty array of known Measure values";
  }
  if (
    !Array.isArray(q.dimensions) ||
    !q.dimensions.every((d) => DIMENSION_SET.has(d as Dimension))
  ) {
    return "dimensions must be an array of known Dimension values";
  }
  if (typeof q.grain !== "string" || !GRAIN_SET.has(q.grain)) {
    return "grain must be one of hour, day, week, month";
  }
  if (
    typeof q.range !== "object" ||
    q.range === null ||
    typeof (q.range as Record<string, unknown>).from !== "string" ||
    typeof (q.range as Record<string, unknown>).to !== "string"
  ) {
    return "range must be an object with string from/to timestamps";
  }
  const range = q.range as Record<string, unknown>;
  if (!isParseableDate(range.from as string) || !isParseableDate(range.to as string)) {
    return "range.from and range.to must be parseable date strings";
  }
  if (q.mode !== undefined && q.mode !== "series" && q.mode !== "distribution") {
    return 'mode must be "series" or "distribution" when present';
  }
  if (
    q.mode === "distribution" &&
    q.distributionEntity !== "session" &&
    q.distributionEntity !== "turn" &&
    q.distributionEntity !== "call"
  ) {
    return 'distribution queries require distributionEntity to be "session", "turn", or "call"';
  }
  if (!isValidFilters(q.filters)) {
    return "filters must be an object mapping known Dimension keys to non-empty arrays of string|number";
  }

  return q as unknown as MetricsQuery;
}

export function registerMetricsRoute(
  app: FastifyInstance,
  store: Store,
  options: RegisterMetricsRouteOptions = {},
): void {
  // Resolve the runtime pricing once at registration time and close over it
  // for every request — the H-risk seam from T5's spec. Importing
  // `DEFAULT_PRICING_TABLE` here at request time would let a future
  // Settings-driven override silently disagree with the table the Store
  // used to derive `costComputed`, exactly the regression T5 is here to
  // prevent.
  const pricing = options.pricing ?? DEFAULT_PRICING_TABLE;

  app.post("/api/metrics", async (request, reply) => {
    const parsed = parseMetricsQuery(request.body);
    if (typeof parsed === "string") {
      reply.code(400);
      return { error: parsed };
    }

    const input = {
      calls: store.listCalls(),
      turns: store.listTurns(),
      sessions: store.listSessions(),
      pricing,
    };
    return metrics(input, parsed);
  });
}
