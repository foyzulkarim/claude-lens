import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuildBuild } from "esbuild";
import { build as viteBuild } from "vite";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const clientDir = join(rootDir, "client");
const distDir = join(rootDir, "dist");

async function main() {
  await rm(distDir, { recursive: true, force: true });

  await viteBuild({ root: clientDir });

  await esbuildBuild({
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
  });

  await mkdir(join(distDir, "public"), { recursive: true });
  await cp(join(clientDir, "dist"), join(distDir, "public"), { recursive: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
