import type { Meta, StoryObj } from "@storybook/react-vite";
import { SessionsFilters } from "./SessionsFilters.js";
import { DEFAULT_SESSIONS_PAGE_STATE } from "./state.js";

const meta: Meta<typeof SessionsFilters> = {
  title: "Sessions/Filters",
  component: SessionsFilters,
};

export default meta;
type Story = StoryObj<typeof SessionsFilters>;

export const Default: Story = {
  args: {
    state: DEFAULT_SESSIONS_PAGE_STATE,
    onStateChange: () => {},
    globalRange: { preset: "7d" },
  },
};

export const Active: Story = {
  args: {
    state: {
      ...DEFAULT_SESSIONS_PAGE_STATE,
      minCostComputed: 0.5,
      maxCostComputed: 10,
      entrypoint: ["cli", "sdk"],
      hasDrilldown: true,
    },
    onStateChange: () => {},
    globalRange: { preset: "7d" },
  },
};

export const Unavailable: Story = {
  args: {
    state: DEFAULT_SESSIONS_PAGE_STATE,
    onStateChange: () => {},
    globalRange: { preset: "7d" },
  },
  parameters: {
    docs: {
      description: {
        story:
          "Gate status and tag filters are visibly unavailable (ARCH R8/A11 explicit seam pattern).",
      },
    },
  },
};
