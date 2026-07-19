import clsx from "clsx";
import type { ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { FilterBar } from "../filters/FilterBar.js";
import { navRoutes } from "../routes.js";

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

  return (
    <div className="flex min-h-screen bg-white text-slate-900 dark:bg-[#0B0F14] dark:text-[#E8EDF2]">
      <nav className="w-56 shrink-0 border-r border-slate-200 p-4 dark:border-[#232B36]">
        <div className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-[#5A6675]">
          Claude Lens
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
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
