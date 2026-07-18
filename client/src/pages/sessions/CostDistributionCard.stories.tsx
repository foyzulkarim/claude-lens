import type { Meta, StoryObj } from "@storybook/react-vite";
import { CostDistributionCard } from "./CostDistributionCard.js";
import { DEFAULT_SESSIONS_PAGE_STATE } from "./state.js";

const meta: Meta<typeof CostDistributionCard> = {
  title: "Sessions/CostDistribution",
  component: CostDistributionCard,
};

export default meta;
type Story = StoryObj<typeof CostDistributionCard>;

export const Histogram: Story = {
  args: {
    state: DEFAULT_SESSIONS_PAGE_STATE,
    onStateChange: () => {},
    now: new Date("2026-07-15T00:00:00Z"),
  },
};

export const Percentiles: Story = {
  args: {
    state: { ...DEFAULT_SESSIONS_PAGE_STATE, distributionView: "percentiles" as const },
    onStateChange: () => {},
    now: new Date("2026-07-15T00:00:00Z"),
  },
};

export const Empty: Story = {
  args: {
    state: DEFAULT_SESSIONS_PAGE_STATE,
    onStateChange: () => {},
    now: new Date("2026-07-15T00:00:00Z"),
  },
  parameters: {
    docs: {
      description: {
        story:
          "Empty state — no distribution data in the current population; the section renders a friendly empty-state message rather than an empty chart.",
      },
    },
  },
};
