import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import { HourWeekdayHeatmapPanel } from "./HourWeekdayHeatmapPanel.js";

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

function hourlySeries(): Series[] {
  const points: Series["points"] = [];
  for (let day = 1; day <= 14; day++) {
    for (const hour of [9, 10, 14, 15, 20]) {
      points.push({
        t: `2026-07-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`,
        value: hour === 14 ? 40 : 8,
      });
    }
  }
  return [{ measure: "costComputed", dimensionKey: "", label: "Cost", points }];
}

const meta: Meta<typeof HourWeekdayHeatmapPanel> = {
  title: "Trends/HourWeekdayHeatmapPanel",
  component: HourWeekdayHeatmapPanel,
  args: { now: NOW },
};

export default meta;
type Story = StoryObj<typeof HourWeekdayHeatmapPanel>;

export const Populated: Story = {
  decorators: [withFetch(() => jsonResponse(hourlySeries()))],
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
