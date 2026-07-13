import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ApiCall } from "../../shared/types.js";
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

type CacheRecordLine =
  | { kind: "call"; call: ApiCall }
  | { kind: "prompt"; prompt: PromptTextRecord }
  | { kind: "tool-result-bytes"; record: ToolResultBytesRecord }
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

function isApiCallShape(value: Record<string, unknown>): boolean {
  return (
    typeof value.uuid === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.messageId === "string" &&
    typeof value.timestamp === "string" &&
    typeof value.model === "string"
  );
}

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

function keyFilePath(cacheDir: string, path: string): string {
  const hash = createHash("sha1").update(path).digest("hex").slice(0, 16);
  return join(cacheDir, `${hash}.ndjson`);
}

function serializeEntry(key: WarmCacheKey, entry: WarmCacheEntry): string {
  const lines: string[] = [JSON.stringify(key)];
  for (const call of entry.calls) {
    lines.push(JSON.stringify({ kind: "call", call } satisfies CacheRecordLine));
  }
  for (const prompt of entry.prompts) {
    lines.push(JSON.stringify({ kind: "prompt", prompt } satisfies CacheRecordLine));
  }
  for (const record of entry.toolResultBytes) {
    lines.push(JSON.stringify({ kind: "tool-result-bytes", record } satisfies CacheRecordLine));
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
  if (!isWarmCacheKey(header)) return null;
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
