// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import type { ChartProps } from "../../charts/Chart.js";
import { tokensPerDollarSeries } from "./RollingEfficiencyPanel.js";

const chartSpy = vi.fn();
vi.mock("../../charts/Chart.js", () => ({
  Chart: (props: ChartProps) => {
    chartSpy(props);
    return <div data-testid="chart-stub" />;
  },
}));

const postMetricsMock = vi.fn<(query: unknown) => Promise<Series[]>>();
vi.mock("../../api/metrics.js", () => ({
  postMetrics: (query: unknown) => postMetricsMock(query),
}));

const { RollingEfficiencyPanel } = await import("./RollingEfficiencyPanel.js");

const NOW = new Date("2026-07-16T14:00:00.000Z");

function seriesResponse(): Series[] {
  const t1 = "2026-07-01T00:00:00.000Z";
  const t2 = "2026-07-02T00:00:00.000Z";
  return [
    {
      measure: "costComputed",
      dimensionKey: "all",
      label: "Cost",
      points: [
        { t: t1, value: 10 },
        { t: t2, value: 20 },
      ],
    },
    {
      measure: "cacheHitPct",
      dimensionKey: "all",
      label: "Cache hit %",
      points: [
        { t: t1, value: 0.5 },
        { t: t2, value: 0.8 },
      ],
    },
    {
      measure: "inputTokens",
      dimensionKey: "all",
      label: "Input tokens",
      points: [
        { t: t1, value: 100 },
        { t: t2, value: 200 },
      ],
    },
    {
      measure: "outputTokens",
      dimensionKey: "all",
      label: "Output tokens",
      points: [
        { t: t1, value: 50 },
        { t: t2, value: 100 },
      ],
    },
  ];
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path: "/trends", static: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <RollingEfficiencyPanel now={NOW} />
      </Router>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("tokensPerDollarSeries", () => {
  it("computes (input + output) / cost per bucket", () => {
    const [cost, , input, output] = seriesResponse();
    const result = tokensPerDollarSeries(cost, input, output);
    expect(result.points.map((p) => p.value)).toEqual([15, 15]);
  });

  it("renders null (not a fabricated ratio) when cost is 0", () => {
    const cost: Series = {
      measure: "costComputed",
      dimensionKey: "all",
      label: "Cost",
      points: [{ t: "2026-07-01T00:00:00.000Z", value: 0 }],
    };
    const input: Series = {
      measure: "inputTokens",
      dimensionKey: "all",
      label: "Input",
      points: [{ t: "2026-07-01T00:00:00.000Z", value: 100 }],
    };
    const output: Series = {
      measure: "outputTokens",
      dimensionKey: "all",
      label: "Output",
      points: [{ t: "2026-07-01T00:00:00.000Z", value: 50 }],
    };
    const result = tokensPerDollarSeries(cost, input, output);
    expect(result.points[0].value).toBeNull();
  });
});

describe("RollingEfficiencyPanel", () => {
  it("requests all four measures at day grain with ma7 smoothing", async () => {
    postMetricsMock.mockResolvedValue(seriesResponse());
    renderPanel();
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalled());
    expect(postMetricsMock.mock.calls[0][0]).toMatchObject({
      measures: ["costComputed", "cacheHitPct", "inputTokens", "outputTokens"],
      grain: "day",
      smoothing: "ma7",
    });
  });

  it("defaults to the $/day 7d-MA view", async () => {
    postMetricsMock.mockResolvedValue(seriesResponse());
    renderPanel();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "$/day 7d-MA" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
  });

  it("switches to the tokens-per-$ view on toggle", async () => {
    postMetricsMock.mockResolvedValue(seriesResponse());
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("chart-stub")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "tokens per $" }));
    await waitFor(() => {
      const option = chartSpy.mock.calls.at(-1)?.[0].option;
      expect(option.series[0].name).toBe("Tokens per $");
    });
  });

  it("switches to the cache-trend view on toggle", async () => {
    postMetricsMock.mockResolvedValue(seriesResponse());
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("chart-stub")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "cache trend" }));
    await waitFor(() => {
      const option = chartSpy.mock.calls.at(-1)?.[0].option;
      expect(option.series[0].data[0][1]).toBe(50);
    });
  });

  it("surfaces a fetch error", async () => {
    postMetricsMock.mockRejectedValue(new Error("boom"));
    renderPanel();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("boom"));
  });
});
