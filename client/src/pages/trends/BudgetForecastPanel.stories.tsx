import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import type { AppConfig } from "../../../../shared/settings-contract.js";
import { BudgetForecastPanel } from "./BudgetForecastPanel.js";

function withFetch(
  responder: (url: string, init: RequestInit | undefined) => Promise<Response> | Promise<never>,
) {
  return function Decorator(Story: () => ReactElement) {
    const { hook, searchHook } = memoryLocation({ path: "/trends", static: true });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    window.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      return responder(url, init);
    }) as typeof window.fetch;
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

function dailyCost(dailyAmount: number): Series[] {
  const points: Series["points"] = [];
  for (let day = 1; day <= 16; day++) {
    points.push({ t: `2026-07-${String(day).padStart(2, "0")}T00:00:00.000Z`, value: dailyAmount });
  }
  return [{ measure: "costComputed", dimensionKey: "", label: "Cost", points }];
}

function routedFetch(config: AppConfig, series: Series[]) {
  return (url: string) => {
    if (url.startsWith("/api/config")) return jsonResponse(config);
    return jsonResponse(series);
  };
}

const meta: Meta<typeof BudgetForecastPanel> = {
  title: "Trends/BudgetForecastPanel",
  component: BudgetForecastPanel,
  args: { now: NOW },
};

export default meta;
type Story = StoryObj<typeof BudgetForecastPanel>;

export const NoBudgetSet: Story = {
  decorators: [withFetch(routedFetch({ budget: null }, dailyCost(12)))],
};

export const BudgetConfigured: Story = {
  decorators: [withFetch(routedFetch({ budget: 400 }, dailyCost(12)))],
};

export const OverBudget: Story = {
  decorators: [withFetch(routedFetch({ budget: 100 }, dailyCost(20)))],
};

export const InsufficientData: Story = {
  decorators: [
    withFetch(
      routedFetch(
        { budget: 300 },
        dailyCost(10).map((s) => ({
          ...s,
          points: s.points.slice(0, 2),
        })),
      ),
    ),
  ],
};

export const Loading: Story = {
  decorators: [withFetch(() => new Promise(() => {}))],
};
