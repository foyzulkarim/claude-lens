import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

/**
 * Resolves the absolute path to the vendored `capture/` directory
 * (ARCH-producer-cost-capture-tier §Reachability path, decision A5).
 *
 * Two-candidate resolution relative to this module's own location — the same
 * `import.meta.url`-relative idiom `scripts/build.ts` uses for `rootDir`
 * (that derivation is single-candidate, since it never runs from a bundled
 * location):
 *   1. Dev / source-tree layout — this file lives at `server/capture-assets.ts`,
 *      so `../capture` is the repo-root `capture/` directory.
 *   2. Production bundle layout — esbuild bundles everything into one
 *      `dist/cli.js`, so `import.meta.url` there points at that file and
 *      `./capture` is `dist/capture` (populated by `scripts/build.ts`'s `cp`).
 *
 * Returns `null` rather than throwing when neither candidate exists (S7) —
 * a dev server started outside a build, or an install stripped of
 * `dist/capture`. The route surfaces that as a documented `null`, and the
 * guide renders manual fallback instructions instead of a broken path.
 */
export function resolveCaptureDir(): string | null {
  const candidates = [join(moduleDir, "..", "capture"), join(moduleDir, "capture")];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "install.sh"))) return candidate;
  }
  return null;
}
