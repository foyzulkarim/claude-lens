import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  type LocalStore,
  isValidSavedView,
  isValidTagList,
} from "../shared/local-store-contract.js";
import { isRecord } from "./util.js";

/**
 * Local-store file I/O (ARCH-settings-local-store.md; architecture §10).
 * Reads/writes `~/.claude-lens/local.json`. Same shape as `server/settings.ts`:
 * never throws — a missing or unparseable file reads back as the default
 * `{views: [], tags: {}}`; `writeLocalStore` merges its patch onto the
 * existing on-disk object (shallow — callers pass the fully computed
 * `views`/`tags` value when changing either, since both are structured
 * collections a route mutates in memory before persisting).
 *
 * Reads additionally deep-validate each `SavedView` and each tag array
 * (review #19): a hand-edited `local.json` with `views: [{}]` or
 * `tags: {s1: "not-an-array"}` previously passed the container-level
 * check and was trusted as the fully-typed `LocalStore`, which then crashed
 * `server/routes/tags.ts`'s `for...of sessionTags` loop on a non-array
 * value. Now any element that fails the per-element guard is dropped
 * (best-effort salvage) rather than trusting the whole collection, so
 * partial corruption degrades gracefully.
 */

const DEFAULT_LOCAL_STORE: LocalStore = { views: [], tags: {} };

function localStoreFilePath(storePath?: string): string {
  return storePath ?? join(homedir(), ".claude-lens", "local.json");
}

function isValidOnDiskShape(value: Record<string, unknown>): value is {
  views: unknown[];
  tags: Record<string, unknown>;
} {
  if (!Array.isArray(value.views)) return false;
  if (!isRecord(value.tags)) return false;
  return true;
}

// GET /api/sessions attaches tags on every page request — the app's
// hottest, most-frequently-refetched endpoint — so a plain re-read+parse
// per call would add disk I/O to that hot path. Cache per file path and
// invalidate only on a write through mutateLocalStore/writeLocalStore.
const readCache = new Map<string, LocalStore>();

async function readLocalStoreUncached(storePath?: string): Promise<LocalStore> {
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

  // Element-level filtering (review #19): per-field guards in
  // `shared/local-store-contract.ts` keep the typed-cast honest. A
  // partially-corrupt file reads back as the best-effort salvage — the
  // contract is "graceful degradation," not "fail closed."
  const views: LocalStore["views"] = [];
  for (const candidate of parsed.views) {
    if (isValidSavedView(candidate)) views.push(candidate);
  }
  const tags: LocalStore["tags"] = {};
  for (const [sessionId, sessionTags] of Object.entries(parsed.tags)) {
    if (isValidTagList(sessionTags)) tags[sessionId] = sessionTags;
  }
  return { views, tags };
}

export async function readLocalStore(storePath?: string): Promise<LocalStore> {
  const key = localStoreFilePath(storePath);
  const cached = readCache.get(key);
  if (cached) return cached;
  const store = await readLocalStoreUncached(storePath);
  readCache.set(key, store);
  return store;
}

export async function writeLocalStore(
  patch: Partial<LocalStore>,
  storePath?: string,
): Promise<LocalStore> {
  return mutateLocalStore(() => patch, storePath);
}

// Serializes read-modify-write cycles per file path so concurrent mutations
// (e.g. a tag rename racing a per-session tag update) can't both read the
// pre-mutation state and have one silently overwrite the other's write.
const mutationQueues = new Map<string, Promise<unknown>>();

/**
 * Reads the current store, lets `mutate` compute a patch from it, and writes
 * the result — the whole cycle serialized against any other in-flight
 * mutation for the same `storePath`, so callers never race each other.
 */
export async function mutateLocalStore(
  mutate: (current: LocalStore) => Partial<LocalStore>,
  storePath?: string,
): Promise<LocalStore> {
  const filePath = localStoreFilePath(storePath);
  const run = async (): Promise<LocalStore> => {
    const current = await readLocalStoreUncached(storePath);
    const next: LocalStore = { ...current, ...mutate(current) };
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(next, null, 2), "utf8");
    readCache.set(filePath, next);
    return next;
  };
  const queued = (mutationQueues.get(filePath) ?? Promise.resolve()).then(run, run);
  mutationQueues.set(
    filePath,
    queued.catch(() => undefined),
  );
  return queued;
}
