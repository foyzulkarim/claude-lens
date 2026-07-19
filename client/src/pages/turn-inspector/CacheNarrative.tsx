import type {
  TurnInspectorCacheCause,
  TurnInspectorCachePoint,
} from "../../../../shared/turn-inspector-contract.js";
import { Badge } from "../../components/Badge.js";
import { formatTokens } from "./format.js";

export interface CacheNarrativeProps {
  points: TurnInspectorCachePoint[];
}

const CAUSE_VARIANT: Record<TurnInspectorCacheCause, "neutral" | "warn" | "fail"> = {
  "first-call": "neutral",
  "model-switch": "warn",
  compaction: "warn",
  unexplained: "fail",
};

/**
 * Cache narrative panel (#P4-6): per-call read/write breakdown with a short
 * generated narrative on notable points (write spikes / unexplained
 * causes), reusing the same K2-compatible cause classification Session
 * Detail's Cache Strip already renders — so the two pages never disagree
 * about why a given call's cache hit rate dropped.
 */
export function CacheNarrative({ points }: CacheNarrativeProps): React.JSX.Element {
  if (points.length === 0) {
    return (
      <section
        aria-label="Cache narrative"
        data-testid="turn-inspector-cache-narrative"
        className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
      >
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
          Cache narrative
        </h2>
        <p className="mt-3 text-xs text-slate-500 dark:text-[#8A96A5]">
          No cache activity in this turn.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="Cache narrative"
      data-testid="turn-inspector-cache-narrative"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">Cache narrative</h2>
      <ul aria-label="Cache points" className="mt-3 space-y-2">
        {points.map((point) => (
          <li key={point.callIndex} className="flex gap-2 text-xs">
            <Badge variant={CAUSE_VARIANT[point.cause]}>c{point.callIndex + 1}</Badge>
            <div className="text-slate-600 dark:text-[#8A96A5]">
              {point.narrative ?? (
                <>
                  Read {formatTokens(point.cacheReadTokens)} cached tokens (
                  {Math.round(point.hitRate * 100)}% hit)
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
