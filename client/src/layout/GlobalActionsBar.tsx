import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { parseFilters } from "../filters/state.js";
import { buildExportUrl, parseSessionsPageState } from "../pages/sessions/state.js";
import { TOGGLE_CLASS } from "../ui/toggleStyles.js";

/**
 * Global-layer action group (pages spec §0, ARCH-csv-json-export.md):
 * export current view (CSV/JSON) + copy permalink. Mounted once in
 * AppShell next to FilterBar. Every input is re-derived from the URL on
 * each render (same "URL is the only place state lives" convention as
 * FilterBar/useFilters) — no prop drilling from the Sessions page.
 *
 * Export is Sessions-only today (ARCH decision A3): the pages spec lists
 * "export current view" as a global-layer capability, but only Sessions
 * has a tabular current view to export. Copy-permalink is always
 * available — it's just the current URL.
 */
type PermalinkStatus = "idle" | "copied" | "error";

export function GlobalActionsBar() {
  const [location] = useLocation();
  const search = useSearch();
  const [permalinkStatus, setPermalinkStatus] = useState<PermalinkStatus>("idle");

  const isSessionsList = location === "/sessions";

  function triggerExport(format: "csv" | "json"): void {
    const filters = parseFilters(search);
    const pageState = parseSessionsPageState(search);
    const url = buildExportUrl(pageState, filters, format, new Date());
    const link = document.createElement("a");
    link.href = url;
    // download="": let the browser infer the filename from the response's
    // Content-Disposition header rather than hardcoding one here.
    link.download = "";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async function copyPermalink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setPermalinkStatus("copied");
    } catch {
      setPermalinkStatus("error");
    }
    setTimeout(() => setPermalinkStatus("idle"), 1500);
  }

  const permalinkLabel =
    permalinkStatus === "copied"
      ? "Copied!"
      : permalinkStatus === "error"
        ? "Copy failed"
        : "Copy permalink";

  return (
    <div
      role="toolbar"
      aria-label="Export actions"
      className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 dark:border-[#232B36] dark:bg-[#0B0F14]"
    >
      {isSessionsList && (
        <>
          <button
            type="button"
            onClick={() => triggerExport("csv")}
            className={TOGGLE_CLASS}
            aria-label="Export CSV"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => triggerExport("json")}
            className={TOGGLE_CLASS}
            aria-label="Export JSON"
          >
            Export JSON
          </button>
        </>
      )}
      <button type="button" onClick={() => void copyPermalink()} className={TOGGLE_CLASS}>
        <span aria-live="polite">{permalinkLabel}</span>
      </button>
    </div>
  );
}
