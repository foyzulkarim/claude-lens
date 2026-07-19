import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import { StackedWeeklyBarsPanel } from "./StackedWeeklyBarsPanel.js";

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

function weeklyByProject(): Series[] {
  const weeks = ["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22"];
  return [
    {
      measure: "costComputed",
      dimensionKey: "project:claude-lens",
      label: "claude-lens",
      points: weeks.map((t) => ({ t: `${t}T00:00:00.000Z`, value: 40 })),
    },
    {
      measure: "costComputed",
      dimensionKey: "project:claude-code",
      label: "claude-code",
      points: weeks.map((t) => ({ t: `${t}T00:00:00.000Z`, value: 25 })),
    },
  ];
}

const meta: Meta<typeof StackedWeeklyBarsPanel> = {
  title: "Trends/StackedWeeklyBarsPanel",
  component: StackedWeeklyBarsPanel,
  args: { now: NOW },
};

export default meta;
type Story = StoryObj<typeof StackedWeeklyBarsPanel>;

export const Populated: Story = {
  decorators: [withFetch(() => jsonResponse(weeklyByProject()))],
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
