import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { LockedCard } from "./LockedCard.js";

// LockedCard's CTA is a wouter `Link` — same memoryLocation decorator
// pattern as FilterBar.stories.tsx, minus the QueryClientProvider (LockedCard
// never fetches).
function withRouter() {
  return function Decorator(Story: () => ReactElement) {
    const { hook, searchHook } = memoryLocation({ path: "/", static: true });
    return (
      <Router hook={hook} searchHook={searchHook}>
        <Story />
      </Router>
    );
  };
}

const meta: Meta<typeof LockedCard> = {
  title: "Components/LockedCard",
  component: LockedCard,
  decorators: [withRouter()],
};

export default meta;
type Story = StoryObj<typeof LockedCard>;

export const Default: Story = {
  args: {
    title: "Cache Savings",
    message: "Premium capture required for observed cost.",
  },
};

export const CustomCta: Story = {
  args: {
    title: "Turn Attribution",
    message: "Enable turn-boundary capture to unlock this view.",
    ctaLabel: "Enable capture →",
    ctaHref: "/settings#capture",
  },
};

export const GhostChildren: Story = {
  args: {
    title: "Cache Savings",
    message: "Premium capture required for observed cost.",
  },
  render: (args) => (
    <LockedCard {...args}>
      <div className="h-32 rounded bg-slate-100 dark:bg-[#11161D]" />
    </LockedCard>
  ),
};
