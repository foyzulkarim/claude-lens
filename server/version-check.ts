import { createRequire } from "node:module";
import type { FastifyBaseLogger } from "fastify";
import type { VersionSnapshot } from "../shared/version-contract.js";

// esbuild inlines this at bundle time (server/cli.ts's `bundle: true` build
// treats a relative `require("...json")` as a static JSON import), so
// `dist/cli.js` embeds the published version with no runtime fs read and no
// need for `resolveJsonModule` in tsconfig.base.json — mirrors how
// `client/vite.config.ts` bakes `__APP_VERSION__` into the client bundle.
const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { name: string; version: string };

export const CURRENT_VERSION = packageJson.version;
export const PACKAGE_NAME = packageJson.name;

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

/** Structural timer handle — the real `setInterval` return value satisfies it with no cast. */
interface Timer {
  unref?(): void;
}

export interface VersionCheckerDeps {
  fetchFn?: typeof fetch;
  setIntervalFn?: (cb: () => void, delayMs: number) => Timer;
  clearIntervalFn?: (timer: Timer) => void;
  now?: () => number;
}

export interface VersionChecker {
  stop(): void;
  getSnapshot(): VersionSnapshot;
}

/**
 * Compares plain `x.y.z` versions (no prerelease tags in this repo's
 * history — a hand-rolled tuple compare avoids adding `semver` as a
 * dependency, which would mean editing the architecture doc's pinned
 * dependency list first). Missing trailing segments default to 0, so
 * "1.2" and "1.2.0" compare equal.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const currentParts = current.split(".").map(Number);
  const latestParts = latest.split(".").map(Number);
  const length = Math.max(currentParts.length, latestParts.length);
  for (let i = 0; i < length; i++) {
    const currentPart = currentParts[i] ?? 0;
    const latestPart = latestParts[i] ?? 0;
    if (latestPart > currentPart) return true;
    if (latestPart < currentPart) return false;
  }
  return false;
}

/**
 * Best-effort background poll of the npm registry (ARCH decision: no new
 * dependency, no blocking startup). Fires an immediate check, then
 * re-checks every 24h on an `unref`'d interval so it can never keep the
 * process alive. Any failure — network, timeout, non-2xx, malformed body —
 * is logged once and leaves the previous snapshot untouched; this must
 * never throw or crash the server, since this tool is expected to work
 * offline.
 */
export function startVersionChecker(
  log: Pick<FastifyBaseLogger, "warn">,
  deps: VersionCheckerDeps = {},
): VersionChecker {
  const fetchFn = deps.fetchFn ?? fetch;
  const setIntervalFn = deps.setIntervalFn ?? ((cb, delayMs) => setInterval(cb, delayMs));
  const clearIntervalFn =
    deps.clearIntervalFn ?? ((timer) => clearInterval(timer as ReturnType<typeof setInterval>));
  const now = deps.now ?? Date.now;

  let snapshot: VersionSnapshot = {
    currentVersion: CURRENT_VERSION,
    latestVersion: null,
    updateAvailable: false,
    lastCheckedAt: null,
  };

  async function check(): Promise<void> {
    try {
      const response = await fetchFn(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) return;
      const body = (await response.json()) as { version?: string };
      if (!body.version) return;
      snapshot = {
        currentVersion: CURRENT_VERSION,
        latestVersion: body.version,
        updateAvailable: isNewerVersion(CURRENT_VERSION, body.version),
        lastCheckedAt: now(),
      };
    } catch (err) {
      log.warn({ err }, "npm version check failed — update badge will stay hidden");
    }
  }

  void check();
  const timer = setIntervalFn(() => void check(), CHECK_INTERVAL_MS);
  timer.unref?.();

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearIntervalFn(timer);
    },
    getSnapshot: () => snapshot,
  };
}
