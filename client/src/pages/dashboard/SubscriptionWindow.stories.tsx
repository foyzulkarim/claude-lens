import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import { SubscriptionWindow } from "./SubscriptionWindow.js";

// Same stub-fetch + QueryClientProvider + wouter memoryLocation decorator
// pattern as ChartCard.stories.tsx (Storybook has no dev server behind it).
function withFetch(impl: () => Promise<Response> | Promise<never>) {
  return function Decorator(Story: () => ReactElement) {
    const { hook, searchHook } = memoryLocation({ path: "/", static: true });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    window.fetch = impl as typeof window.fetch;
    return (
      <QueryClientProvider client={queryClient}>
        <Router hook={hook} searchHook={searchHook}>
          <Story />
        </Router>
      </QueryClientProvider>
    );
  };
}

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

// Pinned "now" so the rolling-window math in every story is deterministic.
const NOW = new Date("2026-07-16T14:00:00.000Z");

/** Hourly points over the trailing 30 days: a quiet baseline, a historical
 * spike ~10 days ago (sets the "peak" for both windows above the current
 * activity), and recent activity in the last few hours (populates the
 * current 5h/7d windows and the "resets in" countdown). */
function populatedHourlySeries(): Series[] {
  const points: Series["points"] = [];
  const nowMs = NOW.getTime();
  const hourMs = 60 * 60 * 1000;
  for (let hoursAgo = 24 * 30; hoursAgo >= 0; hoursAgo--) {
    const t = new Date(nowMs - hoursAgo * hourMs).toISOString();
    let value = 0.5; // quiet baseline
    if (hoursAgo <= 4)
      value = 6; // recent burst inside the 5h window
    else if (hoursAgo >= 235 && hoursAgo <= 245) value = 8; // historical spike ~10 days ago
    points.push({ t, value });
  }
  return [{ measure: "costComputed", dimensionKey: "", label: "Cost", points }];
}

const populated = populatedHourlySeries();

const meta: Meta<typeof SubscriptionWindow> = {
  title: "Dashboard/SubscriptionWindow",
  component: SubscriptionWindow,
  args: { now: NOW },
};

export default meta;
type Story = StoryObj<typeof SubscriptionWindow>;

export const HistoricalPeak: Story = {
  decorators: [withFetch(() => jsonResponse(populated))],
};

export const SettingsCeiling: Story = {
  args: { ceiling: 50 },
  decorators: [withFetch(() => jsonResponse(populated))],
};

export const Empty: Story = {
  decorators: [withFetch(() => jsonResponse([]))],
};

export const Loading: Story = {
  decorators: [withFetch(() => new Promise(() => {}))],
};

export const ErrorState: Story = {
  decorators: [
    withFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "server unreachable" }), { status: 500 }),
      ),
    ),
  ],
};
