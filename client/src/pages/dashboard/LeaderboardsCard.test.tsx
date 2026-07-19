// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import type { SessionListResponse } from "../../../../shared/sessions-contract.js";

const listSessionsMock = vi.fn<(params: unknown) => Promise<SessionListResponse>>();
vi.mock("../../api/sessions.js", () => ({
  listSessions: (params: unknown) => listSessionsMock(params),
}));

const postMetricsMock = vi.fn<(query: unknown) => Promise<Series[]>>();
vi.mock("../../api/metrics.js", () => ({
  postMetrics: (query: unknown) => postMetricsMock(query),
}));

const { LeaderboardsCard } = await import("./LeaderboardsCard.js");

const sessionsResponse: SessionListResponse = {
  items: [
    {
      sessionId: "session-aaaa1111",
      startedAt: "2026-07-10T00:00:00.000Z",
      lastAt: "2026-07-10T01:00:00.000Z",
      project: "claude-lens",
      model: "claude-sonnet-5",
      durationMs: 3_600_000,
      turnCount: 12,
      costComputed: 18.42,
    },
  ],
  total: 1,
  meta: {
    matchedExtent: null,
    globalCapture: {
      hasCostSamples: false,
      hasTurnBoundaries: false,
      hasCostLog: false,
      costBasis: "computed",
    },
    captureSummary: { capturingSessions: 0, lastCapturedAt: null },
  },
};

const projectSeries: Series[] = [
  {
    measure: "costComputed",
    dimensionKey: "project:claude-lens",
    label: "claude-lens",
    points: [{ t: "2026-07-08T00:00:00.000Z", value: 40.2 }],
  },
];

const modelSeries: Series[] = [
  {
    measure: "costComputed",
    dimensionKey: "model:claude-sonnet-5",
    label: "claude-sonnet-5",
    points: [{ t: "2026-07-08T00:00:00.000Z", value: 30.5 }],
  },
];

function renderCard(search = "") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const searchPath = search.startsWith("?") ? search.slice(1) : search;
  const { hook, searchHook, history } = memoryLocation({ path: "/", searchPath, record: true });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <LeaderboardsCard />
      </Router>
    </QueryClientProvider>
  ) as ReactElement;
  return { ...render(tree), history: history as string[] };
}

beforeEach(() => {
  listSessionsMock.mockReset();
  postMetricsMock.mockReset();
  listSessionsMock.mockResolvedValue(sessionsResponse);
  postMetricsMock.mockResolvedValue(projectSeries);
});

afterEach(() => {
  cleanup();
});

describe("LeaderboardsCard — tabs", () => {
  it("defaults to the Sessions tab and renders top sessions", async () => {
    renderCard();
    const tab = screen.getByRole("tab", { name: "Sessions" });
    expect(tab).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(listSessionsMock).toHaveBeenCalled());
    expect(await screen.findByText("claude-lens")).toBeInTheDocument();
  });

  it("switches to the Projects tab, fetches a project-dimension metrics query, and shows project rows", async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(listSessionsMock).toHaveBeenCalled());

    await user.click(screen.getByRole("tab", { name: "Projects" }));

    expect(screen.getByRole("tab", { name: "Projects" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalled());
    const query = postMetricsMock.mock.calls.at(-1)?.[0] as { dimensions: string[] };
    expect(query.dimensions).toEqual(["project"]);
    expect(await screen.findByText("claude-lens")).toBeInTheDocument();
  });

  it("switches to the Models tab and fetches a model-dimension metrics query", async () => {
    const user = userEvent.setup();
    postMetricsMock.mockResolvedValue(modelSeries);
    renderCard();
    await waitFor(() => expect(listSessionsMock).toHaveBeenCalled());

    await user.click(screen.getByRole("tab", { name: "Models" }));

    await waitFor(() => expect(postMetricsMock).toHaveBeenCalled());
    const query = postMetricsMock.mock.calls.at(-1)?.[0] as { dimensions: string[] };
    expect(query.dimensions).toEqual(["model"]);
    expect(await screen.findByText("claude-sonnet-5")).toBeInTheDocument();
  });

  it("honors an initialTab prop for deep-linked stories/tests", async () => {
    const { LeaderboardsCard: Card } = await import("./LeaderboardsCard.js");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { hook, searchHook } = memoryLocation({ path: "/", static: true });
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={hook} searchHook={searchHook}>
          <Card initialTab="models" />
        </Router>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("tab", { name: "Models" })).toHaveAttribute("aria-selected", "true");
  });

  it("clicking a session row navigates to /sessions/:id", async () => {
    const user = userEvent.setup();
    const { history } = renderCard();
    const link = await screen.findAllByRole("button", { name: /View session/ });
    await user.click(link[0]);
    expect(history.at(-1)).toBe("/sessions/session-aaaa1111");
  });

  it("shows 'No data yet' when a tab has no rows", async () => {
    listSessionsMock.mockResolvedValue({
      items: [],
      total: 0,
      meta: {
        matchedExtent: null,
        globalCapture: {
          hasCostSamples: false,
          hasTurnBoundaries: false,
          hasCostLog: false,
          costBasis: "computed",
        },
        captureSummary: { capturingSessions: 0, lastCapturedAt: null },
      },
    });
    renderCard();
    expect(await screen.findByText("No data yet")).toBeInTheDocument();
  });
});
