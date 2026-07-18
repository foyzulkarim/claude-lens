import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { classifyFilename, discover, resolveScanConfig } from "./discovery.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(__dirname, "..", "..", "test", "fixtures", "projects");

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "claude-lens-discovery-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("classifyFilename — tier classification", () => {
  it("classifies the exact L-file name", () => {
    expect(classifyFilename("cost-log.jsonl")).toEqual({ kind: "cost-log" });
  });

  it("classifies a turn-boundaries file", () => {
    expect(classifyFilename("11111111-1111-4111-8111-111111111111.turn-boundaries.jsonl")).toEqual({
      kind: "turn-boundaries",
      sessionId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("classifies a cost file", () => {
    expect(classifyFilename("11111111-1111-4111-8111-111111111111.cost.jsonl")).toEqual({
      kind: "cost",
      sessionId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("classifies a plain transcript file", () => {
    expect(classifyFilename("11111111-1111-4111-8111-111111111111.jsonl")).toEqual({
      kind: "transcript",
      sessionId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("rejects underscored premium variants", () => {
    expect(classifyFilename("11111111-1111-4111-8111-111111111111_cost.jsonl")).toEqual({
      kind: "transcript",
      sessionId: "11111111-1111-4111-8111-111111111111_cost",
    });
  });

  it("classifies unrecognized names as unknown", () => {
    expect(classifyFilename("notes.txt")).toEqual({ kind: "unknown" });
  });

  it("never throws on degenerate input", () => {
    expect(() => classifyFilename("")).not.toThrow();
    expect(classifyFilename("").kind).toBe("unknown");
    expect(() => classifyFilename(".jsonl")).not.toThrow();
    expect(classifyFilename(".jsonl").kind).toBe("unknown");
  });
});

describe("discover — snapshot over real and synthetic roots", () => {
  it("discovers fixture transcripts", async () => {
    const claudeDir = await makeTmpDir();
    const files = await discover({
      roots: [{ path: join(fixturesRoot, "-Users-demo-project-alpha") }],
      claudeDir,
    });

    const transcripts = files.filter((f) => f.class === "transcript");
    expect(transcripts).toHaveLength(5);
    expect(new Set(transcripts.map((f) => f.sessionId))).toEqual(
      new Set([
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444",
        "55555555-5555-4555-8555-555555555555",
      ]),
    );
  });

  it("dedupes overlapping roots", async () => {
    const dir = join(fixturesRoot, "-Users-demo-project-alpha");
    const claudeDir = await makeTmpDir();
    const files = await discover({
      roots: [{ path: dir }, { path: dir }],
      claudeDir,
    });

    const paths = files.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("tolerates a missing root", async () => {
    const claudeDir = await makeTmpDir();
    const files = await discover({
      roots: [{ path: join(tmpdir(), "claude-lens-does-not-exist-xyz") }],
      claudeDir,
    });
    expect(files).toEqual([]);
  });

  it("tolerates an empty root", async () => {
    const emptyRoot = await makeTmpDir();
    const claudeDir = await makeTmpDir();
    const files = await discover({ roots: [{ path: emptyRoot }], claudeDir });
    expect(files).toEqual([]);
  });

  it("classifies premium files in a synthetic root", async () => {
    const root = await makeTmpDir();
    const claudeDir = await makeTmpDir();
    const sessionId = "44444444-4444-4444-8444-444444444444";
    await writeFile(join(root, `${sessionId}.cost.jsonl`), "");
    await writeFile(join(root, `${sessionId}.turn-boundaries.jsonl`), "");

    const files = await discover({ roots: [{ path: root }], claudeDir });

    expect(files.find((f) => f.class === "cost")).toMatchObject({ sessionId });
    expect(files.find((f) => f.class === "turn-boundaries")).toMatchObject({ sessionId });
  });

  it("discovers the L-file explicitly", async () => {
    const root = await makeTmpDir();
    const claudeDir = await makeTmpDir();
    await writeFile(join(claudeDir, "cost-log.jsonl"), "");

    const files = await discover({ roots: [{ path: root }], claudeDir });

    const lFile = files.find((f) => f.class === "cost-log");
    expect(lFile).toBeDefined();
    expect(lFile?.sessionId).toBeUndefined();
  });

  it("tolerates a missing L-file", async () => {
    const root = await makeTmpDir();
    const claudeDir = await makeTmpDir();
    const files = await discover({ roots: [{ path: root }], claudeDir });
    expect(files.find((f) => f.class === "cost-log")).toBeUndefined();
  });
});

describe("resolveScanConfig — CLI/defaults to ScanConfig", () => {
  it("defaults to the standard root and claudeDir", () => {
    const config = resolveScanConfig({});
    expect(config.roots).toEqual([{ path: join(homedir(), ".claude", "projects") }]);
    expect(config.claudeDir).toBe(join(homedir(), ".claude"));
  });

  it("claudeDir stays fixed under custom roots", () => {
    const config = resolveScanConfig({ roots: ["/some/other/place"] });
    expect(config.roots).toEqual([{ path: "/some/other/place" }]);
    expect(config.claudeDir).toBe(join(homedir(), ".claude"));
  });
});
