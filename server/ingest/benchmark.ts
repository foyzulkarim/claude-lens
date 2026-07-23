#!/usr/bin/env node
import { mkdtemp, rm, stat } from "node:fs/promises";
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
import { parseRootsFlag } from "./argv.js";
import { classifyPath, type ScanConfig, resolveScanConfig } from "./discovery.js";
import { startIngest } from "./pipeline.js";
import { createWarmCache } from "./warm-cache.js";

function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

// Once-gated set mirroring `discover.ts`'s `warnedDiscoverFailure`:
// bounded by the number of distinct roots since server start — never
// grows unboundedly. A flapping root surfaces one warning across the
// process lifetime instead of spamming the log on every benchmark run.
const warnedMeasureFailure = new Set<string>();

/**
 * Walks the configured scan roots and sums the bytes of every
 * transcript (T) file classified as `kind: "transcript"` by
 * `classifyPath`. Excludes `.cost.jsonl` and `.turn-boundaries.jsonl`
 * sidecars (C and B) since they're metadata for a T file, not the
 * transcript data the boot hot path reads. The cost-log.jsonl (L) lives
 * at the `claudeDir` level, not under a scan root, so it never appears
 * here. The sum is "MB of source JSONL" — the same data the cold path
 * must read off disk and parse.
 *
 * Side effect on the cold-boot measurement: walking the same files
 * here warms the OS page cache before the cold-boot timer starts in
 * `runOnce`. On a warm-cache system the measured cold-boot `ms` reads
 * from that warm cache; the JS-level `t0` is unaffected, but the I/O
 * is. Acceptable for our scale; revisit if a true cold-disk measurement
 * becomes important.
 */
async function measureDataSize(config: ScanConfig): Promise<number> {
  // Cap in-flight stat() calls per root. The libuv thread pool
  // serializes the syscalls internally (default 4 threads), so the
  // actual concurrency is lower — this cap bounds the in-flight
  // promise count and closure retention, not the syscall rate. 64
  // is a comfortable ceiling; revisit for the 100× corpus case the
  // §5.7 follow-up in the PR description already calls out.
  const STAT_CONCURRENCY = 64;
  let totalBytes = 0;
  for (const root of config.roots) {
    let matches: string[];
    try {
      matches = await fg("**/*.jsonl", { cwd: root.path, absolute: true, onlyFiles: true });
    } catch (err) {
      // Mirror `discover.ts`'s posture: warn once per misconfigured
      // root so the operator can see what went wrong, then continue.
      // A partial data-size number still beats a crash.
      if (!warnedMeasureFailure.has(root.path)) {
        warnedMeasureFailure.add(root.path);
        console.warn("[measure-data-size] fast-glob failed for root", {
          root: basename(root.path),
          code: (err as NodeJS.ErrnoException | undefined)?.code ?? "UNKNOWN",
        });
      }
      continue;
    }
    for (let i = 0; i < matches.length; i += STAT_CONCURRENCY) {
      const chunk = matches.slice(i, i + STAT_CONCURRENCY);
      await Promise.all(
        chunk.map(async (filePath) => {
          if (classifyPath(filePath).kind !== "transcript") return;
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

async function main() {
  const { roots: configRoots } = parseRootsFlag(process.argv.slice(2));
  const scanConfig = resolveScanConfig({ roots: configRoots });
  const dataBytes = await measureDataSize(scanConfig);
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
