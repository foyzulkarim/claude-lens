import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Must match server/cli.ts's DEFAULT_PORT — the dev npm script pins the
// backend to this port so the proxy target is predictable.
const BACKEND_PORT = 4128;

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [tailwindcss()],
  server: {
    proxy: {
      "/api": `http://127.0.0.1:${BACKEND_PORT}`,
      "/ws": {
        target: `ws://127.0.0.1:${BACKEND_PORT}`,
        ws: true,
      },
    },
  },
});
