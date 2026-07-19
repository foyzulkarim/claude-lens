import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AppConfig } from "../shared/settings-contract.js";

/**
 * Minimal local config store (ARCH-trends-calendar-budget.md; architecture
 * §10). Reads/writes `~/.claude-lens/config.json`. Deliberately loose about
 * the on-disk shape beyond `budget`: `readConfig` returns whatever object is
 * on disk (typed as `AppConfig`, unknown keys included), and `writeConfig`
 * merges its patch onto that object rather than replacing it — so a future
 * field #P4-15 adds (pricing, scan roots, thresholds, …) survives a `PUT
 * /api/config` call made by this task's budget-only route.
 *
 * Same `homedir()`-joined path convention as `ingest/warm-cache.ts`'s cache
 * directory. Never throws: a missing or unparseable file reads back as the
 * default `{ budget: null }`, matching the warm cache's "degrade to
 * recompute" precedent rather than crashing the server over a corrupt
 * local file.
 */

const DEFAULT_CONFIG: AppConfig = { budget: null };

function configFilePath(configPath?: string): string {
  return configPath ?? join(homedir(), ".claude-lens", "config.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readConfig(configPath?: string): Promise<AppConfig> {
  let raw: string;
  try {
    raw = await readFile(configFilePath(configPath), "utf8");
  } catch {
    return { ...DEFAULT_CONFIG };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_CONFIG };
  }

  if (!isRecord(parsed)) return { ...DEFAULT_CONFIG };
  return { ...DEFAULT_CONFIG, ...(parsed as AppConfig) };
}

/**
 * Merges `patch` onto the existing on-disk config and persists the result.
 * Reads the current file first (rather than blind-overwriting) so unknown
 * keys already on disk survive a budget-only `PUT` from this task's route.
 */
export async function writeConfig(
  patch: Partial<AppConfig>,
  configPath?: string,
): Promise<AppConfig> {
  const filePath = configFilePath(configPath);
  const current = await readConfig(configPath);
  const next: AppConfig = { ...current, ...patch };
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}
