import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import { EfficiencyTable } from "./EfficiencyTable.js";
import { EntrypointBreakdown } from "./EntrypointBreakdown.js";
import { LatencyByModel } from "./LatencyByModel.js";
import { LockedLinesPerCost } from "./LockedLinesPerCost.js";
import { ModelMixOverTime } from "./ModelMixOverTime.js";
import { ModelStatsRow } from "./ModelStatsRow.js";
import { ThroughputByModel } from "./ThroughputByModel.js";
import { VersionBeforeAfter } from "./VersionBeforeAfter.js";
import type { FilterState } from "../../filters/state.js";

// jsdom has no ECharts canvas in Storybook either — the Chart component
// is mounted anyway but renders an empty canvas; the tests cover the
// post-fetch states.

const POPULATED_FILTERS: FilterState = {
  range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-18T00:00:00.000Z" },
  project: [],
  model: [],
  branch: [],
  host: [],
};

function point(value: number, t = "2026-07-10T00:00:00.000Z"): { t: string; value: number } {
  return { t, value };
}

function seriesFor(measure: Series["measure"], model: string, value: number): Series {
  return {
    measure,
    dimensionKey: `model:${model}`,
    label: model,
    points: [point(value)],
  };
}

function populatedModelSeries(): Series[] {
  // One per-model Series per (measure, model) — enough to make every
  // panel above render populated content.
  const model = "claude-fable-5";
  return [
    seriesFor("costComputed", model, 99.2),
    seriesFor("sessions", model, 11),
    seriesFor("inputTokens", model, 800_000),
    seriesFor("outputTokens", model, 90_000),
    seriesFor("cacheReadTokens", model, 950_000),
    seriesFor("cacheCreateTokens", model, 50_000),
    seriesFor("turns", model, 11),
    seriesFor("wallMinutes", model, 25),
    seriesFor("apiCalls", model, 120),
    seriesFor("outputTokens", model, 90_000),
    seriesFor("outputTokens", model, 90_000),
    seriesFor("wallMinutes", model, 25),
  ];
}

function populatedVersionSeries(): Series[] {
  return [
    {
      measure: "costComputed",
      dimensionKey: "version:3.17.9",
      label: "3.17.9",
      points: [point(80)],
    },
    {
      measure: "costComputed",
      dimensionKey: "version:3.18.0",
      label: "3.18.0",
      points: [point(120)],
    },
    {
      measure: "turns",
      dimensionKey: "version:3.17.9",
      label: "3.17.9",
      points: [point(80)],
    },
    {
      measure: "turns",
      dimensionKey: "version:3.18.0",
      label: "3.18.0",
      points: [point(120)],
    },
    {
      measure: "inputTokens",
      dimensionKey: "version:3.17.9",
      label: "3.17.9",
      points: [point(5_600_000)],
    },
    {
      measure: "inputTokens",
      dimensionKey: "version:3.18.0",
      label: "3.18.0",
      points: [point(10_080_000)],
    },
    {
      measure: "outputTokens",
      dimensionKey: "version:3.17.9",
      label: "3.17.9",
      points: [point(640_000)],
    },
    {
      measure: "outputTokens",
      dimensionKey: "version:3.18.0",
      label: "3.18.0",
      points: [point(960_000)],
    },
    {
      measure: "cacheReadTokens",
      dimensionKey: "version:3.17.9",
      label: "3.17.9",
      points: [point(80_000_000)],
    },
    {
      measure: "cacheReadTokens",
      dimensionKey: "version:3.18.0",
      label: "3.18.0",
      points: [point(96_000_000)],
    },
    {
      measure: "cacheCreateTokens",
      dimensionKey: "version:3.17.9",
      label: "3.17.9",
      points: [point(5_000_000)],
    },
    {
      measure: "cacheCreateTokens",
      dimensionKey: "version:3.18.0",
      label: "3.18.0",
      points: [point(4_000_000)],
    },
  ];
}

function populatedEntrypointSeries(): Series[] {
  return [
    seriesFor("inputTokens", "cli", 1_000_000),
    seriesFor("outputTokens", "cli", 120_000),
    seriesFor("cacheReadTokens", "cli", 4_000_000),
    seriesFor("cacheCreateTokens", "cli", 200_000),
    seriesFor("costComputed", "cli", 12.34),
  ];
}

function populatedWallSeries(): Series[] {
  return [
    seriesFor("wallMinutes", "claude-fable-5", 25),
    seriesFor("apiCalls", "claude-fable-5", 120),
    seriesFor("outputTokens", "claude-fable-5", 90_000),
    seriesFor("wallMinutes", "claude-fable-5", 25),
    seriesFor("wallMinutes", "claude-opus-4-8", 60),
    seriesFor("apiCalls", "claude-opus-4-8", 90),
    seriesFor("outputTokens", "claude-opus-4-8", 30_000),
    seriesFor("wallMinutes", "claude-opus-4-8", 60),
  ];
}

function mixTimeSeries(): Series[] {
  return [
    {
      measure: "costComputed",
      dimensionKey: "model:claude-fable-5",
      label: "claude-fable-5",
      points: [
        point(10, "2026-07-01T00:00:00.000Z"),
        point(20, "2026-07-08T00:00:00.000Z"),
        point(30, "2026-07-15T00:00:00.000Z"),
      ],
    },
    {
      measure: "costComputed",
      dimensionKey: "model:claude-opus-4-8",
      label: "claude-opus-4-8",
      points: [
        point(40, "2026-07-01T00:00:00.000Z"),
        point(35, "2026-07-08T00:00:00.000Z"),
        point(20, "2026-07-15T00:00:00.000Z"),
      ],
    },
  ];
}

function withQueryClient(children: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function withRouter(children: ReactElement, path = "/models") {
  const { hook, searchHook } = memoryLocation({ path, static: true });
  return (
    <Router hook={hook} searchHook={searchHook}>
      {children}
    </Router>
  );
}

function PageGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 p-4">{children}</div>;
}

import type { ReactNode } from "react";

function Populated() {
  return withRouter(
    withQueryClient(
      <PageGrid>
        <ModelStatsRow data={populatedModelSeries()} filters={POPULATED_FILTERS} />
        <ModelMixOverTime filters={POPULATED_FILTERS} grain="day" isPending={false} />
        <div className="grid gap-4 lg:grid-cols-2">
          <EfficiencyTable data={populatedModelSeries()} filters={POPULATED_FILTERS} />
          <VersionBeforeAfter data={populatedVersionSeries()} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <LatencyByModel data={populatedWallSeries()} filters={POPULATED_FILTERS} />
          <ThroughputByModel data={populatedWallSeries()} filters={POPULATED_FILTERS} />
        </div>
        <LockedLinesPerCost />
        <EntrypointBreakdown data={populatedEntrypointSeries()} filters={POPULATED_FILTERS} />
      </PageGrid>,
    ),
  );
}

function Empty() {
  return withRouter(
    withQueryClient(
      <PageGrid>
        <ModelStatsRow data={[]} filters={POPULATED_FILTERS} />
        <ModelMixOverTime filters={POPULATED_FILTERS} grain="day" />
        <div className="grid gap-4 lg:grid-cols-2">
          <EfficiencyTable data={[]} filters={POPULATED_FILTERS} />
          <VersionBeforeAfter data={[]} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <LatencyByModel data={[]} filters={POPULATED_FILTERS} />
          <ThroughputByModel data={[]} filters={POPULATED_FILTERS} />
        </div>
        <LockedLinesPerCost />
        <EntrypointBreakdown data={[]} filters={POPULATED_FILTERS} />
      </PageGrid>,
    ),
  );
}

function Loading() {
  return withRouter(
    withQueryClient(
      <PageGrid>
        <ModelStatsRow data={undefined} filters={POPULATED_FILTERS} isPending />
        <ModelMixOverTime filters={POPULATED_FILTERS} grain="day" isPending />
        <div className="grid gap-4 lg:grid-cols-2">
          <EfficiencyTable data={undefined} filters={POPULATED_FILTERS} isPending />
          <VersionBeforeAfter data={undefined} isPending />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <LatencyByModel data={undefined} filters={POPULATED_FILTERS} isPending />
          <ThroughputByModel data={undefined} filters={POPULATED_FILTERS} isPending />
        </div>
        <LockedLinesPerCost />
        <EntrypointBreakdown data={undefined} filters={POPULATED_FILTERS} isPending />
      </PageGrid>,
    ),
  );
}

function Failed() {
  return withRouter(
    withQueryClient(
      <PageGrid>
        <ModelStatsRow
          data={undefined}
          filters={POPULATED_FILTERS}
          isError
          error={new Error("Metrics endpoint unreachable")}
        />
        <ModelMixOverTime filters={POPULATED_FILTERS} grain="day" isPending={false} />
        <div className="grid gap-4 lg:grid-cols-2">
          <EfficiencyTable
            data={undefined}
            filters={POPULATED_FILTERS}
            isError
            error={new Error("Metrics endpoint unreachable")}
          />
          <VersionBeforeAfter data={undefined} isError error={new Error("upstream timeout")} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <LatencyByModel
            data={undefined}
            filters={POPULATED_FILTERS}
            isError
            error={new Error("Metrics endpoint unreachable")}
          />
          <ThroughputByModel
            data={undefined}
            filters={POPULATED_FILTERS}
            isError
            error={new Error("Metrics endpoint unreachable")}
          />
        </div>
        <LockedLinesPerCost />
        <EntrypointBreakdown
          data={undefined}
          filters={POPULATED_FILTERS}
          isError
          error={new Error("Metrics endpoint unreachable")}
        />
      </PageGrid>,
    ),
  );
}

const meta: Meta = { title: "Pages/Models/States" };
export default meta;
type Story = StoryObj;

export const AllPopulated: Story = { render: () => <Populated /> };
export const AllEmpty: Story = { render: () => <Empty /> };
export const AllLoading: Story = { render: () => <Loading /> };
export const AllFailed: Story = { render: () => <Failed /> };
// (data shape used by mixTimeSeries — kept exported for stories that
// want the stacked chart with a non-empty series list instead of
// empty)
export { mixTimeSeries };
