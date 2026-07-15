import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../shared/metrics-contract.js";
import { ChartCard } from "./ChartCard.js";

// ChartCard fetches via postMetrics (window.fetch) — Storybook has no dev
// server behind it, so each story stubs `window.fetch` directly to return
// canned Series[] (or hang/reject) rather than exercising the real endpoint.
// Same QueryClientProvider + wouter memoryLocation decorator pattern as
// FilterBar.stories.tsx.
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

const days = ["2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11", "2026-07-12"];

const costSeries: Series[] = [
  {
    measure: "costComputed",
    dimensionKey: "time",
    label: "Cost",
    points: days.map((t, i) => ({ t: `${t}T00:00:00Z`, value: 10 + i * 4 })),
  },
];

const ghostSeries: Series[] = [
  {
    ...costSeries[0],
    compareGhost: days.map((t, i) => ({ t: `${t}T00:00:00Z`, value: 8 + i * 2 })),
  },
];

const meta: Meta<typeof ChartCard> = {
  title: "Charts/ChartCard",
  component: ChartCard,
  args: { title: "Cost over time", defaultUnit: "$" },
};

export default meta;
type Story = StoryObj<typeof ChartCard>;

export const Area: Story = {
  decorators: [withFetch(() => jsonResponse(costSeries))],
};

// Same data as Area — family isn't a story arg (it's local toolbar state per
// decision A4), so verify bars by clicking the "bars" toggle in this story.
export const Bars: Story = {
  decorators: [withFetch(() => jsonResponse(costSeries))],
};

export const WithGhost: Story = {
  decorators: [withFetch(() => jsonResponse(ghostSeries))],
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
