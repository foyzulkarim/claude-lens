// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { GlobalActionsBar } from "./GlobalActionsBar.js";

afterEach(() => {
  cleanup();
});

function renderAt(path: string, search = "") {
  // wouter's memoryLocation joins `path + "?" + searchPath` itself — a
  // leading "?" in `search` produces a literal "??" and silently drops the
  // query, so strip it here (call sites read more naturally with it).
  const searchPath = search.startsWith("?") ? search.slice(1) : search;
  const { hook, searchHook } = memoryLocation({ path, searchPath, static: true });
  render(
    <Router hook={hook} searchHook={searchHook}>
      <GlobalActionsBar />
    </Router>,
  );
}

describe("GlobalActionsBar — route gating", () => {
  it("renders Export CSV/JSON on the Sessions list route", () => {
    renderAt("/sessions", "?range=30d");
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export JSON" })).toBeInTheDocument();
  });

  it("hides Export CSV/JSON on other routes", () => {
    renderAt("/", "?range=30d");
    expect(screen.queryByRole("button", { name: "Export CSV" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export JSON" })).not.toBeInTheDocument();
  });

  it("hides Export CSV/JSON on the Session Detail route (not the list)", () => {
    renderAt("/sessions/abc123", "");
    expect(screen.queryByRole("button", { name: "Export CSV" })).not.toBeInTheDocument();
  });

  it("always renders Copy permalink", () => {
    renderAt("/", "");
    expect(screen.getByRole("button", { name: "Copy permalink" })).toBeInTheDocument();
  });
});

describe("GlobalActionsBar — export href construction", () => {
  let clickSpy: ReturnType<typeof vi.fn<() => void>>;
  let appendSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clickSpy = vi.fn<() => void>();
    HTMLAnchorElement.prototype.click = clickSpy;
    appendSpy = vi.spyOn(document.body, "appendChild");
  });

  afterEach(() => {
    appendSpy.mockRestore();
  });

  function lastAppendedAnchor(): HTMLAnchorElement | undefined {
    return (appendSpy.mock.calls as [Node][])
      .map((call) => call[0])
      .find((node: Node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
  }

  it("builds a CSV export URL reflecting the current filters and triggers a download", () => {
    renderAt("/sessions", "?range=30d&project=alpha&sort=totalTokens&order=asc");
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = lastAppendedAnchor();
    expect(anchor).toBeDefined();
    expect(anchor?.getAttribute("href")).toContain("/api/export?");
    expect(anchor?.getAttribute("href")).toContain("format=csv");
    expect(anchor?.getAttribute("href")).toContain("project=alpha");
    expect(anchor?.getAttribute("href")).toContain("sort=totalTokens");
    expect(anchor?.getAttribute("href")).toContain("order=asc");
  });

  it("builds a JSON export URL when the JSON button is clicked", () => {
    renderAt("/sessions", "?range=7d");
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));

    const anchor = lastAppendedAnchor();
    expect(anchor?.getAttribute("href")).toContain("format=json");
  });
});

describe("GlobalActionsBar — copy permalink", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it("copies window.location.href and shows transient feedback", async () => {
    renderAt("/sessions", "?range=30d");
    fireEvent.click(screen.getByRole("button", { name: "Copy permalink" }));

    await screen.findByRole("button", { name: "Copied!" });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(window.location.href);
  });
});
