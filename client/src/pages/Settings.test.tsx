// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { AppConfig } from "../../../shared/settings-contract.js";
import type { SessionListResponse } from "../../../shared/sessions-contract.js";

// Whole-page composition smoke test (Phase 4 standing rule: route renders
// key sections from fixtures). Same fetch-boundary mocking pattern as
// Sessions.test.tsx/Dashboard.test.tsx.
const getConfigMock = vi.fn<() => Promise<AppConfig>>();
const putConfigMock = vi.fn<(patch: Partial<AppConfig>) => Promise<AppConfig>>();
vi.mock("../api/config.js", () => ({
  getConfig: () => getConfigMock(),
  putConfig: (patch: Partial<AppConfig>) => putConfigMock(patch),
}));

const getViewsMock = vi.fn();
const getTagsMock = vi.fn();
vi.mock("../api/localStore.js", () => ({
  getViews: () => getViewsMock(),
  getTags: () => getTagsMock(),
}));

const listSessionsMock = vi.fn<(params: unknown) => Promise<SessionListResponse>>();
vi.mock("../api/sessions.js", () => ({
  listSessions: (params: unknown) => listSessionsMock(params),
}));

const { Settings } = await import("./Settings.js");

function emptyConfig(): AppConfig {
  return { budget: null };
}

function emptySessionsResponse(): SessionListResponse {
  return {
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
  };
}

function renderSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path: "/settings", static: true });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <Settings />
      </Router>
    </QueryClientProvider>
  ) as ReactElement;
  return render(tree);
}

beforeEach(() => {
  getConfigMock.mockReset();
  getConfigMock.mockResolvedValue(emptyConfig());
  putConfigMock.mockReset();
  getViewsMock.mockReset();
  getViewsMock.mockResolvedValue([]);
  getTagsMock.mockReset();
  getTagsMock.mockResolvedValue([]);
  listSessionsMock.mockReset();
  listSessionsMock.mockResolvedValue(emptySessionsResponse());
});

afterEach(() => {
  cleanup();
});

describe("Settings page composition", () => {
  it("renders all five sections", async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByTestId("pricing-editor")).toBeInTheDocument());
    expect(screen.getByTestId("scan-roots-editor")).toBeInTheDocument();
    expect(screen.getByTestId("thresholds-panel")).toBeInTheDocument();
    expect(screen.getByTestId("cost-capture-guide")).toBeInTheDocument();
    expect(screen.getByTestId("saved-views-tags-panel")).toBeInTheDocument();
  });

  it("keeps rendering every other section when one panel's query rejects", async () => {
    getViewsMock.mockRejectedValue(new Error("views endpoint unreachable"));
    renderSettings();
    await waitFor(() => expect(screen.getByTestId("pricing-editor")).toBeInTheDocument());
    expect(screen.getByTestId("scan-roots-editor")).toBeInTheDocument();
    expect(screen.getByTestId("thresholds-panel")).toBeInTheDocument();
  });
});
