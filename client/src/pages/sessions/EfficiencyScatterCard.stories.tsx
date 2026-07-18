import type { Meta, StoryObj } from "@storybook/react-vite";
import { EfficiencyScatterCard } from "./EfficiencyScatterCard.js";
import { DEFAULT_SESSIONS_PAGE_STATE } from "./state.js";

const meta: Meta<typeof EfficiencyScatterCard> = {
  title: "Sessions/EfficiencyScatter",
  component: EfficiencyScatterCard,
};

export default meta;
type Story = StoryObj<typeof EfficiencyScatterCard>;

export const Default: Story = {
  args: {
    state: DEFAULT_SESSIONS_PAGE_STATE,
    onStateChange: () => {},
    now: new Date("2026-07-15T00:00:00Z"),
  },
};

export const TokensTurnsPreset: Story = {
  args: {
    state: { ...DEFAULT_SESSIONS_PAGE_STATE, scatterPreset: "tokens-vs-turns" as const },
    onStateChange: () => {},
    now: new Date("2026-07-15T00:00:00Z"),
  },
};

export const CacheVsCostPreset: Story = {
  args: {
    state: { ...DEFAULT_SESSIONS_PAGE_STATE, scatterPreset: "cache-vs-cost" as const },
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
          "Empty state — no eligible sessions (e.g. all premium-only measures are null on transcript-tier sessions); section renders an empty message instead of a blank chart.",
      },
    },
  },
};
