#!/usr/bin/env node
import { stat } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
// #P2-7 checkpoint: cold boot, warm boot, and RSS against the real
// ~/.claude/projects, using the same startIngest() assembly #P3-1 reuses.
// #P5-1: also adds a "data size" column (MB of source JSONL) and a
// `--roots` flag (default still `~/.claude/projects`).
// Run with `npm run bench:ingest`. Prints a markdown table row ready to paste
// into specs/claude-lens-plan.md's benchmark log.
import { performance } from "node:perf_hooks";
import fg from "fast-glob";
import { classifyFilename, type ScanConfig, resolveScanConfig } from "./discovery.js";
import { startIngest } from "./pipeline.js";
import { createWarmCache } from "./warm-cache.js";

function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * Walks each scan root and sums the bytes of every transcript (T) file —
 * the `<uuid>.jsonl` shape classified by `classifyFilename` as kind
 * "transcript". Excludes `.cost.jsonl` and `.turn-boundaries.jsonl`
 * sidecars (C and B) since they're metadata for a T file, not the
 * transcript data the boot hot path reads. The cost-log.jsonl (L) lives
 * at the `claudeDir` level, not under a scan root, so it never appears
 * here. The sum is "MB of source JSONL" — the same data the cold path
 * must read off disk and parse.
 */
async function measureDataSize(roots: { path: string }[]): Promise<number> {
  let totalBytes = 0;
  for (const root of roots) {
    let matches: string[];
    try {
      matches = await fg("**/*.jsonl", { cwd: root.path, absolute: true, onlyFiles: true });
    } catch {
      // Same "skip and continue" shape `discover` uses for a flapping
      // root — a partial data-size number beats a crash, and the
      // pipeline surfaces the same warning via its own discover pass.
      continue;
    }
    await Promise.all(
      matches.map(async (filePath) => {
        if (classifyFilename(basename(filePath)).kind !== "transcript") return;
        try {
          const s = await stat(filePath);
          totalBytes += s.size;
        } catch {
          // File may have been pruned between glob and stat — best-
          // effort posture matches the pipeline's own readers.
        }
      }),
    );
  }
  return totalBytes;
}

async function runOnce(
  cacheDir: string,
  config: ScanConfig,
): Promise<{ ms: number; rssBytes: number; sessions: number; calls: number }> {
  const warmCache = createWarmCache(cacheDir);

  const t0 = performance.now();
  const pipeline = startIngest(config, { onInvalidate: () => {}, warmCache });
  await pipeline.whenSettled();
  pipeline.store.flushAll();
  const ms = performance.now() - t0;

  const sessions = pipeline.store.listSessions();
  const calls = sessions.reduce((sum, s) => sum + s.callCount, 0);
  const rssBytes = process.memoryUsage().rss;

  pipeline.stop();
  return { ms, rssBytes, sessions: sessions.length, calls };
}

/**
 * Mirrors `server/cli.ts`'s --roots handling: `--roots a b c` and
 * `--roots=a` both work, repeats accumulate, parsing stops at the
 * next `--`-prefixed token. No commander per architecture §1.
 */
function parseRootsArg(argv: string[]): string[] {
  const roots: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inlineValue] = arg.split("=", 2);
    if (flag !== "--roots") continue;
    if (inlineValue) roots.push(inlineValue);
    while (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      roots.push(argv[++i]);
    }
  }
  return roots;
}

async function main() {
  const configRoots = parseRootsArg(process.argv.slice(2));
  const scanConfig = resolveScanConfig({ roots: configRoots });
  const dataBytes = await measureDataSize(scanConfig.roots);
  const cacheDir = await mkdtemp(join(tmpdir(), "claude-lens-bench-cache-"));
  try {
    const cold = await runOnce(cacheDir, scanConfig);
    const warm = await runOnce(cacheDir, scanConfig);

    const dataSize = `${formatMb(dataBytes)} · ${cold.sessions} sessions / ${cold.calls} calls`;
    const ratio = cold.ms > 0 ? (warm.ms / cold.ms).toFixed(2) : "n/a";

    console.log("\n#P5-1 benchmark results\n");
    console.log(`Data size: ${dataSize}`);
    console.log(
      `Cold boot: ${formatMs(cold.ms)}  RSS: ${formatMb(cold.rssBytes)}  sessions: ${cold.sessions}  calls: ${cold.calls}`,
    );
    console.log(
      `Warm boot: ${formatMs(warm.ms)}  RSS: ${formatMb(warm.rssBytes)}  (warm/cold ratio: ${ratio}x)`,
    );
    console.log("\nPaste into specs/claude-lens-plan.md benchmark log:\n");
    console.log(
      `| ${new Date().toISOString().slice(0, 10)} | #P5-1 | ${formatMs(cold.ms)} | ${formatMs(warm.ms)} | ${formatMb(cold.rssBytes)} | ${dataSize} | warm/cold ${ratio}x |`,
    );
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
