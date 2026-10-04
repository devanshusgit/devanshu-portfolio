import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, Download, FlaskConical, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, errorMessage } from "@/api/client";
import type { FeatureName } from "@/api/types";
import { axisProps, ChartTooltip, useThemeColors } from "@/components/charts/chartKit";
import { ConfusionMatrix } from "@/components/charts/ConfusionMatrix";
import { Badge, Button, ErrorState, Field, Input, KeyValue, LoadingBlock, MaterialLabel, Notice, Panel, Stat } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { dateTime, downloadText, FEATURE_META, formatFeature, MATERIAL_ORDER, pct } from "@/lib/format";

export default function ModelLab() {
  const qc = useQueryClient();
  const c = useThemeColors();
  const isAdmin = useAuth((s) => s.user?.role === "ADMIN");
  const status = useQuery({ queryKey: ["model-status"], queryFn: api.modelStatus });
  const info = useQuery({ queryKey: ["dataset-info", status.data?.version], queryFn: api.datasetInfo, enabled: !!status.data?.ready });
  const runs = useQuery({ queryKey: ["training-runs", status.data?.version], queryFn: api.trainingRuns });
  const [params, setParams] = useState({ n_samples: 4800, seed: 42, test_size: 0.2 });
  const train = useMutation({
    mutationFn: () => api.train(params),
    onSuccess: (d) => {
      qc.setQueryData(["model-status"], d);
      qc.invalidateQueries({ queryKey: ["health"] });
    },
  });
  const download = useMutation({ mutationFn: async () => downloadText("neurogrip_training_dataset.csv", await api.downloadTrainingDataset(), "text/csv") });

  if (status.isLoading) return <LoadingBlock label="Loading model status…" className="min-h-[50vh]" />;
  if (status.isError || !status.data) return <ErrorState error={status.error} onRetry={() => status.refetch()} />;
  const s = status.data;
  if (!s.ready) return <Notice tone="warn">The model is not loaded yet{s.training ? " — training in progress" : ""}. {s.error}</Notice>;

  const importance = Object.entries(s.feature_importances ?? {})
    .map(([f, v]) => ({ feature: FEATURE_META[f as FeatureName].label, value: v }))
    .sort((a, b) => b.value - a.value);
  const perClass = MATERIAL_ORDER.map((m) => ({ m, ...s.per_class![m] }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">ML Model</h1>
          <p className="text-sm text-muted">The material classifier as it is actually trained, persisted and evaluated.</p>
        </div>
        <Badge tone="violet">
          <BrainCircuit className="h-3 w-3" /> {s.version}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Accuracy" value={pct(s.metrics!.accuracy)} tone="accent" sub="held-out test set" />
        <Stat label="Precision" value={pct(s.metrics!.precision_macro)} sub="macro average" />
        <Stat label="Recall" value={pct(s.metrics!.recall_macro)} sub="macro average" />
        <Stat label="F1 score" value={pct(s.metrics!.f1_macro)} sub="macro average" />
        <Stat label="5-fold CV" value={pct(s.cross_validation!.mean)} sub={`± ${(s.cross_validation!.std * 100).toFixed(2)} pts`} />
        <Stat label="Training time" value={`${s.training_duration_s?.toFixed(2)} s`} sub={`trained ${dateTime(s.trained_at)}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Panel title="Model card" icon={<BrainCircuit className="h-4 w-4" />}>
          <KeyValue
            items={[
              ["Model type", s.model_type],
              ["Hyper-parameters", Object.entries(s.params ?? {}).map(([k, v]) => `${k}=${v}`).join(", ")],
              ["Pipeline", s.pipeline_steps?.join(" → ")],
              ["Classes", s.classes?.join(", ")],
              ["Features", s.features?.map((f) => `${f} (${s.feature_units?.[f]})`).join(", ")],
              ["Dataset size", `${s.dataset?.n_samples} samples (seed ${s.dataset?.seed})`],
              ["Train / test split", `${s.dataset?.train_size} / ${s.dataset?.test_count} (stratified, test_size=${s.dataset?.test_size})`],
              ["Persistence", "joblib (compressed), atomic swap on retrain"],
              ["scikit-learn", s.sklearn_version],
              ["Training status", s.training ? "training…" : "idle — model loaded"],
            ]}
          />
          <Notice className="mt-4">
            Trained on a <span className="font-medium text-ink">simulated</span>, physics-inspired dataset. These metrics describe performance on that simulation, not on
            real tactile hardware, which would require calibration and re-training on measured data.
          </Notice>
        </Panel>
        <Panel title="Confusion matrix" subtitle="Held-out test set — computed at training time">
          <ConfusionMatrix data={s.confusion_matrix!} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Per-class performance">
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[10.5px] uppercase tracking-wider text-muted">
              <tr>
                <th className="py-1">Class</th>
                <th className="py-1 text-right">Precision</th>
                <th className="py-1 text-right">Recall</th>
                <th className="py-1 text-right">F1</th>
                <th className="py-1 text-right">n</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular">
              {perClass.map((r) => (
                <tr key={r.m} className="border-t border-line">
                  <td className="py-1.5 font-sans">
                    <MaterialLabel material={r.m} />
                  </td>
                  <td className="text-right">{pct(r.precision)}</td>
                  <td className="text-right">{pct(r.recall)}</td>
                  <td className="text-right">{pct(r.f1)}</td>
                  <td className="text-right text-muted">{r.support}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Feature importance" subtitle="Mean decrease in impurity (random forest)">
          <div className="h-52">
            <ResponsiveContainer>
              <BarChart data={importance} layout="vertical" margin={{ top: 0, right: 30, left: 10, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke={c["--chart-grid"]} />
                <XAxis type="number" {...axisProps(c)} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
                <YAxis type="category" dataKey="feature" width={110} {...axisProps(c)} />
                <Tooltip cursor={{ fill: c["--chart-grid"] }} content={<ChartTooltip formatter={(v) => `${(v * 100).toFixed(1)}%`} />} />
                <Bar dataKey="value" name="Importance" fill={c["--accent"]} radius={[0, 4, 4, 0]} label={{ position: "right", fill: c["--text-2"], fontSize: 11, formatter: (v: unknown) => `${(Number(v) * 100).toFixed(0)}%` }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Is the confidence meaningful?" subtitle="Test-set accuracy within each confidence band">
          <ul className="space-y-2.5">
            {s.confidence_bands?.map((b) => (
              <li key={b.level} className="text-[13px]">
                <div className="flex justify-between">
                  <Badge tone={b.level === "HIGH" ? "good" : b.level === "MODERATE" ? "warn" : "bad"}>{b.level}</Badge>
                  <span className="font-mono text-ink-2">
                    {b.count} samples ({pct(b.share)}) · accuracy {pct(b.accuracy)}
                  </span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-surface-3">
                  <div className="h-2 rounded-full" style={{ width: `${(b.accuracy ?? 0) * 100}%`, background: b.level === "HIGH" ? c["--good"] : b.level === "MODERATE" ? c["--warn"] : c["--bad"] }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11.5px] text-muted">
            High-confidence predictions are far more often correct than low-confidence ones — which is why LOW confidence triggers conservative grip. A per-class novelty check
            (flags {pct(s.typicality_test_flag_rate)} of test samples) adds protection when the model is confident about atypical readings.
          </p>
        </Panel>
      </div>

      {info.data && (
        <Panel
          title="Training dataset"
          icon={<FlaskConical className="h-4 w-4" />}
          subtitle={info.data.generator}
          actions={
            <Button size="sm" onClick={() => download.mutate()} loading={download.isPending} icon={<Download className="h-3.5 w-3.5" />}>
              Download CSV ({info.data.n_samples} rows)
            </Button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[12px]">
              <thead className="text-left text-[10.5px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="py-1.5">Class (n)</th>
                  {info.data.features.map((f) => (
                    <th key={f.name} className="py-1.5 text-right">
                      {f.label} <span className="normal-case">({f.unit})</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MATERIAL_ORDER.map((m) => (
                  <tr key={m} className="border-t border-line">
                    <td className="py-1.5">
                      <MaterialLabel material={m} /> <span className="text-muted">({info.data!.class_counts[m]})</span>
                    </td>
                    {info.data!.features.map((f) => {
                      const r = info.data!.class_feature_ranges[m][f.name];
                      return (
                        <td key={f.name} className="py-1.5 text-right font-mono tabular text-ink-2" title="median (5th–95th percentile)">
                          {formatFeature(f.name, r.median)}
                          <span className="block text-[10px] text-muted">
                            {formatFeature(f.name, r.p05)}–{formatFeature(f.name, r.p95)}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11.5px] text-muted">
            Median and 5th–95th percentile of the training split. Readings are generated from latent physical properties (Young’s modulus, density, thermal effusivity, conductivity,
            viscoelastic relaxation) plus environment, contact quality and sensor noise; surface variants (painted steel, varnished wood, conductive rubber) create genuine class overlap.
          </p>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Train / retrain model" icon={<RefreshCw className="h-4 w-4" />} subtitle="Regenerates the dataset, trains, evaluates and atomically swaps the model">
          {!isAdmin && <Notice className="mb-3">Retraining is restricted to administrators.</Notice>}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Samples (3000–6000)" htmlFor="ns">
              <Input id="ns" type="number" min={3000} max={6000} step={100} value={params.n_samples} disabled={!isAdmin} onChange={(e) => setParams({ ...params, n_samples: Number(e.target.value) })} />
            </Field>
            <Field label="Random seed" htmlFor="seed">
              <Input id="seed" type="number" min={0} value={params.seed} disabled={!isAdmin} onChange={(e) => setParams({ ...params, seed: Number(e.target.value) })} />
            </Field>
            <Field label="Test split" htmlFor="ts">
              <Input id="ts" type="number" min={0.1} max={0.4} step={0.05} value={params.test_size} disabled={!isAdmin} onChange={(e) => setParams({ ...params, test_size: Number(e.target.value) })} />
            </Field>
          </div>
          <Button className="mt-3" variant="primary" disabled={!isAdmin} loading={train.isPending} onClick={() => train.mutate()} icon={<RefreshCw className="h-4 w-4" />}>
            TRAIN / RETRAIN MODEL
          </Button>
          {train.isError && <ErrorState className="mt-3" title="Training failed" error={new Error(errorMessage(train.error))} />}
          {train.isSuccess && (
            <Notice tone="good" className="mt-3">
              Trained {train.data.version}: accuracy {pct(train.data.metrics?.accuracy)}, F1 {pct(train.data.metrics?.f1_macro)} in {train.data.training_duration_s?.toFixed(2)} s.
            </Notice>
          )}
        </Panel>
        <Panel title="Training runs">
          {runs.isLoading && <LoadingBlock />}
          {runs.data && (
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-[12px]">
                <thead className="text-left text-[10.5px] uppercase tracking-wider text-muted">
                  <tr>
                    <th className="py-1">When</th>
                    <th className="py-1">Trigger</th>
                    <th className="py-1 text-right">n / seed</th>
                    <th className="py-1 text-right">Accuracy</th>
                    <th className="py-1 text-right">F1</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.data.runs.map((r) => (
                    <tr key={r.id} className="border-t border-line">
                      <td className="py-1.5 text-ink-2">{dateTime(r.created_at)}</td>
                      <td className="max-w-[160px] truncate py-1.5" title={r.triggered_by}>
                        {r.triggered_by}
                      </td>
                      <td className="py-1.5 text-right font-mono">
                        {r.n_samples} / {r.seed}
                      </td>
                      <td className="py-1.5 text-right font-mono">{pct(r.accuracy)}</td>
                      <td className="py-1.5 text-right font-mono">{pct(r.f1_macro)}</td>
                    </tr>
                  ))}
                  {runs.data.runs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-muted">
                        The current model was loaded from a persisted artifact; no runs recorded in this database yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
