import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatCard, StatRow } from "./StatCard.js";

const meta: Meta<typeof StatCard> = {
  title: "Components/StatCard",
  component: StatCard,
};

export default meta;
type Story = StoryObj<typeof StatCard>;

export const Basic: Story = { args: { label: "Total Cost", value: "$128.40" } };

export const DeltaUpBad: Story = {
  args: {
    label: "Total Cost",
    value: "$128.40",
    accent: "money",
    delta: { text: "189%", direction: "up", sentiment: "bad" },
  },
};

export const DeltaUpGood: Story = {
  args: {
    label: "Cache Hit Rate",
    value: "82%",
    accent: "cache",
    delta: { text: "12%", direction: "up", sentiment: "good" },
  },
};

export const DeltaDownGood: Story = {
  args: {
    label: "Total Cost",
    value: "$42.10",
    accent: "money",
    delta: { text: "9%", direction: "down", sentiment: "good" },
  },
};

export const DeltaDownBad: Story = {
  args: {
    label: "Cache Hit Rate",
    value: "61%",
    accent: "cache",
    delta: { text: "5%", direction: "down", sentiment: "bad" },
  },
};

export const DeltaFlat: Story = {
  args: {
    label: "Sessions",
    value: "412",
    delta: { text: "0%", direction: "flat", sentiment: "neutral" },
  },
};

export const WithSparkline: Story = {
  args: {
    label: "Total Cost",
    value: "$128.40",
    accent: "money",
    delta: { text: "189%", direction: "up", sentiment: "bad" },
    sparkline: [10, 14, 9, 22, 18, 30, 24],
  },
};

export const SparklineWithoutDelta: Story = {
  args: {
    label: "Total Cost",
    value: "$128.40",
    accent: "money",
    sparkline: [10, 14, 9, 22, 18, 30, 24],
    sparklineLabel: "trending up over the last 7 days",
  },
};

export const SparklineEmpty: Story = {
  args: { label: "Total Cost", value: "$0.00", sparkline: [], sparklineLabel: "No trend yet" },
};

export const SparklineSinglePoint: Story = {
  args: {
    label: "Total Cost",
    value: "$4.00",
    sparkline: [4],
    sparklineLabel: "No trend yet",
  },
};

export const SparklineNonFinite: Story = {
  args: {
    label: "Total Cost",
    value: "$18.00",
    sparkline: [4, Number.NaN, 12, Number.POSITIVE_INFINITY, 9, 18],
    sparklineLabel: "trending up overall",
  },
};

export const WithSub: Story = {
  args: { label: "Total Calls", value: "1,204", sub: "last 30 days" },
};

export const LongLabel: Story = {
  args: {
    label: "Average cost per turn across every project and model combination",
    value: "$0.42",
  },
};

export const Grid: Story = {
  render: () => (
    <StatRow>
      <StatCard
        label="Total Cost"
        value="$128.40"
        accent="money"
        delta={{ text: "189%", direction: "up", sentiment: "bad" }}
        sparkline={[10, 14, 9, 22, 18, 30, 24]}
      />
      <StatCard
        label="Cache Hit Rate"
        value="82%"
        accent="cache"
        delta={{ text: "12%", direction: "up", sentiment: "good" }}
      />
      <StatCard
        label="Sessions"
        value="412"
        delta={{ text: "0%", direction: "flat", sentiment: "neutral" }}
      />
      <StatCard label="Total Calls" value="1,204" sub="last 30 days" />
    </StatRow>
  ),
};
