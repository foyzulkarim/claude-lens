import type { FastifyInstance } from "fastify";
import type { VersionSnapshot } from "../../shared/version-contract.js";

// GET /api/version — mirrors the simple `/api/ping`/`/api/capture-assets`
// shape (no body, no validation); the route exists purely to surface
// `version-check.ts`'s in-memory snapshot so the sidebar can render an
// "update available" badge.

export interface RegisterVersionRouteOptions {
  getSnapshot: () => VersionSnapshot;
}

export function registerVersionRoute(
  app: FastifyInstance,
  options: RegisterVersionRouteOptions,
): void {
  app.get("/api/version", async (): Promise<VersionSnapshot> => options.getSnapshot());
}
