import type { FastifyInstance } from "fastify";
import type { GateReport } from "../../shared/gates-contract.js";
import { evaluateSessionGates } from "../gates/engine.js";
import { getGateThresholds } from "../gates/thresholds.js";
import { readConfig } from "../settings.js";
import type { Store } from "../store/store.js";

/**
 * GET /api/sessions/:id/gates — Gates engine report for one session
 * (ARCH-gates-engine.md §API Contracts; #P4-11 / #P4-12).
 *
 * Reads the session snapshot from the store, resolves the user's
 * `gateThresholds` over the engine defaults via `getGateThresholds(await
 * readConfig())`, calls the async `evaluateSessionGates` (which awaits
 * the E1/E2 filesystem check), and stamps `evaluatedAt` (the engine is
 * deterministic per ARCH A12; the route carries the timestamp).
 *
 * 404 if the session is unknown; 200 + `GateReport` otherwise. E1/E2
 * filesystem failures are non-fatal — the gate reports them as evidence
 * with `warn`/`fail` status; the engine never throws on IO issues.
 */

export interface RegisterGatesRouteOptions {
  /** Override the config path — tests only; production uses `~/.claude-lens/config.json`. */
  configPath?: string;
  /**
   * Override the user-home directory used for E1/E2's `~/.claude/CLAUDE.md`
   * lookup. Defaults to `os.homedir()`. Tests pass a temp dir; production
   * never sets this.
   */
  userHomeDir?: string;
}

export function registerGatesRoute(
  app: FastifyInstance,
  store: Store,
  options: RegisterGatesRouteOptions = {},
): void {
  const configPath = options.configPath;
  const userHomeDir = options.userHomeDir;

  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/gates",
    async (request, reply): Promise<GateReport | { error: string; sessionId: string }> => {
      const sessionId = request.params.id;
      const snapshot = store.getSessionSnapshot(sessionId);
      if (!snapshot) {
        return reply.code(404).send({ error: "session not found", sessionId });
      }

      const config = await readConfig(configPath);
      const thresholds = getGateThresholds(config);

      const report = await evaluateSessionGates(
        {
          session: snapshot.session,
          turns: snapshot.turns,
          calls: snapshot.calls,
          toolResults: snapshot.toolResults,
          userHomeDir,
        },
        thresholds,
      );

      // Stamp `evaluatedAt` here — the engine returns an empty placeholder
      // by design (ARCH A12), keeping engine output fixture-regression
      // friendly across runs.
      const stamped: GateReport = {
        ...report,
        evaluatedAt: new Date().toISOString(),
      };

      return reply.code(200).send(stamped);
    },
  );
}
