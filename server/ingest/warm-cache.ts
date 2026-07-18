import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ApiCall, CompactionRecord } from "../../shared/types.js";
import type {
  ParseTranscriptResult,
  PromptTextRecord,
  ToolResultBytesRecord,
} from "./parse-transcript.js";

export interface WarmCacheKey {
  path: string;
  size: number;
  mtime: number;
}

export type WarmCacheEntry = ParseTranscriptResult;

export interface WarmCache {
  load(key: WarmCacheKey): Promise<WarmCacheEntry | null>;
  save(key: WarmCacheKey, entry: WarmCacheEntry): Promise<void>;
}

/**
 * Schema version baked into every saved cache header. Bump this whenever the
 * `WarmCacheEntry` shape gains/removes/renames a field that the existing
 * record-line validators below cannot tolerate. On a mismatch the entry is
 * treated as a cache miss (safe rebuild from source transcripts), not a
 * throw — see ARCH-session-detail-page.md T1 stress test: "treats old cache
 * schemas as safe misses". (#P4-5)
 */
export const WARM_CACHE_SCHEMA_VERSION = 2;

type CacheHeader = WarmCacheKey & { version: number };

type CacheRecordLine =
  | { kind: "call"; call: ApiCall }
  | { kind: "prompt"; prompt: PromptTextRecord }
  | { kind: "tool-result-bytes"; record: ToolResultBytesRecord }
  | { kind: "compaction"; record: CompactionRecord }
  | { kind: "meta"; duplicateCount: number; malformedCount: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWarmCacheKey(value: unknown): value is WarmCacheKey {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.size === "number" &&
    typeof value.mtime === "number"
  );
}

function isCacheHeader(value: unknown): value is CacheHeader {
  return (
    isWarmCacheKey(value) &&
    typeof (value as unknown as Record<string, unknown>).version === "number" &&
    (value as unknown as Record<string, unknown>).version === WARM_CACHE_SCHEMA_VERSION
  );
}

function isApiCallShape(value: Record<string, unknown>): boolean {
  return (
    typeof value.uuid === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.messageId === "string" &&
    typeof value.timestamp === "string" &&
    typeof value.model === "string"
  );
}

// `timestamp` was added to PromptTextRecord after this cache format shipped
// (#P2-6) — tightening this check means any pre-existing on-disk cache entry
// written before that change (missing the field) now fails validation.
// That's intentional and safe: deserializeEntry returns null on any failed
// record (see below), which is a clean cache miss, not a throw — the tailer
// falls back to a full re-parse and re-saves a schema-correct entry. No data
// loss (this cache is a rebuildable derived artifact; the source-of-truth
// transcripts are never touched), just one slower boot per affected file.
function isPromptTextRecordShape(value: Record<string, unknown>): boolean {
  return (
    typeof value.sessionId === "string" &&
    typeof value.promptId === "string" &&
    typeof value.text === "string" &&
    typeof value.timestamp === "string"
  );
}

function isToolResultBytesRecordShape(value: Record<string, unknown>): boolean {
  return (
    typeof value.sessionId === "string" &&
    typeof value.promptId === "string" &&
    typeof value.toolUseId === "string" &&
    typeof value.bytes === "number"
  );
}

// (#P4-5) Compact validation: sessionId is the only required field. Both
// optional fields may be absent on a transcript that didn't supply them.
function isCompactionRecordShape(value: Record<string, unknown>): boolean {
  if (typeof value.sessionId !== "string" || value.sessionId === "") return false;
  if (value.timestamp !== undefined && typeof value.timestamp !== "string") return false;
  if (value.promptId !== undefined && typeof value.promptId !== "string") return false;
  return true;
}

function keyFilePath(cacheDir: string, path: string): string {
  const hash = createHash("sha1").update(path).digest("hex").slice(0, 16);
  return join(cacheDir, `${hash}.ndjson`);
}

function serializeEntry(key: WarmCacheKey, entry: WarmCacheEntry): string {
  const header: CacheHeader = { ...key, version: WARM_CACHE_SCHEMA_VERSION };
  const lines: string[] = [JSON.stringify(header)];
  for (const call of entry.calls) {
    lines.push(JSON.stringify({ kind: "call", call } satisfies CacheRecordLine));
  }
  for (const prompt of entry.prompts) {
    lines.push(JSON.stringify({ kind: "prompt", prompt } satisfies CacheRecordLine));
  }
  for (const record of entry.toolResultBytes) {
    lines.push(JSON.stringify({ kind: "tool-result-bytes", record } satisfies CacheRecordLine));
  }
  for (const record of entry.compactions) {
    lines.push(JSON.stringify({ kind: "compaction", record } satisfies CacheRecordLine));
  }
  lines.push(
    JSON.stringify({
      kind: "meta",
      duplicateCount: entry.duplicateCount,
      malformedCount: entry.malformedCount,
    } satisfies CacheRecordLine),
  );
  return `${lines.join("\n")}\n`;
}

function deserializeEntry(raw: string, expectedKey: WarmCacheKey): WarmCacheEntry | null {
  const lines = raw.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return null;

  let header: unknown;
  try {
    header = JSON.parse(lines[0] ?? "");
  } catch {
    return null;
  }
  // (#P4-5) Schema-version gate: pre-versioned entries (missing `version`
  // or carrying a lower one) are rejected as cache misses here so the
  // tailer falls back to a full re-parse. Source transcripts are never
  // mutated. See ARCH-session-detail-page.md T1 stress test.
  if (!isCacheHeader(header)) return null;
  if (
    header.path !== expectedKey.path ||
    header.size !== expectedKey.size ||
    header.mtime !== expectedKey.mtime
  ) {
    return null;
  }

  const entry: WarmCacheEntry = {
    calls: [],
    prompts: [],
    toolResultBytes: [],
    compactions: [],
    duplicateCount: 0,
    malformedCount: 0,
  };

  for (const line of lines.slice(1)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return null;
    }
    if (!isRecord(parsed) || typeof parsed.kind !== "string") return null;

    switch (parsed.kind) {
      case "call":
        if (!isRecord(parsed.call) || !isApiCallShape(parsed.call)) return null;
        entry.calls.push(parsed.call as unknown as ApiCall);
        break;
      case "prompt":
        if (!isRecord(parsed.prompt) || !isPromptTextRecordShape(parsed.prompt)) return null;
        entry.prompts.push(parsed.prompt as unknown as PromptTextRecord);
        break;
      case "tool-result-bytes":
        if (!isRecord(parsed.record) || !isToolResultBytesRecordShape(parsed.record)) return null;
        entry.toolResultBytes.push(parsed.record as unknown as ToolResultBytesRecord);
        break;
      case "compaction":
        if (!isRecord(parsed.record) || !isCompactionRecordShape(parsed.record)) return null;
        entry.compactions.push(parsed.record as unknown as CompactionRecord);
        break;
      case "meta":
        if (
          typeof parsed.duplicateCount !== "number" ||
          typeof parsed.malformedCount !== "number"
        ) {
          return null;
        }
        entry.duplicateCount = parsed.duplicateCount;
        entry.malformedCount = parsed.malformedCount;
        break;
      default:
        return null;
    }
  }

  return entry;
}

export function createWarmCache(cacheDir?: string): WarmCache {
  const dir = cacheDir ?? join(homedir(), ".claude-lens", "cache");
  // Logged at most once per cache instance — a persistently failing warm
  // cache degrades to "every boot re-parses from scratch," which is
  // otherwise invisible to an operator.
  let warnedOnSaveFailure = false;

  return {
    async load(key: WarmCacheKey): Promise<WarmCacheEntry | null> {
      const filePath = keyFilePath(dir, key.path);
      let raw: string;
      try {
        raw = await readFile(filePath, "utf8");
      } catch {
        return null;
      }
      return deserializeEntry(raw, key);
    },

    async save(key: WarmCacheKey, entry: WarmCacheEntry): Promise<void> {
      const filePath = keyFilePath(dir, key.path);
      const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await mkdir(dir, { recursive: true });
        await writeFile(tmpPath, serializeEntry(key, entry), "utf8");
        await rename(tmpPath, filePath);
      } catch {
        if (!warnedOnSaveFailure) {
          warnedOnSaveFailure = true;
          console.warn(
            `[warm-cache] failed to write a cache entry under ${dir}; warm-start is unavailable this run`,
          );
        }
        try {
          await unlink(tmpPath);
        } catch {
          // best-effort cleanup only — a leftover temp file is harmless
        }
      }
    },
  };
}
