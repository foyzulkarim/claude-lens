// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";

const postMetricsMock = vi.fn<(query: unknown) => Promise<Series[]>>();
vi.mock("../../api/metrics.js", () => ({
  postMetrics: (query: unknown) => postMetricsMock(query),
}));

const { BurnRateCard } = await import("./BurnRateCard.js");
const { SubscriptionWindow } = await import("./SubscriptionWindow.js");

function renderCard(card: ReactElement): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path: "/", static: true });
  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        {card}
      </Router>
    </QueryClientProvider>,
  );
  return queryClient;
}

beforeEach(() => {
  postMetricsMock.mockReset();
  // Ensure a broken `new Date()`-per-render implementation crosses a
  // millisecond boundary and produces a measurably different query key.
  postMetricsMock.mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve([]), 5)),
  );
});

afterEach(() => {
  cleanup();
});

describe("live-window cards — stable default time", () => {
  it("does not create a new BurnRateCard query after its response renders", async () => {
    const queryClient = renderCard(<BurnRateCard />);

    await screen.findByLabelText("Month-to-date spend: $0.00");

    expect(postMetricsMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  });

  it("does not create a new SubscriptionWindow query after its response renders", async () => {
    const queryClient = renderCard(<SubscriptionWindow />);

    await screen.findByLabelText("5h window: $0.00");

    expect(postMetricsMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  });
});
