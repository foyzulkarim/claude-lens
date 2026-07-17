import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "node:process";

export const DEFAULT_PORT_BASE = 4128;
const MAX_PORT = 65_535;

export interface LanePorts {
  backend: number;
  vite: number;
  e2e: number;
  storybook: number;
}

function parsePort(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_PORT) {
    throw new Error(`${name} must be an integer between 1 and ${MAX_PORT}; got ${raw}`);
  }
  return value;
}

export function loadRepoEnv(rootDir: string): void {
  const path = join(rootDir, ".env.local");
  if (existsSync(path)) loadEnvFile(path);
}

export function resolveLanePorts(env: NodeJS.ProcessEnv = process.env): LanePorts {
  const backend = parsePort(
    "CLAUDE_LENS_PORT_BASE",
    env.CLAUDE_LENS_PORT_BASE ?? String(DEFAULT_PORT_BASE),
  );
  if (backend > MAX_PORT - 3) {
    throw new Error(
      `CLAUDE_LENS_PORT_BASE must leave room for the Vite, E2E, and Storybook ports (maximum ${MAX_PORT - 3}); got ${backend}`,
    );
  }

  return { backend, vite: backend + 1, e2e: backend + 2, storybook: backend + 3 };
}

export function resolveE2ePort(env: NodeJS.ProcessEnv = process.env): number {
  const explicit = env.CLAUDE_LENS_E2E_PORT;
  return explicit ? parsePort("CLAUDE_LENS_E2E_PORT", explicit) : resolveLanePorts(env).e2e;
}
