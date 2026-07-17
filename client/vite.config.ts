import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import { resolveLanePorts } from "../scripts/ports.js";

const clientRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, repoRoot, ""), ...process.env };
  const ports = resolveLanePorts(env);
  return {
    root: clientRoot,
    plugins: [tailwindcss()],
    server: {
      port: ports.vite,
      strictPort: true,
      proxy: {
        "/api": `http://127.0.0.1:${ports.backend}`,
        "/ws": {
          target: `ws://127.0.0.1:${ports.backend}`,
          ws: true,
        },
      },
    },
  };
});
