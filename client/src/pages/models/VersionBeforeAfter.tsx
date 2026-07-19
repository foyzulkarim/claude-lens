import { useMemo } from "react";
import type { Series } from "../../../../shared/metrics-contract.js";
import { TierBadge } from "../../components/TierBadge.js";
import { versionBucket, VERSION_BUCKET_UNKNOWN } from "./versionBuckets.js";

/**
 * CC-version before/after compare (pages spec §6 — "Nobody else can show
 * this"). Groups raw semver versions into presentation buckets (`v3.18.x`)
 * client-side via `versionBuckets`, then renders the two most recent
 * non-unknown buckets side-by-side.
 *
 * No version drill-link: the Sessions page's URL schema understands
 * `version` only as a sort column (see `shared/sessions-contract.ts:58`),
 * not a filter dimension. The version bucket is informational for now;
 * pinning the visual contract leaves us the right hook to add a drill
 * once the contract gains `version`.
 */

export interface VersionBeforeAfterProps {
  data: Series[] | undefined;
  isPending?: boolean;
  isError?: boolean;
  error?: Error | null;
}

interface BucketSummary {
  bucket: string;
  major: number;
  minor: number;
  tokensPerTurn: number | null;
  cacheHitPct: number | null;
  dollarsPerTurn: number | null;
  turns: number;
  /** Sample count for the "n sessions" footnote. */
  samples: number;
}

const COMPACT_INT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 0,
});

const PERCENT_FORMAT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const CURRENCY_FORMAT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function safeDiv(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator === 0) return null;
  return numerator / denominator;
}

function deriveBuckets(data: Series[] | undefined): BucketSummary[] {
  if (!data || data.length === 0) return [];
  const map = new Map<string, BucketSummary>();

  // Pulled apart from the inner loop so a regex recompile per call
  // doesn't matter — `versionBucket` already does the parsing and
  // we lift the major/minor out here for numeric (not lexicographic)
  // sorting further down.
  const parseMajorMinor = (bucket: string): { major: number; minor: number } => {
    const m = /^v(\d+)\.(\d+)\.x$/.exec(bucket);
    if (!m) return { major: -1, minor: -1 };
    return { major: Number.parseInt(m[1] ?? "-1", 10), minor: Number.parseInt(m[2] ?? "-1", 10) };
  };

  for (const series of data) {
    const raw = series.label || series.dimensionKey;
    const bucket = versionBucket(raw);
    if (bucket === VERSION_BUCKET_UNKNOWN) continue;

    let summary = map.get(bucket);
    if (!summary) {
      const { major, minor } = parseMajorMinor(bucket);
      summary = {
        bucket,
        major,
        minor,
        tokensPerTurn: null,
        cacheHitPct: null,
        dollarsPerTurn: null,
        turns: 0,
        samples: 0,
      };
      map.set(bucket, summary);
    }

    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheCreate = 0;
    let turns = 0;
    let cost = 0;
    for (const p of series.points) {
      const value = typeof p.value === "number" && Number.isFinite(p.value) ? p.value : 0;
      switch (series.measure) {
        case "inputTokens":
          input += value;
          break;
        case "outputTokens":
          output += value;
          break;
        case "cacheReadTokens":
          cacheRead += value;
          break;
        case "cacheCreateTokens":
          cacheCreate += value;
          break;
        case "turns":
          turns += value;
          break;
        case "costComputed":
          cost += value;
          break;
      }
    }

    const eligible = input + cacheRead + cacheCreate;
    summary.cacheHitPct = eligible > 0 ? cacheRead / eligible : null;
    summary.tokensPerTurn = safeDiv(input + output, turns);
    summary.dollarsPerTurn = safeDiv(cost, turns);
    summary.turns = turns;
    summary.samples += 1;
  }

  // Numeric sort by major then minor — string `"v10.0.x".localeCompare("v9.0.x")`
  // would put v10 before v9, which would visibly flip the "before / after"
  // pairing whenever both exist.
  return [...map.values()].sort((a, b) => {
    if (a.major !== b.major) return a.major - b.major;
    return a.minor - b.minor;
  });
}

export function VersionBeforeAfter({ data, isPending, isError, error }: VersionBeforeAfterProps) {
  const buckets = useMemo(() => deriveBuckets(data), [data]);

  if (isError) {
    return (
      <section
        data-testid="version-before-after"
        aria-labelledby="version-heading"
        className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
      >
        <div className="flex items-center justify-between">
          <h2
            id="version-heading"
            className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
          >
            Before / after Claude Code update
          </h2>
          <TierBadge level="exact">version from transcript</TierBadge>
        </div>
        <p role="alert" className="mt-3 text-sm text-[#B23A3A] dark:text-[#E05252]">
          {error?.message ?? "Failed to load version data"}
        </p>
      </section>
    );
  }

  // Pick the two most-recent buckets (numeric sort guarantees monotonic
  // ordering regardless of digit length).
  const recent = buckets.slice(-2);
  const before = recent[0];
  const after = recent[1];
  const havePair = Boolean(before && after && before !== after);

  return (
    <section
      data-testid="version-before-after"
      aria-labelledby="version-heading"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex items-center justify-between">
        <h2
          id="version-heading"
          className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
        >
          Before / after Claude Code update
        </h2>
        <TierBadge level="exact">version from transcript</TierBadge>
      </div>

      {isPending ? (
        <p role="status" className="mt-4 text-sm text-slate-500 dark:text-[#8B98A9]">
          Loading version history…
        </p>
      ) : buckets.length === 0 ? (
        <p role="status" className="mt-4 text-sm text-slate-500 dark:text-[#8B98A9]">
          No CC version data in this range.
        </p>
      ) : !havePair || !before || !after ? (
        <p className="mt-4 text-sm text-slate-600 dark:text-[#8A96A5]">
          Only one CC version observed ({before?.bucket ?? "unknown"}). Need at least two to
          compare.
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-2 dark:border-[#232B36] dark:bg-[#232B36]">
            <BucketCard bucket={before} />
            <BucketCard bucket={after} />
          </div>
          <DeltaFootnote before={before} after={after} />
        </>
      )}
    </section>
  );
}

function BucketCard({ bucket }: { bucket: BucketSummary }) {
  const tokensPerTurn = bucket.tokensPerTurn;
  const cacheHitPct = bucket.cacheHitPct;
  return (
    <div className="bg-white p-4 dark:bg-[#151A21]">
      <p className="font-mono text-[11px] text-slate-500 dark:text-[#8B98A9]">{bucket.bucket}</p>
      <p className="mt-1.5 font-mono text-[20px] tabular-nums text-slate-900 dark:text-[#E8EDF2]">
        {tokensPerTurn === null ? "—" : `${COMPACT_INT.format(tokensPerTurn)} tok/turn`}
      </p>
      <p className="mt-1 font-mono text-[13px] text-[#0E7A8C] dark:text-[#4FC3D9]">
        {cacheHitPct === null ? "—" : `${PERCENT_FORMAT.format(cacheHitPct * 100)}% cache`}
      </p>
      {bucket.dollarsPerTurn !== null ? (
        <p className="mt-1 font-mono text-[12px] text-slate-600 dark:text-[#8A96A5]">
          {CURRENCY_FORMAT.format(bucket.dollarsPerTurn)}/turn
        </p>
      ) : null}
    </div>
  );
}

function DeltaFootnote({ before, after }: { before: BucketSummary; after: BucketSummary }) {
  const tokens = safeDiv(after.tokensPerTurn ?? 0, before.tokensPerTurn ?? 0);
  const cache = safeDiv(after.cacheHitPct ?? 0, before.cacheHitPct ?? 0);
  const dollars = safeDiv(after.dollarsPerTurn ?? 0, before.dollarsPerTurn ?? 0);

  return (
    <p className="mt-3 font-mono text-[11px] text-slate-600 dark:text-[#8A96A5]">
      {tokens === null
        ? "tok/turn change n/a"
        : Math.abs(tokens - 1) < 0.01
          ? "tok/turn flat"
          : `tok/turn ${tokens > 1 ? "▲" : "▼"} ${Math.round(Math.abs(tokens - 1) * 100)}%`}
      {" · "}
      {cache === null
        ? "cache % change n/a"
        : Math.abs(cache - 1) < 0.01
          ? "cache hit rate flat"
          : `cache hit ${cache > 1 ? "▲" : "▼"} ${(Math.abs(cache - 1) * 100).toFixed(1)}pp`}
      {" · "}
      {dollars === null
        ? "$/turn change n/a"
        : Math.abs(dollars - 1) < 0.03
          ? "$/turn flat"
          : `$/turn ${dollars > 1 ? "▲" : "▼"} ${Math.round(Math.abs(dollars - 1) * 100)}%`}
    </p>
  );
}
