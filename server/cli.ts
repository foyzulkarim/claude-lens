#!/usr/bin/env node
import { createServer } from "node:net";
import open from "open";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";

const DEFAULT_PORT = 4128;
const MAX_PORT = 65535;

interface CliOptions {
  port?: number;
  open: boolean;
  roots: string[];
}

class CliUsageError extends Error {}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { open: true, roots: [] };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--no-open") {
      options.open = false;
      continue;
    }

    const [flag, inlineValue] = arg.split("=", 2);

    if (flag === "--port") {
      const raw = inlineValue ?? argv[++i];
      const parsed = Number(raw);
      if (raw === undefined || !Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PORT) {
        throw new CliUsageError(
          `Invalid --port value: ${raw ?? "(missing)"} (expected an integer between 1 and ${MAX_PORT})`,
        );
      }
      options.port = parsed;
    } else if (flag === "--roots") {
      if (inlineValue) options.roots.push(inlineValue);
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) {
        options.roots.push(argv[++i]);
      }
    } else {
      throw new CliUsageError(`Unrecognized option: ${arg}`);
    }
  }

  return options;
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  while (!(await isPortFree(port))) {
    port++;
    if (port > MAX_PORT) {
      throw new Error(`No available port found up to ${MAX_PORT}`);
    }
  }
  return port;
}

// findAvailablePort only checks-then-reports free; another process can still
// grab the port before app.listen() binds it. Retry with the next candidate
// on EADDRINUSE instead of crashing on that race.
async function listenWithRetry(app: FastifyInstance, startPort: number, maxAttempts = 5): Promise<number> {
  let port = startPort;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await app.listen({ port, host: "127.0.0.1" });
      return port;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        port = await findAvailablePort(port + 1);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Could not bind to a port after ${maxAttempts} attempts`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const candidatePort = await findAvailablePort(options.port ?? DEFAULT_PORT);

  const app = buildApp();
  const port = await listenWithRetry(app, candidatePort);

  const url = `http://127.0.0.1:${port}`;
  app.log.info(`claude-lens running at ${url}`);

  if (options.open) {
    try {
      await open(url);
    } catch (err) {
      app.log.warn({ err }, "failed to open browser");
    }
  }
}

main().catch((err) => {
  if (err instanceof CliUsageError) {
    console.error(err.message);
  } else {
    console.error(err);
  }
  process.exit(1);
});
