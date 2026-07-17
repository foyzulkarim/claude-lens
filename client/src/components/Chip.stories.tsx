import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Chip } from "./Chip.js";

const meta: Meta<typeof Chip> = {
  title: "Components/Chip",
  component: Chip,
};

export default meta;
type Story = StoryObj<typeof Chip>;

export const Inactive: Story = { args: { label: "claude-lens" } };

export const Active: Story = {
  render: () => {
    function ToggleChip() {
      const [active, setActive] = useState(true);
      return <Chip label="claude-lens" active={active} onClick={() => setActive((v) => !v)} />;
    }
    return <ToggleChip />;
  },
};

export const Static: Story = { args: { label: "claude-sonnet-5" } };

export const Clickable: Story = {
  render: () => {
    function ClickableChip() {
      const [clicks, setClicks] = useState(0);
      return (
        <div className="flex items-center gap-2">
          <Chip label="claude-sonnet-5" onClick={() => setClicks((c) => c + 1)} />
          <span className="text-xs text-slate-400">clicked {clicks}×</span>
        </div>
      );
    }
    return <ClickableChip />;
  },
};

export const Removable: Story = {
  render: () => {
    function RemovableChip() {
      const [present, setPresent] = useState(true);
      const [clicks, setClicks] = useState(0);
      if (!present) return <span className="text-xs text-slate-400">removed</span>;
      return (
        <div className="flex items-center gap-2">
          <Chip
            label="claude-lens"
            onClick={() => setClicks((c) => c + 1)}
            onRemove={() => setPresent(false)}
          />
          <span className="text-xs text-slate-400">clicked {clicks}×</span>
        </div>
      );
    }
    return <RemovableChip />;
  },
};
