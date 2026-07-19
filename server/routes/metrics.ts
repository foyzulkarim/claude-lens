import type { FastifyInstance } from "fastify";
import {
  DIMENSIONS,
  type Dimension,
  GRAINS,
  MEASURES,
  type Measure,
  type MetricsQuery,
  type ScatterMeasure,
  type ScatterMetricsQuery,
} from "../../shared/metrics-contract.js";
import type { SessionPopulationCriteria } from "../../shared/sessions-contract.js";
import { metrics } from "../metrics/engine.js";
import { DEFAULT_PRICING_TABLE, type PricingTable } from "../metrics/measures.js";
import { metricsScatter } from "../metrics/scatter.js";
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

// ---------------------------------------------------------------------------
// Session-population criteria validation (scatter path)
// ---------------------------------------------------------------------------

const SCATTER_PRESET_MEASURES: ReadonlySet<string> = new Set(["totalTokens"]);
const SCATTER_COMPARE_ID_MAX = 3;

function isFiniteCostBound(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Mirrors `server/metrics/session-population.ts`'s `matchSession`
 * validation surface — the route must 400 on malformed criteria before
 * dispatching, otherwise `matchSession` would silently accept bad data.
 * Pure, never throws: returns the typed criteria on success or a
 * human-readable error message on failure. */
function parseSessionPopulationCriteria(value: unknown): SessionPopulationCriteria | string {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "sessionPopulation must be an object";
  }
  const v = value as Record<string, unknown>;

  for (const key of ["project", "model", "branch", "host", "entrypoint", "gateStatus"] as const) {
    const raw = v[key];
    if (raw === undefined) continue;
    if (!Array.isArray(raw) || raw.length === 0 || !raw.every((x) => typeof x === "string")) {
      return `${key} must be a non-empty array of strings when present`;
    }
  }

  if (v.minCostComputed !== undefined && !isFiniteCostBound(v.minCostComputed)) {
    return "minCostComputed must be a finite number when present";
  }
  if (v.maxCostComputed !== undefined && !isFiniteCostBound(v.maxCostComputed)) {
    return "maxCostComputed must be a finite number when present";
  }
  if (
    v.minCostComputed !== undefined &&
    v.maxCostComputed !== undefined &&
    (v.minCostComputed as number) > (v.maxCostComputed as number)
  ) {
    return "minCostComputed must be <= maxCostComputed";
  }
  if (v.hasDrilldown !== undefined && typeof v.hasDrilldown !== "boolean") {
    return "hasDrilldown must be a boolean when present";
  }
  if (v.sessionId !== undefined) {
    if (
      !Array.isArray(v.sessionId) ||
      v.sessionId.length === 0 ||
      v.sessionId.length > SCATTER_COMPARE_ID_MAX ||
      !v.sessionId.every((x) => typeof x === "string")
    ) {
      return `sessionId must be a non-empty array of at most ${SCATTER_COMPARE_ID_MAX} strings when present`;
    }
    const unique = new Set(v.sessionId as string[]);
    if (unique.size !== v.sessionId.length) {
      return "sessionId must not contain duplicates";
    }
  }

  const criteria: SessionPopulationCriteria = {};
  for (const key of ["project", "model", "branch", "host", "entrypoint", "gateStatus"] as const) {
    const raw = v[key];
    if (Array.isArray(raw)) (criteria as Record<string, unknown>)[key] = raw as string[];
  }
  if (v.minCostComputed !== undefined) criteria.minCostComputed = v.minCostComputed as number;
  if (v.maxCostComputed !== undefined) criteria.maxCostComputed = v.maxCostComputed as number;
  if (v.hasDrilldown !== undefined) criteria.hasDrilldown = v.hasDrilldown as boolean;
  if (v.sessionId !== undefined) criteria.sessionId = v.sessionId as string[];
  return criteria;
}

function isScatterMeasure(value: unknown): value is ScatterMeasure {
  return (
    typeof value === "string" &&
    (MEASURE_SET.has(value as Measure) || SCATTER_PRESET_MEASURES.has(value))
  );
}

/** Validates the scatter-specific request fields (mode/entity/xMeasure/
 * yMeasure/sizeMeasure/sessionPopulation). Returns the typed query on
 * success or an error message on failure — never throws. The base
 * `measures`/`dimensions`/`grain`/`range` validation is shared with the
 * aggregate path above. */
function parseScatterQueryFields(q: Record<string, unknown>): ScatterMetricsQuery | string {
  if (q.entity !== "session") {
    return 'scatter queries require entity to be "session"';
  }
  if (!isScatterMeasure(q.xMeasure)) {
    return "xMeasure must be a known Measure value or the scatter-only preset 'totalTokens'";
  }
  if (!isScatterMeasure(q.yMeasure)) {
    return "yMeasure must be a known Measure value or the scatter-only preset 'totalTokens'";
  }
  if (q.sizeMeasure !== undefined && !isScatterMeasure(q.sizeMeasure)) {
    return "sizeMeasure must be a known Measure value or the scatter-only preset 'totalTokens' when present";
  }
  const sessionPopulation = parseSessionPopulationCriteria(q.sessionPopulation);
  if (typeof sessionPopulation === "string") return sessionPopulation;

  return {
    mode: "scatter",
    entity: "session",
    measures: [
      q.xMeasure,
      q.yMeasure,
      ...(q.sizeMeasure !== undefined ? [q.sizeMeasure as ScatterMeasure] : []),
    ],
    dimensions: [],
    grain: q.grain as ScatterMetricsQuery["grain"],
    range: q.range as ScatterMetricsQuery["range"],
    xMeasure: q.xMeasure as ScatterMeasure,
    yMeasure: q.yMeasure as ScatterMeasure,
    ...(q.sizeMeasure !== undefined ? { sizeMeasure: q.sizeMeasure as ScatterMeasure } : {}),
    sessionPopulation,
  };
}

/** A parse failure message, or the validated query on success — never throws. */
export function parseMetricsQuery(body: unknown): MetricsQuery | string {
  if (typeof body !== "object" || body === null) {
    return "request body must be an object";
  }
  const q = body as Record<string, unknown>;

  if (!Array.isArray(q.measures) || q.measures.length === 0) {
    return "measures must be a non-empty array of known Measure values";
  }
  if (q.mode !== "scatter" && !q.measures.every((m) => MEASURE_SET.has(m as Measure))) {
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
  if (
    q.mode !== undefined &&
    q.mode !== "series" &&
    q.mode !== "distribution" &&
    q.mode !== "scatter"
  ) {
    return 'mode must be "series", "distribution", or "scatter" when present';
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

  // Scatter path is a discriminated sub-parser: same measures/dimensions/
  // grain/range validation as above (so an invalid scatter request 400s
  // before reaching the scatter field check), plus scatter-specific field
  // validation. The result is a `ScatterMetricsQuery` rather than the
  // shared union so the route can dispatch to the right helper below.
  if (q.mode === "scatter") {
    return parseScatterQueryFields(q);
  }

  const filters = q.filters as MetricsQuery["filters"];
  const base = {
    measures: q.measures as Measure[],
    dimensions: q.dimensions as Dimension[],
    grain: q.grain as MetricsQuery["grain"],
    range: q.range as MetricsQuery["range"],
    ...(filters !== undefined ? { filters } : {}),
  };
  if (q.mode === "distribution") {
    const sessionPopulation = parseSessionPopulationCriteria(q.sessionPopulation);
    if (typeof sessionPopulation === "string") return sessionPopulation;
    return {
      ...base,
      mode: "distribution",
      distributionEntity: q.distributionEntity as "session" | "turn" | "call",
      ...(q.sessionPopulation !== undefined ? { sessionPopulation } : {}),
    };
  }
  return {
    ...base,
    mode: "series",
    ...(q.compare === "previous-period" ? { compare: q.compare } : {}),
    ...(q.smoothing === "ma7" || q.smoothing === "none" ? { smoothing: q.smoothing } : {}),
  };
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

    // Scatter returns its own discriminated response (`ScatterMetricsResult`);
    // every other mode still returns `Series[]` — preserving the existing
    // `metrics()` return-type contract for Dashboard callers (ARCH A4).
    if (parsed.mode === "scatter") {
      return metricsScatter(input, parsed);
    }
    return metrics(input, parsed);
  });
}
