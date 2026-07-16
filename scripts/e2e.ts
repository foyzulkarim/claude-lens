import { type ChildProcess, execFile, spawn } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceFixtureRoot = join(rootDir, "test", "fixtures");
const DEFAULT_PORT = 4200;
const READY_TIMEOUT_MS = 30_000;
const RETRY_INTERVAL_MS = 250;
const STOP_TIMEOUT_MS = 5_000;
const METRICS_QUERY = {
  measures: ["costComputed"],
  dimensions: [],
  grain: "day",
  range: { from: "2026-07-01T00:00:00.000Z", to: "2026-08-01T00:00:00.000Z" },
};

export interface ChildResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface ManagedChild {
  name: string;
  process: ChildProcess;
  readonly output: string;
  done: Promise<ChildResult>;
  readonly exited: boolean;
}

interface CleanupAction {
  name: string;
  run(): Promise<void>;
}

export interface SignalHost {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

class CliStoppedError extends Error {}

function log(message: string): void {
  console.log(`[e2e] ${message}`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parsePort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CLAUDE_LENS_E2E_PORT ?? String(DEFAULT_PORT);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`CLAUDE_LENS_E2E_PORT must be an integer between 1 and 65535; got ${raw}`);
  }
  return port;
}

export async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error: NodeJS.ErrnoException) => {
      const detail = error.code ? `${error.code}: ${error.message}` : error.message;
      const summary = error.code === "EADDRINUSE" ? "already occupied" : "could not be probed";
      reject(new Error(`Port ${port} is ${summary} (${detail})`, { cause: error }));
    });
    probe.once("listening", () => probe.close((error) => (error ? reject(error) : resolve())));
    probe.listen(port, "127.0.0.1");
  });
}

export function startChild(
  name: string,
  command: string,
  args: string[],
  env = process.env,
): ManagedChild {
  log(`starting ${name}: ${command} ${args.join(" ")}`);
  const child = spawn(command, args, {
    cwd: rootDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    // A dedicated POSIX process group lets teardown reap Cypress's browser
    // descendants as well as its Node launcher. Windows uses taskkill /T.
    detached: process.platform !== "win32",
  });
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
    stream?.on("error", (error) => {
      const text = `[e2e] ${name} output stream failed: ${errorText(error)}\n`;
      output += text;
      console.error(text.trimEnd());
    });
  }

  const done = new Promise<ChildResult>((resolve, reject) => {
    let settled = false;
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      exited = true;
      reject(new Error(`${name} failed to start: ${errorText(error)}`, { cause: error }));
    });
    child.once("exit", (code, signal) => {
      exited = true;
      if (settled) return;
      settled = true;
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

export async function requireSuccess(child: ManagedChild): Promise<void> {
  const result = await child.done;
  if (result.code !== 0) {
    throw new Error(`${child.name} exited with ${result.signal ?? `code ${result.code}`}`);
  }
}

async function signalProcessTree(
  child: ManagedChild,
  signal: "SIGTERM" | "SIGKILL",
): Promise<void> {
  const pid = child.process.pid;
  if (!pid || child.exited) return;

  try {
    if (process.platform === "win32") {
      await execFileAsync("taskkill", [
        "/PID",
        String(pid),
        "/T",
        ...(signal === "SIGKILL" ? ["/F"] : []),
      ]);
    } else {
      process.kill(-pid, signal);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH" && !child.exited) throw error;
  }
}

export async function stopChild(
  child: ManagedChild | undefined,
  options: {
    timeoutMs?: number;
    signalTree?: (child: ManagedChild, signal: "SIGTERM" | "SIGKILL") => Promise<void>;
  } = {},
): Promise<void> {
  if (!child || child.exited || !child.process.pid) return;
  log(`stopping ${child.name}`);
  const signalTree = options.signalTree ?? signalProcessTree;
  await signalTree(child, "SIGTERM");

  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopped = await Promise.race([
    child.done.then(() => true),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), options.timeoutMs ?? STOP_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });

  if (!stopped && !child.exited) {
    await signalTree(child, "SIGKILL");
    await child.done;
  }
}

export function createCleanup(actions: CleanupAction[]): () => Promise<void> {
  let cleanupPromise: Promise<void> | undefined;
  return () => {
    cleanupPromise ??= (async () => {
      const failures: Error[] = [];
      for (const action of actions) {
        try {
          await action.run();
        } catch (error) {
          const failure = new Error(`cleanup ${action.name} failed: ${errorText(error)}`, {
            cause: error,
          });
          failures.push(failure);
          console.error(`[e2e] ${failure.message}`);
        }
      }
      if (failures.length > 0) throw new AggregateError(failures, "E2E cleanup failed");
    })();
    return cleanupPromise;
  };
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

export async function waitForReady(
  baseUrl: string,
  server: ManagedChild,
  options: {
    timeoutMs?: number;
    retryIntervalMs?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? READY_TIMEOUT_MS;
  const retryIntervalMs = options.retryIntervalMs ?? RETRY_INTERVAL_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const deadline = Date.now() + timeoutMs;
  let lastError = "application did not answer yet";
  const serverFailure = server.done.then(
    (exit) => {
      throw new CliStoppedError(
        `CLI exited before readiness (${exit.signal ?? `code ${exit.code}`})\n${server.output}`,
      );
    },
    (error) => {
      throw new CliStoppedError(
        `CLI failed before readiness: ${errorText(error)}\n${server.output}`,
      );
    },
  );

  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now());
    try {
      const probe = (async () => {
        const signal = AbortSignal.timeout(remainingMs);
        const ping = await fetchImpl(`${baseUrl}/api/ping`, { signal });
        if (!ping.ok) throw new Error(`/api/ping returned ${ping.status}`);
        const metrics = await fetchImpl(`${baseUrl}/api/metrics`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(METRICS_QUERY),
          signal,
        });
        if (!metrics.ok) throw new Error(`/api/metrics returned ${metrics.status}`);
        return hasFixtureData(await metrics.json());
      })();
      const ready = await Promise.race([probe, serverFailure]);
      if (ready) {
        if (!server.output.includes(`claude-lens running at ${baseUrl}`)) {
          throw new Error(`CLI bound a URL other than requested ${baseUrl}`);
        }
        log(`ready at ${baseUrl}`);
        return;
      }
      lastError = "fixture metrics are still empty";
    } catch (error) {
      if (error instanceof CliStoppedError) throw error;
      lastError = errorText(error);
    }

    const retry = new Promise<void>((resolve) => setTimeout(resolve, retryIntervalMs));
    await Promise.race([retry, serverFailure]);
  }
  throw new Error(`Timed out waiting for ${baseUrl}: ${lastError}\n${server.output}`);
}

export function installInterruptHandlers(
  cleanup: () => Promise<void>,
  options: {
    host?: SignalHost;
    abort?: AbortController;
    exit?: (code: number) => void;
  } = {},
): () => void {
  const host = options.host ?? process;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const interrupt = (signal: NodeJS.Signals) => {
    console.error(`[e2e] interrupted by ${signal}`);
    options.abort?.abort(new Error(`interrupted by ${signal}`));
    void cleanup()
      .catch((error) => console.error("[e2e] cleanup after interrupt failed", error))
      .finally(() => exit(130));
  };
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");
  host.once("SIGINT", onSigint);
  host.once("SIGTERM", onSigterm);
  return () => {
    host.off("SIGINT", onSigint);
    host.off("SIGTERM", onSigterm);
  };
}

export async function runE2e(): Promise<void> {
  const port = parsePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let runFixtureRoot: string | undefined;
  let build: ManagedChild | undefined;
  let server: ManagedChild | undefined;
  let cypress: ManagedChild | undefined;
  const abort = new AbortController();
  const cleanup = createCleanup([
    { name: "Cypress stop", run: () => stopChild(cypress) },
    { name: "CLI stop", run: () => stopChild(server) },
    { name: "build stop", run: () => stopChild(build) },
    {
      name: "fixture removal",
      run: async () => {
        if (!runFixtureRoot) return;
        log("removing isolated fixture root");
        await rm(runFixtureRoot, { recursive: true, force: true });
      },
    },
  ]);
  const removeInterruptHandlers = installInterruptHandlers(cleanup, { abort });
  let primaryError: unknown;

  try {
    build = startChild("build", process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"]);
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
    if (abort.signal.aborted) throw abort.signal.reason;

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
      // Keep this rejection branch attached after Cypress wins: Promise.race
      // observes the loser, preventing a later CLI exit from becoming an
      // unhandled rejection while cleanup begins.
      server.done.then((exit) => {
        throw new Error(
          `CLI exited while Cypress was running (${exit.signal ?? `code ${exit.code}`})`,
        );
      }),
    ]);
    if (result.code !== 0) {
      throw new Error(`Cypress exited with ${result.signal ?? `code ${result.code}`}`);
    }
  } catch (error) {
    primaryError = error;
  }

  try {
    await cleanup();
  } catch (cleanupError) {
    if (primaryError !== undefined) {
      console.error("[e2e] cleanup also failed; preserving the original failure", cleanupError);
    } else {
      primaryError = cleanupError;
    }
  }
  removeInterruptHandlers();
  if (primaryError !== undefined) throw primaryError;
}

export async function main(): Promise<void> {
  await runE2e().catch((error) => {
    console.error("[e2e] failed", error);
    process.exitCode = 1;
  });
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  await main();
}
