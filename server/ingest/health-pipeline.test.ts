import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startIngest } from "./pipeline.js";

// End-to-end test for review E1 — Data Health surfacing of
// `parse-premium.ts`'s `malformedCount`. The PR body and ARCH-45.md both
// claim this work is the gating dependency for #P4-14, so the test pins
// the end-to-end path: a C file with one malformed + two valid lines
// produces a health snapshot with `malformedCount >= 1` for that file.

describe("Ingest pipeline → Store.getHealthSnapshot (review E1)", () => {
  let claudeDir: string;

  beforeEach(async () => {
    claudeDir = await mkdtemp(join(tmpdir(), "claude-lens-health-"));
  });

  afterEach(async () => {
    await rm(claudeDir, { recursive: true, force: true });
  });

  it("surfaces a C file's malformed-line count through to the health snapshot", async () => {
    const projectDir = join(claudeDir, "projects", "alpha");
    await mkdir(projectDir, { recursive: true });

    const sessionId = "11111111-1111-4111-8111-111111111111";
    // C file with one malformed + two valid lines.
    const costPath = join(projectDir, `${sessionId}.cost.jsonl`);
    await writeFile(
      costPath,
      [
        JSON.stringify({
          session_id: sessionId,
          timestamp: "2026-07-21T10:00:00.000Z",
          cost_delta_usd: 0.42,
          api_duration_ms: 1234,
          context_pct: 25,
        }),
        "{ this is not valid json",
        JSON.stringify({
          session_id: sessionId,
          timestamp: "2026-07-21T10:01:00.000Z",
          cost_delta_usd: 0.17,
          api_duration_ms: 980,
          context_pct: 30,
        }),
      ].join("\n"),
      "utf8",
    );

    const pipeline = startIngest(
      {
        roots: [{ path: projectDir }],
        claudeDir,
      },
      {
        onInvalidate: () => {
          /* no-op */
        },
        debounceMs: 10,
      },
    );
    await pipeline.whenSettled();

    const snapshot = pipeline.store.getHealthSnapshot();
    expect(snapshot.observedFileCount).toBeGreaterThanOrEqual(1);
    const cEntry = snapshot.files.find((f) => f.fileClass === "cost" && f.sessionId === sessionId);
    expect(cEntry).toBeDefined();
    expect(cEntry?.malformedCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.totalMalformedLines).toBeGreaterThanOrEqual(1);

    pipeline.stop();
  });
});
