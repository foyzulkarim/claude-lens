import type { Meta, StoryObj } from "@storybook/react-vite";
import { costTierLevel, TierBadge } from "./TierBadge.js";

const meta: Meta<typeof TierBadge> = {
  title: "Components/TierBadge",
  component: TierBadge,
};

export default meta;
type Story = StoryObj<typeof TierBadge>;

export const Exact: Story = { args: { level: "exact", children: "$ observed" } };
export const Estimated: Story = { args: { level: "estimated", children: "$ computed" } };
export const Locked: Story = { args: { level: "locked" } };

export const NoLabel: Story = { args: { level: "exact" } };

// Demonstrates costTierLevel's mapping from the shared TierFlags contract —
// no unit test (ARCH decision A4), the label text is the manual assertion.
export const FromTierFlags: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <TierBadge
        level={costTierLevel({
          hasCostSamples: true,
          hasTurnBoundaries: true,
          hasCostLog: true,
          costBasis: "observed",
        })}
      >
        costBasis: observed →{" "}
        {costTierLevel({
          hasCostSamples: true,
          hasTurnBoundaries: true,
          hasCostLog: true,
          costBasis: "observed",
        })}
      </TierBadge>
      <TierBadge
        level={costTierLevel({
          hasCostSamples: false,
          hasTurnBoundaries: false,
          hasCostLog: false,
          costBasis: "computed",
        })}
      >
        costBasis: computed →{" "}
        {costTierLevel({
          hasCostSamples: false,
          hasTurnBoundaries: false,
          hasCostLog: false,
          costBasis: "computed",
        })}
      </TierBadge>
    </div>
  ),
};
