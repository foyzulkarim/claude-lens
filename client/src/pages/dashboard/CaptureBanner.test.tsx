// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type {
  SessionListParams,
  SessionListResponse,
} from "../../../../shared/sessions-contract.js";
import type { TierFlags } from "../../../../shared/types.js";

const listSessionsMock = vi.fn<(params: unknown) => Promise<SessionListResponse>>();
vi.mock("../../api/sessions.js", () => ({
  listSessions: (params: unknown) => listSessionsMock(params),
}));

const { CaptureBanner } = await import("./CaptureBanner.js");

function responseFor(globalCapture: TierFlags): SessionListResponse {
  return { items: [], total: 0, meta: { matchedExtent: null, globalCapture } };
}

function renderBanner(search = "") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const searchPath = search.startsWith("?") ? search.slice(1) : search;
  const { hook, searchHook } = memoryLocation({ path: "/", searchPath, record: true });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <CaptureBanner />
      </Router>
    </QueryClientProvider>
  ) as ReactElement;
  return render(tree);
}

beforeEach(() => {
  listSessionsMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("CaptureBanner — visibility based on globalCapture", () => {
  it("renders the CTA with a link to /settings when no capture source is present", async () => {
    listSessionsMock.mockResolvedValue(
      responseFor({
        hasCostSamples: false,
        hasTurnBoundaries: false,
        hasCostLog: false,
        costBasis: "computed",
      }),
    );
    renderBanner();
    await waitFor(() => expect(screen.getByTestId("capture-banner")).toBeInTheDocument());
    expect(screen.getByText("Set up cost capture")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up cost capture →" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  it("renders nothing when a cost-samples source is present", async () => {
    listSessionsMock.mockResolvedValue(
      responseFor({
        hasCostSamples: true,
        hasTurnBoundaries: false,
        hasCostLog: false,
        costBasis: "observed",
      }),
    );
    const { container } = renderBanner();
    await waitFor(() => expect(listSessionsMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when a turn-boundaries source is present", async () => {
    listSessionsMock.mockResolvedValue(
      responseFor({
        hasCostSamples: false,
        hasTurnBoundaries: true,
        hasCostLog: false,
        costBasis: "computed",
      }),
    );
    const { container } = renderBanner();
    await waitFor(() => expect(listSessionsMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when a cost-log source is present", async () => {
    listSessionsMock.mockResolvedValue(
      responseFor({
        hasCostSamples: false,
        hasTurnBoundaries: false,
        hasCostLog: true,
        costBasis: "computed",
      }),
    );
    const { container } = renderBanner();
    await waitFor(() => expect(listSessionsMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing before the probe resolves (no loading flash)", () => {
    listSessionsMock.mockImplementation(() => new Promise(() => {}));
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it("fetches with no filter/date params — filter-independent per the section-level lock", async () => {
    listSessionsMock.mockResolvedValue(
      responseFor({
        hasCostSamples: false,
        hasTurnBoundaries: false,
        hasCostLog: false,
        costBasis: "computed",
      }),
    );
    renderBanner("?project=alpha&from=2026-01-01&to=2026-01-31");
    await waitFor(() => expect(listSessionsMock).toHaveBeenCalled());
    const sentParams = listSessionsMock.mock.calls[0]?.[0] as SessionListParams;
    expect(sentParams).toEqual({ limit: 1 });
  });
});
