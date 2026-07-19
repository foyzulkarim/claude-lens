import { useQuery } from "@tanstack/react-query";
import { getConfig } from "../api/config.js";
import { qk } from "../api/queryKeys.js";
import { ChartCard } from "../charts/ChartCard.js";
import { AnomalyFeed } from "./dashboard/AnomalyFeed.js";
import { BurnRateCard } from "./dashboard/BurnRateCard.js";
import { CaptureBanner } from "./dashboard/CaptureBanner.js";
import { FailedWorkStat } from "./dashboard/FailedWorkStat.js";
import { LeaderboardsCard } from "./dashboard/LeaderboardsCard.js";
import { LeverageRatio } from "./dashboard/LeverageRatio.js";
import { RecentSessionCard } from "./dashboard/RecentSessionCard.js";
import { RecordsStrip } from "./dashboard/RecordsStrip.js";
import { SavingsDecomposition } from "./dashboard/SavingsDecomposition.js";
import { StatCardsRow } from "./dashboard/StatCardsRow.js";
import { SubscriptionWindow } from "./dashboard/SubscriptionWindow.js";

/**
 * Dashboard page shell (architecture ARCH-dashboard-page.md T14): composes
 * the 12 sections landed independently in T7-T13 into one responsive page.
 * Section order follows `specs/claude-lens-pages.md` §1's Dashboard table,
 * which is binding over the mockup's visual nesting (ARCH "Specs over
 * mockup for presence") — notably Records strip and the subscription-window
 * tracker are separate top-level sections here even though the mockup nests
 * their text inside the burn-rate panel.
 *
 * Every section component owns its own query, loading state, and error
 * state (decision A5, section-owned queries) — this shell does no data
 * fetching of its own beyond what CaptureBanner needs, and wraps nothing in
 * a page-level error boundary. A thrown exception in one section's render
 * would still be able to unmount the tree, but every section here already
 * guards its fetch failures with `isError` branches (verified per-component
 * in T7-T13), so in practice one section's API outage renders that
 * section's own error text and leaves the rest of the page intact.
 */
export function Dashboard() {
  // #P4-10: the config-sourced monthly budget, threaded into BurnRateCard's
  // existing `budget` prop — its over-budget red state already *is* the
  // Dashboard threshold alert (ARCH-trends-calendar-budget.md decision A6),
  // so no new AnomalyFeedItem kind is introduced for this.
  const { data: config } = useQuery({
    queryKey: qk.config(),
    queryFn: ({ signal }) => getConfig(signal),
  });

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-[#E8EDF2]">Dashboard</h1>

      {/* 1. Stat cards row */}
      <StatCardsRow />

      {/* 2. Cost-over-time chart + 6. Anomaly & gate-failure feed */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard title="Cost over time" defaultUnit="$" />
        </div>
        <AnomalyFeed />
      </div>

      {/* 3. Burn-rate card + 5. Leaderboards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BurnRateCard budget={config?.budget ?? undefined} />
        <LeaderboardsCard />
      </div>

      {/* 4. Most recent session card */}
      <RecentSessionCard />

      {/* 7. Records strip */}
      <RecordsStrip />

      {/* 8. Subscription window tracker + 9. Leverage ratio headline */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SubscriptionWindow />
        <LeverageRatio />
      </div>

      {/* 10. Savings decomposition + 11. Failed-work stat */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SavingsDecomposition />
        <FailedWorkStat />
      </div>

      {/* 12. Capture banner (conditional — renders nothing when C/B/L present) */}
      <CaptureBanner />
    </div>
  );
}
