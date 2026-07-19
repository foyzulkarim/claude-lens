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
 * 404 if the session is unknown; 200 + `GateReport` otherwise.
 *
 * Errors per ARCH §HTTP errors: any uncaught engine / IO / store
 * failure surfaces as HTTP 500 with `{ error, cause, sessionId }`. The
 * engine never throws on E1/E2 IO itself (those are classified as
 * `warn` / `fail` evidence per ARCH §Cross-Cutting Concerns), so this
 * catch is defense-in-depth — a future refactor that lets an error
 * escape the engine would still produce the documented wire shape
 * rather than Fastify's default `{statusCode, error, message}`. The
 * `sessionId` field in the 500 body lets the UI cross-reference the
 * failed report.
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
    async (
      request,
      reply,
    ): Promise<
      | GateReport
      | { error: string; sessionId: string }
      | { error: string; cause: string; sessionId: string }
    > => {
      const sessionId = request.params.id;
      try {
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

        // Stamp `evaluatedAt` here — the engine returns the report
        // sans timestamp by design (ARCH A12), keeping engine output
        // fixture-regression friendly across runs.
        const stamped: GateReport = {
          ...report,
          evaluatedAt: new Date().toISOString(),
        };

        return reply.code(200).send(stamped);
      } catch (err) {
        // Defense-in-depth: the engine currently never throws on user
        // data, but a future refactor that lets an IO or parse error
        // escape would otherwise surface as Fastify's default
        // `{statusCode, error, message}` shape — silently violating
        // ARCH §HTTP errors. Translate here so the wire contract is
        // consistent regardless of where the error originates.
        app.log.error({ err, sessionId }, "failed to evaluate gates");
        return reply.code(500).send({
          error: "failed to evaluate gates",
          cause: err instanceof Error ? err.message : String(err),
          sessionId,
        });
      }
    },
  );
}
