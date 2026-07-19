import type { ApiCall, CompactionRecord } from "../../shared/types.js";

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
  /**
   * Whether this tool_result belongs to a sidechain (sub-agent) turn.
   * Sub-agent tool_result lines share the parent's `promptId` (per the
   * `derive-turns` convention) so without this field bytes/errors would
   * silently fold into the main thread's toolResultBytes/errorToolResults
   * (review finding #3). Defaults to `false` for fixture compatibility.
   */
  isSidechain?: boolean;
}

export type ParsedLine =
  | { kind: "call"; call: ApiCall }
  | { kind: "prompt"; prompt: PromptTextRecord }
  | { kind: "tool-result-bytes"; record: ToolResultBytesRecord }
  | { kind: "compaction"; record: CompactionRecord }
  | { kind: "duplicate" }
  | { kind: "skipped" }
  | { kind: "malformed" };

export interface ParseTranscriptResult {
  calls: ApiCall[];
  prompts: PromptTextRecord[];
  toolResultBytes: ToolResultBytesRecord[];
  compactions: CompactionRecord[];
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
  /** Present on tool_result lines from sub-agent (Agent tool) turns —
   * mirrors RawAssistantLine's `isSidechain` field and lets the downstream
   * turn derivation split main-thread vs sidechain tool_result attribution
   * (review #3: otherwise sidechain bytes/errors silently inflate the
   * parent's FailedWork/Records numbers). */
  isSidechain?: unknown;
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

// Detects non-zero exit codes in Bash tool-result text. The pre-fix regex
// was greedy and matched "exit code 0; copied 1 file" as a failure (the [1-9]
// exclusion didn't help because the regex engine backtracks). The new regex
// is anchored to the *adjacent* signed integer — there can be at most a
// `"`/`'` separator (for JSON-style `{"exit_code": 5}` payloads), then
// optional whitespace, an optional `:`/`=` separator, then the number
// immediately. Specifically:
//   "exit code 1" / "exit_code: -2" / "exit code = 0; copied 1 file"
//                                                ^^^^^ rejects trailing digits
// Review #11 / CQ4.
const FAILED_EXIT_RE =
  /["']?(?:exit[ _]code|exit_code|returned\s+exit\s+code)["']?\s*[:=]?\s*-?\d+/i;

/** Returns the integer the regex matched, or null if no exit code is
 * present. Review #11: this lets us compare with zero rather than treating
 * the mere presence of a digit as failure. */
function extractExitCode(text: string): number | null {
  const match = text.match(FAILED_EXIT_RE);
  if (!match) return null;
  const numeric = match[0].match(/-?\d+/);
  if (!numeric) return null;
  const n = Number(numeric[0]);
  return Number.isFinite(n) ? n : null;
}

// (#P4-5) Tools whose `input` object carries a `file_path` / `notebook_path`
// we want to surface as `targetPath` for workflow analysis. Anything outside
// this list leaves `targetPath` undefined so wire payloads stay compact.
const PATH_BEARING_TOOLS = new Set(["Read", "Edit", "Write", "NotebookEdit", "MultiEdit"]);

function extractTargetPath(toolName: string, input: unknown): string | undefined {
  if (!PATH_BEARING_TOOLS.has(toolName)) return undefined;
  if (!isRecord(input)) return undefined;
  const candidate =
    typeof input.file_path === "string"
      ? input.file_path
      : typeof input.notebook_path === "string"
        ? input.notebook_path
        : undefined;
  if (candidate === undefined || candidate === "") return undefined;
  // Compact normalization only: trim whitespace, never resolve symlinks or
  // canonicalize (the architecture contract is "normalized" = "trimmed and
  // stable shape" — see ARCH-session-detail-page.md, Compact Tool Metadata).
  return candidate.trim();
}

// (#P4-5) Bash command classification for the workflow funnel. The check is
// the leading-token form (case-insensitive, leading whitespace tolerated) so
// `git commit`, `  git commit -m "..."`, and `GIT COMMIT --amend` all classify
// the same way. We never retain the command body itself.
const GIT_COMMIT_RE = /^\s*git\s+commit\b/i;

function classifyBash(input: unknown): "git-commit" | "other" {
  if (!isRecord(input)) return "other";
  const command = typeof input.command === "string" ? input.command : "";
  return GIT_COMMIT_RE.test(command) ? "git-commit" : "other";
}

interface RawCompactBoundaryLine {
  type: "system/compact_boundary";
  sessionId?: unknown;
  timestamp?: unknown;
  promptId?: unknown;
}

function parseAssistantLine(
  line: RawAssistantLine,
  toolNameByToolUseId: Map<string, string>,
): ParsedLine {
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
        const id = toStr(block.id);
        const name = toStr(block.name);
        if (id !== "") {
          // Record toolUseId → tool name so subsequent tool_result blocks
          // (which arrive in user-type lines, not assistant) can look up
          // the originating tool and apply tool-specific error rules
          // (review #11 / CQ4).
          toolNameByToolUseId.set(id, name);
        }
        // (#P4-5) Populate the additive compact metadata for path-bearing
        // tools and Bash. The `input` is captured for sizing only; never
        // retained past `inputBytes` / the classification.
        const input = block.input ?? {};
        const toolRef: ApiCall["tools"][number] = {
          name,
          id: id !== "" ? id : undefined,
          inputBytes: Buffer.byteLength(JSON.stringify(input), "utf8"),
        };
        const targetPath = extractTargetPath(name, input);
        if (targetPath !== undefined) {
          toolRef.targetPath = targetPath;
        }
        if (name === "Bash") {
          toolRef.bashKind = classifyBash(input);
          // V2 failing-command-loop gate (#P4-11) needs the full command
          // text to detect "same normalized command repeated". Other
          // tools keep the compact `inputBytes`-only footprint.
          if (isRecord(input) && typeof input.command === "string" && input.command.length > 0) {
            toolRef.bashCommand = input.command;
          }
        }
        tools.push(toolRef);
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

function parseUserLine(line: RawUserLine, toolNameByToolUseId: Map<string, string>): ParsedLine {
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
        const toolUseId = toStr(block.tool_use_id);
        // Review #11 / CQ4: exit-code fallback is Bash-only. Look up the
        // originating tool_use block's name (recorded from earlier assistant
        // tool_use entries in the same batch via toolNameByToolUseId); when
        // it's "Bash" AND `is_error` isn't explicitly set, fall back to a
        // parsed exit-code comparison. Non-Bash tools' raw `is_error: true`
        // flag stays authoritative — we never synthesize an error for them.
        const originatingToolName = toolNameByToolUseId.get(toolUseId);
        let isError: boolean;
        if (block.is_error === true) {
          isError = true;
        } else if (originatingToolName === "Bash") {
          const exitCode = extractExitCode(rawContent);
          // Exit code present and non-zero → failure. Exit code 0 (or
          // missing/unparseable) → not a failure on this axis. The pre-fix
          // regex flagged "exit code 0; copied 1 file" as failed because the
          // trailing digit matched the unbounded grep — fixed here.
          isError = exitCode !== null && exitCode !== 0;
        } else {
          isError = false;
        }
        return {
          kind: "tool-result-bytes",
          record: {
            sessionId,
            promptId,
            toolUseId,
            bytes: Buffer.byteLength(rawContent, "utf8"),
            isError,
            isSidechain: line.isSidechain === true,
          },
        };
      }
    }
  }

  return { kind: "skipped" };
}

export function parseTranscriptLine(
  rawLine: string,
  seenMessageIds: Set<string>,
  toolNameByToolUseId: Map<string, string> = new Map(),
): ParsedLine {
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
    return parseUserLine(parsed as unknown as RawUserLine, toolNameByToolUseId);
  }

  if (parsed.type === "system/compact_boundary") {
    return parseCompactBoundaryLine(parsed as unknown as RawCompactBoundaryLine);
  }

  if (parsed.type !== "assistant") {
    return { kind: "skipped" };
  }

  const result = parseAssistantLine(parsed as unknown as RawAssistantLine, toolNameByToolUseId);
  if (result.kind !== "call") {
    return result;
  }

  if (seenMessageIds.has(result.call.messageId)) {
    return { kind: "duplicate" };
  }
  seenMessageIds.add(result.call.messageId);
  return result;
}

// (#P4-5) Recognized but minimal: a missing sessionId would mean the
// record can't be partitioned into any session snapshot, so it's skipped
// rather than malformed — every other "missing required" line has a clear
// session-less treatment in parseUserLine. Optional fields stay optional.
function parseCompactBoundaryLine(line: RawCompactBoundaryLine): ParsedLine {
  const sessionId = toStr(line.sessionId);
  if (sessionId === "") {
    return { kind: "skipped" };
  }
  const timestamp = toOptionalStr(line.timestamp);
  const promptId = toOptionalStr(line.promptId);
  const record: CompactionRecord = { sessionId };
  if (timestamp !== undefined) record.timestamp = timestamp;
  if (promptId !== undefined) record.promptId = promptId;
  return { kind: "compaction", record };
}

export function parseTranscriptLines(
  rawLines: string[],
  seenMessageIds: Set<string>,
  /** Optional starting state for the toolUseId → tool-name map. Callers
   * parsing across multiple files/batches (warm-cache reconstruction) can
   * pass a map they've pre-populated from earlier batches; otherwise the
   * parser builds one fresh for this batch. */
  initialToolNameMap?: Map<string, string>,
): ParseTranscriptResult {
  const result: ParseTranscriptResult = {
    calls: [],
    prompts: [],
    toolResultBytes: [],
    compactions: [],
    duplicateCount: 0,
    malformedCount: 0,
  };

  // Single-source toolUseId → tool-name state for this batch. Maintained
  // across lines so a tool_result (which arrives in a user line, not the
  // assistant line that declared the tool) can resolve the originating tool
  // (review #11 / CQ4 — Bash-specific exit-code fallback).
  const toolNameByToolUseId = initialToolNameMap ?? new Map<string, string>();

  for (const rawLine of rawLines) {
    const parsed = parseTranscriptLine(rawLine, seenMessageIds, toolNameByToolUseId);
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
      case "compaction":
        result.compactions.push(parsed.record);
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
