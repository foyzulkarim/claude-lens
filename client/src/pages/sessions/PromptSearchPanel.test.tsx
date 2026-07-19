// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { SearchIndexResponse } from "../../../../shared/search-index-contract.js";
import { PromptSearchPanel } from "./PromptSearchPanel.js";

const SAMPLE_INDEX: SearchIndexResponse = {
  prompts: [
    {
      id: "s1:p1",
      sessionId: "s1",
      promptId: "p1",
      turnNumber: 1,
      text: "How do I budget my Claude Code usage across a 5-hour subscription window?",
      timestamp: "2026-07-15T10:00:00.000Z",
      cwd: "/Users/me/personal/claude-lens",
      gitBranch: "main",
    },
    {
      id: "s1:p2",
      sessionId: "s1",
      promptId: "p2",
      turnNumber: 2,
      text: "Refactor the parser to handle partial trailing lines more carefully.",
      timestamp: "2026-07-15T10:05:00.000Z",
      cwd: "/Users/me/personal/claude-lens",
      gitBranch: "feat/search-index",
    },
    {
      id: "s2:p1",
      sessionId: "s2",
      promptId: "p1",
      turnNumber: 1,
      text: "Add a MiniSearch-backed full-text search across every user prompt.",
      timestamp: "2026-07-12T14:30:00.000Z",
      cwd: "/Users/me/personal/claude-lens",
      gitBranch: "feat/search-index",
    },
  ],
  version: 1,
};

const EMPTY_INDEX: SearchIndexResponse = { prompts: [], version: 1 };

function installFetch(responder: () => Promise<Response>): void {
  const fakeFetch = vi.fn((): Promise<Response> => responder());
  vi.stubGlobal("fetch", fakeFetch);
}

function renderPanel(initialSearch = "") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({
    path: "/sessions",
    searchPath: initialSearch,
    static: true,
  });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <PromptSearchPanel />
      </Router>
    </QueryClientProvider>
  ) as ReactElement;
  return render(tree);
}

beforeEach(() => {
  installFetch(() => Promise.resolve(new Response(JSON.stringify(SAMPLE_INDEX))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("PromptSearchPanel — display states (#P4-3)", () => {
  it("shows the idle hint before the user types", async () => {
    renderPanel();
    const input = screen.getByTestId("prompt-search-input");
    expect(input).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Type to search across/i)).toBeInTheDocument();
    });
  });

  it("renders the empty-state message when the index is empty", async () => {
    installFetch(() => Promise.resolve(new Response(JSON.stringify(EMPTY_INDEX))));
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/No prompts indexed yet/i)).toBeInTheDocument();
    });
  });

  it("renders an error state when the index fetch fails", async () => {
    installFetch(() => Promise.resolve(new Response("boom", { status: 500 })));
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/Prompt search unavailable/i)).toBeInTheDocument();
    });
  });
});

describe("PromptSearchPanel — search-as-you-type", () => {
  it("renders matching results after the user types a query", async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() => screen.getByTestId("prompt-search-input"));

    await user.type(screen.getByTestId("prompt-search-input"), "refactor");

    await waitFor(() => {
      const results = screen.getAllByTestId("prompt-search-result");
      expect(results.length).toBeGreaterThan(0);
    });
    // The refactor prompt should appear in the result list.
    expect(screen.getByText(/Refactor the parser/i)).toBeInTheDocument();
  });

  it("renders the no-match state when the query has no hits", async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() => screen.getByTestId("prompt-search-input"));

    // A query that's both absent from the corpus AND longer than the
    // fuzzy-matching edit-distance budget — MiniSearch's fuzzy=0.2 lets
    // ~20% of characters mismatch, so a 14-char nonsense string with
    // no overlap to any prompt text stays no-match.
    await user.type(screen.getByTestId("prompt-search-input"), "qqqxxxwwwyyyzzz");

    await waitFor(() => {
      expect(screen.getByText(/No matches for/i)).toBeInTheDocument();
    });
  });

  it("clears results back to the idle hint when the input is emptied", async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() => screen.getByTestId("prompt-search-input"));

    const input = screen.getByTestId("prompt-search-input") as HTMLInputElement;
    await user.type(input, "refactor");
    await waitFor(() => screen.getAllByTestId("prompt-search-result"));

    await user.clear(input);
    await waitFor(() => {
      expect(screen.queryByTestId("prompt-search-result")).not.toBeInTheDocument();
      expect(screen.getByText(/Type to search across/i)).toBeInTheDocument();
    });
  });
});

describe("PromptSearchPanel — deep-link shape", () => {
  it("clicking a result navigates to /sessions/:id?turn=N", async () => {
    const user = userEvent.setup();
    const { hook, searchHook, history } = memoryLocation({
      path: "/sessions",
      record: true,
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (
      <QueryClientProvider client={queryClient}>
        <Router hook={hook} searchHook={searchHook}>
          <PromptSearchPanel />
        </Router>
      </QueryClientProvider>
    ) as ReactElement;
    render(tree);

    // Type a query that matches the "Refactor the parser" prompt in the
    // sample fixture; the click below should navigate to its session.
    const input = await waitFor(() => screen.getByTestId("prompt-search-input"));
    await user.type(input, "refactor");

    await waitFor(() => screen.getAllByTestId("prompt-search-result"));
    const results = screen.getAllByTestId("prompt-search-result");
    expect(results.length).toBeGreaterThan(0);
    await user.click(results[0] as HTMLElement);

    // memoryLocation's recorded history captures every navigation;
    // the latest entry should be the Session Detail deep-link at
    // /sessions/:id?turn=N (ARCH A3).
    const last = history.at(-1) ?? "";
    expect(last.startsWith("/sessions/s1?turn=")).toBe(true);
  });
});
