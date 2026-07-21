import type { Meta, StoryObj } from "@storybook/react-vite";
import type { HealthSnapshot } from "../../../../shared/health-contract.js";
import { DataHealth } from "./DataHealth.js";

/**
 * Storybook coverage for the Data Health page (#P4-14). One
 * `snapshot` prop is enough to drive every panel — the page is a
 * pure derivation of `HealthSnapshot`. The `Empty` and `Premium`
 * variants pin the locked-vs-data states the Cypress smoke can't
 * deterministically reproduce.
 */

function emptySnapshot(): HealthSnapshot {
  return {
    files: [],
    totalMalformedLines: 0,
    observedFileCount: 0,
    observedSince: Date.now() - 5 * 60_000,
    dedup: { rawLines: 0, distinctCalls: 0, duplicates: 0 },
    parseErrors: { malformedLines: 0, byFile: [] },
    scan: {
      roots: [],
      transcriptsFound: 0,
      transcriptsParsed: 0,
      transcriptsFailed: 0,
      sessionsWithSidecars: 0,
    },
    pricingCoverage: { modelsSeen: [], unpricedModels: [] },
    sidecarCoverage: { total: 0, withCost: 0, withBoundaries: 0 },
    reconciliation: {
      sessionsWithObserved: 0,
      sessionsWithComputedOnly: 0,
      costComputed: 0,
      costObserved: 0,
      costLogTotal: undefined,
    },
    captureGaps: { sessionsWithoutObserved: 0 },
  };
}

function populatedSnapshot(): HealthSnapshot {
  return {
    files: [
      {
        filePath: "/Users/demo/.claude/projects/-Users-demo-project-alpha/11111111.cost.jsonl",
        fileClass: "cost",
        sessionId: "11111111-1111-4111-8111-111111111111",
        malformedCount: 3,
        lastUpdated: Date.now() - 60_000,
      },
    ],
    totalMalformedLines: 3,
    observedFileCount: 1,
    observedSince: Date.now() - 24 * 60 * 60_000,
    dedup: { rawLines: 1240, distinctCalls: 905, duplicates: 335 },
    parseErrors: {
      malformedLines: 2,
      byFile: [{ filePath: "/Users/demo/.claude/projects/abc/def.jsonl", count: 2 }],
    },
    scan: {
      roots: [
        { path: "/Users/demo/.claude/projects", label: "workstation" },
        { path: "/Users/laptop/.claude/projects" },
      ],
      transcriptsFound: 21,
      transcriptsParsed: 21,
      transcriptsFailed: 0,
      sessionsWithSidecars: 5,
    },
    pricingCoverage: {
      modelsSeen: ["claude-fable-5", "claude-sonnet-5", "fable-5"],
      unpricedModels: ["fable-5"],
    },
    sidecarCoverage: { total: 21, withCost: 5, withBoundaries: 5 },
    reconciliation: {
      sessionsWithObserved: 5,
      sessionsWithComputedOnly: 16,
      costComputed: 12.34,
      costObserved: 13.5,
      costLogTotal: 12.99,
    },
    captureGaps: { sessionsWithoutObserved: 16 },
  };
}

const meta = {
  title: "Pages/DataHealth",
  component: DataHealth,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DataHealth>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { snapshot: emptySnapshot() },
};

export const Populated: Story = {
  args: { snapshot: populatedSnapshot() },
};
