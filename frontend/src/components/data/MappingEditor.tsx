import { RotateCcw, Save, Table2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Dataset, DatasetMapping, FeatureName } from "@/api/types";
import { Badge, Button, Notice, Panel, Select } from "@/components/ui";
import { FEATURE_META, FEATURE_ORDER } from "@/lib/format";

const CONVERSIONS: Record<FeatureName, { value: string; label: string }[]> = {
  pressure: [
    { value: "pa_to_kpa", label: "Pa → kPa" },
    { value: "mpa_to_kpa", label: "MPa → kPa" },
    { value: "psi_to_kpa", label: "psi → kPa" },
    { value: "bar_to_kpa", label: "bar → kPa" },
  ],
  temperature: [
    { value: "f_to_c", label: "°F → °C" },
    { value: "k_to_c", label: "K → °C" },
  ],
  vibration: [{ value: "khz_to_hz", label: "kHz → Hz" }],
  conductivity: [
    { value: "reciprocal", label: "resistance/resistivity → 1/x" },
    { value: "us_cm_to_s_m", label: "µS/cm → S/m" },
  ],
  contact_duration: [{ value: "ms_to_s", label: "ms → s" }],
};

const QUALITY_TONE: Record<string, "good" | "accent" | "warn" | "violet"> = { exact: "good", alias: "accent", fuzzy: "warn", manual: "violet" };

export function MappingEditor({ dataset, onSave, onReset, saving }: { dataset: Dataset; onSave: (m: Partial<DatasetMapping> & { clear_label?: boolean; clear_id?: boolean }) => void; onReset: () => void; saving?: boolean }) {
  const [draft, setDraft] = useState<DatasetMapping>(dataset.mapping);
  useEffect(() => setDraft(dataset.mapping), [dataset.mapping]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(dataset.mapping);
  const used = new Set(Object.values(draft.features).filter(Boolean));

  return (
    <Panel
      title="Schema & column mapping"
      icon={<Table2 className="h-4 w-4" />}
      subtitle={dataset.mapping.auto ? "Detected automatically from column-name aliases" : "Manually mapped"}
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={onReset} icon={<RotateCcw className="h-3.5 w-3.5" />} disabled={saving}>
            Auto-detect
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!dirty}
            loading={saving}
            icon={<Save className="h-3.5 w-3.5" />}
            onClick={() =>
              onSave({
                features: draft.features,
                conversions: draft.conversions,
                label_column: draft.label_column ?? undefined,
                id_column: draft.id_column ?? undefined,
                clear_label: !draft.label_column,
                clear_id: !draft.id_column,
              })
            }
          >
            Apply mapping
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {FEATURE_ORDER.map((f) => {
          const col = draft.features[f];
          const q = dataset.mapping.features[f] === col ? dataset.mapping.quality[f] : col ? "manual" : null;
          return (
            <div key={f} className="grid grid-cols-[120px_1fr] items-center gap-2 sm:grid-cols-[140px_1fr_170px]">
              <label htmlFor={`map-${f}`} className="text-[13px] font-medium text-ink">
                {FEATURE_META[f].label} <span className="font-mono text-[10.5px] text-muted">{FEATURE_META[f].unit}</span>
              </label>
              <div className="flex items-center gap-2">
                <Select
                  id={`map-${f}`}
                  value={col ?? ""}
                  onChange={(e) => setDraft({ ...draft, features: { ...draft.features, [f]: e.target.value || null }, conversions: { ...draft.conversions, [f]: null } })}
                  className={!col ? "border-bad/50" : undefined}
                >
                  <option value="">— not mapped —</option>
                  {dataset.columns.map((c) => (
                    <option key={c} value={c} disabled={used.has(c) && c !== col}>
                      {c}
                    </option>
                  ))}
                </Select>
                {q ? <Badge tone={QUALITY_TONE[q] ?? "neutral"}>{q}</Badge> : <Badge tone="bad">missing</Badge>}
              </div>
              <Select
                aria-label={`${FEATURE_META[f].label} unit conversion`}
                value={draft.conversions[f] ?? ""}
                onChange={(e) => setDraft({ ...draft, conversions: { ...draft.conversions, [f]: e.target.value || null } })}
                className="col-span-2 sm:col-span-1"
              >
                <option value="">no conversion ({FEATURE_META[f].unit})</option>
                {CONVERSIONS[f].map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
          );
        })}
        <div className="grid gap-2 border-t border-line pt-3 sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <label htmlFor="map-label" className="w-24 shrink-0 text-[13px] text-ink-2">
              Label column
            </label>
            <Select id="map-label" value={draft.label_column ?? ""} onChange={(e) => setDraft({ ...draft, label_column: e.target.value || null })}>
              <option value="">none (no ground truth)</option>
              {dataset.columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="map-id" className="w-24 shrink-0 text-[13px] text-ink-2">
              Row ID column
            </label>
            <Select id="map-id" value={draft.id_column ?? ""} onChange={(e) => setDraft({ ...draft, id_column: e.target.value || null })}>
              <option value="">row number</option>
              {dataset.columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {dataset.mapping.notes.length > 0 && (
          <Notice tone="warn" className="mt-2">
            <ul className="list-disc space-y-0.5 pl-4">
              {dataset.mapping.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Notice>
        )}
      </div>
    </Panel>
  );
}
