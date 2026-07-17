import { type ChildProcess, spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadRepoEnv, resolveLanePorts } from "./ports.js";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

// The wrapper owns where Storybook binds; user flags that would fight it are rejected.
const RESERVED_FLAGS = ["-p", "--port", "--exact-port", "-c", "--config-dir"];

export function buildStorybookArgs(
  env: NodeJS.ProcessEnv = process.env,
  extraArgs: string[] = [],
): string[] {
  for (const arg of extraArgs) {
    const flag = arg.split("=", 1)[0] ?? arg;
    if (RESERVED_FLAGS.includes(flag)) {
      throw new Error(
        `${flag} is managed by this wrapper; set CLAUDE_LENS_PORT_BASE to move the lane instead`,
      );
    }
  }
  const ports = resolveLanePorts(env);
  return [
    "dev",
    "-p",
    String(ports.storybook),
    "--exact-port",
    "-c",
    "client/.storybook",
    ...extraArgs,
  ];
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

export async function main(): Promise<void> {
  loadRepoEnv(rootDir);
  const args = buildStorybookArgs(process.env, process.argv.slice(2));
  const command = process.platform === "win32" ? "storybook.cmd" : "storybook";
  console.log(`[storybook] starting: ${command} ${args.join(" ")}`);

  const child = spawn(command, args, { cwd: rootDir, env: process.env, stdio: "inherit" });

  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    void stopProcess(child);
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);

  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      },
    );
    if (interrupted || result.signal === "SIGINT" || result.signal === "SIGTERM") {
      process.exitCode = 130;
    } else if (result.code !== null && result.code !== 0) {
      process.exitCode = result.code;
    }
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    await stopProcess(child);
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  await main().catch((error) => {
    console.error("[storybook] failed", error);
    process.exitCode = 1;
  });
}
