// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { VersionSnapshot } from "../../../shared/version-contract.js";

const fetchVersionMock = vi.fn<() => Promise<VersionSnapshot>>();
vi.mock("../api/version.js", () => ({
  fetchVersion: () => fetchVersionMock(),
}));

const { AppShell } = await import("./AppShell.js");

function snapshot(over: Partial<VersionSnapshot> = {}): VersionSnapshot {
  return {
    currentVersion: "1.2.0",
    latestVersion: null,
    updateAvailable: false,
    lastCheckedAt: null,
    ...over,
  };
}

function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path: "/", static: true });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <AppShell>
          <div>page content</div>
        </AppShell>
      </Router>
    </QueryClientProvider>
  ) as ReactElement;
  return render(tree);
}

beforeEach(() => {
  fetchVersionMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("AppShell — update-available badge", () => {
  it("renders no badge when already on the latest version", async () => {
    fetchVersionMock.mockResolvedValue(snapshot({ updateAvailable: false }));
    renderShell();
    await waitFor(() => expect(fetchVersionMock).toHaveBeenCalled());
    expect(screen.queryByText("update available")).not.toBeInTheDocument();
  });

  it("renders the badge when a newer version is available", async () => {
    fetchVersionMock.mockResolvedValue(snapshot({ updateAvailable: true, latestVersion: "1.3.0" }));
    renderShell();
    expect(await screen.findByText("update available")).toBeInTheDocument();
  });

  it("renders no badge while the check is pending or has failed", async () => {
    fetchVersionMock.mockRejectedValue(new Error("offline"));
    renderShell();
    await waitFor(() => expect(fetchVersionMock).toHaveBeenCalled());
    expect(screen.queryByText("update available")).not.toBeInTheDocument();
  });
});
