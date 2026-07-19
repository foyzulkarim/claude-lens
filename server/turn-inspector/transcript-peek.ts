/**
 * Turn Inspector's "transcript peek" (#P4-6). The only place in the
 * codebase that reads a transcript file's raw content on demand — every
 * other consumer (ingest/parse-transcript.ts) deliberately discards raw
 * text after extracting compact metadata (usage, tool names, byte counts).
 * This module exists because the peek needs the raw text itself, but only
 * for the small handful of lines belonging to one turn, and only when a
 * user explicitly expands the panel — never eagerly, never retained.
 *
 * Module boundary: this is the one turn-inspector module allowed to touch
 * the filesystem, mirroring `server/ingest/tailer.ts`'s role relative to
 * the pure parser. `server/turn-inspector/projector.ts` stays pure.
 */

import { readFile } from "node:fs/promises";
import type {
  TurnTranscriptPeekLine,
  TurnTranscriptPeekResponse,
} from "../../shared/turn-inspector-contract.js";

const PREVIEW_CHAR_CAP = 200;

function truncate(text: string): { preview: string; truncated: boolean } {
  if (text.length <= PREVIEW_CHAR_CAP) return { preview: text, truncated: false };
  return { preview: `${text.slice(0, PREVIEW_CHAR_CAP)}…`, truncated: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface TurnWindow {
  /** Inclusive lower bound (ms since epoch), or -Infinity when unknown. */
  startMs: number;
  /** Inclusive upper bound (ms since epoch), or +Infinity when unknown. */
  endMs: number;
}

function withinWindow(timestamp: unknown, window: TurnWindow): boolean {
  if (typeof timestamp !== "string") return false;
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) return false;
  return ms >= window.startMs && ms <= window.endMs;
}

/**
 * Reads `filePath`, extracts a short, truncated preview of every line whose
 * timestamp falls within `[startedAt, endedAt]`. Returns `null` when the
 * file can't be read (moved/deleted since ingest) — the route maps that to
 * the honest "transcript unavailable" 404 rather than throwing.
 */
export async function buildTranscriptPeek(
  filePath: string,
  startedAt: string,
  endedAt: string,
): Promise<TurnTranscriptPeekResponse | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return null;
  }

  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(endedAt);
  const window: TurnWindow = {
    startMs: Number.isFinite(startMs) ? startMs : Number.NEGATIVE_INFINITY,
    endMs: Number.isFinite(endMs) ? endMs : Number.POSITIVE_INFINITY,
  };

  // First pass: record toolUseId -> tool name so tool_result lines (which
  // arrive on separate "user" lines) can be labeled, mirroring the
  // toolNameByToolUseId idiom in parse-transcript.ts.
  const toolNameByToolUseId = new Map<string, string>();
  const rawLines = raw.split("\n");
  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (trimmed === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isRecord(parsed) || parsed.type !== "assistant") continue;
    const content = isRecord(parsed.message) ? parsed.message.content : undefined;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (isRecord(block) && block.type === "tool_use" && typeof block.id === "string") {
        toolNameByToolUseId.set(block.id, typeof block.name === "string" ? block.name : "");
      }
    }
  }

  const lines: TurnTranscriptPeekLine[] = [];
  let truncated = false;

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (trimmed === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isRecord(parsed) || typeof parsed.type !== "string") continue;

    if (parsed.type === "assistant") {
      if (!withinWindow(parsed.timestamp, window)) continue;
      const content = isRecord(parsed.message) ? parsed.message.content : undefined;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (!isRecord(block)) continue;
        if (block.type === "text" && typeof block.text === "string") {
          const { preview, truncated: cut } = truncate(block.text);
          if (cut) truncated = true;
          lines.push({ role: "assistant-text", preview });
        } else if (block.type === "tool_use" && typeof block.name === "string") {
          const inputText = JSON.stringify(block.input ?? {});
          const { preview, truncated: cut } = truncate(inputText);
          if (cut) truncated = true;
          lines.push({ role: "tool-use", toolName: block.name, preview });
        }
      }
      continue;
    }

    if (parsed.type === "user") {
      if (!withinWindow(parsed.timestamp, window)) continue;
      const content = isRecord(parsed.message) ? parsed.message.content : undefined;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (isRecord(block) && block.type === "tool_result" && typeof block.content === "string") {
          const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
          const toolName = toolNameByToolUseId.get(toolUseId);
          const bytes = Buffer.byteLength(block.content, "utf8");
          const { preview, truncated: cut } = truncate(block.content);
          if (cut) truncated = true;
          lines.push({
            role: "tool-result",
            ...(toolName !== undefined ? { toolName } : {}),
            preview,
            bytes,
          });
        }
      }
    }
  }

  return { lines, truncated };
}
