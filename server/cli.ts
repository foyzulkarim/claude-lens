#!/usr/bin/env node
import { createServer } from "node:net";
import open from "open";
import { buildApp } from "./app.js";

const DEFAULT_PORT = 4128;

interface CliOptions {
  port?: number;
  open: boolean;
  roots: string[];
}

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
      options.port = Number(inlineValue ?? argv[++i]);
    } else if (flag === "--roots") {
      if (inlineValue) options.roots.push(inlineValue);
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) {
        options.roots.push(argv[++i]);
      }
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
  }
  return port;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const port = await findAvailablePort(options.port ?? DEFAULT_PORT);

  const app = buildApp();
  await app.listen({ port, host: "127.0.0.1" });

  const url = `http://127.0.0.1:${port}`;
  app.log.info(`claude-lens running at ${url}`);

  if (options.open) {
    await open(url);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
