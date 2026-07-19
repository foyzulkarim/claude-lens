import type { FastifyInstance } from "fastify";
import {
  type AppConfig,
  isValidAnomalyFactor,
  isValidBudget,
  isValidGateThresholds,
  isValidPricingTable,
  isValidScanRoots,
} from "../../shared/settings-contract.js";
import { buildHostLabels, buildRuntimeMetadata } from "../runtime.js";
import { readConfig, writeConfig } from "../settings.js";
import type { Store } from "../store/store.js";

/**
 * GET/PUT /api/config — the budget + gate-thresholds config surface
 * (#P4-10 + #P4-11; ARCH-trends-calendar-budget.md, ARCH-gates-engine.md).
 * `budget` is still required in PUT bodies (existing #P4-10 / BurnRateCard
 * contract); `gateThresholds` is an optional addition. #P4-15 extends this
 * same route further (pricing, scan roots, saved views, tags) — adding an
 * optional field here cannot lock the schema down for that later work.
 */

/**
 * Validates a `PUT /api/config` body into a typed patch. Returns either the
 * validated patch or a human-readable error message — never throws. Same
 * "validate, snapshot, delegate" shape as `routes/cache-lab.ts`'s
 * `parseCacheLabQuery`.
 *
 * `budget` is required (preserves the existing #P4-10 / BurnRateCard
 * contract). `gateThresholds` is optional; when present, every present
 * field is validated. An empty object `{}` resets to defaults — useful
 * for "I want a clean slate" without dropping the whole field.
 */
export function parseConfigPatch(body: unknown): Partial<AppConfig> | string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "request body must be an object";
  }
  const b = body as Record<string, unknown>;
  if (!("budget" in b)) return "request body must include a budget field";
  if (!isValidBudget(b.budget)) {
    return "budget must be null or a finite number greater than 0";
  }

  const patch: Partial<AppConfig> = { budget: b.budget };

  if ("gateThresholds" in b) {
    if (!isValidGateThresholds(b.gateThresholds)) {
      return (
        "gateThresholds must be an object with valid non-negative integer fields " +
        "(v2Repeat, c3MaxChars, k2Spike, e2MaxChars, e2MaxLines); " +
        "use {} to reset to defaults"
      );
    }
    patch.gateThresholds = b.gateThresholds;
  }

  if ("pricing" in b) {
    if (!isValidPricingTable(b.pricing)) {
      return (
        "pricing must be an object keyed by model name, each value a complete rate " +
        "(input, output, cacheRead, cacheCreate — all finite numbers >= 0)"
      );
    }
    patch.pricing = b.pricing;
  }

  if ("scanRoots" in b) {
    if (!isValidScanRoots(b.scanRoots)) {
      return "scanRoots must be an array of {path: string, label?: string} with non-empty values";
    }
    patch.scanRoots = b.scanRoots;
  }

  if ("anomalyFactor" in b) {
    if (!isValidAnomalyFactor(b.anomalyFactor)) {
      return "anomalyFactor must be a finite number greater than 0";
    }
    patch.anomalyFactor = b.anomalyFactor;
  }

  return patch;
}

export interface RegisterConfigRouteOptions {
  /** Overrides the on-disk config path — tests only; production always uses `~/.claude-lens/config.json`. */
  configPath?: string;
  /**
   * When provided, a PUT that changes `pricing` or `scanRoots` propagates
   * live into the running ingest Store (ARCH-settings-local-store.md A1) —
   * `pricing` via `Store.updatePricing()`, `scanRoots` via
   * `Store.updateHostLabels()`. The two paths are intentionally asymmetric:
   * `updatePricing` marks every session dirty so the debounced
   * `session-updated` flush recomputes each session with new inputs;
   * `updateHostLabels` patches `Session.host` in place and fires an
   * immediate `scan-updated` invalidation, since only the host label
   * changed and every already-mounted page should refetch the new value
   * (review #19). Both routes meet the acceptance criterion
   * "without restart". Optional so route tests that don't care about live
   * propagation can omit it.
   */
  store?: Store;
}

export function registerConfigRoute(
  app: FastifyInstance,
  options: RegisterConfigRouteOptions = {},
): void {
  app.get("/api/config", async (): Promise<AppConfig> => readConfig(options.configPath));

  app.put("/api/config", async (request, reply): Promise<AppConfig | { error: string }> => {
    const parsed = parseConfigPatch(request.body);
    if (typeof parsed === "string") {
      reply.code(400);
      return { error: parsed };
    }
    try {
      const merged = await writeConfig(parsed, options.configPath);
      if (options.store) {
        if (parsed.pricing !== undefined) {
          options.store.updatePricing(buildRuntimeMetadata({ pricing: merged.pricing }));
        }
        if (parsed.scanRoots !== undefined) {
          options.store.updateHostLabels(buildHostLabels(merged.scanRoots));
        }
      }
      return merged;
    } catch (err) {
      app.log.error({ err }, "failed to write config");
      reply.code(500);
      return { error: "failed to save config" };
    }
  });
}
