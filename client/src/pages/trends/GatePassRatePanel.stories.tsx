import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import { GatePassRatePanel } from "./GatePassRatePanel.js";

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

function populatedSeries(): Series[] {
  const weeks = [
    "2026-05-25T00:00:00.000Z",
    "2026-06-01T00:00:00.000Z",
    "2026-06-08T00:00:00.000Z",
    "2026-06-15T00:00:00.000Z",
    "2026-06-22T00:00:00.000Z",
    "2026-06-29T00:00:00.000Z",
    "2026-07-06T00:00:00.000Z",
  ];
  return [
    {
      measure: "gatePassRate",
      dimensionKey: "all",
      label: "Gate pass %",
      points: weeks.map((t, i) => ({ t, value: 0.7 + i * 0.03 })),
    },
  ];
}

const meta: Meta<typeof GatePassRatePanel> = {
  title: "Trends/GatePassRatePanel",
  component: GatePassRatePanel,
  args: { now: NOW },
};

export default meta;
type Story = StoryObj<typeof GatePassRatePanel>;

export const Populated: Story = {
  decorators: [withFetch(() => jsonResponse(populatedSeries()))],
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
      Promise.resolve(new Response(JSON.stringify({ error: "metrics offline" }), { status: 500 })),
    ),
  ],
};
