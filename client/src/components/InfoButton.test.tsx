// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { InfoButton } from "./InfoButton.js";

afterEach(cleanup);

describe("InfoButton", () => {
  it("is closed until the trigger is clicked", () => {
    render(
      <InfoButton label="What does V1 check?" title="V1 · Edit-without-verify">
        Explanation text
      </InfoButton>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the modal with the given title and content on click", async () => {
    const user = userEvent.setup();
    render(
      <InfoButton label="What does V1 check?" title="V1 · Edit-without-verify">
        Explanation text
      </InfoButton>,
    );
    await user.click(screen.getByRole("button", { name: "What does V1 check?" }));
    const dialog = screen.getByRole("dialog", { name: "V1 · Edit-without-verify" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Explanation text")).toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(
      <InfoButton label="What does V1 check?" title="V1 · Edit-without-verify">
        Explanation text
      </InfoButton>,
    );
    const trigger = screen.getByRole("button", { name: "What does V1 check?" });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on backdrop click and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(
      <InfoButton label="What does V1 check?" title="V1 · Edit-without-verify">
        Explanation text
      </InfoButton>,
    );
    const trigger = screen.getByRole("button", { name: "What does V1 check?" });
    await user.click(trigger);
    await user.click(screen.getByTestId("info-modal-backdrop"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("does not close when clicking inside the panel", async () => {
    const user = userEvent.setup();
    render(
      <InfoButton label="What does V1 check?" title="V1 · Edit-without-verify">
        Explanation text
      </InfoButton>,
    );
    await user.click(screen.getByRole("button", { name: "What does V1 check?" }));
    await user.click(screen.getByText("Explanation text"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes via the modal's own close button and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(
      <InfoButton label="What does V1 check?" title="V1 · Edit-without-verify">
        Explanation text
      </InfoButton>,
    );
    const trigger = screen.getByRole("button", { name: "What does V1 check?" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("only opens one dialog when a second InfoButton's trigger is clicked while the first is still open", async () => {
    const user = userEvent.setup();
    render(
      <>
        <InfoButton label="What does V1 check?" title="V1 · Edit-without-verify">
          V1 explanation
        </InfoButton>
        <InfoButton label="What does V2 check?" title="V2 · Failing-command loop">
          V2 explanation
        </InfoButton>
      </>,
    );
    await user.click(screen.getByRole("button", { name: "What does V1 check?" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    // The focus trap keeps Tab inside the open dialog, so a second trigger
    // isn't keyboard-reachable while one is open.
    const secondTrigger = screen.getByRole("button", { name: "What does V2 check?" });
    expect(secondTrigger).not.toHaveFocus();
    await user.tab();
    expect(secondTrigger).not.toHaveFocus();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});
