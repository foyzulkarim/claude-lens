// Runs on `npm install`/`npm ci`, including when this repo is installed as a
// git dependency (e.g. `npx github:foyzulkarim/claude-lens`). In that case
// this is the *only* lifecycle hook npm runs before linking the `claude-lens`
// bin, so it must produce `dist/cli.js` itself — dist/ is gitignored and
// carries no prebuilt copy in the repo.

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

if (!existsSync(new URL("../dist/cli.js", import.meta.url))) {
  execSync("npm run build", { cwd: rootDir, stdio: "inherit" });
}

// Contributor-only step; harmless to skip when there's no .git (e.g. this
// package cloned as a git dependency into another project).
if (existsSync(new URL("../.git", import.meta.url)) && process.env.HUSKY !== "0") {
  execSync("npx husky", { cwd: rootDir, stdio: "inherit" });
}
