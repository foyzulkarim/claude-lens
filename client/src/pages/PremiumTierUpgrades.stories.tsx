import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ContextGrowthSection } from "../../../shared/cache-lab-contract.js";
import type { Series } from "../../../shared/metrics-contract.js";
import type { TurnInspectorWaterfallCall } from "../../../shared/turn-inspector-contract.js";
import type { FilterState } from "../filters/state.js";
import { ContextGrowthPanel } from "./cache-lab/ContextGrowthPanel.js";
import { LatencyByModel } from "./models/LatencyByModel.js";
import { ThroughputByModel } from "./models/ThroughputByModel.js";
import { Waterfall } from "./turn-inspector/Waterfall.js";

// Tier-upgrade component states (#P4-13) gathered in one place: each panel is
// shown twice — the transcript-only 🟡 estimated tier next to the premium 🟢
// observed tier. These are the fleet-aggregate panels the Cypress double-run
// can't flip on a mixed fixture fleet (they only go observed when *every* shown
// session is premium), so per the acceptance criteria their observed states are
// proven here with hand-built props instead.

const FILTERS: FilterState = {
  range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-18T00:00:00.000Z" },
  project: [],
  model: [],
  branch: [],
  host: [],
};

function series(measure: Series["measure"], model: string, value: number): Series {
  return {
    measure,
    dimensionKey: `model:${model}`,
    label: model,
    points: [{ t: "2026-07-10T00:00:00.000Z", value }],
  };
}

// Estimated tier: only the wall-clock proxy measures are present.
function estimatedModelSeries(): Series[] {
  return [
    series("wallMinutes", "claude-sonnet-5", 25),
    series("apiCalls", "claude-sonnet-5", 120),
    series("outputTokens", "claude-sonnet-5", 90_000),
    series("wallMinutes", "claude-opus-4-8", 60),
    series("apiCalls", "claude-opus-4-8", 90),
    series("outputTokens", "claude-opus-4-8", 30_000),
  ];
}

// Observed tier: every model also carries apiMs, so the panels flip to 🟢.
function observedModelSeries(): Series[] {
  return [
    ...estimatedModelSeries(),
    series("apiMs", "claude-sonnet-5", 240_000),
    series("apiMs", "claude-opus-4-8", 360_000),
  ];
}

function contextGrowth(basis: ContextGrowthSection["basis"]): ContextGrowthSection {
  const observed = basis === "observed";
  return {
    curves: [
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        points: [0, 1, 2].map((i) => ({
          turnIndex: i,
          timestamp: `2026-07-10T0${i}:00:00.000Z`,
          inputTokens: 5_000 * (i + 1),
          ...(observed ? { contextPct: 8 * (i + 1) } : {}),
        })),
      },
    ],
    total: 1,
    truncated: false,
    basis,
  };
}

function waterfallCalls(observed: boolean): TurnInspectorWaterfallCall[] {
  return [0, 1, 2].map((i) => ({
    callIndex: i,
    messageId: `msg_${i}`,
    timestamp: `2026-07-10T00:0${i}:00.000Z`,
    offsetMs: i * 1000,
    ...(observed ? { apiMs: 1500 + i * 1200 } : {}),
    tokens: 2000 * (i + 1),
    cost: 0.05 * (i + 1),
    tools: [],
    isSidechain: false,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
  }));
}

function withProviders(children: ReactNode): ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path: "/", static: true });
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <div className="grid gap-4 p-4 lg:grid-cols-2">{children}</div>
      </Router>
    </QueryClientProvider>
  );
}

const meta: Meta = { title: "Pages/PremiumTierUpgrades" };
export default meta;
type Story = StoryObj;

/** 🟡 estimated (left of each pair) vs 🟢 observed (right) for every
 * fleet-aggregate panel the premium tier upgrades. */
export const EstimatedVsObserved: Story = {
  render: () =>
    withProviders(
      <>
        <LatencyByModel data={estimatedModelSeries()} filters={FILTERS} />
        <LatencyByModel data={observedModelSeries()} filters={FILTERS} />
        <ThroughputByModel data={estimatedModelSeries()} filters={FILTERS} />
        <ThroughputByModel data={observedModelSeries()} filters={FILTERS} />
        <ContextGrowthPanel data={contextGrowth("token-estimated")} />
        <ContextGrowthPanel data={contextGrowth("observed")} />
        <Waterfall calls={waterfallCalls(false)} />
        <Waterfall calls={waterfallCalls(true)} />
      </>,
    ),
};
