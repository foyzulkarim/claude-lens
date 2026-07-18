// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionsFilters } from "./SessionsFilters.js";
import { DEFAULT_SESSIONS_PAGE_STATE } from "./state.js";

afterEach(() => {
  cleanup();
});

describe("SessionsFilters — page-only controls", () => {
  it("renders cost bounds, entrypoint, and drilldown inputs", () => {
    render(
      <SessionsFilters
        state={DEFAULT_SESSIONS_PAGE_STATE}
        onStateChange={() => {}}
        globalRange={{ preset: "7d" }}
      />,
    );
    expect(screen.getByLabelText(/min cost/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/max cost/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/entrypoint/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /any/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^yes$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^no$/i })).toBeInTheDocument();
  });

  it("preloads the active filter values", () => {
    render(
      <SessionsFilters
        state={{
          ...DEFAULT_SESSIONS_PAGE_STATE,
          minCostComputed: 1,
          maxCostComputed: 5,
          entrypoint: ["cli"],
          hasDrilldown: true,
        }}
        onStateChange={() => {}}
        globalRange={{ preset: "7d" }}
      />,
    );
    expect((screen.getByLabelText(/min cost/i) as HTMLInputElement).value).toBe("1");
    expect((screen.getByLabelText(/max cost/i) as HTMLInputElement).value).toBe("5");
    expect((screen.getByLabelText(/entrypoint/i) as HTMLInputElement).value).toBe("cli");
    expect(screen.getByRole("button", { name: /^yes$/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders a section-level testid for mount-point stability", () => {
    render(
      <SessionsFilters
        state={DEFAULT_SESSIONS_PAGE_STATE}
        onStateChange={() => {}}
        globalRange={{ preset: "7d" }}
      />,
    );
    expect(screen.getByTestId("sessions-filters")).toBeInTheDocument();
  });

  it("clicking 'Yes' calls onStateChange with hasDrilldown: true", async () => {
    const onStateChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SessionsFilters
        state={DEFAULT_SESSIONS_PAGE_STATE}
        onStateChange={onStateChange}
        globalRange={{ preset: "7d" }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^yes$/i }));
    expect(onStateChange).toHaveBeenCalledWith({ hasDrilldown: true });
  });

  it("editing the entrypoint field calls onStateChange with a parsed CSV array", () => {
    const onStateChange = vi.fn();
    render(
      <SessionsFilters
        state={DEFAULT_SESSIONS_PAGE_STATE}
        onStateChange={onStateChange}
        globalRange={{ preset: "7d" }}
      />,
    );
    const input = screen.getByLabelText(/entrypoint/i);
    // The field is uncontrolled between component-level state updates, so
    // userEvent.type fires one onChange per keystroke against the same
    // starting value ("") rather than accumulating — assert directly via
    // fireEvent instead to exercise the CSV-parse path in one call.
    fireEvent.change(input, { target: { value: "cli" } });
    expect(onStateChange).toHaveBeenCalledWith({ entrypoint: ["cli"] });
  });

  it("resets pagination-relevant filters without crashing when cleared", async () => {
    const onStateChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SessionsFilters
        state={{
          ...DEFAULT_SESSIONS_PAGE_STATE,
          entrypoint: ["cli"],
        }}
        onStateChange={onStateChange}
        globalRange={{ preset: "7d" }}
      />,
    );
    const input = screen.getByLabelText(/entrypoint/i);
    await user.clear(input);
    expect(onStateChange).toHaveBeenCalledWith({ entrypoint: undefined });
  });
});
