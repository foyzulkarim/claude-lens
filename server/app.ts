import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { createGatesCache, type GatesCache } from "./cache/gates-cache.js";
import { getGateThresholds } from "./gates/thresholds.js";
import type { PipelineStats } from "./pipeline-stats.js";
import { registerCacheLabRoute } from "./routes/cache-lab.js";
import { registerConfigRoute } from "./routes/config.js";
import { registerExportRoute } from "./routes/export.js";
import { registerGatesRoute } from "./routes/gates.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerMetricsRoute } from "./routes/metrics.js";
import { registerSearchRoute } from "./routes/search.js";
import { registerSessionDetailRoute } from "./routes/session-detail.js";
import { registerSessionsRoute } from "./routes/sessions.js";
import { registerTagsRoute } from "./routes/tags.js";
import { registerTurnInspectorRoute } from "./routes/turn-inspector.js";
import { registerViewsRoute } from "./routes/views.js";
import type { RuntimeMetadata } from "./runtime.js";
import { readConfig } from "./settings.js";
import type { Store } from "./store/store.js";
import { type Broadcaster, createBroadcaster } from "./ws/broadcaster.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "public");
// dist/public only exists in a production build; in dev, Vite serves the
// client on its own port and proxies /api + /ws here, so skip static serving.
const hasStaticAssets = existsSync(publicDir);

// Browsers don't apply Same-Origin Policy to WebSocket handshakes, so any
// page open in the user's browser could otherwise connect to this socket
// just because claude-lens happens to be running. Loopback hostnames only;
// missing Origin (non-browser clients, e.g. tooling) is allowed through.
const ALLOWED_ORIGIN_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

// Exported for direct unit testing of the allowlist (the /ws origin guard is
// security-relevant and easy to regress silently otherwise).
export function isAllowedOrigin(origin: string): boolean {
  try {
    return ALLOWED_ORIGIN_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export interface BuildAppOptions {
  store: Store;
  /**
   * The invalidation-bus fan-out (architecture §7). `cli.ts` passes the same
   * instance it wired into `startIngest`'s `onInvalidate`, so ingest events
   * reach every connected `/ws` socket. Optional so `buildApp({ store })`
   * callers (e.g. route tests that never exercise the socket) stay valid; when
   * omitted, `/ws` still works against a self-contained broadcaster that simply
   * has no producer feeding it.
   */
  broadcaster?: Broadcaster;
  /**
   * Runtime pricing + context metadata (ARCH T5). When provided, the
   * metrics route uses this `pricing` table instead of importing the
   * module-level default at request time — so derived sessions and
   * `/api/metrics` aggregations can never disagree about prices. Optional
   * for backward compatibility: existing `buildApp({ store })` callers
   * (route tests that don't care about pricing) keep their default
   * behavior.
   */
  metadata?: RuntimeMetadata;
  /**
   * Override the server logger. Defaults to a pino-pretty transport for the
   * CLI; pass `false` in tests to skip it — each pretty transport spawns a
   * worker thread and registers a persistent `process` exit listener, which
   * accumulate across a suite that builds many apps (MaxListeners warning).
   */
  logger?: FastifyServerOptions["logger"];
  /**
   * Overrides `~/.claude-lens/config.json`'s path for `GET/PUT /api/config`
   * (#P4-10). Tests point this at a temp file so route tests never touch
   * the real user config; production (`cli.ts`) never sets it.
   */
  configPath?: string;
  /**
   * Overrides the user-home directory used by the gates engine's E1/E2
   * check (`~/.claude/CLAUDE.md` lookup). Tests point this at a temp
   * dir so the engine doesn't read the real user config; production
   * (`cli.ts`) never sets it.
   */
  userHomeDir?: string;
  /**
   * Overrides `~/.claude-lens/local.json`'s path (#P4-15) — tests point
   * this at a temp file so route tests never touch the real user
   * local-store; production (`cli.ts`) never sets it.
   */
  localStorePath?: string;
  /**
   * Override the gates cache (ARCH-p4-12 §API Contracts; #P4-11/#P4-12).
   * Tests pass a cache wired to a deterministic threshold resolver and
   * `userHomeDir` so the engine never reads the real user's home
   * config; production (`cli.ts`) never sets it — `buildApp` constructs
   * the default and subscribes it to the broadcaster.
   */
  gatesCache?: GatesCache;
  /**
   * The ingest pipeline (#P4-14). When provided, its `getStats`
   * callback is threaded into `/api/health` so the Data Health page
   * can surface `transcriptsFound` / `transcriptsFailed`. The store
   * passes its already-computed `transcriptsParsed` count into the
   * callback so the pipeline doesn't have to recompute it via
   * `listSessions()` (review P-001). Optional because route tests
   * build an app without a real pipeline; CLI production wiring
   * always passes it.
   */
  pipeline?: { getStats: (transcriptsParsed: number) => PipelineStats };
}

export function buildApp({
  store,
  broadcaster = createBroadcaster(),
  metadata,
  logger,
  configPath,
  userHomeDir,
  localStorePath,
  gatesCache,
  pipeline,
}: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: logger ?? {
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
      },
    },
  });

  // ARCH-p4-12 §Cross-Cutting: the gates cache is the only per-session
  // memo between the engine and the Sessions / Dashboard / Trends
  // consumers. Production wires it through the broadcaster so the same
  // WS-debounced `session-updated` bus that the sockets read evicts
  // the cache; tests pass an explicit `gatesCache` to avoid filesystem
  // IO on the threshold resolver.
  const activeCache: GatesCache =
    gatesCache ??
    createGatesCache({
      store,
      resolveThresholds: async () => {
        // Re-read the config each miss so a Settings edit is observed
        // without a restart — matches `routes/gates.ts:67-68`. The
        // `readConfig` call is wrapped to never throw (it catches
        // internally), so this resolver never poisons the cache.
        return getGateThresholds(await readConfig(configPath));
      },
      ...(userHomeDir !== undefined ? { userHomeDir } : {}),
    });
  // Capture the unsubscribe function returned by `subscribe` —
  // (`#P4-12 review finding #15`): a future rollback path can call it
  // to detach the cache invalidator without rebroadcasting. The
  // broadcaster's in-process subscriber Set is the source of truth
  // for active subscribers; holding the unsubscribe in a module-scope
  // const keeps the rollback seam available without polluting the
  // production hot path.
  const unsubscribeCacheInvalidator = broadcaster.subscribe((message) => {
    if (message.type === "session-updated") {
      activeCache.invalidate(message.sessionId);
    }
  });
  // Reference the unsubscribe function so an unused-var lint doesn't
  // discard it; this is the documented rollback seam.
  void unsubscribeCacheInvalidator;

  app.register(fastifyWebsocket);

  if (hasStaticAssets) {
    app.register(fastifyStatic, { root: publicDir, dotfiles: "deny" });
  }

  app.get("/api/ping", async () => ({ ok: true }));

  // GET /api/health — review E1 (Data Health surfacing of parse-premium
  // malformedCount); #P4-14 extends it with the §2 scan-coverage and §3
  // reconciliation rollups. `scanRoots` threads from metadata (same plumbing
  // as `pricing`); `pipelineStats` is wired by `cli.ts` via the optional
  // `pipeline` field on `BuildAppOptions`.
  registerHealthRoute(app, store, {
    ...(metadata?.scanRoots ? { scanRoots: metadata.scanRoots } : {}),
    ...(pipeline ? { pipelineStats: pipeline.getStats } : {}),
  });

  registerMetricsRoute(
    app,
    store,
    metadata?.pricing
      ? { pricing: metadata.pricing, gatesCache: activeCache }
      : { gatesCache: activeCache },
  );

  registerSearchRoute(app, store);

  registerSessionsRoute(app, store, {
    ...(metadata ? { pricing: metadata.pricing, pricer: metadata.pricer } : undefined),
    localStorePath,
    gatesCache: activeCache,
  });

  registerCacheLabRoute(app, store, metadata?.pricing ? { pricing: metadata.pricing } : undefined);

  registerExportRoute(app, store);

  registerConfigRoute(app, { configPath, store });

  registerSessionDetailRoute(app, store, {
    ...(metadata
      ? { pricer: metadata.pricer, contextResolver: metadata.contextResolver }
      : undefined),
    configPath,
  });

  registerViewsRoute(app, { localStorePath });

  registerTagsRoute(app, { localStorePath });

  registerTurnInspectorRoute(
    app,
    store,
    metadata ? { pricer: metadata.pricer, contextResolver: metadata.contextResolver } : undefined,
  );

  registerGatesRoute(
    app,
    store,
    configPath || userHomeDir ? { configPath, userHomeDir } : undefined,
  );
  // Note: when configPath/userHomeDir are absent, the route reads the real
  // `~/.claude-lens/config.json` and `~/.claude/CLAUDE.md` from `homedir()`
  // — the production behavior. Tests pass overrides via BuildAppOptions.

  // ARCH §HTTP errors: every uncaught error in any route handler (today:
  // the gates engine and the config PUT) must surface as the documented
  // `{ error, cause }` wire shape, not Fastify's default
  // `{statusCode, error, message}`. The gates route has its own
  // try/catch around `evaluateSessionGates`; this top-level handler is
  // the catch-all for anything that escapes a route's local handling
  // (defense-in-depth, review H2).
  //
  // `#P4-12 review finding #14`: shape consistency across handlers.
  // The gates route returns `{ error, cause, sessionId }` because the
  // route knows the session; the top-level handler has no session
  // context (the request may not be session-scoped), so it returns
  // `{ error, cause }` only. Documented here so the asymmetry is
  // deliberate — clients decoding both shapes should treat
  // `sessionId` as optional.
  app.setErrorHandler((err, _request, reply) => {
    app.log.error({ err }, "unhandled route error");
    reply.code(500).send({
      error: "internal server error",
      cause: err instanceof Error ? err.message : String(err),
    });
  });

  app.register(async (instance) => {
    instance.get(
      "/ws",
      {
        websocket: true,
        preValidation: async (request, reply) => {
          const origin = request.headers.origin;
          if (origin !== undefined && !isAllowedOrigin(origin)) {
            // Explicit return: replying in a preValidation hook already
            // short-circuits the route handler, but returning makes that
            // intent local rather than relying on a later reader not adding
            // code below this guard.
            return reply.code(403).send({ error: "forbidden origin" });
          }
        },
      },
      (socket) => {
        broadcaster.add(socket);
        socket.on("close", () => broadcaster.remove(socket));
        socket.on("error", () => broadcaster.remove(socket));
        socket.on("message", () => {
          // invalidation bus only (architecture §7) — no inbound protocol yet
        });
      },
    );
  });

  app.setNotFoundHandler((request, reply) => {
    if (hasStaticAssets && request.method === "GET" && !request.url.startsWith("/api")) {
      return reply.sendFile("index.html");
    }
    reply.code(404).send({ error: "not found" });
  });

  return app;
}
