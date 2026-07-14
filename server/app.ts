import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { WsServerMessage } from "../shared/ws-protocol.js";
import { registerMetricsRoute } from "./routes/metrics.js";
import type { Store } from "./store/store.js";

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

function isAllowedOrigin(origin: string): boolean {
  try {
    return ALLOWED_ORIGIN_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

interface OutboundSocket {
  send(data: string): void;
}

// The typed outbound path for the invalidation bus (architecture §7). Not yet
// called anywhere — the ingest pipeline that triggers these sends lands in
// #P2-2/#P2-3; this pins the wire shape ahead of that work.
export function sendInvalidation(socket: OutboundSocket, message: WsServerMessage): void {
  socket.send(JSON.stringify(message));
}

export interface BuildAppOptions {
  store: Store;
}

export function buildApp({ store }: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: {
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
      },
    },
  });

  app.register(fastifyWebsocket);

  if (hasStaticAssets) {
    app.register(fastifyStatic, { root: publicDir, dotfiles: "deny" });
  }

  app.get("/api/ping", async () => ({ ok: true }));

  registerMetricsRoute(app, store);

  app.register(async (instance) => {
    instance.get(
      "/ws",
      {
        websocket: true,
        preValidation: async (request, reply) => {
          const origin = request.headers.origin;
          if (origin !== undefined && !isAllowedOrigin(origin)) {
            reply.code(403).send({ error: "forbidden origin" });
          }
        },
      },
      (socket) => {
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
