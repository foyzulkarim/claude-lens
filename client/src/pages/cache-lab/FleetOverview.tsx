import type { Series } from "../../../../shared/metrics-contract.js";
import { formatUnitValue } from "../../charts/units.js";
import { StatCard, StatRow } from "../../components/StatCard.js";
import type { CacheLabAnalysis } from "../../../../shared/cache-lab-contract.js";

/**
 * Cache Lab overview quartet (ARCH §T6 R1-R3): cache hit %, tokens
 * saved, busted cache events, and baseline cache-write size. The
 * two left cards reuse the existing `/api/metrics` aggregate (so a
 * Cache Lab endpoint outage can't blank them); the two right cards
 * read `/api/cache-lab` directly.
 *
 * The page composition shell (T8) wires the two data sources
 * together and passes the resolved data down. This component is
 * presentational so Storybook can drive every panel state with a
 * hand-built `data` object.
 */
export function FleetOverview({
  hitRateSeries,
  cacheLab,
}: {
  hitRateSeries: Series[] | undefined;
  cacheLab: CacheLabAnalysis | undefined;
}) {
  return (
    <section data-testid="fleet-overview" aria-labelledby="fleet-overview-heading">
      <h2
        id="fleet-overview-heading"
        className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
      >
        Fleet cache overview
      </h2>
      <StatRow columns={4}>
        <HitRateCard hitRateSeries={hitRateSeries} />
        <SavingsCard cacheLab={cacheLab} />
        <BustCountCard cacheLab={cacheLab} />
        <BaselineCard cacheLab={cacheLab} />
      </StatRow>
    </section>
  );
}

function HitRateCard({ hitRateSeries }: { hitRateSeries: Series[] | undefined }) {
  const total = (hitRateSeries ?? [])
    .filter((s) => s.measure === "cacheHitPct")
    .reduce((sum, s) => {
      const v = s.points[0]?.value;
      return sum + (typeof v === "number" && Number.isFinite(v) ? v : 0);
    }, 0);
  const display = total > 0 ? `${(total * 100).toFixed(1)}%` : "—";
  return <StatCard label="cache hit %" value={display} accent="cache" />;
}

function SavingsCard({ cacheLab }: { cacheLab: CacheLabAnalysis | undefined }) {
  if (!cacheLab) {
    return <StatCard label="tokens saved" value="—" accent="money" />;
  }
  if (cacheLab.economics.cacheSavings === null) {
    return (
      <StatCard
        label="tokens saved"
        value="—"
        accent="money"
        sub={cacheLab.economics.pricingComplete ? "$0 measured" : "Unpriced"}
      />
    );
  }
  return (
    <StatCard
      label="tokens saved"
      value={formatUnitValue(cacheLab.economics.cacheSavings, "$")}
      accent="money"
    />
  );
}

function BustCountCard({ cacheLab }: { cacheLab: CacheLabAnalysis | undefined }) {
  if (!cacheLab) return <StatCard label="busted events" value="—" />;
  return <StatCard label="busted events" value={String(cacheLab.economics.bustCount)} />;
}

function BaselineCard({ cacheLab }: { cacheLab: CacheLabAnalysis | undefined }) {
  if (!cacheLab) return <StatCard label="median baseline" value="—" />;
  const medians = cacheLab.baseline.points
    .map((p) => p.medianTokens)
    .filter((v): v is number => v !== null);
  if (medians.length === 0) {
    return <StatCard label="median baseline" value="—" sub="No samples" />;
  }
  const median = medians.reduce((sum, v) => sum + v, 0) / medians.length;
  const sampleBuckets = cacheLab.baseline.points.filter((p) => p.sampleCount > 0).length;
  return (
    <StatCard
      label="median baseline"
      value={`${Math.round(median / 1000)}k tok`}
      sub={`${sampleBuckets} session samples`}
    />
  );
}
