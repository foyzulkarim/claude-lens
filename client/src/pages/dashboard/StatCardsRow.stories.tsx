import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import { StatCardsRow } from "./StatCardsRow.js";

// Same withFetch decorator pattern as ChartCard.stories.tsx: StatCardsRow
// fetches via postMetrics (window.fetch), so each story stubs the global
// fetch to return canned Series[] (or hang/reject) rather than exercising a
// real /api/metrics endpoint.
function withFetch(impl: typeof window.fetch) {
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

const days = [
  "2026-07-12",
  "2026-07-13",
  "2026-07-14",
  "2026-07-15",
  "2026-07-16",
  "2026-07-17",
  "2026-07-18",
];
const prevDays = [
  "2026-07-05",
  "2026-07-06",
  "2026-07-07",
  "2026-07-08",
  "2026-07-09",
  "2026-07-10",
  "2026-07-11",
];

function points(values: number[], labels: string[]) {
  return values.map((value, i) => ({ t: `${labels[i]}T00:00:00Z`, value }));
}

// /api/metrics receives two batched queries per StatCardsRow render: the
// first requests [costComputed, sessions], the second requests the four
// token measures. The stub below dispatches on the request body's
// `measures` array so both queries resolve from a single fetch stub.
const spendValues = [12, 18, 9, 24, 30, 40, 36.7];
const spendPrev = [6, 8, 5, 10, 11, 14, 15.3];
const sessionsValues = [2, 3, 1, 4, 5, 4, 2];
const sessionsPrev = [1, 1, 1, 2, 1, 1, 1];
const inputValues = [400_000, 500_000, 300_000, 700_000, 900_000, 1_100_000, 950_000];
const outputValues = [50_000, 60_000, 40_000, 80_000, 100_000, 120_000, 110_000];
const cacheReadValues = [
  3_000_000, 3_500_000, 2_000_000, 4_000_000, 5_000_000, 6_000_000, 5_500_000,
];
const cacheCreateValues = [200_000, 250_000, 150_000, 300_000, 350_000, 400_000, 380_000];

function coreSeries(withCompare: boolean): Series[] {
  const cost: Series = {
    measure: "costComputed",
    dimensionKey: "all",
    label: "Spend",
    points: points(spendValues, days),
    basis: "computed",
    ...(withCompare ? { compareGhost: points(spendPrev, prevDays) } : {}),
  };
  const sessions: Series = {
    measure: "sessions",
    dimensionKey: "all",
    label: "Sessions",
    points: points(sessionsValues, days),
    ...(withCompare ? { compareGhost: points(sessionsPrev, prevDays) } : {}),
  };
  return [cost, sessions];
}

function tokensSeries(withCompare: boolean): Series[] {
  const build = (measure: Series["measure"], label: string, values: number[]): Series => ({
    measure,
    dimensionKey: "all",
    label,
    points: points(values, days),
    ...(withCompare
      ? {
          compareGhost: points(
            values.map((v) => v * 0.6),
            prevDays,
          ),
        }
      : {}),
  });
  return [
    build("inputTokens", "Input tokens", inputValues),
    build("outputTokens", "Output tokens", outputValues),
    build("cacheReadTokens", "Cache read tokens", cacheReadValues),
    build("cacheCreateTokens", "Cache create tokens", cacheCreateValues),
  ];
}

function installMetricsStub(withCompare: boolean) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.includes("/api/metrics")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const measures: string[] = body.measures ?? [];
    if (measures.includes("costComputed")) return jsonResponse(coreSeries(withCompare));
    return jsonResponse(tokensSeries(withCompare));
  };
}

const meta: Meta<typeof StatCardsRow> = {
  title: "Dashboard/StatCardsRow",
  component: StatCardsRow,
};

export default meta;
type Story = StoryObj<typeof StatCardsRow>;

export const Populated: Story = {
  decorators: [withFetch(installMetricsStub(true))],
};

export const NoPreviousPeriod: Story = {
  name: "No previous period (deltas hidden)",
  decorators: [withFetch(installMetricsStub(false))],
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
