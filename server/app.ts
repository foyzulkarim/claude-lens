import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "public");
// dist/public only exists in a production build; in dev, Vite serves the
// client on its own port and proxies /api + /ws here, so skip static serving.
const hasStaticAssets = existsSync(publicDir);

export function buildApp() {
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
    app.register(fastifyStatic, { root: publicDir });
  }

  app.get("/api/ping", async () => ({ ok: true }));

  app.register(async (instance) => {
    instance.get("/ws", { websocket: true }, (socket) => {
      socket.on("message", () => {
        // invalidation bus only (architecture §7) — no inbound protocol yet
      });
    });
  });

  app.setNotFoundHandler((request, reply) => {
    if (hasStaticAssets && request.method === "GET" && !request.url.startsWith("/api")) {
      return reply.sendFile("index.html");
    }
    reply.code(404).send({ error: "not found" });
  });

  return app;
}
