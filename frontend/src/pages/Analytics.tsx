import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/api/client";
import { axisProps, ChartTooltip, Legend, materialColor, sourceColor, useThemeColors } from "@/components/charts/chartKit";
import { ConfusionMatrix } from "@/components/charts/ConfusionMatrix";
import { EmptyState, ErrorState, LoadingBlock, Panel, Segmented, Stat, StatusPill } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { pct } from "@/lib/format";

export default function Analytics() {
  const isAdmin = useAuth((s) => s.user?.role === "ADMIN");
  const [scope, setScope] = useState<"me" | "all">("me");
  const [days, setDays] = useState("14");
  const q = useQuery({ queryKey: ["metrics", scope, days], queryFn: () => api.metrics(scope, Number(days)), refetchInterval: 15000 });
  const c = useThemeColors();
  const m = q.data;

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted">Aggregated from stored predictions — nothing here is synthetic.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {isAdmin && (
          <Segmented size="sm" label="Scope" value={scope} onChange={setScope} options={[{ value: "me", label: "My data" }, { value: "all", label: "All users" }]} />
        )}
        <Segmented size="sm" label="Time range" value={days} onChange={setDays} options={[{ value: "7", label: "7 d" }, { value: "14", label: "14 d" }, { value: "30", label: "30 d" }]} />
      </div>
    </div>
  );

  if (q.isLoading) return <div className="space-y-4">{header}<LoadingBlock className="min-h-[40vh]" /></div>;
  if (q.isError || !m) return <div className="space-y-4">{header}<ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;

  const materialData = m.material_distribution.filter((d) => d.count > 0 || d.material !== "Uncertain");
  const ev = m.labeled_evaluation;

  return (
    <div className="space-y-4">
      {header}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Predictions" value={m.total_predictions} />
        <Stat label="High confidence" value={m.confidence_levels.find((l) => l.level === "HIGH")?.count ?? 0} tone="good" />
        <Stat label="Uncertain" value={m.confidence_levels.find((l) => l.level === "LOW")?.count ?? 0} tone="bad" />
        <Stat label="Labelled accuracy" value={pct(ev.accuracy)} sub={`${ev.labeled_predictions} with ground truth`} tone="accent" />
        <Stat label="Latency p50" value={m.latency_ms.p50 !== null ? `${m.latency_ms.p50.toFixed(1)} ms` : "—"} />
        <Stat label="Latency p95" value={m.latency_ms.p95 !== null ? `${m.latency_ms.p95.toFixed(1)} ms` : "—"} />
      </div>

      {m.total_predictions === 0 ? (
        <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No predictions recorded yet">
          Run grasps in the Virtual Lab, simulate uploaded rows, or batch-process a dataset with “Record in history” to populate analytics.
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Predictions over time" subtitle={`Per day, stacked by data source (last ${days} days)`}>
            <div className="h-60">
              <ResponsiveContainer>
                <BarChart data={m.timeline} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={c["--chart-grid"]} />
                  <XAxis dataKey="date" {...axisProps(c)} tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis allowDecimals={false} {...axisProps(c)} />
                  <Tooltip cursor={{ fill: c["--chart-grid"] }} content={<ChartTooltip />} />
                  {(["SIMULATED", "UPLOADED", "LIVE"] as const).map((s, i) => (
                    <Bar key={s} dataKey={s} stackId="a" fill={sourceColor(c, s)} radius={i === 2 ? [4, 4, 0, 0] : 0} stroke={c["--surface"]} strokeWidth={1} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Legend items={["SIMULATED", "UPLOADED", "LIVE"].map((s) => ({ label: s, color: sourceColor(c, s) }))} />
          </Panel>

          <Panel title="Material distribution" subtitle="Predicted class (uncertain predictions counted separately)">
            <div className="h-60">
              <ResponsiveContainer>
                <BarChart data={materialData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={c["--chart-grid"]} />
                  <XAxis dataKey="material" {...axisProps(c)} />
                  <YAxis allowDecimals={false} {...axisProps(c)} />
                  <Tooltip cursor={{ fill: c["--chart-grid"] }} content={<ChartTooltip />} />
                  <Bar dataKey="count" name="Predictions" radius={[4, 4, 0, 0]} label={{ position: "top", fill: c["--text-2"], fontSize: 11 }}>
                    {materialData.map((d) => (
                      <Cell key={d.material} fill={materialColor(c, d.material)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Prediction confidence" subtitle="Distribution of max class probability (10 % bins)">
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={m.confidence_histogram} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={c["--chart-grid"]} />
                  <XAxis dataKey="bucket" {...axisProps(c)} interval={1} />
                  <YAxis allowDecimals={false} {...axisProps(c)} />
                  <Tooltip cursor={{ fill: c["--chart-grid"] }} content={<ChartTooltip />} />
                  <Bar dataKey="count" name="Predictions" radius={[4, 4, 0, 0]}>
                    {m.confidence_histogram.map((d) => (
                      <Cell key={d.bucket} fill={d.low >= 0.8 ? c["--good"] : d.low >= 0.6 ? c["--warn"] : c["--bad"]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Legend items={[{ label: "≥ 80 % high", color: c["--good"] }, { label: "60–79 % moderate", color: c["--warn"] }, { label: "< 60 % uncertain", color: c["--bad"] }]} />
          </Panel>

          <Panel title="Grip by material" subtitle="Mean commanded grip (normalised %) with min–max range">
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={m.grip_by_material.filter((g) => g.count)} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={c["--chart-grid"]} />
                  <XAxis dataKey="material" {...axisProps(c)} />
                  <YAxis domain={[0, 100]} {...axisProps(c)} />
                  <Tooltip
                    cursor={{ fill: c["--chart-grid"] }}
                    content={({ active, payload }) => {
                      const d = payload?.[0]?.payload as (typeof m.grip_by_material)[number] | undefined;
                      if (!active || !d) return null;
                      return (
                        <div className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-xs shadow-xl">
                          <div className="font-medium">{d.material}</div>
                          <div className="font-mono text-ink-2">
                            mean {d.mean_grip}% · range {d.min_grip}–{d.max_grip}% · n={d.count}
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="mean_grip" name="Mean grip" radius={[4, 4, 0, 0]}>
                    {m.grip_by_material.filter((g) => g.count).map((d) => (
                      <Cell key={d.material} fill={materialColor(c, d.material)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Data sources & safety">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Data source</h3>
                <ul className="space-y-2">
                  {m.source_distribution.map((s) => (
                    <li key={s.source} className="text-[13px]">
                      <div className="flex justify-between">
                        <span>{s.source}</span>
                        <span className="font-mono">{s.count}</span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-surface-3">
                        <div className="h-2 rounded-full" style={{ width: `${(s.count / m.total_predictions) * 100}%`, background: sourceColor(c, s.source) }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Safety status</h3>
                <ul className="space-y-2">
                  {m.safety_distribution.map((s) => (
                    <li key={s.status} className="flex items-center justify-between text-[13px]">
                      <StatusPill status={s.status} />
                      <span className="font-mono">
                        {s.count} <span className="text-muted">({pct(s.count / m.total_predictions, 0)})</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Panel>

          <Panel title="Accuracy on labelled predictions" subtitle="Simulated samples and uploaded rows that carried a ground-truth label">
            {ev.labeled_predictions ? (
              <ConfusionMatrix data={ev.confusion_matrix} />
            ) : (
              <EmptyState title="No labelled predictions yet">Simulated runs carry their true material; uploaded rows need a label column.</EmptyState>
            )}
          </Panel>
        </div>
      )}

      {m.model && (
        <Panel title="Model evaluation (held-out test set)" subtitle={`Active model ${m.model.version}`}>
          <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
            <div className="grid grid-cols-2 gap-2 self-start">
              <Stat label="Accuracy" value={pct(m.model.metrics.accuracy)} tone="accent" />
              <Stat label="Precision (macro)" value={pct(m.model.metrics.precision_macro)} />
              <Stat label="Recall (macro)" value={pct(m.model.metrics.recall_macro)} />
              <Stat label="F1 (macro)" value={pct(m.model.metrics.f1_macro)} />
            </div>
            <ConfusionMatrix data={m.model.confusion_matrix} />
          </div>
        </Panel>
      )}
    </div>
  );
}
