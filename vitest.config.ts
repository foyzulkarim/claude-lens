import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{shared,server,client}/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "legacy/**", "dist/**"],
    passWithNoTests: true,
  },
});
