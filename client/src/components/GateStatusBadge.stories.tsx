import type { Meta, StoryObj } from "@storybook/react-vite";
import { GateStatusBadge, statusForLetter } from "./GateStatusBadge.js";

const meta: Meta<typeof GateStatusBadge> = {
  title: "Components/GateStatusBadge",
  component: GateStatusBadge,
  argTypes: {
    status: {
      control: { type: "select" },
      options: ["pass", "warn", "fail", undefined],
    },
    letter: {
      control: { type: "select" },
      options: ["A", "B", "C", "D", "F", undefined],
    },
  },
};

export default meta;
type Story = StoryObj<typeof GateStatusBadge>;

export const PassStatus: Story = { args: { status: "pass", label: "pass" } };
export const WarnStatus: Story = { args: { status: "warn", label: "warn" } };
export const FailStatus: Story = { args: { status: "fail", label: "fail" } };

export const LetterA: Story = { args: { letter: "A" } };
export const LetterB: Story = { args: { letter: "B" } };
export const LetterC: Story = { args: { letter: "C" } };
export const LetterD: Story = { args: { letter: "D" } };
export const LetterF: Story = { args: { letter: "F" } };

export const AllLetters: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {(["A", "B", "C", "D", "F"] as const).map((l) => (
        <div key={l} className="flex items-center gap-3">
          <GateStatusBadge letter={l} />
          <span className="text-xs text-slate-600 dark:text-[#8A96A5]">
            {l} → {statusForLetter(l)}
          </span>
        </div>
      ))}
    </div>
  ),
};

export const DefensivePlaceholder: Story = {
  // No `status` and no `letter` — both omitted, e.g. the cache hasn't
  // populated the row yet. Renders the neutral "—" placeholder.
  args: {},
};
