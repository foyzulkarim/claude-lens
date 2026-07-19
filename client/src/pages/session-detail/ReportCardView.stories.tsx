import type { Meta, StoryObj } from "@storybook/react-vite";
import type { GateReport } from "../../../../shared/gates-contract.js";
import { ReportCardView } from "./ReportCardView.js";

function buildReport(overrides: Partial<GateReport> = {}): GateReport {
  return {
    sessionId: "s1",
    score: 0.95,
    scoreLetter: "A",
    evaluatedAt: "2026-07-20T12:00:00.000Z",
    thresholdsUsed: {
      v2Repeat: 3,
      c3MaxChars: 15000,
      k2Spike: 10000,
      e2MaxChars: 4000,
      e2MaxLines: 60,
    },
    gates: [
      { gateId: "V1", status: "pass", evidence: [] },
      { gateId: "V2", status: "pass", evidence: [] },
      { gateId: "P3", status: "pass", evidence: [] },
      {
        gateId: "C3",
        status: "warn",
        evidence: [
          {
            detail:
              "Tool result was 18,243 chars (>15,000) — recurring cost estimated at $0.42 across remaining 12 calls.",
            turnN: 4,
            callId: "call-7",
          },
        ],
      },
      {
        gateId: "K2",
        status: "fail",
        evidence: [
          {
            detail:
              "Unexplained cache invalidation: cache_creation_input_tokens=12,400 with no classifier-reducible cause. Classifier ran: first-call=true, model-switch=false, compaction=false.",
            turnN: 6,
            callId: "call-9",
          },
        ],
      },
      {
        gateId: "E1",
        status: "fail",
        evidence: [
          {
            detail: "Project CLAUDE.md missing — checked /Users/demo/proj/CLAUDE.md.",
            filePath: "/Users/demo/proj/CLAUDE.md",
          },
        ],
      },
      {
        gateId: "E2",
        status: "warn",
        evidence: [
          {
            detail: "CLAUDE.md size: 6,212 chars / 92 lines (over 4,000 / 60 limits).",
            filePath: "/Users/demo/.claude/CLAUDE.md",
          },
        ],
      },
    ],
    ...overrides,
  };
}

const meta: Meta<typeof ReportCardView> = {
  title: "SessionDetail/ReportCardView",
  component: ReportCardView,
};

export default meta;
type Story = StoryObj<typeof ReportCardView>;

export const Passing: Story = {
  args: { data: buildReport({ score: 0.95, scoreLetter: "A" }) },
};
export const Warn: Story = {
  args: { data: buildReport({ score: 0.6, scoreLetter: "C" }) },
};
export const Failing: Story = {
  args: { data: buildReport({ score: 0.2, scoreLetter: "F" }) },
};
export const NoEvidence: Story = {
  args: {
    data: buildReport({
      gates: buildReport().gates.map((g) => ({ ...g, evidence: [] })),
    }),
  },
};
