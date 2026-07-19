import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import { CalendarHeatmapPanel } from "./CalendarHeatmapPanel.js";

// Same stub-fetch + QueryClientProvider + wouter memoryLocation decorator
// pattern as BurnRateCard.stories.tsx (Storybook has no dev server behind it).
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

function dailySeries(values: number[]): Series[] {
  const points: Series["points"] = values.map((value, i) => ({
    t: `2026-07-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    value,
  }));
  return [{ measure: "costComputed", dimensionKey: "", label: "Cost", points }];
}

const meta: Meta<typeof CalendarHeatmapPanel> = {
  title: "Trends/CalendarHeatmapPanel",
  component: CalendarHeatmapPanel,
  args: { now: NOW },
};

export default meta;
type Story = StoryObj<typeof CalendarHeatmapPanel>;

export const Populated: Story = {
  decorators: [
    withFetch(() => jsonResponse(dailySeries([5, 12, 3, 40, 8, 0, 22, 15, 9, 3, 1, 30]))),
  ],
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
