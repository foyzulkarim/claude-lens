import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import { RollingEfficiencyPanel } from "./RollingEfficiencyPanel.js";

function withFetch(impl: () => Promise<Response> | Promise<never>) {
  return function Decorator(Story: () => ReactElement) {
    const { hook, searchHook } = memoryLocation({ path: "/trends", static: true });
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

const NOW = new Date("2026-07-16T14:00:00.000Z");

function trending(): Series[] {
  const days = Array.from(
    { length: 14 },
    (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
  );
  return [
    {
      measure: "costComputed",
      dimensionKey: "all",
      label: "Cost",
      points: days.map((t, i) => ({ t, value: 30 - i })),
    },
    {
      measure: "cacheHitPct",
      dimensionKey: "all",
      label: "Cache hit %",
      points: days.map((t, i) => ({ t, value: 0.4 + i * 0.03 })),
    },
    {
      measure: "inputTokens",
      dimensionKey: "all",
      label: "Input tokens",
      points: days.map((t) => ({ t, value: 5000 })),
    },
    {
      measure: "outputTokens",
      dimensionKey: "all",
      label: "Output tokens",
      points: days.map((t) => ({ t, value: 2000 })),
    },
  ];
}

const meta: Meta<typeof RollingEfficiencyPanel> = {
  title: "Trends/RollingEfficiencyPanel",
  component: RollingEfficiencyPanel,
  args: { now: NOW },
};

export default meta;
type Story = StoryObj<typeof RollingEfficiencyPanel>;

export const Populated: Story = {
  decorators: [withFetch(() => jsonResponse(trending()))],
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
