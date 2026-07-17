import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadRepoEnv, resolveLanePorts } from "./ports.js";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

export function buildStorybookArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const ports = resolveLanePorts(env);
  return ["dev", "-p", String(ports.storybook), "-c", "client/.storybook"];
}

export async function main(): Promise<void> {
  loadRepoEnv(rootDir);
  const args = buildStorybookArgs();
  const command = process.platform === "win32" ? "storybook.cmd" : "storybook";
  console.log(`[storybook] starting: ${command} ${args.join(" ")}`);

  const child = spawn(command, args, { cwd: rootDir, env: process.env, stdio: "inherit" });
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    },
  );

  if (result.signal === "SIGINT" || result.signal === "SIGTERM") process.exitCode = 130;
  else if (result.code !== null && result.code !== 0) process.exitCode = result.code;
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  await main().catch((error) => {
    console.error("[storybook] failed", error);
    process.exitCode = 1;
  });
}
