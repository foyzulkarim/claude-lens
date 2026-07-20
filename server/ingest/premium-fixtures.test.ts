import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { IngestPipeline } from "./pipeline.js";
import { startIngest } from "./pipeline.js";

// End-to-end validation of the hand-authored premium overlay fixtures
// (`test/fixtures-premium/`) through the real ingest pipeline (#P4-13). This
// mirrors what the Cypress double-run harness (scripts/e2e.ts) exercises: a
// base transcript tree with the premium C/B/L overlay copied on top, booted as
// one scan root. It is the executable proof that the authored fixtures produce
// the observed values the e2e specs and manual sign-off rely on.

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const baseFixtures = join(repoRoot, "test", "fixtures");
const premiumOverlay = join(repoRoot, "test", "fixtures-premium");

const tmpDirs: string[] = [];
const pipelines: IngestPipeline[] = [];

afterEach(async () => {
  for (const pipeline of pipelines.splice(0)) pipeline.stop();
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function bootWithPremium(): Promise<IngestPipeline> {
  const root = await mkdtemp(join(tmpdir(), "claude-lens-premium-"));
  tmpDirs.push(root);
  await cp(baseFixtures, root, { recursive: true });
  await cp(premiumOverlay, root, { recursive: true }); // overlay on top
  const pipeline = startIngest(
    { roots: [{ path: root }], claudeDir: root, fastIntervalMs: 50, slowIntervalMs: 5000 },
    { onInvalidate: () => {}, debounceMs: 20 },
  );
  pipelines.push(pipeline);
  await pipeline.whenSettled();
  pipeline.store.flushAll();
  return pipeline;
}

describe("premium overlay fixtures (#P4-13)", () => {
  const S1 = "11111111-1111-4111-8111-111111111111";
  const S4 = "44444444-4444-4444-8444-444444444444";
  const S6 = "66666666-6664-4666-8666-666666666666";
  const S2 = "22222222-2222-4222-8222-222222222222";

  it("upgrades a C+B session to observed with summed cost/lines and last ctx%", async () => {
    const { store } = await bootWithPremium();
    const s = store.getSession(S1);
    expect(s?.tier.costBasis).toBe("observed");
    expect(s?.tier).toMatchObject({ hasCostSamples: true, hasTurnBoundaries: true });
    expect(s?.costObserved).toBeCloseTo(0.22); // Σ cost_delta_usd
    expect(s?.linesAdded).toBe(11);
    expect(s?.linesRemoved).toBe(3);
    expect(s?.contextPctObserved).toBeCloseTo(0.15); // last sample 15%
    // Observed apiMs is attributed onto the fleet-visible calls.
    expect(store.getCalls(S1).some((c) => c.apiMs !== undefined)).toBe(true);
  });

  it("lets C win over L for costObserved on a C+B+L session", async () => {
    const { store } = await bootWithPremium();
    const s = store.getSession(S4);
    expect(s?.tier).toMatchObject({
      hasCostSamples: true,
      hasTurnBoundaries: true,
      hasCostLog: true,
      costBasis: "observed",
    });
    expect(s?.costObserved).toBeCloseTo(1.85); // Σ C deltas, not L's 1.88
  });

  it("upgrades an L-only session to observed from its cost-log row", async () => {
    const { store } = await bootWithPremium();
    const s = store.getSession(S6);
    expect(s?.tier).toMatchObject({
      hasCostSamples: false,
      hasCostLog: true,
      costBasis: "observed",
    });
    expect(s?.costObserved).toBeCloseTo(0.75);
  });

  it("leaves a transcript-only session unchanged (control)", async () => {
    const { store } = await bootWithPremium();
    const s = store.getSession(S2);
    expect(s?.tier.costBasis).toBe("computed");
    expect(s?.costObserved).toBeUndefined();
    expect(s?.contextPctObserved).toBeUndefined();
    expect(store.getCalls(S2).every((c) => c.apiMs === undefined)).toBe(true);
  });
});
