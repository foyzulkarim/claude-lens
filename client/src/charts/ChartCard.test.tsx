// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../shared/metrics-contract.js";
import { qk } from "../api/queryKeys.js";
import type { ChartProps } from "./Chart.js";

const chartSpy = vi.fn();
vi.mock("./Chart.js", () => ({
  Chart: (props: ChartProps) => {
    chartSpy(props);
    return (
      // biome-ignore lint/a11y/useButtonType: test double
      <button
        data-testid="chart-stub"
        onClick={() =>
          props.onPointClick?.({
            value: ["2026-07-10T00:00:00.000Z", 5],
          } as never)
        }
      >
        chart
      </button>
    );
  },
}));

const postMetricsMock = vi.fn<(query: unknown) => Promise<Series[]>>();
vi.mock("../api/metrics.js", () => ({
  postMetrics: (query: unknown) => postMetricsMock(query),
}));

const { ChartCard, chartAriaLabel } = await import("./ChartCard.js");

function latestQuery<T>(): T {
  const calls = postMetricsMock.mock.calls;
  const call = calls[calls.length - 1];
  if (!call) throw new Error("postMetrics was never called");
  return call[0] as T;
}

const sampleSeries: Series[] = [
  {
    measure: "costComputed",
    dimensionKey: "time",
    label: "Cost",
    points: [
      { t: "2026-07-08T00:00:00.000Z", value: 1 },
      { t: "2026-07-09T00:00:00.000Z", value: 2 },
    ],
  },
];

const summarySeries: Series[] = [
  {
    measure: "costComputed",
    dimensionKey: "time",
    label: "Cost",
    points: [
      { t: "2026-07-08T00:00:00.000Z", value: 1 },
      { t: "2026-07-09T00:00:00.000Z", value: null },
      { t: "2026-07-10T00:00:00.000Z", value: Number.POSITIVE_INFINITY },
      { t: "2026-07-11T00:00:00.000Z", value: Number.NEGATIVE_INFINITY },
      { t: "2026-07-12T00:00:00.000Z", value: Number.NaN },
    ],
    compareGhost: [{ t: "2026-07-08T00:00:00.000Z", value: 100 }],
  },
  {
    measure: "costComputed",
    dimensionKey: "time",
    label: "Secondary cost series",
    points: [{ t: "2026-07-08T00:00:00.000Z", value: 2 }],
  },
];

function renderCard(search = "") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook, history } = memoryLocation({
    path: "/",
    searchPath: search,
    record: true,
  });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <ChartCard title="Cost over time" defaultUnit="$" />
      </Router>
    </QueryClientProvider>
  ) as ReactElement;
  const view = render(tree);
  // Re-renders with the exact same element tree (same queryClient/hook
  // instances, same props) — a genuine "nothing changed" re-render, as
  // opposed to a fresh mount.
  const rerenderUnchanged = () => view.rerender(tree);
  return { history: history as string[], queryClient, rerenderUnchanged };
}

beforeEach(() => {
  postMetricsMock.mockReset();
  chartSpy.mockReset();
  postMetricsMock.mockResolvedValue(sampleSeries);
});

afterEach(() => {
  cleanup();
});

describe("ChartCard — render states", () => {
  it("renders a loading state before postMetrics resolves", () => {
    postMetricsMock.mockImplementation(() => new Promise(() => {}));
    renderCard();
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(chartSpy).not.toHaveBeenCalled();
  });

  it("renders an error state when postMetrics rejects", async () => {
    postMetricsMock.mockRejectedValue(new Error("boom"));
    renderCard();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("boom"));
  });

  it("renders the chart once data resolves, built from the resolved Series[]", async () => {
    renderCard();
    await waitFor(() => expect(chartSpy).toHaveBeenCalled());
    const lastCall = chartSpy.mock.calls.at(-1)?.[0] as ChartProps;
    expect(lastCall.option.series).toHaveLength(1);
  });
});

describe("ChartCard — semantic summary", () => {
  it("leaves the summary undefined until query data exists", () => {
    expect(chartAriaLabel(undefined, "Cost over time", "$")).toBeUndefined();
  });

  it("describes an empty loaded result as zero series and zero total", async () => {
    postMetricsMock.mockResolvedValue([]);
    renderCard();
    await waitFor(() => {
      const lastCall = chartSpy.mock.calls.at(-1)?.[0] as ChartProps;
      expect(lastCall.ariaLabel).toBe("Cost over time chart; 0 series; total $0.00");
    });
  });

  it("treats all-null and non-finite points as a zero total", () => {
    const values: Series[] = [
      {
        measure: "costComputed",
        dimensionKey: "time",
        label: "No finite values",
        points: [
          { t: "2026-07-08T00:00:00.000Z", value: null },
          { t: "2026-07-09T00:00:00.000Z", value: Number.NaN },
          { t: "2026-07-10T00:00:00.000Z", value: Number.POSITIVE_INFINITY },
          { t: "2026-07-11T00:00:00.000Z", value: Number.NEGATIVE_INFINITY },
        ],
      },
    ];
    expect(chartAriaLabel(values, "Cost over time", "$")).toBe(
      "Cost over time chart; 1 series; total $0.00",
    );
  });

  it("derives the loaded chart summary from finite points using the active unit formatter", async () => {
    postMetricsMock.mockResolvedValue(summarySeries);
    renderCard();
    await waitFor(() => {
      const lastCall = chartSpy.mock.calls.at(-1)?.[0] as ChartProps;
      expect(lastCall.ariaLabel).toBe("Cost over time chart; 2 series; total $3.00");
    });
  });

  it("updates the semantic summary when query data changes", async () => {
    const { queryClient } = renderCard();
    await waitFor(() => expect(chartSpy).toHaveBeenCalled());
    const initial = chartSpy.mock.calls.at(-1)?.[0] as ChartProps;
    expect(initial.ariaLabel).toBe("Cost over time chart; 1 series; total $3.00");

    queryClient.setQueryData(qk.metrics(latestQuery()), [
      {
        ...sampleSeries[0],
        points: [...sampleSeries[0].points, { t: "2026-07-10T00:00:00.000Z", value: 4 }],
      },
    ]);

    await waitFor(() => {
      const updated = chartSpy.mock.calls.at(-1)?.[0] as ChartProps;
      expect(updated.ariaLabel).toBe("Cost over time chart; 1 series; total $7.00");
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Chart updated: Cost over time chart; 1 series; total $7.00",
    );
  });

  it("does not announce the initial summary or an unchanged rerender", async () => {
    const { rerenderUnchanged } = renderCard();
    await waitFor(() => expect(chartSpy).toHaveBeenCalled());
    expect(screen.queryByText(/^Chart updated:/)).not.toBeInTheDocument();

    rerenderUnchanged();
    expect(screen.queryByText(/^Chart updated:/)).not.toBeInTheDocument();
  });
});

describe("ChartCard — controls", () => {
  it("unit toggle requeries with the mapped measure(s)", async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "tokens" }));
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalledTimes(2));
    const lastQuery = postMetricsMock.mock.calls.at(-1)?.[0] as { measures: string[] };
    expect(lastQuery.measures).toEqual(["inputTokens", "outputTokens"]);
  });

  it("family toggle re-renders without a new fetch", async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "bars" }));
    await waitFor(() => {
      const lastCall = chartSpy.mock.calls.at(-1)?.[0] as ChartProps;
      const [entry] = lastCall.option.series as { type: string }[];
      expect(entry.type).toBe("bar");
    });
    expect(postMetricsMock).toHaveBeenCalledTimes(1);
  });

  it("grain toggle requeries with the updated grain", async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalledTimes(1));

    await user.selectOptions(screen.getByLabelText("Grain"), "week");
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalledTimes(2));
    const lastQuery = postMetricsMock.mock.calls.at(-1)?.[0] as { grain: string };
    expect(lastQuery.grain).toBe("week");
  });

  it("compare toggle adds/removes compare: previous-period", async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Compare" }));
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalledTimes(2));
    expect(latestQuery<{ compare?: string }>().compare).toBe("previous-period");

    await user.click(screen.getByRole("button", { name: "Compare" }));
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalledTimes(3));
    expect(latestQuery<{ compare?: string }>().compare).toBeUndefined();
  });

  it("smoothing toggle adds/removes smoothing: ma7", async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "MA7" }));
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalledTimes(2));
    expect(latestQuery<{ smoothing?: string }>().smoothing).toBe("ma7");

    await user.click(screen.getByRole("button", { name: "MA7" }));
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalledTimes(3));
    expect(latestQuery<{ smoothing?: string }>().smoothing).toBeUndefined();
  });

  it("click-to-drill navigates with the clicked bucket's range", async () => {
    const user = userEvent.setup();
    const { history } = renderCard();
    await waitFor(() => expect(chartSpy).toHaveBeenCalled());

    await user.click(screen.getByTestId("chart-stub"));
    const lastPath = history.at(-1);
    expect(lastPath).toBe(
      "/sessions?from=2026-07-10T00%3A00%3A00.000Z&to=2026-07-11T00%3A00%3A00.000Z",
    );
  });

  it("settles on the last selection when unit and grain are toggled in quick succession", async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalledTimes(1));

    // Fire both toggles without awaiting the fetches in between.
    await Promise.all([
      user.click(screen.getByRole("button", { name: "tokens" })),
      user.selectOptions(screen.getByLabelText("Grain"), "week"),
    ]);

    await waitFor(() => {
      const last = latestQuery<{ measures: string[]; grain: string }>();
      expect(last.measures).toEqual(["inputTokens", "outputTokens"]);
      expect(last.grain).toBe("week");
    });
  });
});

describe("ChartCard — regression guards", () => {
  it("stable filters+controls do not requery on unrelated re-render", async () => {
    const { rerenderUnchanged } = renderCard();
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalledTimes(1));

    // Force an actual second render pass with nothing changed — if the
    // query's useMemo guard (ChartCard.tsx) regressed to a fresh-object
    // identity per render, this would trigger a second fetch.
    rerenderUnchanged();
    await waitFor(() => expect(chartSpy).toHaveBeenCalled());
    expect(postMetricsMock).toHaveBeenCalledTimes(1);
  });

  it("query key matches the shared factory exactly", async () => {
    const { queryClient } = renderCard();
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalledTimes(1));
    const sentQuery = postMetricsMock.mock.calls[0]?.[0];

    // Inspect the key TanStack Query actually registered in its cache —
    // not a self-reference — so a hand-rolled key (e.g. dropping qk.metrics)
    // would fail this assertion.
    const [entry] = queryClient.getQueryCache().getAll();
    expect(entry?.queryKey).toEqual(qk.metrics(sentQuery as never));
  });

  it("range/filters fragment matches the shared resolver", async () => {
    const before = Date.now();
    renderCard();
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalledTimes(1));
    const after = Date.now();
    const sentQuery = postMetricsMock.mock.calls[0]?.[0] as {
      range: { from: string; to: string };
      filters: Record<string, unknown>;
    };
    // Default filters ("") resolve to the 7d preset via filtersToQuery/resolveRange
    // — assert the same shape rather than a wall-clock-identical instant.
    expect(Date.parse(sentQuery.range.to)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(sentQuery.range.to)).toBeLessThanOrEqual(after);
    expect(Date.parse(sentQuery.range.to) - Date.parse(sentQuery.range.from)).toBe(
      7 * 24 * 60 * 60 * 1000,
    );
    expect(sentQuery.filters).toEqual({});
  });
});
