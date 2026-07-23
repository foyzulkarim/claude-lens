import type { FastifyInstance } from "fastify";
import type { CaptureAssets } from "../../shared/capture-assets-contract.js";
import { resolveCaptureDir } from "../capture-assets.js";

// GET /api/capture-assets (ARCH-producer-cost-capture-tier §API Contracts,
// decision A5) — mirrors the simple `/api/ping` shape (no body, no
// validation); the route exists purely to surface the resolved `capture/`
// path so `CostCaptureGuide.tsx` can render a real, runnable install
// command. The path is resolved once at registration time — it can't
// change while the server is running.

export interface RegisterCaptureAssetsRouteOptions {
  /** Test-only override; production always resolves via `resolveCaptureDir()`. */
  captureDir?: string | null;
}

export function registerCaptureAssetsRoute(
  app: FastifyInstance,
  options: RegisterCaptureAssetsRouteOptions = {},
): void {
  const captureDir = options.captureDir !== undefined ? options.captureDir : resolveCaptureDir();
  app.get("/api/capture-assets", async (): Promise<CaptureAssets> => ({ captureDir }));
}
