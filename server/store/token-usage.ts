import type { TokenUsage } from "../../shared/types.js";

export function emptyUsage(): TokenUsage {
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

export function addUsage(target: TokenUsage, usage: TokenUsage): void {
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.cacheReadTokens += usage.cacheReadTokens;
  target.cacheCreateTokens += usage.cacheCreateTokens;
  target.cacheCreate5m = (target.cacheCreate5m ?? 0) + (usage.cacheCreate5m ?? 0);
  target.cacheCreate1h = (target.cacheCreate1h ?? 0) + (usage.cacheCreate1h ?? 0);
  target.webSearchRequests = (target.webSearchRequests ?? 0) + (usage.webSearchRequests ?? 0);
  target.webFetchRequests = (target.webFetchRequests ?? 0) + (usage.webFetchRequests ?? 0);
}
