import { formatUnitValue } from "../../charts/units.js";
import { EmptyState } from "../../components/EmptyState.js";
import type { CacheLabAnalysis } from "../../../../shared/cache-lab-contract.js";

/**
 * Net cache-benefit panel (ARCH §T6 R3): "saved by cache vs. lost to
 * busts → NET, net-negative badge per session". Renders three segments
 * (cache savings, bust loss, net) plus the net-negative session count
 * — the headline financial claim, so it owns an isolated error state
 * even if the rest of the page has data.
 */
export function BustEconomicsPanel({
  data,
  error,
}: {
  data: CacheLabAnalysis | undefined;
  error?: Error | null;
}) {
  if (!data) {
    return (
      <section
        data-testid="bust-economics"
        aria-labelledby="bust-economics-heading"
        className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
      >
        <h2
          id="bust-economics-heading"
          className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
        >
          Cache busts vs savings
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
  const { economics } = data;
  const bustLossLabel =
    economics.bustLoss === null ? "—" : formatUnitValue(economics.bustLoss, "$");
  const savingsLabel =
    economics.cacheSavings === null ? "—" : formatUnitValue(economics.cacheSavings, "$");
  const netLabel = economics.netBenefit === null ? "—" : formatUnitValue(economics.netBenefit, "$");

  return (
    <section
      data-testid="bust-economics"
      aria-labelledby="bust-economics-heading"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2
        id="bust-economics-heading"
        className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
      >
        Cache busts vs savings
      </h2>

      {!economics.pricingComplete && (
        <p role="status" className="mt-3 text-xs text-[#B23A3A] dark:text-[#E05252]">
          Pricing incomplete — showing token counts only.
        </p>
      )}

      {economics.cacheSavings === 0 && economics.bustLoss === 0 && economics.bustCount === 0 && (
        <EmptyState message="No cache activity in range" />
      )}

      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm" data-testid="bust-economics-grid">
        <div>
          <dt className="text-slate-600 dark:text-[#8A96A5]">Saved by cache</dt>
          <dd className="mt-1 font-mono text-base text-slate-900 dark:text-[#E8EDF2]">
            {savingsLabel}
          </dd>
        </div>
        <div>
          <dt className="text-slate-600 dark:text-[#8A96A5]">Lost to busts</dt>
          <dd className="mt-1 font-mono text-base text-[#B23A3A] dark:text-[#E05252]">
            {bustLossLabel}
          </dd>
        </div>
        <div>
          <dt className="text-slate-600 dark:text-[#8A96A5]">NET</dt>
          <dd
            className={
              "mt-1 font-mono text-base " +
              (economics.netBenefit === null
                ? "text-slate-500 dark:text-[#8A96A5]"
                : economics.netBenefit < 0
                  ? "text-[#B23A3A] dark:text-[#E05252]"
                  : "text-[#1E7F49] dark:text-[#55B87A]")
            }
            data-testid="bust-economics-net"
          >
            {netLabel}
          </dd>
        </div>
      </dl>

      {economics.netNegativeSessionCount > 0 && (
        <p
          className="mt-3 text-xs text-[#B23A3A] dark:text-[#E05252]"
          data-testid="bust-economics-negative-sessions"
        >
          {economics.netNegativeSessionCount} session
          {economics.netNegativeSessionCount === 1 ? "" : "s"} net negative
        </p>
      )}
    </section>
  );
}
