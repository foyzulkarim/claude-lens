import { defineConfig } from "cypress";
import { build } from "esbuild";
import { appendJsonl } from "./cypress/node/append-jsonl.js";

export default defineConfig({
  e2e: {
    baseUrl: process.env.CLAUDE_LENS_E2E_BASE_URL,
    specPattern: "cypress/e2e/**/*.cy.ts",
    supportFile: false,
    // Review #17: 10s default command timeout. The previous 4s default
    // timed out `cy.injectAxe()` reading `node_modules/axe-core/axe.min.js`
    // (a ~250KB file) on cold disk-cache runs. Bumping to 10s leaves headroom
    // for axe injection while keeping the suite responsive on the happy
    // path — individual `should(...)` calls override this when they need
    // longer (e.g. polling for an async render).
    defaultCommandTimeout: 10_000,
    setupNodeEvents(on) {
      on("task", { appendJsonl });
      // Cypress's built-in webpack preprocessor currently relies on
      // TypeScript compiler internals removed by this repository's TS 7.
      // The project already uses esbuild for the packaged CLI, so compile the
      // browser-only specs with that stable, dependency-free boundary too.
      on("file:preprocessor", async (file) => {
        await build({
          entryPoints: [file.filePath],
          outfile: file.outputPath,
          bundle: true,
          format: "iife",
          platform: "browser",
          sourcemap: "inline",
        });
        return file.outputPath;
      });
    },
  },
  video: false,
});
