import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { GateThresholds } from "../../../../shared/gates-contract.js";
import type { ScorecardThresholds } from "../../../../shared/scorecard-contract.js";
import { isValidScorecardThresholds } from "../../../../shared/settings-contract.js";
import { getConfig, putConfig } from "../../api/config.js";
import { qk } from "../../api/queryKeys.js";
import { TOGGLE_CLASS } from "../../ui/toggleStyles.js";
import { useConfigSyncedFormState } from "./useConfigSyncedFormState.js";

/** Mirrors `server/gates/thresholds.ts`'s `DEFAULT_GATE_THRESHOLDS` /
 * `specs/gates.md`'s "Configurable constants" table — duplicated as a
 * display-only fallback since the client can't import server code. */
const DEFAULT_GATE_THRESHOLDS: GateThresholds = {
  v2Repeat: 3,
  c3MaxChars: 15_000,
  k2Spike: 10_000,
  e2MaxChars: 4_000,
  e2MaxLines: 60,
};

/** Mirrors `server/scorecard/thresholds.ts`'s `DEFAULT_SCORECARD_THRESHOLDS`
 * / `specs/gates.md`'s "Grade thresholds and calibration" section —
 * duplicated as a display-only fallback for the same reason as
 * `DEFAULT_GATE_THRESHOLDS` above (the client can't import server code). */
const DEFAULT_SCORECARD_THRESHOLDS: ScorecardThresholds = {
  floorCalls: 10,
  calibrationMinSessions: 20,
  A: 95,
  B: 85,
  C: 70,
  D: 50,
};

const DEFAULT_ANOMALY_FACTOR = 5;

const GATE_FIELDS: { key: keyof GateThresholds; label: string }[] = [
  { key: "v2Repeat", label: "V2 repeat count" },
  { key: "c3MaxChars", label: "C3 max result chars" },
  { key: "k2Spike", label: "K2 spike floor (tokens)" },
  { key: "e2MaxChars", label: "E2 CLAUDE.md max chars" },
  { key: "e2MaxLines", label: "E2 CLAUDE.md max lines" },
];

/** Count fields (no upper bound — floor/calibration are call/session counts). */
const SCORECARD_COUNT_FIELDS: { key: "floorCalls" | "calibrationMinSessions"; label: string }[] = [
  { key: "floorCalls", label: "Scorecard grade floor (main-thread calls)" },
  { key: "calibrationMinSessions", label: "Scorecard calibration minimum (sessions)" },
];

/** Band fields — integer percentages in [0,100], ordered A > B > C > D. */
const SCORECARD_BAND_FIELDS: { key: "A" | "B" | "C" | "D"; label: string }[] = [
  { key: "A", label: "Scorecard band A (%, min)" },
  { key: "B", label: "Scorecard band B (%, min)" },
  { key: "C", label: "Scorecard band C (%, min)" },
  { key: "D", label: "Scorecard band D (%, min)" },
];

interface ThresholdsSeed {
  budgetInput: string;
  anomalyInput: string;
  gateThresholds: GateThresholds;
  scorecardThresholds: ScorecardThresholds;
}

function seedThresholds(cfg: object): ThresholdsSeed {
  const c = cfg as {
    budget?: number | null;
    anomalyFactor?: number;
    gateThresholds?: Partial<GateThresholds>;
    scorecardThresholds?: Partial<ScorecardThresholds>;
  };
  return {
    budgetInput: c.budget != null ? String(c.budget) : "",
    anomalyInput: c.anomalyFactor != null ? String(c.anomalyFactor) : "",
    gateThresholds: { ...DEFAULT_GATE_THRESHOLDS, ...(c.gateThresholds ?? {}) },
    scorecardThresholds: { ...DEFAULT_SCORECARD_THRESHOLDS, ...(c.scorecardThresholds ?? {}) },
  };
}

/**
 * Budget, anomaly multiplier, and gate thresholds (#P4-15, pages spec
 * §10). Three previously-separate config surfaces (#P4-10's budget,
 * #P4-11's gateThresholds, this task's anomalyFactor) combined into one
 * panel per the mockup's "Budget & thresholds" table.
 *
 * Shares the Settings-page dirty-guard (review #19) — the three fields are
 * written together with the rest of `AppConfig`, and a sibling panel's save
 * would otherwise refetch the shared `["config"]` query and clobber the
 * in-progress edits in this one. `useConfigSyncedFormState` flags dirty on
 * the first update and skips reseeding until `accept()` is called after a
 * successful save.
 */
export function ThresholdsPanel() {
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: qk.config(),
    queryFn: ({ signal }) => getConfig(signal),
  });

  const [seed, setSeed] = useState<ThresholdsSeed>({
    budgetInput: "",
    anomalyInput: "",
    gateThresholds: { ...DEFAULT_GATE_THRESHOLDS },
    scorecardThresholds: { ...DEFAULT_SCORECARD_THRESHOLDS },
  });
  const [validationError, setValidationError] = useState<string | null>(null);
  const sync = useConfigSyncedFormState<ThresholdsSeed>({
    data: configQuery.data,
    apply: seedThresholds,
    setRows: setSeed,
  });

  const { budgetInput, anomalyInput, gateThresholds, scorecardThresholds } = seed;

  const saveMutation = useMutation({
    mutationFn: (patch: {
      budget: number | null;
      anomalyFactor?: number;
      gateThresholds: GateThresholds;
      scorecardThresholds: ScorecardThresholds;
    }) => putConfig(patch),
    onSuccess: () => {
      sync.accept();
      queryClient.invalidateQueries({ queryKey: qk.prefixes.config });
      // Scorecard grades depend on scorecardThresholds — a floor/band edit
      // here can change every session's grade, so both scorecard query
      // shapes (session scorecard + fleet Biggest Lever) must refetch.
      queryClient.invalidateQueries({ queryKey: qk.prefixes.scorecard });
    },
  });

  function updateGateField(key: keyof GateThresholds, value: string): void {
    sync.markDirty();
    const n = Number(value);
    setSeed((prev) => ({
      ...prev,
      gateThresholds: {
        ...prev.gateThresholds,
        [key]: Number.isFinite(n) && n >= 0 ? Math.round(n) : 0,
      },
    }));
  }

  function updateScorecardCountField(
    key: "floorCalls" | "calibrationMinSessions",
    value: string,
  ): void {
    sync.markDirty();
    const n = Number(value);
    setSeed((prev) => ({
      ...prev,
      scorecardThresholds: {
        ...prev.scorecardThresholds,
        [key]: Number.isFinite(n) && n >= 0 ? Math.round(n) : 0,
      },
    }));
  }

  function updateScorecardBandField(key: "A" | "B" | "C" | "D", value: string): void {
    sync.markDirty();
    const n = Number(value);
    setSeed((prev) => ({
      ...prev,
      scorecardThresholds: {
        ...prev.scorecardThresholds,
        // Clamp to [0,100] as the user types (matches the server validator's
        // range check) — order violations (A <= B etc.) are NOT blocked here
        // so a user reordering bands one field at a time isn't fought
        // mid-edit; that check runs once at save (handleSave below), same
        // as the server's isValidScorecardThresholds.
        [key]: Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 0,
      },
    }));
  }

  function handleSave(): void {
    let budget: number | null = null;
    if (budgetInput.trim() !== "") {
      const parsed = Number(budgetInput);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setValidationError("Budget must be a positive number.");
        return;
      }
      budget = parsed;
    }

    let anomalyFactor: number | undefined;
    if (anomalyInput.trim() !== "") {
      const parsed = Number(anomalyInput);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setValidationError("Anomaly multiplier must be a positive number.");
        return;
      }
      anomalyFactor = parsed;
    }

    // Mirrors the server's isValidScorecardThresholds exactly (same
    // function, imported from shared/) so a save that would 400 is caught
    // here first — range [0,100] + safe-integer counts + pairwise A>B>C>D
    // order among the bands.
    if (!isValidScorecardThresholds(scorecardThresholds)) {
      setValidationError(
        "Scorecard thresholds must be integer percentages in 0-100 with A > B > C > D.",
      );
      return;
    }

    setValidationError(null);
    saveMutation.mutate({ budget, anomalyFactor, gateThresholds, scorecardThresholds });
  }

  const errorMessage =
    validationError ?? (saveMutation.isError ? (saveMutation.error?.message ?? null) : null);

  return (
    <section
      data-testid="thresholds-panel"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
          Budget &amp; thresholds
        </h2>
        <button
          type="button"
          onClick={handleSave}
          disabled={saveMutation.isPending || configQuery.isPending}
          className={TOGGLE_CLASS}
        >
          Save
        </button>
      </div>

      {configQuery.isPending && (
        <p role="status" className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]">
          Loading…
        </p>
      )}
      {configQuery.isError && (
        <p role="alert" className="mt-3 text-sm text-[#B23A3A] dark:text-[#E05252]">
          {configQuery.error.message}
        </p>
      )}
      {errorMessage && (
        <p role="alert" className="mt-2 text-xs text-[#B23A3A] dark:text-[#E05252]">
          {errorMessage}
        </p>
      )}

      {!configQuery.isPending && !configQuery.isError && (
        <table className="mt-3 w-full text-xs">
          <tbody>
            <tr className="border-t border-slate-100 dark:border-[#232B36]">
              <td className="py-1.5">
                <label htmlFor="settings-budget">Monthly budget ($)</label>
              </td>
              <td className="py-1.5 text-right">
                <input
                  id="settings-budget"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="not set"
                  value={budgetInput}
                  onChange={(e) => {
                    sync.markDirty();
                    setSeed((prev) => ({ ...prev, budgetInput: e.target.value }));
                  }}
                  className="w-24 rounded border border-slate-200 bg-transparent px-1 py-0.5 text-right dark:border-[#2A323D]"
                />
              </td>
            </tr>
            <tr className="border-t border-slate-100 dark:border-[#232B36]">
              <td className="py-1.5">
                <label htmlFor="settings-anomaly">Anomaly multiplier (× session median)</label>
              </td>
              <td className="py-1.5 text-right">
                <input
                  id="settings-anomaly"
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder={String(DEFAULT_ANOMALY_FACTOR)}
                  value={anomalyInput}
                  onChange={(e) => {
                    sync.markDirty();
                    setSeed((prev) => ({ ...prev, anomalyInput: e.target.value }));
                  }}
                  className="w-24 rounded border border-slate-200 bg-transparent px-1 py-0.5 text-right dark:border-[#2A323D]"
                />
              </td>
            </tr>
            <tr>
              <td colSpan={2} className="pt-3 pb-1">
                <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-[#8A96A5]">
                  Gate thresholds
                </h3>
              </td>
            </tr>
            {GATE_FIELDS.map((f) => (
              <tr key={f.key} className="border-t border-slate-100 dark:border-[#232B36]">
                <td className="py-1.5">
                  <label htmlFor={`settings-gate-${f.key}`}>{f.label}</label>
                </td>
                <td className="py-1.5 text-right">
                  <input
                    id={`settings-gate-${f.key}`}
                    type="number"
                    min="0"
                    step="1"
                    value={gateThresholds[f.key]}
                    onChange={(e) => updateGateField(f.key, e.target.value)}
                    className="w-24 rounded border border-slate-200 bg-transparent px-1 py-0.5 text-right dark:border-[#2A323D]"
                  />
                </td>
              </tr>
            ))}

            <tr>
              <td colSpan={2} className="pt-3 pb-1">
                <h3
                  data-testid="scorecard-thresholds-heading"
                  className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-[#8A96A5]"
                >
                  Cache Scorecard thresholds
                </h3>
              </td>
            </tr>
            {SCORECARD_COUNT_FIELDS.map((f) => (
              <tr key={f.key} className="border-t border-slate-100 dark:border-[#232B36]">
                <td className="py-1.5">
                  <label htmlFor={`settings-scorecard-${f.key}`}>{f.label}</label>
                </td>
                <td className="py-1.5 text-right">
                  <input
                    id={`settings-scorecard-${f.key}`}
                    type="number"
                    min="0"
                    step="1"
                    value={scorecardThresholds[f.key]}
                    onChange={(e) => updateScorecardCountField(f.key, e.target.value)}
                    className="w-24 rounded border border-slate-200 bg-transparent px-1 py-0.5 text-right dark:border-[#2A323D]"
                  />
                </td>
              </tr>
            ))}
            {SCORECARD_BAND_FIELDS.map((f) => (
              <tr key={f.key} className="border-t border-slate-100 dark:border-[#232B36]">
                <td className="py-1.5">
                  <label htmlFor={`settings-scorecard-${f.key}`}>{f.label}</label>
                </td>
                <td className="py-1.5 text-right">
                  <input
                    id={`settings-scorecard-${f.key}`}
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={scorecardThresholds[f.key]}
                    onChange={(e) => updateScorecardBandField(f.key, e.target.value)}
                    className="w-24 rounded border border-slate-200 bg-transparent px-1 py-0.5 text-right dark:border-[#2A323D]"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
