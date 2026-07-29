import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Mirrors client/vite.config.ts's `define` — AppShell.tsx reads
// `__APP_VERSION__` at module scope, so any test that imports it (even
// transitively) needs the same global defined here.
const { version: appVersion } = JSON.parse(readFileSync("./package.json", "utf-8")) as {
  version: string;
};

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  test: {
    include: ["{shared,server,client,cypress,scripts,capture}/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "legacy/**", "dist/**"],
    passWithNoTests: true,
    setupFiles: ["./client/vitest.setup.ts"],
  },
});
