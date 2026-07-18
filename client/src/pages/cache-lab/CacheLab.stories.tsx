import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CacheLabAnalysis } from "../../../../shared/cache-lab-contract.js";
import { BaselineWeightPanel } from "./BaselineWeightPanel.js";
import { BustEconomicsPanel } from "./BustEconomicsPanel.js";
import { ContextGrowthPanel } from "./ContextGrowthPanel.js";
import { InvalidationCostPanel } from "./InvalidationCostPanel.js";
import { InvalidationGallery } from "./InvalidationGallery.js";
import { MissAttributionPanel } from "./MissAttributionPanel.js";
import { TtlMixPanel } from "./TtlMixPanel.js";

const analysis: CacheLabAnalysis = {
  economics: {
    actualCost: 1,
    cacheSavings: 0.45,
    uncachedCost: 1.45,
    bustLoss: 0.07,
    netBenefit: 0.38,
    bustCount: 1,
    netNegativeSessionCount: 1,
    pricingComplete: true,
  },
  attribution: { ttlLapseCount: 2, prefixChangeCount: 1, unknownCount: 0, verdict: "mixed" },
  ttlMix: { ephemeral5mTokens: 60_000, ephemeral1hTokens: 30_000, unknownTokens: 10_000 },
  baseline: {
    grain: "day",
    points: [{ t: "2026-07-18T00:00:00.000Z", medianTokens: 48_000, sampleCount: 2 }],
  },
  invalidationCost: {
    grain: "day",
    points: [
      { t: "2026-07-18T00:00:00.000Z", modelSwitch: 0.03, compaction: 0.04, unexplained: 0 },
    ],
  },
  gallery: { items: [], total: 0, truncated: false },
  contextGrowth: {
    basis: "token-estimated",
    total: 1,
    truncated: false,
    curves: [
      {
        sessionId: "session-1",
        points: [{ turnIndex: 0, timestamp: "2026-07-18T12:00:00.000Z", inputTokens: 48_000 }],
      },
    ],
  },
};

function Panels({ data, error }: { data?: CacheLabAnalysis; error?: Error }) {
  return (
    <div className="grid gap-4 p-4">
      <BustEconomicsPanel data={data} error={error} />
      <MissAttributionPanel data={data} error={error} />
      <TtlMixPanel data={data} error={error} />
      <BaselineWeightPanel points={data?.baseline.points} error={error} />
      <InvalidationCostPanel points={data?.invalidationCost.points} error={error} />
      <InvalidationGallery data={data} error={error} />
      <ContextGrowthPanel data={data?.contextGrowth} error={error} />
    </div>
  );
}

const meta: Meta<typeof Panels> = { title: "Pages/Cache Lab/States", component: Panels };
export default meta;
type Story = StoryObj<typeof Panels>;

export const Populated: Story = { args: { data: analysis } };
export const Empty: Story = {
  args: {
    data: {
      ...analysis,
      economics: {
        ...analysis.economics,
        actualCost: 0,
        cacheSavings: 0,
        uncachedCost: 0,
        bustLoss: 0,
        netBenefit: 0,
        bustCount: 0,
        netNegativeSessionCount: 0,
      },
      baseline: { grain: "day", points: [] },
      invalidationCost: { grain: "day", points: [] },
      contextGrowth: { ...analysis.contextGrowth, curves: [], total: 0 },
    },
  },
};
export const Loading: Story = { args: {} };
export const Failed: Story = { args: { error: new Error("Cache Lab service unavailable") } };
export const UnknownAndUnpriced: Story = {
  args: {
    data: {
      ...analysis,
      economics: {
        ...analysis.economics,
        actualCost: null,
        cacheSavings: null,
        uncachedCost: null,
        bustLoss: null,
        netBenefit: null,
        pricingComplete: false,
      },
      attribution: { ...analysis.attribution, verdict: "insufficient-evidence", unknownCount: 3 },
    },
  },
};
