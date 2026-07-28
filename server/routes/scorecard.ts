import type { FastifyInstance } from "fastify";
import type {
  BiggestLeverView,
  CacheCreationEntry,
  ScorecardFilters,
  SessionScorecardView,
  WasteEventKind,
} from "../../shared/scorecard-contract.js";
import { DEFAULT_PRICING_TABLE } from "../metrics/measures.js";
import {
  applyGrade,
  priceWasteEntry,
  resolveBands,
  selectBiggestLever,
} from "../scorecard/fleet.js";
import { getScorecardThresholds } from "../scorecard/thresholds.js";
import { readConfig } from "../settings.js";
import type { Store } from "../store/store.js";

/**
 * GET /api/sessions/:id/scorecard + GET /api/dashboard/biggest-lever
 * (ARCH-124-cache-scorecard.md §API Contracts, T5). Both routes read
 * cores the Store already cached (Module Boundaries rule 1: never
 * re-run `computeScorecard` here), resolve `scorecardThresholds` from
 * live config on every request (matching `routes/gates.ts`), read
 * **current** Store pricing (A14/#2 — never a startup closure), call
 * into `scorecard/fleet.ts` for calibration/grading/pricing/selection,
 * and stamp `evaluatedAt` at this serving layer (N3 — the engine and
 * fleet projector stay deterministic and clock-free).
 */

export interface RegisterScorecardRouteOptions {
  /** Override the config path — tests only; production uses `~/.claude-lens/config.json`. */
  configPath?: string;
}

/** `true` for a string `Date.parse` can turn into a real instant (mirrors `routes/metrics.ts`'s `isParseableDate`). */
function isParseableDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function splitFilterValue(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * Normalizes one querystring field into its CSV-split values. The client
 * always sends a single comma-joined string per key (`client/src/api/
 * scorecard.ts`'s `buildBiggestLeverQueryString`), but Fastify's default
 * querystring parser hands back a `string[]` for a *repeated* key
 * (`?project=a&project=b`) instead of the declared `string` type — an
 * unchecked cast on that shape previously threw inside `.split(",")`
 * (#124 review finding #17). Flatten either shape the same way.
 */
function normalizeFilterValue(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap(splitFilterValue);
}

/** Comma-separated querystring values, e.g. `?project=/a,/b`, into `ScorecardFilters`. */
function parseFilters(query: {
  project?: string | string[];
  model?: string | string[];
  branch?: string | string[];
  host?: string | string[];
}): ScorecardFilters {
  const filters: ScorecardFilters = {};
  const project = normalizeFilterValue(query.project);
  const model = normalizeFilterValue(query.model);
  const branch = normalizeFilterValue(query.branch);
  const host = normalizeFilterValue(query.host);
  if (project.length > 0) filters.project = project;
  if (model.length > 0) filters.model = model;
  if (branch.length > 0) filters.branch = branch;
  if (host.length > 0) filters.host = host;
  return filters;
}

function hasWasteKind(
  entry: CacheCreationEntry,
): entry is CacheCreationEntry & { kind: WasteEventKind } {
  return entry.kind !== null;
}

export function registerScorecardRoutes(
  app: FastifyInstance,
  store: Store,
  options: RegisterScorecardRouteOptions = {},
): void {
  const configPath = options.configPath;

  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/scorecard",
    async (
      request,
      reply,
    ): Promise<SessionScorecardView | { error: string; sessionId: string }> => {
      const sessionId = request.params.id;
      try {
        const core = store.getScorecardCore(sessionId);
        if (!core) {
          return reply.code(404).send({ error: "session not found", sessionId });
        }

        const thresholds = getScorecardThresholds(await readConfig(configPath));
        const pricing = store.getPricing() ?? DEFAULT_PRICING_TABLE;

        const gradeableScores = store
          .listScorecardScores()
          .filter((c) => c.mainThreadCalls >= thresholds.floorCalls && c.hygieneScore !== null)
          .map((c) => c.hygieneScore as number);
        const bands = resolveBands(gradeableScores, thresholds);
        const gradeState = applyGrade(core, bands, thresholds);

        const events = core.writes
          .filter(hasWasteKind)
          .map((entry) => priceWasteEntry(entry, sessionId, pricing));

        const view: SessionScorecardView = {
          core,
          events,
          thresholdsUsed: thresholds,
          evaluatedAt: new Date().toISOString(),
          ...gradeState,
        };

        return reply.code(200).send(view);
      } catch (err) {
        app.log.error({ err, sessionId }, "failed to evaluate scorecard");
        return reply.code(500).send({ error: "failed to evaluate scorecard", sessionId });
      }
    },
  );

  app.get<{
    Querystring: {
      from?: string;
      to?: string;
      project?: string | string[];
      model?: string | string[];
      branch?: string | string[];
      host?: string | string[];
    };
  }>(
    "/api/dashboard/biggest-lever",
    async (request, reply): Promise<BiggestLeverView | { error: string }> => {
      const { from, to } = request.query;
      if (!from || !to) {
        return reply.code(400).send({ error: "from and to are required" });
      }
      if (!isParseableDate(from) || !isParseableDate(to)) {
        return reply.code(400).send({ error: "from and to must be parseable date strings" });
      }
      if (Date.parse(from) > Date.parse(to)) {
        return reply.code(400).send({ error: "from must not be after to" });
      }

      try {
        const pricing = store.getPricing() ?? DEFAULT_PRICING_TABLE;
        const cores = store.listScorecardCores();
        const filters = parseFilters(request.query);

        const lever = selectBiggestLever(cores, { from, to }, filters, pricing);

        const view: BiggestLeverView = { ...lever, evaluatedAt: new Date().toISOString() };
        return reply.code(200).send(view);
      } catch (err) {
        app.log.error({ err }, "failed to select biggest lever");
        return reply.code(500).send({ error: "failed to select biggest lever" });
      }
    },
  );
}
