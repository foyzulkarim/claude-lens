import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import { BurnRateCard } from "./BurnRateCard.js";

// BurnRateCard fetches via postMetrics (window.fetch) — same stub-fetch +
// QueryClientProvider + wouter memoryLocation decorator pattern as
// ChartCard.stories.tsx (Storybook has no dev server behind it).
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

// Pinned "now" so the MTD/projection math in every story is deterministic —
// July 16 2026 UTC, ~15.6 days into a 31-day month.
const NOW = new Date("2026-07-16T14:00:00.000Z");

function hourlySeriesForMonth(dailyAmount: number): Series[] {
  const points: Series["points"] = [];
  for (let day = 1; day <= 16; day++) {
    const d = String(day).padStart(2, "0");
    points.push({ t: `2026-07-${d}T12:00:00.000Z`, value: dailyAmount });
  }
  return [{ measure: "costComputed", dimensionKey: "", label: "Cost", points }];
}

const moderateSpend = hourlySeriesForMonth(12);

const meta: Meta<typeof BurnRateCard> = {
  title: "Dashboard/BurnRateCard",
  component: BurnRateCard,
  args: { now: NOW },
};

export default meta;
type Story = StoryObj<typeof BurnRateCard>;

export const NoBudgetSet: Story = {
  decorators: [withFetch(() => jsonResponse(moderateSpend))],
};

export const BudgetConfigured: Story = {
  args: { budget: 300 },
  decorators: [withFetch(() => jsonResponse(moderateSpend))],
};

export const OverBudget: Story = {
  args: { budget: 100 },
  decorators: [withFetch(() => jsonResponse(moderateSpend))],
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
