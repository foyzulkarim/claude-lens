import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{shared,server,client,cypress,scripts,capture}/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "legacy/**", "dist/**"],
    passWithNoTests: true,
    setupFiles: ["./client/vitest.setup.ts"],
  },
});
