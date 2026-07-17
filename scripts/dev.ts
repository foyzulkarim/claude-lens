import { type ChildProcess, spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadRepoEnv, resolveLanePorts } from "./ports.js";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

interface DevProcess {
  name: string;
  command: string;
  args: string[];
}

export function buildDevProcesses(
  env: NodeJS.ProcessEnv,
  options: { serverOnly?: boolean } = {},
): DevProcess[] {
  const ports = resolveLanePorts(env);
  const processes: DevProcess[] = [
    {
      name: "server",
      command: process.platform === "win32" ? "tsx.cmd" : "tsx",
      args: ["watch", "server/cli.ts", "--port", String(ports.backend), "--no-open"],
    },
  ];
  if (!options.serverOnly) {
    processes.push({
      name: "client",
      command: process.platform === "win32" ? "vite.cmd" : "vite",
      args: ["--config", "client/vite.config.ts"],
    });
  }
  return processes;
}

function startProcess(spec: DevProcess, env: NodeJS.ProcessEnv): ChildProcess {
  console.log(`[dev] starting ${spec.name}: ${spec.command} ${spec.args.join(" ")}`);
  return spawn(spec.command, spec.args, { cwd: rootDir, env, stdio: "inherit" });
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

export async function runDev(argv = process.argv.slice(2)): Promise<void> {
  const unknown = argv.filter((arg) => arg !== "--server-only");
  if (unknown.length > 0) throw new Error(`Unrecognized dev option: ${unknown.join(" ")}`);

  loadRepoEnv(rootDir);
  const ports = resolveLanePorts();
  const env = {
    ...process.env,
    CLAUDE_LENS_PORT_BASE: String(ports.backend),
  };
  console.log(`[dev] ports: backend ${ports.backend} · vite ${ports.vite} · e2e ${ports.e2e}`);

  const children = buildDevProcesses(env, { serverOnly: argv.includes("--server-only") }).map(
    (spec) => startProcess(spec, env),
  );
  let stopPromise: Promise<void> | undefined;
  const stopAll = () => {
    stopPromise ??= Promise.all(children.map(stopProcess)).then(() => undefined);
    return stopPromise;
  };

  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    void stopAll();
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);

  try {
    const result = await Promise.race(
      children.map(
        (child) =>
          new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
            child.once("error", reject);
            child.once("exit", (code, signal) => resolve({ code, signal }));
          }),
      ),
    );
    if (!interrupted && result.code !== 0 && result.signal !== "SIGTERM") {
      throw new Error(`dev process exited with ${result.signal ?? `code ${result.code}`}`);
    }
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    await stopAll();
  }

  if (interrupted) process.exitCode = 130;
}

export async function main(): Promise<void> {
  await runDev().catch((error) => {
    console.error("[dev] failed", error);
    process.exitCode = 1;
  });
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  await main();
}
