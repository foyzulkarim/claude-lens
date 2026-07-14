import type { FastifyInstance } from "fastify";
import type { Dimension, Grain, Measure, MetricsQuery } from "../../shared/metrics-contract.js";
import { metrics } from "../metrics/engine.js";
import { DEFAULT_PRICING_TABLE } from "../metrics/measures.js";
import type { Store } from "../store/store.js";

// routes/ may only import store/ for data (architecture §3) — the metrics/
// engine is computation, not a data source, so it's fine to call directly.
// This route never touches ingest/ or the filesystem.

const MEASURES = new Set<Measure>([
  "costComputed",
  "costObserved",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheCreateTokens",
  "apiCalls",
  "turns",
  "sessions",
  "toolCalls",
  "cacheHitPct",
  "wallMinutes",
  "apiMs",
  "linesAdded",
  "linesRemoved",
  "gatePassRate",
]);

const DIMENSIONS = new Set<Dimension>([
  "time",
  "project",
  "model",
  "gitBranch",
  "version",
  "entrypoint",
  "sidechain",
  "tool",
  "gateStatus",
  "host",
]);

const GRAINS = new Set<Grain>(["hour", "day", "week", "month"]);

/** A parse failure message, or `undefined` on success — never throws. */
export function parseMetricsQuery(body: unknown): MetricsQuery | string {
  if (typeof body !== "object" || body === null) {
    return "request body must be an object";
  }
  const q = body as Record<string, unknown>;

  if (
    !Array.isArray(q.measures) ||
    q.measures.length === 0 ||
    !q.measures.every((m) => MEASURES.has(m as Measure))
  ) {
    return "measures must be a non-empty array of known Measure values";
  }
  if (!Array.isArray(q.dimensions) || !q.dimensions.every((d) => DIMENSIONS.has(d as Dimension))) {
    return "dimensions must be an array of known Dimension values";
  }
  if (typeof q.grain !== "string" || !GRAINS.has(q.grain as Grain)) {
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
      calls: store.listAllCalls(),
      turns: store.listAllTurns(),
      sessions: store.listSessions(),
      pricing: DEFAULT_PRICING_TABLE,
    };
    return metrics(input, parsed);
  });
}
