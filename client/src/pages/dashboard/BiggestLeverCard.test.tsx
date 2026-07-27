// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { BiggestLeverParams } from "../../api/scorecard.js";
import type { BiggestLeverView } from "../../../../shared/scorecard-contract.js";

const getBiggestLeverMock = vi.fn<(params: BiggestLeverParams) => Promise<BiggestLeverView>>();
vi.mock("../../api/scorecard.js", () => ({
  getBiggestLever: (params: BiggestLeverParams) => getBiggestLeverMock(params),
}));

const { BiggestLeverCard } = await import("./BiggestLeverCard.js");

const eventLever: BiggestLeverView = {
  state: "event",
  eventId: "m42",
  callId: "m42",
  promptId: "p9",
  turnNumber: 6,
  timestamp: "2026-07-20T12:04:00.000Z",
  model: "claude-sonnet-5",
  project: "/repo/alpha",
  branch: "main",
  kind: "prefix-bust",
  baseCause: "unexplained",
  attribution: "prefix-change",
  tokensRewritten: 90_000,
  costEstimate: 0.34,
  costBasis: "computed",
  deepLink: "/sessions/session-aaaa1111#cache-scorecard",
  sessionId: "session-aaaa1111",
  sessionProject: "/repo/alpha",
  evaluatedAt: "2026-07-20T12:30:00.000Z",
};

const healthyLever: BiggestLeverView = {
  state: "healthy",
  firstWriteTokens: 480_000,
  totalCreationTokens: 500_000,
  firstWriteShare: 0.96,
  evaluatedAt: "2026-07-20T12:30:00.000Z",
};

const noActivityLever: BiggestLeverView = {
  state: "no-cache-activity",
  firstWriteTokens: 0,
  totalCreationTokens: 0,
  firstWriteShare: null,
  evaluatedAt: "2026-07-20T12:30:00.000Z",
};

function renderCard(path = "/") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path, static: true });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <BiggestLeverCard now={new Date("2026-07-20T12:30:00.000Z")} />
      </Router>
    </QueryClientProvider>
  ) as ReactElement;
  return render(tree);
}

beforeEach(() => {
  getBiggestLeverMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("BiggestLeverCard", () => {
  it("renders the loading state while the fetch is pending", () => {
    getBiggestLeverMock.mockReturnValue(new Promise(() => {}));
    renderCard();
    expect(screen.getByRole("status")).toHaveTextContent(/Loading/i);
  });

  it("renders an error message when the fetch fails", async () => {
    getBiggestLeverMock.mockRejectedValue(new Error("from and to are required"));
    renderCard();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/from and to are required/i);
    });
  });

  it("renders the event state: kind, tokens, dollars, session/project, and a deep link", async () => {
    getBiggestLeverMock.mockResolvedValue(eventLever);
    renderCard();
    await waitFor(() => expect(screen.getByTestId("biggest-lever-event")).toBeInTheDocument());
    const card = screen.getByTestId("biggest-lever-event");
    expect(card).toHaveTextContent("prefix bust");
    expect(card).toHaveTextContent("90K rewritten"); // Intl compact tokens
    expect(card).toHaveTextContent("$0.34");
    expect(card).toHaveTextContent("/repo/alpha");
    const link = screen.getByRole("link", { name: /Investigate/i });
    expect(link).toHaveAttribute("href", "/sessions/session-aaaa1111#cache-scorecard");
  });

  it("renders unavailable — never $0.00 — when costEstimate is null", async () => {
    getBiggestLeverMock.mockResolvedValue({
      ...eventLever,
      costEstimate: null,
      costBasis: "unavailable",
    });
    renderCard();
    await waitFor(() => expect(screen.getByTestId("biggest-lever-event")).toBeInTheDocument());
    const card = screen.getByTestId("biggest-lever-event");
    expect(card).toHaveTextContent("unavailable");
    expect(card).not.toHaveTextContent("$0.00");
  });

  it("renders the healthy state with a real first-write-share number, distinct from loading/error", async () => {
    getBiggestLeverMock.mockResolvedValue(healthyLever);
    renderCard();
    await waitFor(() => expect(screen.getByTestId("biggest-lever-healthy")).toBeInTheDocument());
    expect(screen.getByTestId("biggest-lever-healthy")).toHaveTextContent("96%");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a distinct no-cache-activity state without a fabricated 100%", async () => {
    getBiggestLeverMock.mockResolvedValue(noActivityLever);
    renderCard();
    await waitFor(() =>
      expect(screen.getByTestId("biggest-lever-no-activity")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("biggest-lever-no-activity")).not.toHaveTextContent("100%");
  });

  it("renders exactly one event, never a list", async () => {
    getBiggestLeverMock.mockResolvedValue(eventLever);
    renderCard();
    await waitFor(() => expect(screen.getByTestId("biggest-lever-event")).toBeInTheDocument());
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("sends the global range + project/model/branch/host filters from the URL", async () => {
    getBiggestLeverMock.mockResolvedValue(noActivityLever);
    renderCard(
      "/?from=2026-07-01T00:00:00.000Z&to=2026-07-02T00:00:00.000Z&project=/repo/alpha&model=claude-sonnet-5",
    );
    await waitFor(() => expect(getBiggestLeverMock).toHaveBeenCalled());
    expect(getBiggestLeverMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "2026-07-01T00:00:00.000Z",
        to: "2026-07-02T00:00:00.000Z",
        project: ["/repo/alpha"],
        model: ["claude-sonnet-5"],
      }),
    );
  });
});
