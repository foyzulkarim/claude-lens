import type { FastifyInstance } from "fastify";
import type { HealthSnapshot } from "../../shared/health-contract.js";
import type { Store } from "../store/store.js";

// GET /api/health — Data Health surfacing of `parse-premium.ts`'s
// `malformedCount` (review E1 — Critical finding of #P4-13 / #P4-14). The
// store accumulates per-file cumulative malformed-line counts as the
// pipeline parses each premium sidecar (C/B/L); this route exposes the
// rollup so the DataHealth page can render it. No aggregation happens
// here — Store.getHealthSnapshot() returns a pre-computed read-only
// snapshot in O(observed file count).
//
// Mirrors the simple `/api/ping` shape (no body, no validation) — the
// route exists purely to surface the in-memory state.

export function registerHealthRoute(app: FastifyInstance, store: Store): void {
  app.get("/api/health", async (): Promise<HealthSnapshot> => store.getHealthSnapshot());
}
