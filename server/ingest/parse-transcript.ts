import type { ApiCall } from "../../shared/types.js";

export interface PromptTextRecord {
  sessionId: string;
  promptId: string;
  text: string;
  // The user line's own timestamp. Assistant lines never carry a promptId
  // (confirmed against real capture data — only ~4324/4327 `user` lines do),
  // so derive-turns.ts (#P2-6) has no direct call→promptId link. This lets it
  // assign each call to the latest preceding prompt in the same session.
  timestamp: string;
}

export interface ToolResultBytesRecord {
  sessionId: string;
  promptId: string;
  toolUseId: string;
  bytes: number;
  /** True when the tool reported a failure (is_error flag or non-zero exit code in Bash output). */
  isError: boolean;
}

export type ParsedLine =
  | { kind: "call"; call: ApiCall }
  | { kind: "prompt"; prompt: PromptTextRecord }
  | { kind: "tool-result-bytes"; record: ToolResultBytesRecord }
  | { kind: "duplicate" }
  | { kind: "skipped" }
  | { kind: "malformed" };

export interface ParseTranscriptResult {
  calls: ApiCall[];
  prompts: PromptTextRecord[];
  toolResultBytes: ToolResultBytesRecord[];
  duplicateCount: number;
  malformedCount: number;
}

interface RawAssistantMessage {
  id?: unknown;
  model?: unknown;
  stop_reason?: unknown;
  content?: unknown;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    cache_read_input_tokens?: unknown;
    cache_creation_input_tokens?: unknown;
    cache_creation?: {
      ephemeral_5m_input_tokens?: unknown;
      ephemeral_1h_input_tokens?: unknown;
    };
    server_tool_use?: {
      web_search_requests?: unknown;
      web_fetch_requests?: unknown;
    };
  };
}

interface RawAssistantLine {
  type: "assistant";
  uuid?: unknown;
  sessionId?: unknown;
  requestId?: unknown;
  agentId?: unknown;
  timestamp?: unknown;
  cwd?: unknown;
  gitBranch?: unknown;
  version?: unknown;
  entrypoint?: unknown;
  isSidechain?: unknown;
  isApiErrorMessage?: unknown;
  apiErrorStatus?: unknown;
  message?: RawAssistantMessage;
}

interface RawUserLine {
  type: "user";
  sessionId?: unknown;
  promptId?: unknown;
  timestamp?: unknown;
  message?: { content?: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toOptionalStr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toNum(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function toOptionalNum(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

// Detects non-zero exit codes in Bash tool-result text.
// Matches: "exit code N", "exit_code: N", "returned exit code N", etc.
// where N is 1-9 (digit 0 is explicitly excluded).
// Greedy .+ between the keyword and [1-9] ensures we skip any separator chars.
const FAILED_EXIT_RE = /(?:exit ?code|exit_code|returned\s+exit\s+code).+[1-9]/i;

function hasFailedExitCode(text: string): boolean {
  return FAILED_EXIT_RE.test(text);
}

function parseAssistantLine(line: RawAssistantLine): ParsedLine {
  const message = line.message;
  const messageId = message?.id;
  if (!message || typeof messageId !== "string") {
    return { kind: "malformed" };
  }

  const usage = message.usage;
  const cacheCreation = usage?.cache_creation;
  const serverToolUse = usage?.server_tool_use;

  const tools: ApiCall["tools"] = [];
  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (isRecord(block) && block.type === "tool_use") {
        tools.push({
          name: toStr(block.name),
          inputBytes: Buffer.byteLength(JSON.stringify(block.input ?? {}), "utf8"),
        });
      }
    }
  }

  const call: ApiCall = {
    uuid: toStr(line.uuid),
    sessionId: toStr(line.sessionId),
    messageId,
    requestId: toOptionalStr(line.requestId),
    agentId: toOptionalStr(line.agentId),
    timestamp: toStr(line.timestamp),
    model: toStr(message.model),
    usage: {
      inputTokens: toNum(usage?.input_tokens),
      outputTokens: toNum(usage?.output_tokens),
      cacheReadTokens: toNum(usage?.cache_read_input_tokens),
      cacheCreateTokens: toNum(usage?.cache_creation_input_tokens),
      cacheCreate5m: toOptionalNum(cacheCreation?.ephemeral_5m_input_tokens),
      cacheCreate1h: toOptionalNum(cacheCreation?.ephemeral_1h_input_tokens),
      webSearchRequests: toOptionalNum(serverToolUse?.web_search_requests),
      webFetchRequests: toOptionalNum(serverToolUse?.web_fetch_requests),
    },
    stopReason: toOptionalStr(message.stop_reason),
    isSidechain: line.isSidechain === true,
    tools,
    isApiError: line.isApiErrorMessage === true ? true : undefined,
    apiErrorStatus: toOptionalNum(line.apiErrorStatus),
    cwd: toStr(line.cwd),
    gitBranch: toStr(line.gitBranch),
    version: toStr(line.version),
    entrypoint: toStr(line.entrypoint),
  };

  return { kind: "call", call };
}

function parseUserLine(line: RawUserLine): ParsedLine {
  const sessionId = toStr(line.sessionId);
  const promptId = toOptionalStr(line.promptId);
  const timestamp = toStr(line.timestamp);
  const content = line.message?.content;

  if (typeof content === "string") {
    if (!promptId) return { kind: "skipped" };
    return { kind: "prompt", prompt: { sessionId, promptId, text: content, timestamp } };
  }

  if (Array.isArray(content) && promptId) {
    // One line -> one ParsedLine (the agreed contract), so only the first
    // tool_result block on a multi-tool-result line is captured. Acceptable
    // per the confirmed scope: no test/fixture scenario exercises parallel
    // tool calls landing multiple tool_result blocks on a single line.
    for (const block of content) {
      if (isRecord(block) && block.type === "tool_result" && typeof block.content === "string") {
        const rawContent = block.content;
        const isError = block.is_error === true || hasFailedExitCode(rawContent);
        return {
          kind: "tool-result-bytes",
          record: {
            sessionId,
            promptId,
            toolUseId: toStr(block.tool_use_id),
            bytes: Buffer.byteLength(rawContent, "utf8"),
            isError,
          },
        };
      }
    }
  }

  return { kind: "skipped" };
}

export function parseTranscriptLine(rawLine: string, seenMessageIds: Set<string>): ParsedLine {
  const trimmed = rawLine.trim();
  if (trimmed === "") {
    return { kind: "skipped" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: "malformed" };
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    return { kind: "malformed" };
  }

  if (parsed.type === "user") {
    return parseUserLine(parsed as unknown as RawUserLine);
  }

  if (parsed.type !== "assistant") {
    return { kind: "skipped" };
  }

  const result = parseAssistantLine(parsed as unknown as RawAssistantLine);
  if (result.kind !== "call") {
    return result;
  }

  if (seenMessageIds.has(result.call.messageId)) {
    return { kind: "duplicate" };
  }
  seenMessageIds.add(result.call.messageId);
  return result;
}

export function parseTranscriptLines(
  rawLines: string[],
  seenMessageIds: Set<string>,
): ParseTranscriptResult {
  const result: ParseTranscriptResult = {
    calls: [],
    prompts: [],
    toolResultBytes: [],
    duplicateCount: 0,
    malformedCount: 0,
  };

  for (const rawLine of rawLines) {
    const parsed = parseTranscriptLine(rawLine, seenMessageIds);
    switch (parsed.kind) {
      case "call":
        result.calls.push(parsed.call);
        break;
      case "prompt":
        result.prompts.push(parsed.prompt);
        break;
      case "tool-result-bytes":
        result.toolResultBytes.push(parsed.record);
        break;
      case "duplicate":
        result.duplicateCount++;
        break;
      case "malformed":
        result.malformedCount++;
        break;
      case "skipped":
        break;
    }
  }

  return result;
}
