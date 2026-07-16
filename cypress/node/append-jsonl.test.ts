import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendJsonl, isStrictlyWithinRoot, parseAppendRequest } from "./append-jsonl.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "claude-lens-append-test-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("parseAppendRequest", () => {
  it.each([
    [null, "object request"],
    [[], "object request"],
    [{}, "relative POSIX path"],
    [{ relativePath: "", line: "{}" }, "relative POSIX path"],
    [{ relativePath: "/absolute.jsonl", line: "{}" }, "relative POSIX path"],
    [{ relativePath: "../outside.jsonl", line: "{}" }, "relative POSIX path"],
    [{ relativePath: "inside/./target.jsonl", line: "{}" }, "relative POSIX path"],
    [{ relativePath: "inside\\target.jsonl", line: "{}" }, "relative POSIX path"],
    [{ relativePath: "inside/target.jsonl", line: "not-json" }, "valid JSON"],
    [{ relativePath: "inside/target.jsonl", line: "[]" }, "JSON object"],
    [{ relativePath: "inside/target.jsonl", line: "null" }, "JSON object"],
    [{ relativePath: "inside/target.jsonl", line: "{}\n{}" }, "newline-free"],
    [{ relativePath: "inside/target.jsonl", line: "{}\r" }, "newline-free"],
  ])("rejects %#", (request, message) => {
    expect(() => parseAppendRequest(request)).toThrow(message);
  });
});

describe("isStrictlyWithinRoot", () => {
  it("rejects a Windows path on another volume", () => {
    expect(isStrictlyWithinRoot("C:\\fixtures", "D:\\outside\\target.jsonl", win32)).toBe(false);
  });

  it("accepts a nested Windows path", () => {
    expect(isStrictlyWithinRoot("C:\\fixtures", "C:\\fixtures\\nested\\target.jsonl", win32)).toBe(
      true,
    );
  });
});

describe("appendJsonl", () => {
  it("appends exactly one newline-terminated object", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "nested"));
    const target = join(root, "nested", "target.jsonl");
    await writeFile(target, '{"before":true}\n', "utf8");

    await expect(
      appendJsonl({ relativePath: "nested/target.jsonl", line: '{"after":true}' }, root),
    ).resolves.toBeNull();
    expect(await readFile(target, "utf8")).toBe('{"before":true}\n{"after":true}\n');
  });

  it("rejects missing roots, missing targets, and directories", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "directory"));
    const request = { relativePath: "missing.jsonl", line: "{}" };

    await expect(appendJsonl(request, join(root, "missing-root"))).rejects.toThrow(
      "must identify an existing directory",
    );
    await expect(appendJsonl(request, root)).rejects.toThrow("target must already exist");
    await expect(appendJsonl({ relativePath: "directory", line: "{}" }, root)).rejects.toThrow(
      "target must be a file",
    );
  });

  it("rejects symlink escapes without changing the outside target", async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const outsideTarget = join(outside, "sentinel.jsonl");
    await writeFile(outsideTarget, '{"sentinel":true}\n', "utf8");
    await symlink(outsideTarget, join(root, "escape.jsonl"));

    await expect(
      appendJsonl({ relativePath: "escape.jsonl", line: '{"changed":true}' }, root),
    ).rejects.toThrow("through a symlink");
    expect(await readFile(outsideTarget, "utf8")).toBe('{"sentinel":true}\n');
  });
});
