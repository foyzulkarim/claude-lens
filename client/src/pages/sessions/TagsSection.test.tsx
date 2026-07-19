// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SESSIONS_PAGE_STATE } from "./state.js";

const getTagsMock = vi.fn<() => Promise<{ tag: string; sessionCount: number }[]>>();
vi.mock("../../api/localStore.js", () => ({
  getTags: () => getTagsMock(),
}));

const { TagsSection } = await import("./TagsSection.js");

function renderSection(state = DEFAULT_SESSIONS_PAGE_STATE, onStateChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <TagsSection state={state} onStateChange={onStateChange} />
    </QueryClientProvider>
  ) as ReactElement;
  return { ...render(tree), onStateChange };
}

beforeEach(() => {
  getTagsMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("TagsSection", () => {
  it("shows an empty state when no tags exist yet", async () => {
    getTagsMock.mockResolvedValue([]);
    renderSection();
    await waitFor(() => expect(screen.getByText(/No tags yet/)).toBeInTheDocument());
  });

  it("renders each tag as a chip with its usage count", async () => {
    getTagsMock.mockResolvedValue([
      { tag: "important", sessionCount: 3 },
      { tag: "follow-up", sessionCount: 1 },
    ]);
    renderSection();
    await waitFor(() => expect(screen.getByText("important (3)")).toBeInTheDocument());
    expect(screen.getByText("follow-up (1)")).toBeInTheDocument();
  });

  it("toggling a tag chip patches state.tags", async () => {
    getTagsMock.mockResolvedValue([{ tag: "important", sessionCount: 3 }]);
    const { onStateChange } = renderSection();
    const chip = await screen.findByText("important (3)");
    await userEvent.setup().click(chip);
    expect(onStateChange).toHaveBeenCalledWith({ tags: ["important"] });
  });

  it("clicking an already-selected tag deselects it (clears to undefined)", async () => {
    getTagsMock.mockResolvedValue([{ tag: "important", sessionCount: 3 }]);
    const { onStateChange } = renderSection({
      ...DEFAULT_SESSIONS_PAGE_STATE,
      tags: ["important"],
    });
    const chip = await screen.findByText("important (3)");
    await userEvent.setup().click(chip);
    expect(onStateChange).toHaveBeenCalledWith({ tags: undefined });
  });

  it("surfaces a fetch error", async () => {
    getTagsMock.mockRejectedValue(new Error("boom"));
    renderSection();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("boom"));
  });
});
