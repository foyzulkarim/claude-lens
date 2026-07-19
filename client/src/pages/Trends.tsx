import { BudgetForecastPanel } from "./trends/BudgetForecastPanel.js";
import { CalendarHeatmapPanel } from "./trends/CalendarHeatmapPanel.js";
import { GatePassRateStub } from "./trends/GatePassRateStub.js";
import { HourWeekdayHeatmapPanel } from "./trends/HourWeekdayHeatmapPanel.js";
import { ParetoPanel } from "./trends/ParetoPanel.js";
import { RollingEfficiencyPanel } from "./trends/RollingEfficiencyPanel.js";
import { StackedWeeklyBarsPanel } from "./trends/StackedWeeklyBarsPanel.js";

/**
 * Trends, Calendar & Budget page shell (#P4-10; ARCH-trends-calendar-budget.md).
 * Composes the 7 sections (5 from the mockup + the stacked-weekly-bars gap
 * fill, per the pages-spec §8 table, + the gate pass-rate stub) into one
 * responsive page, same pattern as `Dashboard.tsx`: every section owns its
 * own query/loading/error state, this shell does no fetching of its own.
 */
export function Trends() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-[#E8EDF2]">
        Trends, Calendar &amp; Budget
      </h1>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CalendarHeatmapPanel />
        <HourWeekdayHeatmapPanel />
      </div>

      <StackedWeeklyBarsPanel />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ParetoPanel />
        <BudgetForecastPanel />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RollingEfficiencyPanel />
        <GatePassRateStub />
      </div>
    </div>
  );
}
