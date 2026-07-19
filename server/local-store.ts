import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { LocalStore } from "../shared/local-store-contract.js";

/**
 * Local-store file I/O (ARCH-settings-local-store.md; architecture §10).
 * Reads/writes `~/.claude-lens/local.json`. Same shape as `server/settings.ts`:
 * never throws — a missing or unparseable file reads back as the default
 * `{views: [], tags: {}}`; `writeLocalStore` merges its patch onto the
 * existing on-disk object (shallow — callers pass the fully computed
 * `views`/`tags` value when changing either, since both are structured
 * collections a route mutates in memory before persisting).
 */

const DEFAULT_LOCAL_STORE: LocalStore = { views: [], tags: {} };

function localStoreFilePath(storePath?: string): string {
  return storePath ?? join(homedir(), ".claude-lens", "local.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidOnDiskShape(value: Record<string, unknown>): boolean {
  if (!Array.isArray(value.views)) return false;
  if (!isRecord(value.tags)) return false;
  return true;
}

export async function readLocalStore(storePath?: string): Promise<LocalStore> {
  let raw: string;
  try {
    raw = await readFile(localStoreFilePath(storePath), "utf8");
  } catch {
    return { ...DEFAULT_LOCAL_STORE };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_LOCAL_STORE };
  }

  if (!isRecord(parsed) || !isValidOnDiskShape(parsed)) return { ...DEFAULT_LOCAL_STORE };
  return { views: parsed.views as LocalStore["views"], tags: parsed.tags as LocalStore["tags"] };
}

export async function writeLocalStore(
  patch: Partial<LocalStore>,
  storePath?: string,
): Promise<LocalStore> {
  const filePath = localStoreFilePath(storePath);
  const current = await readLocalStore(storePath);
  const next: LocalStore = { ...current, ...patch };
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}
