import type { Meta, StoryObj } from "@storybook/react-vite";
import { SessionBrowser } from "./SessionBrowser.js";
import { DEFAULT_SESSIONS_PAGE_STATE } from "./state.js";

const meta: Meta<typeof SessionBrowser> = {
  title: "Sessions/Browser",
  component: SessionBrowser,
};

export default meta;
type Story = StoryObj<typeof SessionBrowser>;

export const Table: Story = {
  args: {
    state: DEFAULT_SESSIONS_PAGE_STATE,
    onStateChange: () => {},
    now: new Date("2026-07-15T00:00:00Z"),
  },
  parameters: {
    docs: {
      description: {
        story: "Default table view; column set + sort/select rendered for visual review.",
      },
    },
  },
};

export const Timeline: Story = {
  args: {
    state: { ...DEFAULT_SESSIONS_PAGE_STATE, browserView: "timeline" as const },
    onStateChange: () => {},
    now: new Date("2026-07-15T00:00:00Z"),
  },
};

export const Loading: Story = {
  args: {
    state: DEFAULT_SESSIONS_PAGE_STATE,
    onStateChange: () => {},
    now: new Date("2026-07-15T00:00:00Z"),
  },
  parameters: {
    docs: {
      description: {
        story: "Loading state — query is pending; skeleton renders inside the table.",
      },
    },
  },
};
