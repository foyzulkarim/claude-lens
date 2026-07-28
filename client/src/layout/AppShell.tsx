import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import type { ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { qk } from "../api/queryKeys.js";
import { fetchVersion } from "../api/version.js";
import { Badge } from "../components/Badge.js";
import { FilterBar } from "../filters/FilterBar.js";
import { navRoutes } from "../routes.js";
import { GlobalActionsBar } from "./GlobalActionsBar.js";

const VERSION_CHECK_STALE_MS = 30 * 60 * 1000;

// Minimal nav chrome — deliberately unstyled beyond Tailwind base. The real
// primitives (stat-card, data-table, etc.) land in #P4-1; this just proves
// navigation works (ARCH-react-shell.md acceptance criterion S1).
export function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  // Nav links must carry the current query string forward — plain
  // `href={route.path}` drops it, which would silently violate the global
  // filter bar's "filters persist across page navigation" requirement
  // (#P3-3 acceptance criterion) the moment a user clicks a sidebar link.
  const search = useSearch();
  // `retry: false` — a failed npm-registry check has nothing useful to
  // retry against; on error/loading, rendering no badge is the correct
  // "don't know" state, same "never show a misleading value" discipline
  // as the tier system (architecture §4).
  const { data: version } = useQuery({
    queryKey: qk.version(),
    queryFn: ({ signal }) => fetchVersion(signal),
    staleTime: VERSION_CHECK_STALE_MS,
    retry: false,
  });

  return (
    <div className="flex min-h-screen bg-white text-slate-900 dark:bg-[#0B0F14] dark:text-[#E8EDF2]">
      <nav className="w-56 shrink-0 border-r border-slate-200 p-4 dark:border-[#232B36]">
        <div className="mb-4 flex items-baseline justify-between text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-[#5A6675]">
          <span>Claude Lens</span>
          <span className="flex items-center gap-1.5">
            <span className="text-xs font-normal normal-case text-slate-400 dark:text-[#5A6675]">
              v{__APP_VERSION__}
            </span>
            {version?.updateAvailable && (
              <Badge variant="warn" aria-label={`Update available: v${version.latestVersion}`}>
                update available
              </Badge>
            )}
          </span>
        </div>
        <ul className="flex flex-col gap-1">
          {navRoutes.map((route) => (
            <li key={route.path}>
              <Link
                href={search ? `${route.path}?${search}` : route.path}
                className={clsx(
                  "block rounded px-2 py-1 text-sm",
                  location === route.path
                    ? "bg-slate-100 font-medium dark:bg-[#151A21]"
                    : "text-slate-600 hover:bg-slate-50 dark:text-[#8A96A5] dark:hover:bg-[#151A21]",
                )}
              >
                {route.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex flex-1 flex-col">
        <FilterBar />
        <GlobalActionsBar />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
