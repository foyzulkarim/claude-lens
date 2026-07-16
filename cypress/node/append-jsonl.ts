import { appendFile, realpath, stat } from "node:fs/promises";
import * as platformPath from "node:path";

export interface AppendJsonlRequest {
  relativePath: string;
  line: string;
}

type PathOperations = Pick<typeof platformPath, "isAbsolute" | "relative" | "resolve" | "sep">;

export function isStrictlyWithinRoot(
  root: string,
  target: string,
  path: PathOperations = platformPath,
): boolean {
  const targetRelative = path.relative(root, target);
  return (
    targetRelative !== "" &&
    targetRelative !== ".." &&
    !targetRelative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(targetRelative)
  );
}

export function parseAppendRequest(value: unknown): AppendJsonlRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("appendJsonl requires an object request");
  }
  const request = value as Partial<AppendJsonlRequest>;
  if (
    typeof request.relativePath !== "string" ||
    request.relativePath.length === 0 ||
    platformPath.isAbsolute(request.relativePath) ||
    request.relativePath.includes("\\") ||
    request.relativePath.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error("appendJsonl requires a non-empty relative POSIX path without traversal");
  }
  if (
    typeof request.line !== "string" ||
    request.line.includes("\n") ||
    request.line.includes("\r")
  ) {
    throw new Error("appendJsonl requires one newline-free JSON object");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(request.line);
  } catch {
    throw new Error("appendJsonl requires valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("appendJsonl requires a JSON object");
  }
  return { relativePath: request.relativePath, line: request.line };
}

function configuredFixtureRoot(root: string | undefined): string {
  if (!root || !platformPath.isAbsolute(root)) {
    throw new Error("CLAUDE_LENS_E2E_FIXTURE_ROOT must be an absolute temporary fixture root");
  }
  return root;
}

export async function appendJsonl(
  value: unknown,
  fixtureRoot = process.env.CLAUDE_LENS_E2E_FIXTURE_ROOT,
): Promise<null> {
  const request = parseAppendRequest(value);
  let root: string;
  try {
    root = await realpath(configuredFixtureRoot(fixtureRoot));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("CLAUDE_LENS_E2E_FIXTURE_ROOT")) {
      throw error;
    }
    throw new Error("CLAUDE_LENS_E2E_FIXTURE_ROOT must identify an existing directory", {
      cause: error,
    });
  }

  const target = platformPath.resolve(root, ...request.relativePath.split("/"));
  if (!isStrictlyWithinRoot(root, target)) {
    throw new Error("appendJsonl target escapes the fixture root");
  }

  let targetRealPath: string;
  try {
    targetRealPath = await realpath(target);
  } catch (error) {
    throw new Error("appendJsonl target must already exist", { cause: error });
  }
  if (!isStrictlyWithinRoot(root, targetRealPath)) {
    throw new Error("appendJsonl target escapes the fixture root through a symlink");
  }
  if (!(await stat(targetRealPath)).isFile()) {
    throw new Error("appendJsonl target must be a file");
  }

  await appendFile(targetRealPath, `${request.line}\n`, "utf8");
  return null;
}
