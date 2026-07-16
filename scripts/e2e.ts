import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceFixtureRoot = join(rootDir, "test", "fixtures");
const DEFAULT_PORT = 4200;
const READY_TIMEOUT_MS = 30_000;
const RETRY_INTERVAL_MS = 250;
const METRICS_QUERY = {
  measures: ["costComputed"],
  dimensions: [],
  grain: "day",
  range: { from: "2026-07-01T00:00:00.000Z", to: "2026-08-01T00:00:00.000Z" },
};

interface ChildResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface ManagedChild {
  name: string;
  process: ChildProcess;
  output: string;
  done: Promise<ChildResult>;
  exited: boolean;
}

function log(message: string): void {
  console.log(`[e2e] ${message}`);
}

function parsePort(): number {
  const raw = process.env.CLAUDE_LENS_E2E_PORT ?? String(DEFAULT_PORT);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`CLAUDE_LENS_E2E_PORT must be an integer between 1 and 65535; got ${raw}`);
  }
  return port;
}

async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error(`Port ${port} is already occupied`)));
    probe.once("listening", () => probe.close((error) => (error ? reject(error) : resolve())));
    probe.listen(port, "127.0.0.1");
  });
}

function startChild(
  name: string,
  command: string,
  args: string[],
  env = process.env,
): ManagedChild {
  log(`starting ${name}: ${command} ${args.join(" ")}`);
  const child = spawn(command, args, { cwd: rootDir, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let exited = false;

  for (const [stream, destination] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ] as const) {
    stream?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      destination.write(text);
    });
  }

  const done = new Promise<ChildResult>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      exited = true;
      resolve({ code, signal });
    });
  });
  return {
    name,
    process: child,
    get output() {
      return output;
    },
    done,
    get exited() {
      return exited;
    },
  };
}

async function requireSuccess(child: ManagedChild): Promise<void> {
  const result = await child.done;
  if (result.code !== 0) {
    throw new Error(`${child.name} exited with ${result.signal ?? `code ${result.code}`}`);
  }
}

async function stopChild(child: ManagedChild | undefined): Promise<void> {
  if (!child || child.exited || !child.process.pid) return;
  log(`stopping ${child.name}`);
  child.process.kill("SIGTERM");
  const stopped = await Promise.race([
    child.done.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!stopped && !child.exited) {
    child.process.kill("SIGKILL");
    await child.done;
  }
}

function hasFixtureData(response: unknown): boolean {
  if (!Array.isArray(response)) return false;
  return response.some(
    (series) =>
      typeof series === "object" &&
      series !== null &&
      Array.isArray((series as { points?: unknown }).points) &&
      (series as { points: { value?: unknown }[] }).points.some(
        (point) => typeof point?.value === "number" && Number.isFinite(point.value),
      ),
  );
}

async function waitForReady(baseUrl: string, server: ManagedChild): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError = "application did not answer yet";
  while (Date.now() < deadline) {
    if (server.exited) {
      throw new Error(`CLI exited before readiness\n${server.output}`);
    }
    try {
      const ping = await fetch(`${baseUrl}/api/ping`);
      if (!ping.ok) throw new Error(`/api/ping returned ${ping.status}`);
      const metrics = await fetch(`${baseUrl}/api/metrics`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(METRICS_QUERY),
      });
      if (!metrics.ok) throw new Error(`/api/metrics returned ${metrics.status}`);
      if (hasFixtureData(await metrics.json())) {
        if (!server.output.includes(`claude-lens running at ${baseUrl}`)) {
          throw new Error(`CLI bound a URL other than requested ${baseUrl}`);
        }
        log(`ready at ${baseUrl}`);
        return;
      }
      lastError = "fixture metrics are still empty";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for ${baseUrl}: ${lastError}\n${server.output}`);
}

async function runE2e(): Promise<void> {
  const port = parsePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let runFixtureRoot: string | undefined;
  let server: ManagedChild | undefined;
  let cypress: ManagedChild | undefined;
  let cleaning = false;

  async function cleanup(): Promise<void> {
    if (cleaning) return;
    cleaning = true;
    await stopChild(cypress);
    await stopChild(server);
    if (runFixtureRoot) {
      log("removing isolated fixture root");
      await rm(runFixtureRoot, { recursive: true, force: true });
    }
  }

  const interrupt = (signal: NodeJS.Signals) => {
    console.error(`[e2e] interrupted by ${signal}`);
    void cleanup().finally(() => process.exit(130));
  };
  process.once("SIGINT", () => interrupt("SIGINT"));
  process.once("SIGTERM", () => interrupt("SIGTERM"));

  try {
    const build = startChild("build", process.platform === "win32" ? "npm.cmd" : "npm", [
      "run",
      "build",
    ]);
    await requireSuccess(build);
    await assertPortFree(port);

    runFixtureRoot = await mkdtemp(join(tmpdir(), "claude-lens-e2e-"));
    await cp(sourceFixtureRoot, runFixtureRoot, { recursive: true });
    log(`copied fixtures into ${runFixtureRoot}`);

    server = startChild("CLI", process.execPath, [
      join(rootDir, "dist", "cli.js"),
      "--roots",
      runFixtureRoot,
      "--no-open",
      "--port",
      String(port),
    ]);
    await waitForReady(baseUrl, server);

    cypress = startChild(
      "Cypress",
      process.execPath,
      [
        join(rootDir, "node_modules", "cypress", "bin", "cypress"),
        "run",
        "--config",
        `baseUrl=${baseUrl}`,
      ],
      {
        ...process.env,
        CLAUDE_LENS_E2E_BASE_URL: baseUrl,
        CLAUDE_LENS_E2E_FIXTURE_ROOT: runFixtureRoot,
      },
    );
    const result = await Promise.race([
      cypress.done,
      server.done.then((exit) => {
        throw new Error(
          `CLI exited while Cypress was running (${exit.signal ?? `code ${exit.code}`})`,
        );
      }),
    ]);
    if (result.code !== 0) {
      throw new Error(`Cypress exited with ${result.signal ?? `code ${result.code}`}`);
    }
  } finally {
    await cleanup();
  }
}

runE2e().catch((error) => {
  console.error("[e2e] failed", error);
  process.exitCode = 1;
});
