import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import { ParetoPanel } from "./ParetoPanel.js";

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

function distributionSeries(): Series[] {
  return [
    {
      measure: "costComputed",
      dimensionKey: "all",
      label: "All",
      points: [],
      distribution: {
        p50: 1,
        p90: 5,
        p99: 10,
        histogram: [],
        pareto: {
          curve: [
            { entityPct: 10, cumulativeValuePct: 60 },
            { entityPct: 20, cumulativeValuePct: 73 },
            { entityPct: 50, cumulativeValuePct: 90 },
            { entityPct: 100, cumulativeValuePct: 100 },
          ],
          topDecileValuePct: 60,
        },
      },
    },
  ];
}

const meta: Meta<typeof ParetoPanel> = {
  title: "Trends/ParetoPanel",
  component: ParetoPanel,
  args: { now: NOW },
};

export default meta;
type Story = StoryObj<typeof ParetoPanel>;

export const Populated: Story = {
  decorators: [withFetch(() => jsonResponse(distributionSeries()))],
};

export const Empty: Story = {
  decorators: [
    withFetch(() =>
      jsonResponse([
        {
          measure: "costComputed",
          dimensionKey: "all",
          label: "All",
          points: [],
          distribution: { p50: null, p90: null, p99: null, histogram: [] },
        },
      ]),
    ),
  ],
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
