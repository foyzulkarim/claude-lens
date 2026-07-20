// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { PromptSearchPanel } from "./PromptSearchPanel.js";
import { EMPTY_INDEX, SAMPLE_INDEX } from "./prompt-search.fixtures.js";

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
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <PromptSearchPanel />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  installFetch(() => Promise.resolve(new Response(JSON.stringify(SAMPLE_INDEX))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("PromptSearchPanel — display states (#P4-3)", () => {
  it("shows the idle hint after the index loads and the user hasn't typed", async () => {
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

  it("announces state changes via an aria-live region (A-1, WCAG 4.1.3)", async () => {
    renderPanel();
    await waitFor(() => {
      const status = screen.getByTestId("prompt-search-status");
      // Loading/empty/idle/no-match use role="status" + aria-live="polite".
      expect(status.getAttribute("role")).toBe("status");
      expect(status.getAttribute("aria-live")).toBe("polite");
    });
  });

  it("promotes the error state to role=alert so screen readers hear it (A-1)", async () => {
    installFetch(() => Promise.resolve(new Response("boom", { status: 500 })));
    renderPanel();
    await waitFor(() => {
      const status = screen.getByTestId("prompt-search-status");
      expect(status.getAttribute("role")).toBe("alert");
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
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={hook} searchHook={searchHook}>
          <PromptSearchPanel />
        </Router>
      </QueryClientProvider>,
    );

    const input = await waitFor(() => screen.getByTestId("prompt-search-input"));
    await user.type(input, "refactor");

    await waitFor(() => screen.getAllByTestId("prompt-search-result"));
    const results = screen.getAllByTestId("prompt-search-result");
    expect(results.length).toBeGreaterThan(0);
    await user.click(results[0] as HTMLElement);

    const last = history.at(-1) ?? "";
    expect(last.startsWith("/sessions/s1?turn=")).toBe(true);
  });
});

describe("PromptSearchPanel — keyboard navigation (A-2, A-7)", () => {
  it("ArrowDown moves the activeIndex through results; Enter navigates", async () => {
    const user = userEvent.setup();
    const { hook, searchHook, history } = memoryLocation({
      path: "/sessions",
      record: true,
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={hook} searchHook={searchHook}>
          <PromptSearchPanel />
        </Router>
      </QueryClientProvider>,
    );

    const input = await waitFor(() => screen.getByTestId("prompt-search-input"));
    await user.type(input, "refactor");
    await waitFor(() => screen.getAllByTestId("prompt-search-result"));

    // Focus the first result button (tabIndex=0 after roving-tabindex sets it).
    const first = screen.getAllByTestId("prompt-search-result")[0] as HTMLElement;
    first.focus();
    // Move to second result and press Enter.
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    const last = history.at(-1) ?? "";
    expect(last.startsWith("/sessions/")).toBe(true);
    expect(last).toContain("?turn=");
  });

  it("Escape clears the query and returns focus to the input", async () => {
    const user = userEvent.setup();
    renderPanel();

    const input = (await waitFor(() =>
      screen.getByTestId("prompt-search-input"),
    )) as HTMLInputElement;
    await user.type(input, "refactor");
    await waitFor(() => screen.getAllByTestId("prompt-search-result"));

    // Focus a result and press Escape.
    const first = screen.getAllByTestId("prompt-search-result")[0] as HTMLElement;
    first.focus();
    await user.keyboard("{Escape}");

    // Input is cleared and focused.
    await waitFor(() => {
      expect((screen.getByTestId("prompt-search-input") as HTMLInputElement).value).toBe("");
    });
    expect(document.activeElement).toBe(screen.getByTestId("prompt-search-input"));
  });
});

describe("PromptSearchPanel — build error defense-in-depth (EH-1, ARCH §Risks)", () => {
  it("renders the empty-state when the MiniSearch index build throws", async () => {
    // Stub a malformed index that survives the response guard but trips
    // MiniSearch's addAll. The component's defensive try should catch it
    // and render the build-error state instead of unmounting the section.
    installFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            // Two docs with the same id — the previous buildSearchSnapshot
            // would have deduped, but if the server (or a future regression)
            // ships a duplicate-id payload, MiniSearch's addAll throws.
            // This is the exact "pathological input" scenario ARCH §Risks
            // contracts the useMemo try to handle.
            prompts: [
              { ...SAMPLE_INDEX.prompts[0] },
              { ...SAMPLE_INDEX.prompts[0], text: "duplicate" },
            ],
            version: 1,
          }),
        ),
      ),
    );
    renderPanel();
    await waitFor(() => {
      // The error message mentions "index failed to build" so users can
      // tell this is a client-side bug, not a server outage.
      expect(screen.getByText(/index failed to build/i)).toBeInTheDocument();
    });
  });
});
