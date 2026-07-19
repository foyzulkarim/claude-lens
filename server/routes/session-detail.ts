import type { FastifyInstance } from "fastify";
import type {
  SessionDetailError,
  SessionDetailResponse,
} from "../../shared/session-detail-contract.js";
import { projectSessionDetail, type RuntimeMetadata } from "../session-detail/projector.js";
import type { Pricer } from "../store/derive-session.js";
import { buildFleetBaselines } from "../store/fleet-baselines.js";
import type { Store } from "../store/store.js";

// GET /api/sessions/:id — Session Detail (ARCH T5 / #P4-5).
//
// One snapshot per request, served from `Store.getSessionSnapshot` after a
// synchronous recompute so the response is internally atomic regardless of
// the WS/debounce state. The route never re-reads the filesystem and never
// performs cross-session aggregation beyond the fleet baseline that the
// metrics engine already maintains.

export interface RegisterSessionDetailRouteOptions {
  pricer?: Pricer;
  /** Context-window resolver — when omitted, `timeline.contextPct` is null. */
  contextResolver?: (model: string) => number | null;
}

export function registerSessionDetailRoute(
  app: FastifyInstance,
  store: Store,
  options: RegisterSessionDetailRouteOptions = {},
): void {
  const pricer = options.pricer;
  const runtime: RuntimeMetadata = {
    pricer,
    contextResolver: options.contextResolver,
  };

  app.get<{ Params: { id: string } }>("/api/sessions/:id", async (request, reply) => {
    const sessionId = request.params.id;
    // ID is only ever used as a Map key — never interpolated into a
    // filesystem path or any other resource locator.
    const snapshot = store.getSessionSnapshot(sessionId);
    if (!snapshot) {
      const body: SessionDetailError = { error: "session not found", sessionId };
      return reply.code(404).send(body);
    }

    const baselines = buildFleetBaselines(store, pricer);
    const response: SessionDetailResponse = projectSessionDetail(
      snapshot,
      baselines.fleetTurnCosts,
      baselines.fleetSessionCosts,
      runtime,
    );

    return reply.code(200).send(response);
  });
}
