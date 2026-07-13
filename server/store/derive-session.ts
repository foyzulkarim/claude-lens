import type { ApiCall, Session, TierFlags, Turn, TokenUsage } from "../../shared/types.js";

// Per-session tier detection (architecture §4): which sidecar files exist for
// this session. Full C/B/L *parsing* (turning those files into observed
// costs) is #P4-13's job — here we only know presence, so costBasis is always
// "computed" until #P4-13 wires observed values through.
export interface SessionSidecarFlags {
  hasCostSamples: boolean;
  hasTurnBoundaries: boolean;
  hasCostLog: boolean;
}

// Pricing ships in #P2-8 (decisions log, 2026-07-06). Until it's injected,
// costComputed is 0 rather than fabricated — a session with real usage and
// $0 cost is a visible, honest "not priced yet" state, not silently wrong.
export type Pricer = (usage: TokenUsage, model: string) => number;

function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    cacheCreate5m: 0,
    cacheCreate1h: 0,
    webSearchRequests: 0,
    webFetchRequests: 0,
  };
}

function addUsage(target: TokenUsage, usage: TokenUsage): void {
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.cacheReadTokens += usage.cacheReadTokens;
  target.cacheCreateTokens += usage.cacheCreateTokens;
  target.cacheCreate5m = (target.cacheCreate5m ?? 0) + (usage.cacheCreate5m ?? 0);
  target.cacheCreate1h = (target.cacheCreate1h ?? 0) + (usage.cacheCreate1h ?? 0);
  target.webSearchRequests = (target.webSearchRequests ?? 0) + (usage.webSearchRequests ?? 0);
  target.webFetchRequests = (target.webFetchRequests ?? 0) + (usage.webFetchRequests ?? 0);
}

export function deriveSession(
  sessionId: string,
  calls: ApiCall[],
  turns: Turn[],
  sidecars: SessionSidecarFlags,
  pricer?: Pricer,
): Session {
  const usage = emptyUsage();
  const models = new Set<string>();
  let firstAt = "";
  let lastAt = "";
  let project = "";
  let entrypoint = "";
  let gitBranch = "";
  let version = "";
  let costComputed = 0;

  for (const call of calls) {
    addUsage(usage, call.usage);
    if (call.model) models.add(call.model);
    if (firstAt === "" || call.timestamp < firstAt) firstAt = call.timestamp;
    if (lastAt === "" || call.timestamp > lastAt) lastAt = call.timestamp;
    // Host/machine is not in any file (architecture §4) — cwd/gitBranch/version/
    // entrypoint come from calls, last-write-wins across a session is fine since
    // they rarely change mid-session and this is a fallback when they don't.
    if (call.cwd) project = call.cwd;
    if (call.entrypoint) entrypoint = call.entrypoint;
    if (call.gitBranch) gitBranch = call.gitBranch;
    if (call.version) version = call.version;
    if (pricer) costComputed += pricer(call.usage, call.model);
  }

  const cacheEligible = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreateTokens;
  const cacheHitPct = cacheEligible > 0 ? usage.cacheReadTokens / cacheEligible : 0;

  const tier: TierFlags = {
    hasCostSamples: sidecars.hasCostSamples,
    hasTurnBoundaries: sidecars.hasTurnBoundaries,
    hasCostLog: sidecars.hasCostLog,
    costBasis: "computed",
  };

  const durationMs =
    firstAt !== "" && lastAt !== "" ? Date.parse(lastAt) - Date.parse(firstAt) : undefined;

  return {
    sessionId,
    lineageId: sessionId,
    project,
    entrypoint,
    models: [...models],
    gitBranch,
    version,
    tier,
    firstAt,
    lastAt,
    usage,
    turnCount: turns.length,
    callCount: calls.length,
    costComputed,
    cacheHitPct,
    durationMs,
  };
}
