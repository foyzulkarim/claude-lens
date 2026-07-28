// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InfoModal } from "./InfoModal.js";

afterEach(cleanup);

describe("InfoModal", () => {
  it("renders nothing when closed", () => {
    render(
      <InfoModal open={false} onClose={vi.fn()} title="V1">
        body
      </InfoModal>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders as a labelled dialog when open, focused on the close button", () => {
    render(
      <InfoModal open={true} onClose={vi.fn()} title="V1 · Edit-without-verify">
        body text
      </InfoModal>,
    );
    const dialog = screen.getByRole("dialog", { name: "V1 · Edit-without-verify" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("body text")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("calls onClose on Escape and on backdrop click, but not on panel click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <InfoModal open={true} onClose={onClose} title="V1">
        body text
      </InfoModal>,
    );

    await user.click(screen.getByText("body text"));
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("info-modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("wraps Tab focus between the first and last focusable elements in the panel", async () => {
    const user = userEvent.setup();
    render(
      <InfoModal open={true} onClose={vi.fn()} title="V1">
        <a href="https://example.com">View the gates specification</a>
      </InfoModal>,
    );
    const closeButton = screen.getByRole("button", { name: "Close" });
    const link = screen.getByRole("link", { name: "View the gates specification" });
    expect(closeButton).toHaveFocus();

    // Shift+Tab from the first focusable element wraps to the last.
    await user.tab({ shift: true });
    expect(link).toHaveFocus();

    // Tab from the last focusable element wraps back to the first.
    await user.tab();
    expect(closeButton).toHaveFocus();
  });
});
