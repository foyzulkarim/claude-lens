import type {
  TurnInspectorError,
  TurnInspectorResponse,
  TurnTranscriptPeekError,
  TurnTranscriptPeekResponse,
} from "../../../shared/turn-inspector-contract.js";

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/** Mirrors `SessionDetailApiError`'s contract for the Turn Inspector routes. */
export class TurnInspectorApiError extends Error {
  readonly status: number;
  readonly validation: string | null;

  constructor(status: number, validation: string | null, message: string) {
    super(message);
    this.name = "TurnInspectorApiError";
    this.status = status;
    this.validation = validation;
  }
}

/** Thrown when a 2xx response fails the response-shape guard. */
export class TurnInspectorResponseShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TurnInspectorResponseShapeError";
  }
}

// ---------------------------------------------------------------------------
// Response shape guards
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteOrNull(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isFiniteOrUndefined(value: unknown): value is number | undefined {
  return value === undefined || isFiniteNumber(value);
}

function isStringOrUndefined(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

const CAUSE_LABELS = new Set(["first-call", "model-switch", "compaction", "unexplained"]);

function isWaterfallTool(value: unknown): boolean {
  return isObject(value) && typeof value.name === "string" && isFiniteNumber(value.inputBytes);
}

function isWaterfallCall(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    isFiniteNumber(value.callIndex) &&
    typeof value.messageId === "string" &&
    typeof value.timestamp === "string" &&
    isFiniteNumber(value.offsetMs) &&
    isFiniteNumber(value.tokens) &&
    isFiniteNumber(value.cost) &&
    Array.isArray(value.tools) &&
    value.tools.every(isWaterfallTool) &&
    typeof value.isSidechain === "boolean" &&
    isFiniteNumber(value.cacheReadTokens) &&
    isFiniteNumber(value.cacheCreateTokens)
  );
}

function isCacheNarrativePoint(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    isFiniteNumber(value.callIndex) &&
    typeof value.cause === "string" &&
    CAUSE_LABELS.has(value.cause) &&
    typeof value.isWriteSpike === "boolean" &&
    isFiniteNumber(value.hitRate) &&
    isFiniteNumber(value.cacheReadTokens) &&
    isFiniteNumber(value.cacheCreateTokens) &&
    isStringOrUndefined(value.narrative)
  );
}

function isSidechain(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    isStringOrUndefined(value.agentId) &&
    isFiniteNumber(value.cost) &&
    isFiniteNumber(value.tokens) &&
    isFiniteNumber(value.callCount) &&
    typeof value.primaryModel === "string"
  );
}

function assertTurnInspectorResponse(value: unknown): asserts value is TurnInspectorResponse {
  if (!isObject(value)) {
    throw new TurnInspectorResponseShapeError("expected object at the response root");
  }
  const s = value.summary;
  if (
    !isObject(s) ||
    typeof s.sessionId !== "string" ||
    !isFiniteNumber(s.turnNumber) ||
    !isFiniteNumber(s.totalTurns) ||
    typeof s.promptId !== "string" ||
    !isStringOrUndefined(s.promptText) ||
    typeof s.startedAt !== "string" ||
    typeof s.endedAt !== "string" ||
    !isFiniteNumber(s.cost) ||
    !isFiniteNumber(s.tokens) ||
    !isFiniteNumber(s.callCount) ||
    !isStringArray(s.models) ||
    typeof s.primaryModel !== "string" ||
    !isFiniteOrNull(s.fleetPercentile) ||
    typeof s.isAnomaly !== "boolean" ||
    !isFiniteOrUndefined(s.apiMs) ||
    !isFiniteOrUndefined(s.wallMs)
  ) {
    throw new TurnInspectorResponseShapeError("summary does not match the contract shape");
  }
  if (
    !isObject(value.waterfall) ||
    !Array.isArray(value.waterfall.calls) ||
    !value.waterfall.calls.every(isWaterfallCall)
  ) {
    throw new TurnInspectorResponseShapeError("waterfall does not match the contract shape");
  }
  if (!Array.isArray(value.cacheNarrative) || !value.cacheNarrative.every(isCacheNarrativePoint)) {
    throw new TurnInspectorResponseShapeError("cacheNarrative does not match the contract shape");
  }
  const sb = value.sidechainBreakdown;
  if (
    !isObject(sb) ||
    !isFiniteNumber(sb.mainCost) ||
    !isFiniteNumber(sb.mainTokens) ||
    !isFiniteNumber(sb.mainCallCount) ||
    !Array.isArray(sb.sidechains) ||
    !sb.sidechains.every(isSidechain)
  ) {
    throw new TurnInspectorResponseShapeError(
      "sidechainBreakdown does not match the contract shape",
    );
  }
  const nav = value.nav;
  if (
    !isObject(nav) ||
    !isFiniteOrNull(nav.prevTurnNumber) ||
    !isFiniteOrNull(nav.nextTurnNumber) ||
    !isFiniteNumber(nav.totalTurns)
  ) {
    throw new TurnInspectorResponseShapeError("nav does not match the contract shape");
  }
  const meta = value.meta;
  if (
    !isObject(meta) ||
    (meta.costBasis !== "computed" && meta.costBasis !== "observed") ||
    !isStringArray(meta.availability) ||
    !isFiniteNumber(meta.fleetBaselineSize)
  ) {
    throw new TurnInspectorResponseShapeError("meta does not match the contract shape");
  }
}

const PEEK_ROLES = new Set(["assistant-text", "tool-use", "tool-result"]);

function isPeekLine(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    typeof value.role === "string" &&
    PEEK_ROLES.has(value.role) &&
    isStringOrUndefined(value.toolName) &&
    typeof value.preview === "string" &&
    isFiniteOrUndefined(value.bytes)
  );
}

function assertTranscriptPeekResponse(value: unknown): asserts value is TurnTranscriptPeekResponse {
  if (
    !isObject(value) ||
    !Array.isArray(value.lines) ||
    !value.lines.every(isPeekLine) ||
    typeof value.truncated !== "boolean"
  ) {
    throw new TurnInspectorResponseShapeError(
      "transcript peek response does not match the contract shape",
    );
  }
}

// ---------------------------------------------------------------------------
// Wrappers
// ---------------------------------------------------------------------------

/**
 * The single client caller of `GET /api/sessions/:id/turns/:n`
 * (server/routes/turn-inspector.ts). Session IDs are `encodeURIComponent`-ed
 * for the same reason `getSessionDetail` does — the architectural contract
 * is UUID-shaped, but the URL must stay well-formed regardless.
 */
export async function getTurnInspector(
  sessionId: string,
  turnNumber: number,
  signal?: AbortSignal,
): Promise<TurnInspectorResponse> {
  const url = `/api/sessions/${encodeURIComponent(sessionId)}/turns/${turnNumber}`;
  const response = await fetch(url, { signal });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as TurnInspectorError | null;
    const validation =
      body && typeof body === "object" && typeof body.error === "string"
        ? body.error
        : response.statusText;
    throw new TurnInspectorApiError(
      response.status,
      validation,
      `GET ${url} failed (${response.status}): ${validation}`,
    );
  }

  const body: unknown = await response.json();
  assertTurnInspectorResponse(body);
  return body;
}

/** The single client caller of `GET /api/sessions/:id/transcript?turn=n`. */
export async function getTurnTranscriptPeek(
  sessionId: string,
  turnNumber: number,
  signal?: AbortSignal,
): Promise<TurnTranscriptPeekResponse> {
  const url = `/api/sessions/${encodeURIComponent(sessionId)}/transcript?turn=${turnNumber}`;
  const response = await fetch(url, { signal });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as TurnTranscriptPeekError | null;
    const validation =
      body && typeof body === "object" && typeof body.error === "string"
        ? body.error
        : response.statusText;
    throw new TurnInspectorApiError(
      response.status,
      validation,
      `GET ${url} failed (${response.status}): ${validation}`,
    );
  }

  const body: unknown = await response.json();
  assertTranscriptPeekResponse(body);
  return body;
}
