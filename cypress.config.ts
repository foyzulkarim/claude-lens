import { appendFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { defineConfig } from "cypress";
import { build } from "esbuild";

interface AppendJsonlRequest {
  relativePath: string;
  line: string;
}

function fixtureRoot(): string {
  const root = process.env.CLAUDE_LENS_E2E_FIXTURE_ROOT;
  if (!root || !isAbsolute(root)) {
    throw new Error("CLAUDE_LENS_E2E_FIXTURE_ROOT must be an absolute temporary fixture root");
  }
  return root;
}

function parseAppendRequest(value: unknown): AppendJsonlRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("appendJsonl requires an object request");
  }
  const request = value as Partial<AppendJsonlRequest>;
  if (
    typeof request.relativePath !== "string" ||
    request.relativePath.length === 0 ||
    isAbsolute(request.relativePath) ||
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

async function appendJsonl(value: unknown): Promise<null> {
  const request = parseAppendRequest(value);
  const root = await realpath(fixtureRoot());
  const target = resolve(root, ...request.relativePath.split("/"));
  const targetRelative = relative(root, target);
  if (
    targetRelative === "" ||
    targetRelative === ".." ||
    targetRelative.startsWith(`..${sep}`) ||
    isAbsolute(targetRelative)
  ) {
    throw new Error("appendJsonl target escapes the fixture root");
  }

  let targetRealPath: string;
  try {
    targetRealPath = await realpath(target);
  } catch {
    throw new Error("appendJsonl target must already exist");
  }
  const realRelative = relative(root, targetRealPath);
  if (realRelative === "" || realRelative === ".." || realRelative.startsWith(`..${sep}`)) {
    throw new Error("appendJsonl target escapes the fixture root through a symlink");
  }
  if (!(await stat(targetRealPath)).isFile()) {
    throw new Error("appendJsonl target must be a file");
  }

  await appendFile(targetRealPath, `${request.line}\n`, "utf8");
  return null;
}

export default defineConfig({
  e2e: {
    baseUrl: process.env.CLAUDE_LENS_E2E_BASE_URL,
    specPattern: "cypress/e2e/**/*.cy.ts",
    supportFile: false,
    setupNodeEvents(on) {
      on("task", { appendJsonl });
      // Cypress's built-in webpack preprocessor currently relies on
      // TypeScript compiler internals removed by this repository's TS 7.
      // The project already uses esbuild for the packaged CLI, so compile the
      // browser-only specs with that stable, dependency-free boundary too.
      on("file:preprocessor", async (file) => {
        await build({
          entryPoints: [file.filePath],
          outfile: file.outputPath,
          bundle: true,
          format: "iife",
          platform: "browser",
          sourcemap: "inline",
        });
        return file.outputPath;
      });
    },
  },
  video: false,
});
