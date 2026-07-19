import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { SessionPageItem, SessionPopulationFilter } from "../../shared/sessions-contract.js";
import { applyRange } from "../metrics/session-population.js";
import type { Store } from "../store/store.js";
import { comparePageSessions, PAGE_SORT_KEYS, projectPageItem } from "./sessions.js";

// GET /api/export — streams the full matched Sessions-page population as
// CSV or JSON (ARCH-csv-json-export.md, #P4-17 / issue #49). Reuses the
// same population/sort/projection logic as GET /api/sessions?view=page
// (comparePageSessions, projectPageItem) so the export and the on-screen
// table can never disagree about which rows/order are "the current view".
// Deliberately does NOT accept offset/limit/include/sessionId — export is
// the whole filtered set, not a page or a compare selection.

type ExportFormat = "csv" | "json";
type ExportSortKey = NonNullable<
  import("../../shared/sessions-contract.js").SessionPageParams["sort"]
>;
type ExportOrder = "asc" | "desc";

export interface ExportParams {
  format: ExportFormat;
  from: string;
  to: string;
  sort: ExportSortKey;
  order: ExportOrder;
  project?: string[];
  model?: string[];
  branch?: string[];
  host?: string[];
  entrypoint?: string[];
  minCostComputed?: number;
  maxCostComputed?: number;
  hasDrilldown?: boolean;
}

const ORDER_KEYS = new Set<ExportOrder>(["asc", "desc"]);

/**
 * Parses the Fastify query object into a typed `ExportParams`. Same
 * "string-on-error, never-throws" contract as `parseSessionsPageQuery`.
 * `from`/`to` are required here (unlike the page route) — export has no
 * sensible "all time" default, and the client always resolves and sends a
 * concrete range.
 */
export function parseExportQuery(raw: unknown): ExportParams | string {
  if (raw === null || typeof raw !== "object") return "query must be an object";
  const q = raw as Record<string, unknown>;

  if (q.format !== "csv" && q.format !== "json") {
    return 'format must be "csv" or "json"';
  }
  const format = q.format;

  if (typeof q.from !== "string" || !Number.isFinite(Date.parse(q.from))) {
    return "from is required and must be a parseable ISO date string";
  }
  if (typeof q.to !== "string" || !Number.isFinite(Date.parse(q.to))) {
    return "to is required and must be a parseable ISO date string";
  }
  if (Date.parse(q.from) > Date.parse(q.to)) {
    return "from must be <= to";
  }
  const from = q.from;
  const to = q.to;

  let sort: ExportSortKey = "lastAt";
  if (q.sort !== undefined) {
    if (typeof q.sort !== "string" || !PAGE_SORT_KEYS.has(q.sort as ExportSortKey)) {
      return "sort must be one of the supported Sessions-page sort keys";
    }
    sort = q.sort as ExportSortKey;
  }

  let order: ExportOrder = "desc";
  if (q.order !== undefined) {
    if (typeof q.order !== "string" || !ORDER_KEYS.has(q.order as ExportOrder)) {
      return 'order must be "asc" or "desc"';
    }
    order = q.order as ExportOrder;
  }

  const params: ExportParams = { format, from, to, sort, order };

  for (const key of ["project", "model", "branch", "host", "entrypoint"] as const) {
    if (q[key] !== undefined) {
      if (typeof q[key] !== "string") {
        return `${key} must be a comma-separated string`;
      }
      const items = q[key]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (items.length === 0) {
        return `${key} must contain at least one non-empty value`;
      }
      params[key] = items;
    }
  }

  if (q.minCostComputed !== undefined) {
    if (typeof q.minCostComputed !== "string" && typeof q.minCostComputed !== "number") {
      return "minCostComputed must be a number";
    }
    const v = Number(q.minCostComputed);
    if (!Number.isFinite(v) || v < 0) {
      return "minCostComputed must be a finite non-negative number";
    }
    params.minCostComputed = v;
  }

  if (q.maxCostComputed !== undefined) {
    if (typeof q.maxCostComputed !== "string" && typeof q.maxCostComputed !== "number") {
      return "maxCostComputed must be a number";
    }
    const v = Number(q.maxCostComputed);
    if (!Number.isFinite(v) || v < 0) {
      return "maxCostComputed must be a finite non-negative number";
    }
    params.maxCostComputed = v;
  }

  if (
    params.minCostComputed !== undefined &&
    params.maxCostComputed !== undefined &&
    params.minCostComputed > params.maxCostComputed
  ) {
    return "minCostComputed must be <= maxCostComputed";
  }

  if (q.hasDrilldown !== undefined) {
    if (typeof q.hasDrilldown !== "string" && typeof q.hasDrilldown !== "boolean") {
      return "hasDrilldown must be a boolean";
    }
    const rawFlag = q.hasDrilldown;
    if (typeof rawFlag === "string") {
      if (rawFlag !== "true" && rawFlag !== "false") {
        return 'hasDrilldown must be "true" or "false" when present';
      }
      params.hasDrilldown = rawFlag === "true";
    } else {
      params.hasDrilldown = rawFlag;
    }
  }

  return params;
}

function toPopulationFilter(params: ExportParams): SessionPopulationFilter {
  const filter: SessionPopulationFilter = { range: { from: params.from, to: params.to } };
  if (params.project !== undefined) filter.project = params.project;
  if (params.model !== undefined) filter.model = params.model;
  if (params.branch !== undefined) filter.branch = params.branch;
  if (params.host !== undefined) filter.host = params.host;
  if (params.entrypoint !== undefined) filter.entrypoint = params.entrypoint;
  if (params.minCostComputed !== undefined) filter.minCostComputed = params.minCostComputed;
  if (params.maxCostComputed !== undefined) filter.maxCostComputed = params.maxCostComputed;
  if (params.hasDrilldown !== undefined) filter.hasDrilldown = params.hasDrilldown;
  return filter;
}

// ---------------------------------------------------------------------------
// CSV serialization (hand-rolled — no new dependency; ARCH decision A1)
// ---------------------------------------------------------------------------

const CSV_COLUMNS = [
  "sessionId",
  "project",
  "models",
  "branch",
  "host",
  "entrypoint",
  "version",
  "startedAt",
  "lastAt",
  "durationMs",
  "turnCount",
  "totalTokens",
  "cacheHitPct",
  "costComputed",
  "costObserved",
  "linesAdded",
  "linesRemoved",
  "contextPctEstimated",
  "gateScore",
  "hasDrilldown",
  "tierCostSamples",
  "tierTurnBoundaries",
  "tierCostLog",
] as const;

/** RFC4180 field quoting: wrap in quotes and double any inner quotes iff the
 * field contains a comma, quote, or newline. */
function csvField(value: unknown): string {
  const s = value === undefined || value === null ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(values: unknown[]): string {
  return `${values.map(csvField).join(",")}\r\n`;
}

function csvValue(item: SessionPageItem, column: (typeof CSV_COLUMNS)[number]): unknown {
  switch (column) {
    case "models":
      return item.models.join(";");
    case "tierCostSamples":
      return item.tier.hasCostSamples;
    case "tierTurnBoundaries":
      return item.tier.hasTurnBoundaries;
    case "tierCostLog":
      return item.tier.hasCostLog;
    default:
      return item[column];
  }
}

async function* csvStream(items: SessionPageItem[]): AsyncGenerator<string> {
  yield csvRow(CSV_COLUMNS as unknown as string[]);
  for (const item of items) {
    yield csvRow(CSV_COLUMNS.map((c) => csvValue(item, c)));
  }
}

// ---------------------------------------------------------------------------
// JSON serialization — full-fidelity SessionPageItem[], streamed row-by-row
// ---------------------------------------------------------------------------

async function* jsonStream(items: SessionPageItem[]): AsyncGenerator<string> {
  yield "[";
  for (let i = 0; i < items.length; i++) {
    yield `${i === 0 ? "" : ","}${JSON.stringify(items[i])}`;
  }
  yield "]";
}

function exportFilename(format: ExportFormat): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `sessions-export-${stamp}.${format}`;
}

export function registerExportRoute(app: FastifyInstance, store: Store): void {
  app.get("/api/export", async (request, reply) => {
    const parsed = parseExportQuery(request.query);
    if (typeof parsed === "string") {
      reply.code(400);
      return { error: parsed };
    }

    const filter = toPopulationFilter(parsed);
    const { matched } = applyRange(filter, store.listSessions());
    const sorted = [...matched].sort((a, b) =>
      comparePageSessions(a, b, parsed.sort, parsed.order),
    );
    const items = sorted.map(projectPageItem);

    const filename = exportFilename(parsed.format);
    reply.header("content-disposition", `attachment; filename="${filename}"`);

    if (parsed.format === "csv") {
      reply.header("content-type", "text/csv; charset=utf-8");
      return reply.send(Readable.from(csvStream(items)));
    }

    reply.header("content-type", "application/json; charset=utf-8");
    return reply.send(Readable.from(jsonStream(items)));
  });
}
