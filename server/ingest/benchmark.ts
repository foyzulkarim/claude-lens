#!/usr/bin/env node
// #P2-7 checkpoint: cold boot, warm boot, and RSS against the real
// ~/.claude/projects, using the same startIngest() assembly #P3-1 reuses.
// Run with `npm run bench:ingest`. Prints a markdown table row ready to paste
// into specs/claude-lens-plan.md's benchmark log.
import { performance } from "node:perf_hooks";
import { rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveScanConfig } from "./discovery.js";
import { startIngest } from "./pipeline.js";
import { createWarmCache } from "./warm-cache.js";

function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

async function runOnce(
  cacheDir: string,
): Promise<{ ms: number; rssBytes: number; sessions: number; calls: number }> {
  const config = resolveScanConfig({});
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
  const cacheDir = await mkdtemp(join(tmpdir(), "claude-lens-bench-cache-"));
  try {
    const cold = await runOnce(cacheDir);
    const warm = await runOnce(cacheDir);

    console.log("\n#P2-7 benchmark results\n");
    console.log(
      `Cold boot: ${formatMs(cold.ms)}  RSS: ${formatMb(cold.rssBytes)}  sessions: ${cold.sessions}  calls: ${cold.calls}`,
    );
    console.log(
      `Warm boot: ${formatMs(warm.ms)}  RSS: ${formatMb(warm.rssBytes)}  sessions: ${warm.sessions}  calls: ${warm.calls}`,
    );
    console.log("\nPaste into specs/claude-lens-plan.md benchmark log:\n");
    console.log(
      `| ${new Date().toISOString().slice(0, 10)} | ${formatMs(cold.ms)} | ${formatMs(warm.ms)} | ${formatMb(cold.rssBytes)} | ${cold.sessions} sessions / ${cold.calls} calls | |`,
    );
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
