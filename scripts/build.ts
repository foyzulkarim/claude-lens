import { cp, mkdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuildBuild } from "esbuild";
import { build as viteBuild } from "vite";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const clientDir = join(rootDir, "client");
const distDir = join(rootDir, "dist");

async function main() {
  await rm(distDir, { recursive: true, force: true });

  try {
    await Promise.all([
      viteBuild({ root: clientDir }),
      esbuildBuild({
        entryPoints: [join(rootDir, "server/cli.ts")],
        outfile: join(distDir, "cli.js"),
        bundle: true,
        platform: "node",
        target: "node22",
        format: "esm",
        // Keep npm "dependencies" (fastify, pino-pretty, ...) unbundled: they're
        // installed as real node_modules packages at runtime, which is required
        // for pino-pretty's worker thread to resolve itself.
        packages: "external",
      }),
    ]);
  } catch (err) {
    // Don't leave a half-built dist/ (e.g. cli.js with no public/) that
    // could look like a successful build to a subsequent `node dist/cli.js`.
    await rm(distDir, { recursive: true, force: true });
    throw err;
  }

  await mkdir(join(distDir, "public"), { recursive: true });
  await cp(join(clientDir, "dist"), join(distDir, "public"), { recursive: true });

  // Producer-side cost-capture tier (ARCH-producer-cost-capture-tier §Reachability
  // path): vendored capture/ scripts ship inside the npm package so `npx`
  // installs (an unguessable ~/.npm/_npx/<hash>/... dir) can still find them
  // via server/capture-assets.ts's runtime path resolution. Tests and the
  // typecheck project file are repo-only — they have no runtime purpose in
  // a published package and would just be dead weight for end users.
  await cp(join(rootDir, "capture"), join(distDir, "capture"), {
    recursive: true,
    filter: (src) => !src.endsWith(".test.ts") && basename(src) !== "tsconfig.json",
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
