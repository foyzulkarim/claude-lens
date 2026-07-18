import type { Meta, StoryObj } from "@storybook/react-vite";
import { SessionCompare } from "./SessionCompare.js";
import { DEFAULT_SESSIONS_PAGE_STATE } from "./state.js";

const meta: Meta<typeof SessionCompare> = {
  title: "Sessions/Compare",
  component: SessionCompare,
};

export default meta;
type Story = StoryObj<typeof SessionCompare>;

export const TwoWay: Story = {
  args: {
    state: { ...DEFAULT_SESSIONS_PAGE_STATE, compareIds: ["s-a", "s-b"] },
    onStateChange: () => {},
    now: new Date("2026-07-15T00:00:00Z"),
  },
};

export const ThreeWay: Story = {
  args: {
    state: { ...DEFAULT_SESSIONS_PAGE_STATE, compareIds: ["s-a", "s-b", "s-c"] },
    onStateChange: () => {},
    now: new Date("2026-07-15T00:00:00Z"),
  },
};

export const MissingSelection: Story = {
  args: {
    state: { ...DEFAULT_SESSIONS_PAGE_STATE, compareIds: ["s-a", "s-gone"] },
    onStateChange: () => {},
    now: new Date("2026-07-15T00:00:00Z"),
  },
  parameters: {
    docs: {
      description: {
        story:
          "A selected ID no longer matches the population — section renders the unavailable state per ARCH R7.",
      },
    },
  },
};

export const Premium: Story = {
  args: {
    state: { ...DEFAULT_SESSIONS_PAGE_STATE, compareIds: ["s-premium-a", "s-premium-b"] },
    onStateChange: () => {},
    now: new Date("2026-07-15T00:00:00Z"),
  },
  parameters: {
    docs: {
      description: {
        story:
          "Premium-tier comparison (costObserved / linesAdded / linesRemoved visible) — reserved until #P4-13 wires those fields in.",
      },
    },
  },
};
