import { useMutation, useQuery } from "@tanstack/react-query";
import { FlaskConical, Save, Sigma } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, errorMessage } from "@/api/client";
import type { FeatureName, Features, Material, PredictionResult } from "@/api/types";
import { axisProps, ChartTooltip, Legend, materialColor, useThemeColors } from "@/components/charts/chartKit";
import { HandScene } from "@/components/hand/HandScene";
import { ObjectPicker } from "@/components/hand/ObjectPicker";
import { GripPanel } from "@/components/prediction/GripPanel";
import { PredictionPanel } from "@/components/prediction/PredictionPanel";
import { Badge, Button, ErrorState, LoadingBlock, Notice, Panel, Select, SimulatedTag, Spinner } from "@/components/ui";
import { useCatalog } from "@/lib/catalog";
import { FEATURE_META, FEATURE_ORDER, formatFeature, formatSci, MATERIAL_ORDER } from "@/lib/format";
import { MotionController } from "@/sim/motion";

const RANGES: Record<FeatureName, { min: number; max: number; step: number; log?: boolean }> = {
  pressure: { min: 0, max: 400, step: 0.5 },
  temperature: { min: 0, max: 60, step: 0.05 },
  vibration: { min: 0, max: 6000, step: 1 },
  conductivity: { min: -13, max: 7, step: 0.05, log: true },
  contact_duration: { min: 0.02, max: 3, step: 0.005 },
};

const START: Features = { pressure: 230, temperature: 27.4, vibration: 2700, conductivity: 1.5e-12, contact_duration: 0.15 };

function FeatureSlider({ f, value, onChange }: { f: FeatureName; value: number; onChange: (v: number) => void }) {
  const r = RANGES[f];
  const sliderValue = r.log ? Math.log10(Math.max(value, 1e-15)) : value;
  return (
    <div className="grid grid-cols-[1fr_120px] items-center gap-3">
      <div>
        <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
          <label htmlFor={`exp-${f}`} className="font-medium text-ink">
            {FEATURE_META[f].label}
          </label>
          <span className="text-[11px] text-muted">{r.log ? "log scale" : `${r.min}–${r.max} ${FEATURE_META[f].unit}`}</span>
        </div>
        <input
          id={`exp-${f}`}
          type="range"
          min={r.min}
          max={r.max}
          step={r.step}
          value={sliderValue}
          onChange={(e) => onChange(r.log ? 10 ** Number(e.target.value) : Number(e.target.value))}
          className="w-full accent-[var(--accent)]"
          aria-valuetext={`${formatFeature(f, value)} ${FEATURE_META[f].unit}`}
        />
      </div>
      <div className="flex items-center gap-1">
        <input
          aria-label={`${FEATURE_META[f].label} exact value`}
          className="h-8 w-full rounded-md border border-line-strong bg-surface-2 px-2 text-right font-mono text-[12.5px] text-ink focus:border-accent focus:outline-none"
          value={r.log ? formatSci(value) : String(Math.round(value * 1000) / 1000)}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(v);
          }}
        />
        <span className="w-8 text-[10.5px] text-muted">{FEATURE_META[f].unit}</span>
      </div>
    </div>
  );
}

export default function Experiments() {
  const catalog = useCatalog();
  const c = useThemeColors();
  const info = useQuery({ queryKey: ["dataset-info"], queryFn: api.datasetInfo });
  const [features, setFeatures] = useState<Features>(START);
  const [objectId, setObjectId] = useState("glass");
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [sweepFeature, setSweepFeature] = useState<FeatureName>("conductivity");
  const motion = useMemo(() => {
    const m = new MotionController();
    m.set("approach", 1);
    m.set("closure", 1);
    m.set("sensors", 1);
    return m;
  }, []);

  const predict = useMutation({
    mutationFn: (f: Features) => api.predict({ features: f, data_source: "SIMULATED", source_detail: "experiments", object_id: objectId, persist: false }),
    onSuccess: (r) => {
      setResult(r);
      motion.set("squeeze", 0.25);
      motion.to("squeeze", 1, 500).catch(() => undefined);
    },
  });
  const save = useMutation({
    mutationFn: () => api.predict({ features, data_source: "SIMULATED", source_detail: "experiments", object_id: objectId, persist: true }),
  });
  const sweep = useMutation({
    mutationFn: () => {
      const r = RANGES[sweepFeature];
      return api.sweep({
        features,
        feature: sweepFeature,
        start: r.log ? 10 ** r.min : Math.max(r.min, sweepFeature === "contact_duration" ? 0.02 : 0),
        stop: r.log ? 10 ** r.max : r.max,
        steps: 60,
        object_id: objectId,
      });
    },
  });

  // Debounced: every change goes through the real backend pipeline.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => predict.mutate(features), 220);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [features, objectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTypical = (m: Material) => {
    const r = info.data?.class_feature_ranges[m];
    if (r) setFeatures(Object.fromEntries(FEATURE_ORDER.map((f) => [f, r[f].median])) as Features);
  };

  const sweepData = useMemo(
    () =>
      sweep.data?.points
        .filter((p) => p.valid)
        .map((p) => ({ x: sweep.data!.log_scale ? Math.log10(p.value) : p.value, value: p.value, grip: p.grip_percent, ...Object.fromEntries(Object.entries(p.probabilities ?? {}).map(([k, v]) => [k, v * 100])) })) ?? [],
    [sweep.data],
  );
  const currentX = RANGES[sweepFeature].log ? Math.log10(features[sweepFeature]) : features[sweepFeature];
  const object = catalog.objectById[objectId];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Experiments</h1>
          <p className="text-sm text-muted">Change sensor values and watch the real classifier, grip engine and hand respond. Each change is a backend pipeline call.</p>
        </div>
        <SimulatedTag label="MANUAL / SIMULATED INPUT" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          <Panel
            title="Sensor inputs"
            icon={<FlaskConical className="h-4 w-4" />}
            actions={
              <div className="flex items-center gap-2">
                {predict.isPending && <Spinner label="predicting…" />}
                <Button size="sm" onClick={() => save.mutate()} loading={save.isPending} icon={<Save className="h-3.5 w-3.5" />}>
                  Save to history
                </Button>
              </div>
            }
          >
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted">Load typical reading:</span>
              {MATERIAL_ORDER.map((m) => (
                <Button key={m} size="sm" variant="ghost" onClick={() => loadTypical(m)} disabled={!info.data}>
                  {m}
                </Button>
              ))}
            </div>
            <div className="space-y-3">
              {FEATURE_ORDER.map((f) => (
                <FeatureSlider key={f} f={f} value={features[f]} onChange={(v) => setFeatures((s) => ({ ...s, [f]: v }))} />
              ))}
            </div>
            {predict.isError && <ErrorState className="mt-3" title="Pipeline rejected the input" error={new Error(errorMessage(predict.error))} />}
            {save.isSuccess && <Notice tone="good" className="mt-3">Saved as history #{save.data.id}.</Notice>}
          </Panel>
          <Panel title="Hand response" subtitle="The hand holds the selected object with the grip commanded for the current input" bodyClassName="p-0" className="overflow-hidden">
            <div className="p-3">
              <ObjectPicker objects={catalog.objects} value={objectId} onChange={setObjectId} showMaterial={false} />
            </div>
            {object ? (
              <HandScene
                className="h-[340px] w-full"
                object={object}
                appearance={result ? result.prediction.material : "Unknown"}
                motion={motion}
                command={result?.command ?? null}
                compliance={result ? (catalog.materialByName[result.grip.material]?.compliance ?? 0) : 0}
                state="HOLDING"
              />
            ) : (
              <LoadingBlock className="h-[340px]" />
            )}
          </Panel>
          <Panel
            title="Sensitivity sweep"
            icon={<Sigma className="h-4 w-4" />}
            subtitle="Vary one feature across its range with the others fixed — every point is a real pipeline run (60 runs)"
            actions={
              <div className="flex items-center gap-2">
                <Select aria-label="Feature to sweep" value={sweepFeature} onChange={(e) => setSweepFeature(e.target.value as FeatureName)} className="h-8 w-44">
                  {FEATURE_ORDER.map((f) => (
                    <option key={f} value={f}>
                      {FEATURE_META[f].label}
                    </option>
                  ))}
                </Select>
                <Button size="sm" variant="primary" onClick={() => sweep.mutate()} loading={sweep.isPending}>
                  Run sweep
                </Button>
              </div>
            }
          >
            {sweep.isError && <ErrorState error={new Error(errorMessage(sweep.error))} />}
            {!sweep.data && !sweep.isPending && <p className="text-sm text-muted">Run a sweep to see how the class probabilities and the commanded grip change along one feature.</p>}
            {sweep.data && (
              <div className="space-y-3">
                <div className="h-56">
                  <ResponsiveContainer>
                    <LineChart data={sweepData} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid stroke={c["--chart-grid"]} vertical={false} />
                      <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} {...axisProps(c)} tickFormatter={(v: number) => (sweep.data!.log_scale ? `1e${v.toFixed(0)}` : String(Math.round(v)))} />
                      <YAxis domain={[0, 100]} {...axisProps(c)} unit="%" />
                      <Tooltip content={<ChartTooltip unit="%" formatter={(v) => v.toFixed(1)} />} labelFormatter={(v) => `${FEATURE_META[sweepFeature].label} ${sweep.data!.log_scale ? formatSci(10 ** Number(v)) : Number(v).toFixed(2)}`} />
                      <ReferenceLine x={currentX} stroke={c["--text-2"]} strokeDasharray="4 4" />
                      {MATERIAL_ORDER.map((m) => (
                        <Line key={m} type="monotone" dataKey={m} stroke={materialColor(c, m)} strokeWidth={2} dot={false} isAnimationActive={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <Legend items={MATERIAL_ORDER.map((m) => ({ label: `P(${m})`, color: materialColor(c, m) }))} />
                <div className="h-36">
                  <ResponsiveContainer>
                    <LineChart data={sweepData} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid stroke={c["--chart-grid"]} vertical={false} />
                      <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} {...axisProps(c)} tickFormatter={(v: number) => (sweep.data!.log_scale ? `1e${v.toFixed(0)}` : String(Math.round(v)))} />
                      <YAxis domain={[0, 100]} {...axisProps(c)} unit="%" />
                      <Tooltip content={<ChartTooltip unit="%" formatter={(v) => v.toFixed(1)} />} />
                      <ReferenceLine x={currentX} stroke={c["--text-2"]} strokeDasharray="4 4" />
                      <Line type="stepAfter" dataKey="grip" name="Commanded grip" stroke={c["--accent"]} strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-[11px] text-muted">
                  Top: class probabilities. Bottom: commanded grip (normalised %). Dashed line = current input. <Badge tone="neutral">{sweep.data.points.length} pipeline runs</Badge>
                </p>
              </div>
            )}
          </Panel>
        </div>
        <div className="min-w-0 space-y-4">
          <PredictionPanel result={result} pending={predict.isPending && !result} />
          <GripPanel result={result} />
        </div>
      </div>
    </div>
  );
}
