import { CostCaptureGuide } from "./settings/CostCaptureGuide.js";
import { PricingEditor } from "./settings/PricingEditor.js";
import { SavedViewsTagsPanel } from "./settings/SavedViewsTagsPanel.js";
import { ScanRootsEditor } from "./settings/ScanRootsEditor.js";
import { ThresholdsPanel } from "./settings/ThresholdsPanel.js";

/**
 * Settings page composition (#P4-15, pages spec §10). Five sections:
 * pricing table editor, labeled scan roots, budget/anomaly/gate
 * thresholds, saved views + tags manager, and the cost-capture setup
 * guide. Each panel owns its own query/mutation state (same
 * section-owned-queries pattern as every other Phase 4 page) so one
 * panel's error doesn't block its siblings from rendering.
 */
export function Settings() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-[#E8EDF2]">Settings</h1>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PricingEditor />
        <ScanRootsEditor />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ThresholdsPanel />
        <CostCaptureGuide />
      </div>

      <SavedViewsTagsPanel />
    </div>
  );
}
