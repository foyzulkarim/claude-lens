import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import fg from "fast-glob";

export type FileClass =
  | { kind: "transcript"; sessionId: string; agentId?: string }
  | { kind: "cost"; sessionId: string }
  | { kind: "turn-boundaries"; sessionId: string }
  | { kind: "cost-log" }
  | { kind: "unknown" };

export interface DiscoveredFile {
  path: string;
  class: Exclude<FileClass["kind"], "unknown">;
  sessionId?: string;
  /**
   * Set only for sub-agent (sidechain) transcripts discovered under
   * `<session-uuid>/subagents/` (#113). Its presence means "this file's
   * records belong to `sessionId`, but it is not that session's own
   * transcript" — the pipeline uses it to keep `setTranscriptPath` pinned
   * to the parent file.
   */
  agentId?: string;
  root: string;
  label?: string;
}

export interface ScanRoot {
  path: string;
  label?: string;
}

export interface ScanConfig {
  roots: ScanRoot[];
  claudeDir: string;
  fastIntervalMs?: number;
  slowIntervalMs?: number;
}

const COST_LOG_NAME = "cost-log.jsonl";
const TURN_BOUNDARIES_SUFFIX = ".turn-boundaries.jsonl";
const COST_SUFFIX = ".cost.jsonl";
const TRANSCRIPT_SUFFIX = ".jsonl";
// Directory Claude Code writes per-agent sidechain transcripts into, and the
// conventional prefix on those filenames (`agent-<id>.jsonl`). See classifyPath.
const SUBAGENT_DIR_NAME = "subagents";
const AGENT_FILE_PREFIX = "agent-";

// Once-gated set for fast-glob failure warnings (review EH-3). Bounded
// by the number of scan roots the user has configured since server
// start — never grows unboundedly. A flapping root surfaces one
// warning across the process lifetime instead of spamming the log on
// every poll cycle.
const warnedDiscoverFailure = new Set<string>();

export function classifyFilename(name: string): FileClass {
  if (name === COST_LOG_NAME) {
    return { kind: "cost-log" };
  }
  if (name.endsWith(TURN_BOUNDARIES_SUFFIX)) {
    const sessionId = name.slice(0, -TURN_BOUNDARIES_SUFFIX.length);
    if (sessionId.length === 0) return { kind: "unknown" };
    return { kind: "turn-boundaries", sessionId };
  }
  if (name.endsWith(COST_SUFFIX)) {
    const sessionId = name.slice(0, -COST_SUFFIX.length);
    if (sessionId.length === 0) return { kind: "unknown" };
    return { kind: "cost", sessionId };
  }
  if (name.endsWith(TRANSCRIPT_SUFFIX)) {
    const sessionId = name.slice(0, -TRANSCRIPT_SUFFIX.length);
    if (sessionId.length === 0) return { kind: "unknown" };
    return { kind: "transcript", sessionId };
  }
  return { kind: "unknown" };
}

/**
 * Path-aware classification (#113). Claude Code no longer writes sub-agent
 * (sidechain) activity inline in the parent transcript — it writes one file
 * per agent to `<session-uuid>/subagents/agent-<id>.jsonl`. Every line in
 * those files carries the **parent** session's `sessionId` (verified 67/67
 * against real capture data), so classifying them by filename alone made
 * each one a phantom top-level session keyed `agent-<id>`: sidechain cost
 * and tokens were attributed to sessions that don't exist, the
 * `main`/`sidechain` dimension never saw any sidechain rows, and two store
 * sessions could emit the same `sessionId:promptId` search-doc id (the
 * MiniSearch "duplicate ID" crash).
 *
 * Routing them to the parent here means every downstream consumer is
 * correct without changes — `derive-turns` already keys turns by
 * `promptId::side|main`, and gates/cache/metrics already branch on
 * `isSidechain`.
 *
 * Falls back to `classifyFilename` for every other shape, so premium
 * sidecars and ordinary transcripts are unaffected.
 */
export function classifyPath(filePath: string): FileClass {
  const segments = filePath.split(/[/\\]/);
  const name = segments.at(-1) ?? "";
  const parentDir = segments.at(-2);
  const grandparentDir = segments.at(-3);

  // #113 CQ-1: classify by filename first and only reinterpret an already-
  // confirmed transcript — rather than re-deriving "is this a cost/
  // turn-boundaries/cost-log sidecar" from the suffixes a second time here.
  // One source of truth for the sidecar shapes; a future one added to
  // `classifyFilename` doesn't also need updating in this condition.
  const base = classifyFilename(name);
  if (
    base.kind === "transcript" &&
    parentDir === SUBAGENT_DIR_NAME &&
    grandparentDir !== undefined &&
    grandparentDir.length > 0
  ) {
    // Strip the conventional `agent-` prefix so `agentId` matches the value
    // the transcript lines themselves carry (parse-transcript.ts reads
    // `line.agentId`; cache/classifier.ts groups sidechain calls by it).
    const stem = name.slice(0, -TRANSCRIPT_SUFFIX.length);
    const agentId = stem.startsWith(AGENT_FILE_PREFIX)
      ? stem.slice(AGENT_FILE_PREFIX.length)
      : stem;
    if (agentId.length > 0) {
      return { kind: "transcript", sessionId: grandparentDir, agentId };
    }
  }

  return base;
}

function toDiscoveredClass(
  classification: Exclude<FileClass, { kind: "unknown" }>,
): DiscoveredFile["class"] {
  switch (classification.kind) {
    case "transcript":
    case "cost":
    case "turn-boundaries":
    case "cost-log":
      return classification.kind;
    default: {
      const exhaustive: never = classification;
      throw new Error(`unhandled FileClass kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export async function discover(config: ScanConfig): Promise<DiscoveredFile[]> {
  const seen = new Set<string>();
  const files: DiscoveredFile[] = [];

  for (const root of config.roots) {
    let matches: string[];
    try {
      matches = await fg("**/*.jsonl", { cwd: root.path, absolute: true, onlyFiles: true });
    } catch (err) {
      // Review EH-3: previously swallowed silently — a misconfigured
      // --roots entry, a permissions denial, or a stale path was
      // invisible to operators. Warn once per root (the
      // `warnedDiscoverFailure` Set matches the same once-gate
      // pattern warm-cache.ts uses for save failures) so a flapping
      // root doesn't spam logs on every poll cycle.
      if (!warnedDiscoverFailure.has(root.path)) {
        warnedDiscoverFailure.add(root.path);
        console.warn("[discover] fast-glob failed for root", {
          // Security #4 — basename only, never the absolute path.
          root: basename(root.path),
          code: (err as NodeJS.ErrnoException | undefined)?.code ?? "UNKNOWN",
        });
      }
      continue;
    }

    for (const match of matches) {
      const absPath = resolve(match);
      if (seen.has(absPath)) continue;

      const classification = classifyPath(absPath);
      if (classification.kind === "unknown") continue;

      seen.add(absPath);
      files.push({
        path: absPath,
        class: toDiscoveredClass(classification),
        sessionId: "sessionId" in classification ? classification.sessionId : undefined,
        ...(classification.kind === "transcript" && classification.agentId !== undefined
          ? { agentId: classification.agentId }
          : {}),
        root: root.path,
        label: root.label,
      });
    }
  }

  const lFilePath = resolve(join(config.claudeDir, COST_LOG_NAME));
  if (!seen.has(lFilePath)) {
    try {
      await stat(lFilePath);
      files.push({ path: lFilePath, class: "cost-log", root: config.claudeDir });
    } catch {
      // L-file absent — not an error.
    }
  }

  return files;
}

/**
 * Resolves the scan roots for this process. Precedence (#P4-15,
 * ARCH-settings-local-store.md): explicit `--roots` CLI flag wins outright
 * (preserves `scripts/e2e.ts`'s isolated-fixture behavior); otherwise the
 * user's `~/.claude-lens/config.json` `scanRoots` (with labels) applies;
 * otherwise the default `~/.claude/projects`. Root *paths* are resolved
 * once here at boot — changing them requires a restart (ARCH decision A2);
 * only a root's *label* is live-updatable via `Store.updateHostLabels()`.
 */
export function resolveScanConfig(cli: { roots?: string[]; configRoots?: ScanRoot[] }): ScanConfig {
  const claudeDir = join(homedir(), ".claude");
  const roots: ScanRoot[] =
    cli.roots && cli.roots.length > 0
      ? cli.roots.map((path) => ({ path }))
      : cli.configRoots && cli.configRoots.length > 0
        ? cli.configRoots
        : [{ path: join(claudeDir, "projects") }];

  return { roots, claudeDir };
}
