import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import type { GateEvidence, GateResult, GateThresholds } from "../../shared/gates-contract.js";

/**
 * E1/E2 — CLAUDE.md missing / bloated (gates.md §"E1/E2 — CLAUDE.md
 * missing / bloated").
 *
 * Practice: "Write an effective CLAUDE.md" — present, but short. The
 * rule is one check with three outcomes — E1 (missing) and E2 (bloated)
 * share the same scoring row, and gates.md preamble: "E1 and E2 share
 * one check with three outcomes".
 *
 * Per-session outcomes:
 *
 *   - No `CLAUDE.md` at project root (transcript `cwd`) AND none at
 *     `~/.claude/CLAUDE.md` → check fails (E1 fires).
 *   - At least one present, but total size > `e2MaxChars` OR total
 *     lines > `e2MaxLines` → check warns (E2 fires).
 *   - Otherwise → check passes.
 *
 * The `evaluateE1E2` function returns TWO `GateResult` entries — one
 * per gate ID — so the engine can flatten them into its 7-entry
 * `gates` list. Exactly one of them carries the active outcome; the
 * other is a synthetic "pass" with empty evidence. This matches the
 * "one check, three outcomes" framing without inventing a separate
 * combined type.
 *
 * Evidence contract (R7): session-scoped shape, `{filePath, detail}`
 * only — never `turnN` / `callId`. Consumers (#P4-12 Report Card UI,
 * Dashboard gate feed) must not assume turn keys on these entries.
 *
 * `@import` walker (R14): one level only, regex match
 * `@import\s+(?:"([^"]+)"|'([^']+)')`; resolved relative to the
 * importer's directory; resolved paths MUST stay inside the importer's
 * directory (no `..` escape). Imported files' sizes+lines roll into
 * the size total, but we do NOT recurse into their imports.
 *
 * Footnote ("as of now"): this is a filesystem check at analysis time,
 * not session time — gates.md documents the file may have changed
 * since the session ran. The route handler labels the report's
 * evidence with this context.
 */

const IMPORT_RE = /@import\s+(?:"([^"]+)"|'([^']+)')/g;

interface FileSize {
  path: string;
  chars: number;
  lines: number;
  imported: boolean;
}

interface ReadResult {
  file: FileSize | null;
  error?: string;
}

/** Reads a file and reports its size, or returns null on ENOENT. Other I/O errors surface as `error`. */
async function safeReadSize(path: string, imported: boolean): Promise<ReadResult> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { file: null };
    }
    return { file: null, error: (err as Error).message ?? String(err) };
  }
  return {
    file: {
      path,
      chars: text.length,
      lines: text.split("\n").length,
      imported,
    },
  };
}

/**
 * Reads a CLAUDE.md at `path`, following `@import` references up to one
 * level deep. Imported files must resolve inside the importer's
 * directory; traversal escapes are rejected (security) and silent
 * ENOENT imports are skipped (non-fatal).
 *
 * Each call returns the file's size and a list of imported files. The
 * caller sums sizes+lines across all of them.
 */
async function readWithImports(path: string): Promise<{
  primary: FileSize | null;
  imports: FileSize[];
  errors: { path: string; message: string }[];
}> {
  const primaryRead = await safeReadSize(path, false);
  if (!primaryRead.file) {
    return {
      primary: null,
      imports: [],
      errors: primaryRead.error ? [{ path, message: primaryRead.error }] : [],
    };
  }
  const baseDir = dirname(path);

  // Extract @import paths from the primary file's text.
  const importPaths: string[] = [];
  for (const match of (await readFile(path, "utf8")).matchAll(IMPORT_RE)) {
    const importPath = match[1] ?? match[2];
    if (importPath) importPaths.push(importPath);
  }

  const imports: FileSize[] = [];
  const errors: { path: string; message: string }[] = [];
  for (const rawPath of importPaths) {
    const resolved = isAbsolute(rawPath) ? rawPath : resolve(baseDir, rawPath);
    const importerDir = baseDir;
    const importerDirResolved = resolve(importerDir) + "/";
    if (!isAbsolute(rawPath) && !(resolve(resolved) + "/").startsWith(importerDirResolved)) {
      errors.push({ path: rawPath, message: `import escapes ${importerDir}; skipped` });
      continue;
    }
    const importRead = await safeReadSize(resolved, true);
    if (importRead.file) {
      imports.push(importRead.file);
    } else if (importRead.error) {
      errors.push({ path: resolved, message: importRead.error });
    }
    // ENOENT on import is silently skipped.
  }

  return { primary: primaryRead.file, imports, errors };
}

function sumSizes(files: FileSize[]): { chars: number; lines: number } {
  let chars = 0;
  let lines = 0;
  for (const file of files) {
    chars += file.chars;
    lines += file.lines;
  }
  return { chars, lines };
}

/** Synthetic pass result for the inactive E1/E2 gate ID. */
function inactivePass(gateId: "E1" | "E2"): GateResult {
  return { gateId, status: "pass", evidence: [] };
}

export interface EvaluateE1E2Options {
  /**
   * Override the user-level CLAUDE.md path. Defaults to
   * `${homedir()}/.claude/CLAUDE.md`. Tests pass a temp directory so the
   * gate doesn't read the real user's home config; production code never
   * sets this.
   */
  userClaudePath?: string;
}

export async function evaluateE1E2(
  cwd: string,
  thresholds: Pick<GateThresholds, "e2MaxChars" | "e2MaxLines">,
  options: EvaluateE1E2Options = {},
): Promise<GateResult[]> {
  const projectPath = resolve(cwd, "CLAUDE.md");
  const userPath = options.userClaudePath ?? resolve(homedir(), ".claude", "CLAUDE.md");

  const [projectRead, userRead] = await Promise.all([
    readWithImports(projectPath),
    readWithImports(userPath),
  ]);

  const projectFiles: FileSize[] = projectRead.primary
    ? [projectRead.primary, ...projectRead.imports]
    : [];
  const userFiles: FileSize[] = userRead.primary ? [userRead.primary, ...userRead.imports] : [];

  const projectExists = projectRead.primary !== null;
  const userExists = userRead.primary !== null;

  // Outcome 1: neither exists → E1 fails, E2 stays inactive.
  if (!projectExists && !userExists) {
    return [
      {
        gateId: "E1",
        status: "fail",
        evidence: [
          {
            filePath: projectPath,
            detail: `no CLAUDE.md at project root (${projectPath})`,
          },
          {
            filePath: userPath,
            detail: `no CLAUDE.md at user config (${userPath})`,
          },
        ],
      },
      inactivePass("E2"),
    ];
  }

  // Outcomes 2/3: at least one present. Check bloat thresholds.
  const projectSize = sumSizes(projectFiles);
  const userSize = sumSizes(userFiles);
  const totalChars = projectSize.chars + userSize.chars;
  const totalLines = projectSize.lines + userSize.lines;
  const oversized = totalChars > thresholds.e2MaxChars || totalLines > thresholds.e2MaxLines;

  const evidence: GateEvidence[] = [];
  if (projectExists) {
    const importNote =
      projectRead.imports.length > 0
        ? ` +${projectRead.imports.length} import(s) included in size total`
        : "";
    evidence.push({
      filePath: projectPath,
      detail: `${projectPath}, size=${projectSize.chars} chars / ${projectSize.lines} lines${importNote} (totals: ${totalChars} chars / ${totalLines} lines; thresholds ${thresholds.e2MaxChars}/${thresholds.e2MaxLines})`,
    });
  } else {
    evidence.push({
      filePath: projectPath,
      detail: `no CLAUDE.md at project root (${projectPath}) — falling back to user CLAUDE.md only`,
    });
  }
  if (userExists) {
    const importNote =
      userRead.imports.length > 0
        ? ` +${userRead.imports.length} import(s) included in size total`
        : "";
    evidence.push({
      filePath: userPath,
      detail: `${userPath}, size=${userSize.chars} chars / ${userSize.lines} lines${importNote}`,
    });
  } else {
    evidence.push({
      filePath: userPath,
      detail: `no CLAUDE.md at user config (${userPath}) — falling back to project CLAUDE.md only`,
    });
  }

  if (oversized) {
    return [
      inactivePass("E1"),
      {
        gateId: "E2",
        status: "warn",
        evidence,
      },
    ];
  }
  // Pass: both gate IDs return synthetic pass (no findings to surface).
  return [
    {
      gateId: "E1",
      status: "pass",
      evidence,
    },
    inactivePass("E2"),
  ];
}
