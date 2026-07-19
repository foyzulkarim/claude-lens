import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
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
 * directory (no `..` escape, no absolute paths). Imported files'
 * sizes+lines roll into the size total, but we do NOT recurse into
 * their imports.
 *
 * Unreadable-file contract (ARCH §Cross-Cutting Concerns): a file we
 * can't read (permission denied, transient IO, directory at the
 * expected path) is NOT collapsed to "missing" — that would punish the
 * user with an E1 fail over an environmental issue. Instead,
 * `safeReadSize` returns a discriminated `unreadable` outcome that
 * flows up to `evaluateE1E2`, where it surfaces as a `warn` evidence
 * entry. The route never throws on IO failure — only a complete
 * filesystem failure (rare on local-only) becomes HTTP 500.
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

/**
 * Discriminated outcome of a single read attempt. The file content is
 * returned alongside `file` so callers (notably `readWithImports`) can
 * scan it for `@import` references without re-reading from disk —
 * closing the window where a second read could fail after a successful
 * first read (review H3). Unreadable files are distinguished from
 * missing files so the engine can downgrade IO failures to `warn`
 * evidence rather than misclassifying them as `fail` (review H4).
 */
type ReadResult =
  | { kind: "ok"; file: FileSize; text: string }
  | { kind: "missing" }
  | { kind: "unreadable"; error: string };

/** Read a file and report its size + content, or classify the failure. ENOENT is `missing`; any other IO error is `unreadable`. */
async function safeReadSize(path: string, imported: boolean): Promise<ReadResult> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { kind: "missing" };
    }
    return { kind: "unreadable", error: (err as Error).message ?? String(err) };
  }
  return {
    kind: "ok",
    file: {
      path,
      chars: text.length,
      lines: text.split("\n").length,
      imported,
    },
    text,
  };
}

/**
 * One read-attempt outcome with its source path attached, so the
 * caller can attribute `unreadable` evidence to the right path without
 * re-passing the path around.
 */
interface ReadOutcome {
  path: string;
  result: ReadResult;
}

function isPathInside(parent: string, child: string): boolean {
  // path.relative + reject `..`/absolute is the canonical containment
  // check (the `startsWith(parent + "/")` shorthand is fragile against
  // `/proj` vs `/proj-evil`). review nice-to-have.
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

interface ReadWithImportsResult {
  primary: FileSize | null;
  /** True iff the primary file existed but couldn't be read (permission, IO). */
  primaryUnreadable: string | null;
  imports: FileSize[];
  /** Read errors for imported files — surfaced as warn evidence. */
  importErrors: { path: string; message: string }[];
  /** Import lines that escaped the importer directory or were absolute — security rejections. */
  importRejections: { rawPath: string }[];
}

/**
 * Reads a CLAUDE.md at `path`, following `@import` references up to one
 * level deep. Imports must resolve inside the importer's directory;
 * traversal escapes and absolute paths are rejected (security). Silent
 * ENOENT imports are skipped (non-fatal); unreadable imports are
 * captured so the gate can emit `warn` evidence.
 *
 * Each call returns the file's size, a list of imported files, and any
 * import-side errors. The caller sums sizes+lines across all of them.
 *
 * All imports are read in parallel via `Promise.all` — review M3.
 */
async function readWithImports(path: string): Promise<ReadWithImportsResult> {
  const primaryRead = await safeReadSize(path, false);
  if (primaryRead.kind !== "ok") {
    return {
      primary: null,
      primaryUnreadable: primaryRead.kind === "unreadable" ? primaryRead.error : null,
      imports: [],
      importErrors: [],
      importRejections: [],
    };
  }
  const baseDir = dirname(path);

  // Extract @import paths from the primary file's text we already have
  // in hand — no second read, no unguarded fs call (review H3).
  const importPaths: string[] = [];
  for (const match of primaryRead.text.matchAll(IMPORT_RE)) {
    const importPath = match[1] ?? match[2];
    if (importPath) importPaths.push(importPath);
  }

  const importerDir = resolve(baseDir);

  // Resolve every raw import path to its absolute target (or a
  // rejection marker) up front, then dispatch the reads in parallel
  // (review M3). Rejections (absolute paths, escapes) don't touch disk.
  type Resolved =
    | { kind: "ok"; rawPath: string; resolved: string }
    | { kind: "reject"; rawPath: string };
  const resolvedImports: Resolved[] = importPaths.map((rawPath) => {
    // Absolute imports are unconditionally rejected — the importer
    // can't vouch for an arbitrary filesystem location (review H1).
    if (isAbsolute(rawPath)) {
      return { kind: "reject", rawPath };
    }
    const resolved = resolve(importerDir, rawPath);
    // Containment check via path.relative (review nice-to-have): a
    // resolved path that lands outside `importerDir`, or back at the
    // filesystem root, is rejected.
    if (!isPathInside(importerDir, resolved)) {
      return { kind: "reject", rawPath };
    }
    return { kind: "ok", rawPath, resolved };
  });

  const rejections: { rawPath: string }[] = [];
  const reads: Promise<ReadOutcome>[] = [];
  for (const entry of resolvedImports) {
    if (entry.kind === "reject") {
      rejections.push({ rawPath: entry.rawPath });
      continue;
    }
    reads.push(
      safeReadSize(entry.resolved, true).then((result) => ({ path: entry.resolved, result })),
    );
  }

  const outcomes = await Promise.all(reads);

  const imports: FileSize[] = [];
  const importErrors: { path: string; message: string }[] = [];
  for (const { path: importPath, result } of outcomes) {
    if (result.kind === "ok") {
      imports.push(result.file);
    } else if (result.kind === "unreadable") {
      importErrors.push({ path: importPath, message: result.error });
    }
    // ENOENT on import is silently skipped (matches existing
    // behavior; gates.md says non-fatal).
  }

  return {
    primary: primaryRead.file,
    primaryUnreadable: null,
    imports,
    importErrors,
    importRejections: rejections,
  };
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

/**
 * The two E1/E2 gate IDs in canonical order. Returned as a tuple so
 * the engine can destructure without positional fallback — review M2.
 */
export type E1E2Result = readonly [GateResult, GateResult];

export async function evaluateE1E2(
  cwd: string,
  thresholds: Pick<GateThresholds, "e2MaxChars" | "e2MaxLines">,
  options: EvaluateE1E2Options = {},
): Promise<E1E2Result> {
  const projectPath = resolve(cwd, "CLAUDE.md");
  const userPath = options.userClaudePath ?? resolve(homedir(), ".claude", "CLAUDE.md");

  const [projectRead, userRead] = await Promise.all([
    readWithImports(projectPath),
    readWithImports(userPath),
  ]);

  // Unreadable-file evidence surfaces as `warn` per ARCH
  // §Cross-Cutting Concerns. Attach each unreadable file's detail so
  // the UI can show "checked <path>, unreadable" without re-reading.
  const unreadableEvidence: GateEvidence[] = [];
  if (projectRead.primaryUnreadable !== null) {
    unreadableEvidence.push({
      filePath: projectPath,
      detail: `checked ${projectPath}, unreadable: ${projectRead.primaryUnreadable}`,
    });
  }
  for (const err of projectRead.importErrors) {
    unreadableEvidence.push({
      filePath: err.path,
      detail: `checked ${err.path}, unreadable: ${err.message}`,
    });
  }
  for (const rej of projectRead.importRejections) {
    unreadableEvidence.push({
      filePath: rej.rawPath,
      detail: `import "${rej.rawPath}" rejected: absolute path not allowed`,
    });
  }
  if (userRead.primaryUnreadable !== null) {
    unreadableEvidence.push({
      filePath: userPath,
      detail: `checked ${userPath}, unreadable: ${userRead.primaryUnreadable}`,
    });
  }
  for (const err of userRead.importErrors) {
    unreadableEvidence.push({
      filePath: err.path,
      detail: `checked ${err.path}, unreadable: ${err.message}`,
    });
  }
  for (const rej of userRead.importRejections) {
    unreadableEvidence.push({
      filePath: rej.rawPath,
      detail: `import "${rej.rawPath}" rejected: absolute path not allowed`,
    });
  }

  const projectExists = projectRead.primary !== null;
  const userExists = userRead.primary !== null;

  // Outcome 1: both missing (ENOENT on both) → E1 fails, E2 stays inactive.
  // An "unreadable" file is distinct from a missing one and is handled
  // separately below — the missing branch must not steal unreadable
  // cases (both unreadable means both `primary === null` too).
  if (!projectExists && !userExists && unreadableEvidence.length === 0) {
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

  // Outcomes 2/3: at least one present (readable OR unreadable).
  // Bloat math is computed over the readable portion only — an
  // unreadable file contributes zero to the total, since guessing its
  // size would inflate the count. If anything was unreadable, we
  // can't confirm a clean pass; warn so the UI flags the gate rather
  // than silently scoring it.
  const projectFiles: FileSize[] = projectRead.primary
    ? [projectRead.primary, ...projectRead.imports]
    : [];
  const userFiles: FileSize[] = userRead.primary ? [userRead.primary, ...userRead.imports] : [];
  const projectSize = sumSizes(projectFiles);
  const userSize = sumSizes(userFiles);
  const totalChars = projectSize.chars + userSize.chars;
  const totalLines = projectSize.lines + userSize.lines;
  const oversized = totalChars > thresholds.e2MaxChars || totalLines > thresholds.e2MaxLines;

  // Size evidence always reflects what was readable; unreadable
  // evidence is prepended so the UI sees the IO failure first.
  const sizeEvidence: GateEvidence[] = [];
  if (projectExists) {
    const importNote =
      projectRead.imports.length > 0
        ? ` +${projectRead.imports.length} import(s) included in size total`
        : "";
    sizeEvidence.push({
      filePath: projectPath,
      detail: `${projectPath}, size=${projectSize.chars} chars / ${projectSize.lines} lines${importNote} (totals: ${totalChars} chars / ${totalLines} lines; thresholds ${thresholds.e2MaxChars}/${thresholds.e2MaxLines})`,
    });
  } else {
    sizeEvidence.push({
      filePath: projectPath,
      detail: `no CLAUDE.md at project root (${projectPath}) — falling back to user CLAUDE.md only`,
    });
  }
  if (userExists) {
    const importNote =
      userRead.imports.length > 0
        ? ` +${userRead.imports.length} import(s) included in size total`
        : "";
    sizeEvidence.push({
      filePath: userPath,
      detail: `${userPath}, size=${userSize.chars} chars / ${userSize.lines} lines${importNote}`,
    });
  } else {
    sizeEvidence.push({
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
        evidence: [...unreadableEvidence, ...sizeEvidence],
      },
    ];
  }
  if (unreadableEvidence.length > 0) {
    // Readable side is within thresholds, but we can't confirm pass
    // because one side was unreadable (it might have been bloated).
    return [
      {
        gateId: "E1",
        status: "warn",
        evidence: unreadableEvidence,
      },
      inactivePass("E2"),
    ];
  }
  // Pass: both gate IDs return synthetic pass (no findings to surface).
  return [
    {
      gateId: "E1",
      status: "pass",
      evidence: sizeEvidence,
    },
    inactivePass("E2"),
  ];
}
