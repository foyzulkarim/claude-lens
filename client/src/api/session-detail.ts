import type {
  SessionDetailError,
  SessionDetailResponse,
} from "../../../shared/session-detail-contract.js";

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Thrown by `getSessionDetail` on non-2xx responses. `status` is the raw
 * HTTP code (lets UI distinguish 404 not-found from 5xx outages);
 * `validation` is the server's structured `error` field when present, else
 * null. Mirrors `SessionsApiError`'s contract.
 */
export class SessionDetailApiError extends Error {
  readonly status: number;
  readonly validation: string | null;

  constructor(status: number, validation: string | null, message: string) {
    super(message);
    this.name = "SessionDetailApiError";
    this.status = status;
    this.validation = validation;
  }
}

/**
 * Thrown when a 2xx response fails the response-shape guard. Distinct from
 * `SessionDetailApiError` so callers (TanStack Query) can separate "server
 * rejected our request" from "server returned something we can't render".
 * The Session Detail contract is broad — header/timeline/turns/distribution/
 * cache/toolMix/toolTimeline/prompts/workflow/tokenFunnel/contextComposition/
 * meta — so an honest runtime guard surfaces structural skew as a typed
 * throw rather than letting an `undefined`-dereferencing component crash
 * during render. (#P4-5, T5)
 */
export class SessionDetailResponseShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionDetailResponseShapeError";
  }
}

// ---------------------------------------------------------------------------
// Response shape guard
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringOrUndefined(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isFiniteOrUndefined(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isFiniteOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

const CAUSE_LABELS = new Set(["first-call", "model-switch", "compaction", "unexplained"]);
const AVAILABILITY_FIELDS = new Set([
  "header.drift",
  "header.contextPct",
  "turn.apiMs",
  "turn.linesAdded",
  "turn.linesRemoved",
  "turn.cacheSavings",
  "turn.gateStatus",
  "toolMix.targetPaths",
  "toolMix.shellCommands",
  "cache.cause.freshSession",
  "cache.cause.modelSwitch",
  "cache.cause.compaction",
]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isTimelinePoint(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    isFiniteNumber(value.callIndex) &&
    typeof value.timestamp === "string" &&
    isFiniteNumber(value.cumulativeCost) &&
    isFiniteNumber(value.cumulativeTokens) &&
    isFiniteNumber(value.cost) &&
    isFiniteNumber(value.tokens) &&
    (value.contextPct === null || isFiniteNumber(value.contextPct)) &&
    isFiniteNumber(value.turnNumber) &&
    typeof value.isTurnBoundary === "boolean" &&
    typeof value.isCompaction === "boolean"
  );
}

function isTurn(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    isFiniteNumber(value.turnNumber) &&
    typeof value.promptId === "string" &&
    typeof value.startedAt === "string" &&
    typeof value.endedAt === "string" &&
    isFiniteNumber(value.cost) &&
    isFiniteNumber(value.mainCost) &&
    isFiniteNumber(value.sidechainCost) &&
    isFiniteNumber(value.tokens) &&
    isFiniteNumber(value.inputTokens) &&
    isFiniteNumber(value.outputTokens) &&
    isFiniteNumber(value.cacheReadTokens) &&
    isFiniteNumber(value.cacheCreateTokens) &&
    isFiniteNumber(value.callCount) &&
    isFiniteNumber(value.cacheHitPct) &&
    Array.isArray(value.tools) &&
    value.tools.every(isTurnTool) &&
    isFiniteOrNull(value.fleetPercentile) &&
    typeof value.isAnomaly === "boolean" &&
    typeof value.hasSidechain === "boolean" &&
    typeof value.primaryModel === "string" &&
    Array.isArray(value.models) &&
    value.models.every((m) => typeof m === "string") &&
    isStringOrUndefined(value.promptText) &&
    isFiniteOrUndefined(value.apiMs) &&
    isFiniteOrUndefined(value.wallMs) &&
    isFiniteOrUndefined(value.linesAdded) &&
    isFiniteOrUndefined(value.linesRemoved) &&
    isFiniteOrUndefined(value.cacheSavings) &&
    isStringOrUndefined(value.gateStatus)
  );
}

function isTurnTool(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.name === "string" &&
    isFiniteNumber(value.count) &&
    isFiniteNumber(value.inputBytes)
  );
}

function isCachePoint(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    isFiniteNumber(value.callIndex) &&
    typeof value.timestamp === "string" &&
    isFiniteNumber(value.cacheReadTokens) &&
    isFiniteNumber(value.cacheCreateTokens) &&
    isFiniteNumber(value.hitRate) &&
    typeof value.cause === "string" &&
    CAUSE_LABELS.has(value.cause) &&
    typeof value.isWriteSpike === "boolean"
  );
}

function isToolMixItem(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    typeof value.name === "string" &&
    isFiniteNumber(value.callCount) &&
    isFiniteNumber(value.inputBytes) &&
    isFiniteNumber(value.resultBytes) &&
    isFiniteNumber(value.share)
  );
}

function isToolTimelineEvent(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    isFiniteNumber(value.callIndex) &&
    typeof value.timestamp === "string" &&
    typeof value.toolName === "string" &&
    isFiniteNumber(value.turnNumber)
  );
}

function isPrompt(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    isFiniteNumber(value.turnNumber) &&
    typeof value.promptId === "string" &&
    typeof value.timestamp === "string" &&
    typeof value.text === "string"
  );
}

function isWorkflowStage(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    (value.id === "edit" ||
      value.id === "read" ||
      value.id === "plan" ||
      value.id === "verify" ||
      value.id === "commit") &&
    typeof value.label === "string" &&
    isFiniteNumber(value.count)
  );
}

function isContextItem(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    typeof value.toolName === "string" && isFiniteNumber(value.bytes) && isFiniteNumber(value.share)
  );
}

function isHistogramBucket(value: unknown): boolean {
  return (
    isObject(value) &&
    isFiniteNumber(value.rangeStart) &&
    isFiniteNumber(value.rangeEnd) &&
    isFiniteNumber(value.count)
  );
}

function assertSessionDetailResponse(value: unknown): asserts value is SessionDetailResponse {
  if (!isObject(value)) {
    throw new SessionDetailResponseShapeError("expected object at the response root");
  }
  if (!isObject(value.header)) {
    throw new SessionDetailResponseShapeError("expected header object");
  }
  const h = value.header;
  if (
    typeof h.sessionId !== "string" ||
    typeof h.project !== "string" ||
    typeof h.branch !== "string" ||
    typeof h.version !== "string" ||
    !isStringArray(h.models) ||
    typeof h.firstAt !== "string" ||
    typeof h.lastAt !== "string" ||
    !isFiniteNumber(h.logicalTurnCount) ||
    !isFiniteNumber(h.callCount) ||
    !isFiniteNumber(h.costComputed) ||
    !isFiniteOrUndefined(h.costObserved) ||
    !isFiniteOrUndefined(h.contextPctEstimated) ||
    !isFiniteOrNull(h.fleetCostMedian) ||
    !isFiniteOrNull(h.fleetCostRankPct) ||
    !isObject(h.tier) ||
    typeof h.tier.hasCostSamples !== "boolean" ||
    typeof h.tier.hasTurnBoundaries !== "boolean" ||
    typeof h.tier.hasCostLog !== "boolean" ||
    (h.tier.costBasis !== "computed" && h.tier.costBasis !== "observed") ||
    (h.drift !== undefined &&
      (!isObject(h.drift) || !isFiniteNumber(h.drift.delta) || !isFiniteNumber(h.drift.pct)))
  ) {
    throw new SessionDetailResponseShapeError("header does not match the contract shape");
  }
  if (!Array.isArray(value.timeline) || !value.timeline.every(isTimelinePoint)) {
    throw new SessionDetailResponseShapeError("timeline does not match the contract shape");
  }
  if (!Array.isArray(value.turns) || !value.turns.every(isTurn)) {
    throw new SessionDetailResponseShapeError("turns does not match the contract shape");
  }
  if (
    !isObject(value.turnDistribution) ||
    !isFiniteNumber(value.turnDistribution.populationSize) ||
    !isFiniteOrNull(value.turnDistribution.p50) ||
    !isFiniteOrNull(value.turnDistribution.p90) ||
    !isFiniteOrNull(value.turnDistribution.p99) ||
    !Array.isArray(value.turnDistribution.histogram) ||
    !value.turnDistribution.histogram.every(isHistogramBucket) ||
    value.turnDistribution.basis !== "all-history"
  ) {
    throw new SessionDetailResponseShapeError("turnDistribution missing or wrong basis");
  }
  if (!Array.isArray(value.cache) || !value.cache.every(isCachePoint)) {
    throw new SessionDetailResponseShapeError("cache does not match the contract shape");
  }
  if (!Array.isArray(value.toolMix) || !value.toolMix.every(isToolMixItem)) {
    throw new SessionDetailResponseShapeError("toolMix does not match the contract shape");
  }
  if (!Array.isArray(value.toolTimeline) || !value.toolTimeline.every(isToolTimelineEvent)) {
    throw new SessionDetailResponseShapeError("toolTimeline does not match the contract shape");
  }
  if (!Array.isArray(value.prompts) || !value.prompts.every(isPrompt)) {
    throw new SessionDetailResponseShapeError("prompts does not match the contract shape");
  }
  if (!isObject(value.workflow)) {
    throw new SessionDetailResponseShapeError("workflow missing");
  }
  const w = value.workflow;
  if (
    !isFiniteNumber(w.baseEditCount) ||
    !isFiniteNumber(w.readFirstCount) ||
    !isFiniteNumber(w.plannedCount) ||
    !isFiniteNumber(w.verifiedCount) ||
    !isFiniteNumber(w.committedCount) ||
    !Array.isArray(w.stages) ||
    !w.stages.every(isWorkflowStage)
  ) {
    throw new SessionDetailResponseShapeError("workflow does not match the contract shape");
  }
  if (!isObject(value.tokenFunnel)) {
    throw new SessionDetailResponseShapeError("tokenFunnel missing");
  }
  const tf = value.tokenFunnel;
  if (
    !isFiniteNumber(tf.contextOffered) ||
    !isFiniteNumber(tf.cacheServed) ||
    !isFiniteNumber(tf.freshBilled) ||
    !isFiniteNumber(tf.output)
  ) {
    throw new SessionDetailResponseShapeError("tokenFunnel does not match the contract shape");
  }
  if (!Array.isArray(value.contextComposition) || !value.contextComposition.every(isContextItem)) {
    throw new SessionDetailResponseShapeError(
      "contextComposition does not match the contract shape",
    );
  }
  if (
    !isObject(value.meta) ||
    (value.meta.costBasis !== "computed" && value.meta.costBasis !== "observed") ||
    typeof value.meta.isEmpty !== "boolean" ||
    typeof value.meta.isLive !== "boolean" ||
    !Array.isArray(value.meta.availability) ||
    !value.meta.availability.every(
      (field): field is string => typeof field === "string" && AVAILABILITY_FIELDS.has(field),
    ) ||
    !isFiniteNumber(value.meta.fleetBaselineSize)
  ) {
    throw new SessionDetailResponseShapeError("meta does not match the contract shape");
  }
}

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

/**
 * The single client caller of GET /api/sessions/:id (server/routes/session-detail.ts).
 * Mirrors `listSessions`: AbortSignal passthrough for React Query's
 * superseded-request cancellation, typed throw on non-2xx so TanStack Query
 * surfaces it via `isError`/`error`.
 *
 * The session ID is encoded through `encodeURIComponent` so a session ID
 * that contains anything unexpected (the architectural contract is
 * UUID-shaped, but a future migration could change that) never breaks the
 * URL or hits the Fastify router with a malformed path.
 */
export async function getSessionDetail(
  id: string,
  signal?: AbortSignal,
): Promise<SessionDetailResponse> {
  const url = `/api/sessions/${encodeURIComponent(id)}`;
  const response = await fetch(url, { signal });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as SessionDetailError | null;
    const validation =
      body && typeof body === "object" && typeof body.error === "string"
        ? body.error
        : response.statusText;
    throw new SessionDetailApiError(
      response.status,
      validation,
      `GET /api/sessions/${id} failed (${response.status}): ${validation}`,
    );
  }

  const body: unknown = await response.json();
  assertSessionDetailResponse(body);
  return body;
}
