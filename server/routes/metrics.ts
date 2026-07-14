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
import { DEFAULT_PRICING_TABLE } from "../metrics/measures.js";
import type { Store } from "../store/store.js";

// routes/ may only import store/ for data (architecture §3) — the metrics/
// engine is computation, not a data source, so it's fine to call directly.
// This route never touches ingest/ or the filesystem.

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

export function registerMetricsRoute(app: FastifyInstance, store: Store): void {
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
      pricing: DEFAULT_PRICING_TABLE,
    };
    return metrics(input, parsed);
  });
}
