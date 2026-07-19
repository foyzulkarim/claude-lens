import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiCall, Session, Turn } from "../../shared/types.js";
import type { ToolResultBytesRecord } from "../ingest/parse-transcript.js";
import { evaluateSessionGates } from "./engine.js";
import { DEFAULT_GATE_THRESHOLDS } from "./thresholds.js";

/** Minimal session rollup — only `sessionId` and `project` are read by the engine. */
function session(sessionId: string, project: string): Session {
  return {
    sessionId,
    lineageId: sessionId,
    project,
    entrypoint: "",
    models: [],
    gitBranch: "",
    version: "",
    tier: {
      hasCostSamples: false,
      hasTurnBoundaries: false,
      hasCostLog: false,
      costBasis: "computed",
    },
    firstAt: "2026-07-01T00:00:00.000Z",
    lastAt: "2026-07-01T00:00:00.000Z",
    host: "default",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
    turnCount: 0,
    callCount: 0,
    costComputed: 0,
    cacheHitPct: 0,
  };
}

function emptyTurn(promptId: string, calls: ApiCall[] = []): Turn {
  return {
    promptId,
    sessionId: "s1",
    isSidechain: false,
    startedAt: "2026-07-01T00:00:00.000Z",
    endedAt: "2026-07-01T00:00:00.000Z",
    calls,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
    toolResultBytes: 0,
  };
}

function emptyCall(): ApiCall {
  return {
    uuid: "u",
    sessionId: "s1",
    messageId: "m",
    timestamp: "2026-07-01T00:00:00.000Z",
    model: "claude-sonnet-5",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
    isSidechain: false,
    tools: [],
    cwd: "/test",
    gitBranch: "",
    version: "",
    entrypoint: "",
  };
}

let projectDir: string;
let userDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "claude-lens-engine-project-"));
  userDir = await mkdtemp(join(tmpdir(), "claude-lens-engine-user-"));
  await mkdir(projectDir, { recursive: true });
  await mkdir(join(userDir, ".claude"), { recursive: true });
  // Small CLAUDE.md in the project path so E1 passes (E2 inactive).
  await writeFile(join(projectDir, "CLAUDE.md"), "# project\n", "utf8");
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
  await rm(userDir, { recursive: true, force: true });
});

describe("engine — score formula (gates.md §Report Card scoring, R15)", () => {
  it("all 6 checks pass → score 1.00, letter A", async () => {
    const report = await evaluateSessionGates(
      {
        session: session("s1", projectDir),
        turns: [emptyTurn("p1")],
        calls: [emptyCall()],
        toolResults: [],
        userHomeDir: userDir,
      },
      DEFAULT_GATE_THRESHOLDS,
    );
    expect(report.score).toBe(1);
    expect(report.scoreLetter).toBe("A");
    expect(report.gates).toHaveLength(7);
  });

  it("warns are weighted half in the denominator", async () => {
    // Force C3 to warn by linking a fat tool_result to a real Read tool_use.
    const readCall: ApiCall = {
      ...emptyCall(),
      messageId: "read-call",
      tools: [{ name: "Read", inputBytes: 0, id: "tu-fat" }],
    };
    const records: ToolResultBytesRecord[] = [
      { sessionId: "s1", promptId: "p1", toolUseId: "tu-fat", bytes: 20_000, isError: false },
    ];
    const report = await evaluateSessionGates(
      {
        session: session("s1", projectDir),
        turns: [emptyTurn("p1", [readCall])],
        calls: [readCall],
        toolResults: records,
        userHomeDir: userDir,
      },
      DEFAULT_GATE_THRESHOLDS,
    );
    // 5 passes + 1 warn (C3) → 5 / (5 + 0.5) = 0.909...
    expect(report.score).toBeCloseTo(5 / 5.5, 3);
    expect(report.scoreLetter).toBe("A"); // ≥ 0.9
  });

  it("fails are weighted fully; a single fail drops score to B", async () => {
    // Force ONLY V1 to fail. T1 = Read+Edit (no Bash, V1 mid-session fail).
    // Read happens before Edit so P3 stays quiet. T2 = Bash only (V1 N/A).
    const readCall: ApiCall = {
      ...emptyCall(),
      messageId: "read-call",
      tools: [{ name: "Read", inputBytes: 0, targetPath: "/a.ts" }],
    };
    const editCall: ApiCall = {
      ...emptyCall(),
      messageId: "edit-call",
      timestamp: "2026-07-01T00:00:00.001Z",
      tools: [{ name: "Edit", inputBytes: 0, targetPath: "/a.ts" }],
    };
    const bashCall: ApiCall = {
      ...emptyCall(),
      messageId: "bash-call",
      timestamp: "2026-07-01T00:00:01.000Z",
      tools: [{ name: "Bash", inputBytes: 0 }],
    };
    const turns: Turn[] = [emptyTurn("p1", [readCall, editCall]), emptyTurn("p2", [bashCall])];
    const report = await evaluateSessionGates(
      {
        session: session("s1", projectDir),
        turns,
        calls: [readCall, editCall, bashCall],
        toolResults: [],
        userHomeDir: userDir,
      },
      DEFAULT_GATE_THRESHOLDS,
    );
    // 5 passes + 1 fail (V1) → 5/6 = 0.833 → B
    expect(report.score).toBeCloseTo(5 / 6, 3);
    expect(report.scoreLetter).toBe("B");
  });

  it("returns the same gate IDs in the documented prose order", async () => {
    const report = await evaluateSessionGates(
      {
        session: session("s1", projectDir),
        turns: [],
        calls: [],
        toolResults: [],
        userHomeDir: userDir,
      },
      DEFAULT_GATE_THRESHOLDS,
    );
    expect(report.gates.map((g) => g.gateId)).toEqual(["V1", "V2", "P3", "C3", "K2", "E1", "E2"]);
  });

  it("echoes thresholdsUsed so the UI can label 'evaluated with defaults'", async () => {
    const report = await evaluateSessionGates(
      {
        session: session("s1", projectDir),
        turns: [],
        calls: [],
        toolResults: [],
        userHomeDir: userDir,
      },
      DEFAULT_GATE_THRESHOLDS,
    );
    expect(report.thresholdsUsed).toEqual(DEFAULT_GATE_THRESHOLDS);
  });
});
