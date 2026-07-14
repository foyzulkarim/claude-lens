import { QueryClient } from "@tanstack/react-query";

// One QueryClient per app instance (composition root: main.tsx). Defaults are
// TanStack's own; WS-driven invalidation (ws.ts) is what keeps data fresh, so
// no aggressive refetch-on-window-focus tuning is needed here yet.
export function createQueryClient(): QueryClient {
  return new QueryClient();
}
