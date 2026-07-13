import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTranscriptLines } from "../ingest/parse-transcript.js";
import { deriveSession } from "./derive-session.js";
import { deriveTurns } from "./derive-turns.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(
  __dirname,
  "..",
  "..",
  "test",
  "fixtures",
  "projects",
  "-Users-demo-project-alpha",
);

function readFixtureLines(filename: string): string[] {
  const content = readFileSync(join(fixturesDir, filename), "utf8");
  return content.split("\n").filter((_, i, arr) => !(i === arr.length - 1 && arr[i] === ""));
}

const noSidecars = { hasCostSamples: false, hasTurnBoundaries: false, hasCostLog: false };

describe("deriveSession — fixture-driven rollups", () => {
  it("rolls up models, usage, and counts from the clean multi-turn fixture", () => {
    const lines = readFixtureLines("11111111-1111-4111-8111-111111111111.jsonl");
    const parsed = parseTranscriptLines(lines, new Set());
    const turns = deriveTurns(parsed.calls, parsed.prompts, parsed.toolResultBytes);

    const session = deriveSession(
      "11111111-1111-4111-8111-111111111111",
      parsed.calls,
      turns,
      noSidecars,
    );

    expect(session.callCount).toBe(parsed.calls.length);
    expect(session.turnCount).toBe(turns.length);
    expect(session.models.sort()).toEqual(["claude-fable-5", "claude-sonnet-5"]);
    expect(session.usage.inputTokens).toBeGreaterThan(0);
    expect(session.cacheHitPct).toBeGreaterThan(0);
    expect(session.cacheHitPct).toBeLessThanOrEqual(1);
  });

  it("defaults costComputed to 0 without a pricer, and applies an injected pricer", () => {
    const lines = readFixtureLines("11111111-1111-4111-8111-111111111111.jsonl");
    const parsed = parseTranscriptLines(lines, new Set());
    const turns = deriveTurns(parsed.calls, parsed.prompts, parsed.toolResultBytes);

    const unpriced = deriveSession(
      "11111111-1111-4111-8111-111111111111",
      parsed.calls,
      turns,
      noSidecars,
    );
    expect(unpriced.costComputed).toBe(0);
    expect(unpriced.tier.costBasis).toBe("computed");

    const flatPricer = (usage: { inputTokens: number }) => usage.inputTokens * 0.001;
    const priced = deriveSession(
      "11111111-1111-4111-8111-111111111111",
      parsed.calls,
      turns,
      noSidecars,
      flatPricer,
    );
    expect(priced.costComputed).toBeGreaterThan(0);
    expect(priced.costComputed).toBeCloseTo(unpriced.usage.inputTokens * 0.001);
  });

  it("carries sidecar presence into tier flags", () => {
    const session = deriveSession("s1", [], [], {
      hasCostSamples: true,
      hasTurnBoundaries: false,
      hasCostLog: true,
    });
    expect(session.tier).toMatchObject({
      hasCostSamples: true,
      hasTurnBoundaries: false,
      hasCostLog: true,
    });
  });

  it("returns a zeroed rollup for a session with no calls", () => {
    const session = deriveSession("empty-session", [], [], noSidecars);
    expect(session.callCount).toBe(0);
    expect(session.turnCount).toBe(0);
    expect(session.usage.inputTokens).toBe(0);
    expect(session.cacheHitPct).toBe(0);
    expect(session.firstAt).toBe("");
    expect(session.durationMs).toBeUndefined();
  });
});
