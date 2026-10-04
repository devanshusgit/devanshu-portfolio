import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, History as HistoryIcon, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage, type HistoryFilters } from "@/api/client";
import { ProbabilityBars } from "@/components/prediction/PredictionPanel";
import { Badge, Button, Drawer, EmptyState, ErrorState, Input, KeyValue, LoadingBlock, MaterialLabel, Notice, Panel, Select, StatusPill } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { confidenceTone, dateTime, downloadText, FEATURE_META, FEATURE_ORDER, formatFeature, MATERIAL_ORDER, objectName, pct } from "@/lib/format";

const PAGE = 25;

function Detail({ id, onClose }: { id: number; onClose: () => void }) {
  const q = useQuery({ queryKey: ["history-item", id], queryFn: () => api.historyItem(id) });
  const h = q.data;
  return (
    <Drawer open onClose={onClose} title={`Prediction #${id}`}>
      {q.isLoading && <LoadingBlock />}
      {q.isError && <ErrorState error={q.error} />}
      {h && (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">{h.data_source}</Badge>
            {h.source_detail && <Badge>{h.source_detail}</Badge>}
            <StatusPill status={h.safety_status} />
            <span className="text-xs text-muted">{dateTime(h.created_at)}</span>
          </div>
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Sensor input</h3>
            <KeyValue items={FEATURE_ORDER.map((f) => [`${FEATURE_META[f].label} (${FEATURE_META[f].unit})`, formatFeature(f, h.features[f])])} />
          </section>
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Model output</h3>
            <div className="mb-2 flex items-center justify-between">
              <MaterialLabel material={h.display_label} className="text-lg font-semibold" />
              <Badge tone={confidenceTone(h.confidence_level)}>
                {pct(h.confidence)} {h.confidence_level}
              </Badge>
            </div>
            {h.probabilities && <ProbabilityBars probabilities={h.probabilities} highlight={h.predicted_material} />}
            {h.ground_truth && (
              <p className="mt-2 text-xs">
                Ground truth {h.ground_truth} — <span className={h.is_correct ? "text-good" : "text-bad"}>{h.is_correct ? "correct" : "incorrect"}</span>
              </p>
            )}
          </section>
          {h.grip_breakdown && (
            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Grip decision</h3>
              <KeyValue
                items={[
                  ["Base", `${h.grip_breakdown.base_grip.toFixed(1)}%`],
                  ["Sensor adjustment", `${h.grip_breakdown.sensor_adjustment.toFixed(1)}%`],
                  ["Fragility protection", `−${h.grip_breakdown.fragility_protection.toFixed(1)}%`],
                  ["Confidence adjustment", `${h.grip_breakdown.confidence_adjustment.toFixed(1)}%`],
                  ["Final grip", `${h.grip_percent.toFixed(1)}%`],
                  ["Mode / grasp", `${h.grip_mode} · ${h.grasp_type}`],
                  ["Object", objectName(h.object_id)],
                ]}
              />
              <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-[12.5px]">{h.grip_breakdown.action}</p>
              {h.safety_warnings && h.safety_warnings.length > 0 && (
                <ul className="mt-2 space-y-1 text-[12.5px]">
                  {h.safety_warnings.map((w) => (
                    <li key={w.code}>
                      <span className="font-mono text-[11px] font-semibold">{w.code}</span> — {w.message}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Provenance</h3>
            <KeyValue
              items={[
                ["Model version", h.model_version],
                ["Pipeline latency", `${h.latency_ms.toFixed(2)} ms`],
                ["Dataset / row", h.dataset_id ? `#${h.dataset_id} · ${h.row_ref}` : "—"],
                ["User", h.user_id ?? "—"],
              ]}
            />
          </section>
        </div>
      )}
    </Drawer>
  );
}

export default function History() {
  const qc = useQueryClient();
  const isAdmin = useAuth((s) => s.user?.role === "ADMIN");
  const [filters, setFilters] = useState<HistoryFilters>({ offset: 0, limit: PAGE });
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<number | null>(null);
  const q = useQuery({ queryKey: ["history", filters], queryFn: () => api.history(filters), placeholderData: (p) => p });
  const del = useMutation({ mutationFn: api.deleteHistory, onSuccess: () => qc.invalidateQueries({ queryKey: ["history"] }) });
  const exp = useMutation({
    mutationFn: async (format: "csv" | "json") => downloadText(`neurogrip_history.${format}`, await api.exportHistory(format, filters), format === "csv" ? "text/csv" : "application/json"),
  });
  const set = (patch: Partial<HistoryFilters>) => setFilters((f) => ({ ...f, ...patch, offset: 0 }));
  const offset = filters.offset ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Predictions / History</h1>
          <p className="text-sm text-muted">Every stored pipeline result, with its exact sensor input, model output and grip decision.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => exp.mutate("csv")} loading={exp.isPending && exp.variables === "csv"} icon={<Download className="h-3.5 w-3.5" />}>
            Export CSV
          </Button>
          <Button size="sm" onClick={() => exp.mutate("json")} loading={exp.isPending && exp.variables === "json"} icon={<Download className="h-3.5 w-3.5" />}>
            Export JSON
          </Button>
        </div>
      </div>
      {exp.isError && <ErrorState error={new Error(errorMessage(exp.error))} title="Export failed" />}
      <Panel bodyClassName="p-3">
        <form
          className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(4,1fr)_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            set({ q: search || undefined });
          }}
          aria-label="History filters"
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden />
            <Input aria-label="Search" placeholder="Search material, mode, object, row…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
          <Select aria-label="Data source" value={filters.source ?? ""} onChange={(e) => set({ source: e.target.value || undefined })}>
            <option value="">All sources</option>
            <option value="SIMULATED">Simulated</option>
            <option value="UPLOADED">Uploaded</option>
            <option value="LIVE">Live</option>
          </Select>
          <Select aria-label="Material" value={filters.material ?? ""} onChange={(e) => set({ material: e.target.value || undefined })}>
            <option value="">All materials</option>
            {MATERIAL_ORDER.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value="uncertain">Uncertain</option>
          </Select>
          <Select aria-label="Confidence" value={filters.confidence_level ?? ""} onChange={(e) => set({ confidence_level: e.target.value || undefined })}>
            <option value="">Any confidence</option>
            <option value="HIGH">High</option>
            <option value="MODERATE">Moderate</option>
            <option value="LOW">Low</option>
          </Select>
          <Select aria-label="Safety" value={filters.safety ?? ""} onChange={(e) => set({ safety: e.target.value || undefined })}>
            <option value="">Any safety</option>
            <option value="NOMINAL">Nominal</option>
            <option value="CAUTION">Caution</option>
            <option value="WARNING">Warning</option>
          </Select>
          <div className="flex items-center gap-2">
            <Button type="submit" size="md">
              Apply
            </Button>
            {isAdmin && (
              <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-2">
                <input type="checkbox" checked={!!filters.all_users} onChange={(e) => set({ all_users: e.target.checked || undefined })} className="accent-[var(--accent)]" /> all users
              </label>
            )}
          </div>
        </form>
      </Panel>

      <Panel bodyClassName="p-0">
        {q.isLoading && <LoadingBlock className="m-4" />}
        {q.isError && <ErrorState className="m-4" error={q.error} onRetry={() => q.refetch()} />}
        {q.data && q.data.total === 0 && (
          <EmptyState className="m-4" icon={<HistoryIcon className="h-6 w-6" />} title="No predictions match" action={<Link to="/lab" className="text-sm font-medium text-accent hover:underline">Run a grasp in the Virtual Lab →</Link>}>
            Results are stored here whenever a simulation, uploaded row or live sample is processed with “Save to history” on.
          </EmptyState>
        )}
        {q.data && q.data.total > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-[12.5px]" data-testid="history-table">
                <thead className="bg-surface-2 text-left text-[10.5px] uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-3 py-2.5">Date / time</th>
                    <th className="px-3 py-2.5">Source</th>
                    <th className="px-3 py-2.5">Material</th>
                    <th className="px-3 py-2.5 text-right">Confidence</th>
                    <th className="px-3 py-2.5 text-right">Grip</th>
                    <th className="px-3 py-2.5">Grip mode</th>
                    <th className="px-3 py-2.5">Safety</th>
                    <th className="px-3 py-2.5">Input (P · T · V)</th>
                    <th className="px-3 py-2.5">Truth</th>
                    <th className="px-3 py-2.5">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.items.map((h) => (
                    <tr key={h.id} className="border-t border-line hover:bg-surface-2/60">
                      <td className="whitespace-nowrap px-3 py-2 text-ink-2">{dateTime(h.created_at)}</td>
                      <td className="px-3 py-2">
                        <Badge tone="neutral">{h.data_source}</Badge>
                        <div className="mt-0.5 max-w-[140px] truncate text-[10.5px] text-muted">{h.source_detail}</div>
                      </td>
                      <td className="px-3 py-2">
                        <MaterialLabel material={h.display_label} className="font-medium" />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Badge tone={confidenceTone(h.confidence_level)}>{pct(h.confidence)}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular">{h.grip_percent.toFixed(1)}%</td>
                      <td className="px-3 py-2 text-ink-2">{h.grip_mode}</td>
                      <td className="px-3 py-2">
                        <StatusPill status={h.safety_status} />
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-muted">
                        {formatFeature("pressure", h.features.pressure)} · {formatFeature("temperature", h.features.temperature)} · {formatFeature("vibration", h.features.vibration)}
                      </td>
                      <td className="px-3 py-2">{h.ground_truth ? <span className={h.is_correct ? "text-good" : "text-bad"}>{h.ground_truth} {h.is_correct ? "✓" : "✕"}</span> : <span className="text-muted">—</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <Button size="sm" variant="ghost" aria-label={`View prediction ${h.id}`} onClick={() => setDetail(h.id)} icon={<Eye className="h-3.5 w-3.5" />} />
                        <Button size="sm" variant="ghost" aria-label={`Delete prediction ${h.id}`} onClick={() => confirm("Delete this prediction?") && del.mutate(h.id)} icon={<Trash2 className="h-3.5 w-3.5" />} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs text-muted">
              <span>
                {offset + 1}–{Math.min(offset + PAGE, q.data.total)} of {q.data.total}
              </span>
              <div className="flex gap-1.5">
                <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setFilters((f) => ({ ...f, offset: Math.max(0, offset - PAGE) }))}>
                  Previous
                </Button>
                <Button size="sm" variant="ghost" disabled={offset + PAGE >= q.data.total} onClick={() => setFilters((f) => ({ ...f, offset: offset + PAGE }))}>
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Panel>
      {del.isError && <Notice tone="bad">{errorMessage(del.error)}</Notice>}
      {detail !== null && <Detail id={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
