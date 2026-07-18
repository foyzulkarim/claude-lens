import type {
  CacheLabAnalysis,
  MissAttributionVerdict,
} from "../../../../shared/cache-lab-contract.js";

// Color/text comes from the verdict itself (not just numeric counts)
// so the panel communicates "we know what's happening" rather than
// dumping three indistinguishable numbers. Sentiment: prefix-change is
// the actionable "your cache broke because of code/config drift"
// signal; ttl-lapse is benign "the cache TTL elapsed, no action".
const VERDICT_PRESENTATION: Record<
  MissAttributionVerdict,
  { label: string; description: string; color: "ok" | "warn" | "neutral" }
> = {
  "ttl-lapse": {
    label: "TTL lapse",
    description: "Most invalidations were caused by cache TTLs expiring before the next rewrite.",
    color: "warn",
  },
  "prefix-change": {
    label: "Prefix change",
    description:
      "Most invalidations were caused by mid-session prefix churn (system prompt / MCP / settings drift).",
    color: "warn",
  },
  mixed: {
    label: "Mixed",
    description: "Both TTL lapse and prefix-change invalidations contributed meaningfully.",
    color: "warn",
  },
  "insufficient-evidence": {
    label: "Insufficient evidence",
    description: "Classified spikes existed but the TTL overlay could not attribute them.",
    color: "neutral",
  },
  "no-events": {
    label: "No invalidations",
    description: "No cache writes crossed the spike threshold in range — cache is stable.",
    color: "ok",
  },
};

const COLOR_CLASS: Record<"ok" | "warn" | "neutral", string> = {
  ok: "bg-[#E7F4ED] text-[#1E7F49] dark:bg-[#173A2A] dark:text-[#55B87A]",
  warn: "bg-[#FDF4E3] text-[#96631E] dark:bg-[#3A2C18] dark:text-[#E8A33D]",
  neutral: "bg-slate-100 text-slate-700 dark:bg-[#1B222B] dark:text-[#8A96A5]",
};

/**
 * Miss-attribution panel (ARCH §T6 R4): "TTL lapse (idle gap > TTL) vs
 * prefix change (K2 classifier) vs unknown, verdict chip". The panel
 * shows three counts side-by-side plus a verdict pill that summarizes
 * the dominant cause — a user looking at the page wants a one-sentence
 * answer, not three independent percentages.
 */
export function MissAttributionPanel({
  data,
  error,
}: {
  data: CacheLabAnalysis | undefined;
  error?: Error | null;
}) {
  if (!data) {
    return (
      <section
        data-testid="miss-attribution"
        className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
      >
        <h2
          id="miss-attribution-heading"
          className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
        >
          Miss attribution
        </h2>
        <p
          role={error ? "alert" : "status"}
          className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]"
        >
          {error ? `Cache Lab analysis failed: ${error.message}` : "Loading…"}
        </p>
      </section>
    );
  }
  const { attribution } = data;
  const presentation = VERDICT_PRESENTATION[attribution.verdict];
  return (
    <section
      data-testid="miss-attribution"
      aria-labelledby="miss-attribution-heading"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2
        id="miss-attribution-heading"
        className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
      >
        Miss attribution
      </h2>

      <p
        className={
          "mt-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium " +
          COLOR_CLASS[presentation.color]
        }
        data-testid="miss-attribution-verdict"
      >
        {presentation.label}
      </p>
      <p className="mt-2 text-sm text-slate-600 dark:text-[#8A96A5]">{presentation.description}</p>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-slate-600 dark:text-[#8A96A5]">TTL lapse</dt>
          <dd
            className="mt-1 font-mono text-base text-slate-900 dark:text-[#E8EDF2]"
            data-testid="miss-attribution-ttl"
          >
            {attribution.ttlLapseCount}
          </dd>
        </div>
        <div>
          <dt className="text-slate-600 dark:text-[#8A96A5]">Prefix change</dt>
          <dd
            className="mt-1 font-mono text-base text-slate-900 dark:text-[#E8EDF2]"
            data-testid="miss-attribution-prefix"
          >
            {attribution.prefixChangeCount}
          </dd>
        </div>
        <div>
          <dt className="text-slate-600 dark:text-[#8A96A5]">Unknown</dt>
          <dd
            className="mt-1 font-mono text-base text-slate-900 dark:text-[#E8EDF2]"
            data-testid="miss-attribution-unknown"
          >
            {attribution.unknownCount}
          </dd>
        </div>
      </dl>
    </section>
  );
}
