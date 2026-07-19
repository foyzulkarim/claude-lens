import type { FastifyInstance } from "fastify";
import { type AppConfig, isValidBudget } from "../../shared/settings-contract.js";
import { readConfig, writeConfig } from "../settings.js";

/**
 * GET/PUT /api/config — the minimal, budget-only config surface (#P4-10;
 * ARCH-trends-calendar-budget.md). #P4-15 extends this same route with
 * pricing, scan roots, and thresholds; this task's `PUT` body validation
 * intentionally only recognizes `budget` so it can never lock the schema
 * down for that later work.
 */

/**
 * Validates a `PUT /api/config` body into a typed patch. Returns either the
 * validated patch or a human-readable error message — never throws. Same
 * "validate, snapshot, delegate" shape as `routes/cache-lab.ts`'s
 * `parseCacheLabQuery`.
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
  return { budget: b.budget };
}

export interface RegisterConfigRouteOptions {
  /** Overrides the on-disk config path — tests only; production always uses `~/.claude-lens/config.json`. */
  configPath?: string;
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
      return await writeConfig(parsed, options.configPath);
    } catch (err) {
      app.log.error({ err }, "failed to write config");
      reply.code(500);
      return { error: "failed to save config" };
    }
  });
}
