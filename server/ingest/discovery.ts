import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import fg from "fast-glob";

export type FileClass =
  | { kind: "transcript"; sessionId: string }
  | { kind: "cost"; sessionId: string }
  | { kind: "turn-boundaries"; sessionId: string }
  | { kind: "cost-log" }
  | { kind: "unknown" };

export interface DiscoveredFile {
  path: string;
  class: Exclude<FileClass["kind"], "unknown">;
  sessionId?: string;
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
    } catch {
      continue;
    }

    for (const match of matches) {
      const absPath = resolve(match);
      if (seen.has(absPath)) continue;

      const classification = classifyFilename(absPath.split("/").pop() ?? "");
      if (classification.kind === "unknown") continue;

      seen.add(absPath);
      files.push({
        path: absPath,
        class: toDiscoveredClass(classification),
        sessionId: "sessionId" in classification ? classification.sessionId : undefined,
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

export function resolveScanConfig(cli: { roots?: string[] }): ScanConfig {
  const claudeDir = join(homedir(), ".claude");
  const roots: ScanRoot[] =
    cli.roots && cli.roots.length > 0
      ? cli.roots.map((path) => ({ path }))
      : [{ path: join(claudeDir, "projects") }];

  return { roots, claudeDir };
}
