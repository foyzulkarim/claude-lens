import type { FastifyInstance } from "fastify";
import type {
  TurnInspectorError,
  TurnInspectorResponse,
  TurnTranscriptPeekError,
  TurnTranscriptPeekResponse,
} from "../../shared/turn-inspector-contract.js";
import type { Pricer } from "../store/derive-session.js";
import { buildFleetBaselines } from "../store/fleet-baselines.js";
import { groupLogicalTurns } from "../store/logical-turns.js";
import type { Store } from "../store/store.js";
import { projectTurnInspector, type RuntimeMetadata } from "../turn-inspector/projector.js";
import { buildTranscriptPeek } from "../turn-inspector/transcript-peek.js";

// GET /api/sessions/:id/turns/:n and GET /api/sessions/:id/transcript?turn=n
// — Turn Inspector (ARCH-turn-inspector-page.md / #P4-6). Mirrors
// `routes/session-detail.ts`'s shape: one atomic snapshot per request, no
// cross-session aggregation beyond the shared fleet baseline.

export interface RegisterTurnInspectorRouteOptions {
  pricer?: Pricer;
  contextResolver?: (model: string) => number | null;
}

function parseTurnNumber(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function registerTurnInspectorRoute(
  app: FastifyInstance,
  store: Store,
  options: RegisterTurnInspectorRouteOptions = {},
): void {
  const pricer = options.pricer;
  const runtime: RuntimeMetadata = {
    pricer,
    contextResolver: options.contextResolver,
  };

  app.get<{ Params: { id: string; n: string } }>(
    "/api/sessions/:id/turns/:n",
    async (request, reply) => {
      const sessionId = request.params.id;
      const turnNumber = parseTurnNumber(request.params.n);

      const snapshot = store.getSessionSnapshot(sessionId);
      if (!snapshot) {
        const body: TurnInspectorError = { error: "session not found", sessionId };
        return reply.code(404).send(body);
      }
      if (turnNumber === null) {
        const body: TurnInspectorError = { error: "turn not found", sessionId };
        return reply.code(404).send(body);
      }

      const baselines = buildFleetBaselines(store, pricer);
      const response = projectTurnInspector(
        snapshot,
        turnNumber,
        baselines.fleetTurnCosts,
        runtime,
      );
      if (!response) {
        const body: TurnInspectorError = { error: "turn not found", sessionId, turnNumber };
        return reply.code(404).send(body);
      }

      const ok: TurnInspectorResponse = response;
      return reply.code(200).send(ok);
    },
  );

  app.get<{ Params: { id: string }; Querystring: { turn?: string } }>(
    "/api/sessions/:id/transcript",
    async (request, reply) => {
      const sessionId = request.params.id;
      const turnNumber = parseTurnNumber(request.query.turn ?? "");

      const snapshot = store.getSessionSnapshot(sessionId);
      if (!snapshot) {
        const body: TurnTranscriptPeekError = { error: "session not found", sessionId };
        return reply.code(404).send(body);
      }
      if (turnNumber === null) {
        const body: TurnTranscriptPeekError = { error: "turn not found", sessionId };
        return reply.code(404).send(body);
      }

      const group = groupLogicalTurns(snapshot.turns).find((t) => t.turnNumber === turnNumber);
      if (!group) {
        const body: TurnTranscriptPeekError = { error: "turn not found", sessionId, turnNumber };
        return reply.code(404).send(body);
      }

      const transcriptPath = store.getTranscriptPath(sessionId);
      if (!transcriptPath) {
        const body: TurnTranscriptPeekError = {
          error: "transcript unavailable",
          sessionId,
          turnNumber,
        };
        return reply.code(404).send(body);
      }

      const peek = await buildTranscriptPeek(
        transcriptPath,
        group.startedAt ?? "",
        group.endedAt ?? "",
      );
      if (!peek) {
        const body: TurnTranscriptPeekError = {
          error: "transcript unavailable",
          sessionId,
          turnNumber,
        };
        return reply.code(404).send(body);
      }

      const ok: TurnTranscriptPeekResponse = peek;
      return reply.code(200).send(ok);
    },
  );
}
