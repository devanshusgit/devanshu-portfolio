import { useQuery } from "@tanstack/react-query";
import { Database, Play, Radio, RotateCcw, SlidersHorizontal, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { api } from "@/api/client";
import type { DataSource, Material } from "@/api/types";
import { ObjectPicker } from "@/components/hand/ObjectPicker";
import { SimulationWorkbench } from "@/components/hand/SimulationWorkbench";
import { Badge, Button, ErrorState, Field, Input, LoadingBlock, Notice, Panel, Segmented, Select, Toggle } from "@/components/ui";
import { useCatalog } from "@/lib/catalog";
import { FEATURE_ORDER, formatFeature, MATERIAL_ORDER } from "@/lib/format";
import { latestClassified, useLive } from "@/lib/live";
import { usePrefs, useReducedMotion } from "@/lib/prefs";
import { liveSource, simulatedSource, uploadedRowSource } from "@/sim/sources";
import { useGraspRun } from "@/sim/useGraspRun";

const SPEEDS = [0.5, 1, 2, 5];

export default function Lab() {
  const catalog = useCatalog();
  // Only the fields used here, so a theme switch does not re-render the 3D lab.
  const prefs = usePrefs(useShallow((s) => ({ default_object: s.default_object, playback_speed: s.playback_speed, auto_save_history: s.auto_save_history })));
  const reduced = useReducedMotion();
  const [source, setSource] = useState<DataSource>("SIMULATED");
  const [objectId, setObjectId] = useState(prefs.default_object || "glass");
  const [material, setMaterial] = useState<Material | "">("");
  const [speed, setSpeed] = useState<number>(prefs.playback_speed || 1);
  const [persist, setPersist] = useState(prefs.auto_save_history);
  const [advanced, setAdvanced] = useState(false);
  const [contactQuality, setContactQuality] = useState<number | null>(null);
  const [noise, setNoise] = useState(1);
  const [ambient, setAmbient] = useState<number | null>(null);
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [rowIndex, setRowIndex] = useState(0);
  const run = useGraspRun({ speed, reducedMotion: reduced });

  useEffect(() => setPersist(prefs.auto_save_history), [prefs.auto_save_history]);

  const object = catalog.objectById[objectId];
  const effectiveMaterial = (material || object?.default_material) as Material | undefined;

  const datasets = useQuery({ queryKey: ["datasets"], queryFn: api.datasets, enabled: source === "UPLOADED" });
  const dataset = datasets.data?.datasets.find((d) => d.id === datasetId) ?? datasets.data?.datasets[0];
  const rowQuery = useQuery({
    queryKey: ["dataset-row", dataset?.id, rowIndex],
    queryFn: () => api.datasetRows(dataset!.id, rowIndex, 1),
    enabled: source === "UPLOADED" && !!dataset,
  });
  const row = rowQuery.data?.rows[0];

  const live = useLive();
  const latestLive = useMemo(() => latestClassified(live.samples), [live.samples]);
  useEffect(() => {
    if (source === "LIVE") live.connect();
  }, [source]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = run.running;

  const start = (overrideObject?: string) => {
    const obj = overrideObject ?? objectId;
    if (overrideObject) setObjectId(overrideObject);
    if (source === "SIMULATED") {
      const mat = (overrideObject ? catalog.objectById[overrideObject]?.default_material : effectiveMaterial) as Material;
      run.run(
        simulatedSource({
          object_id: obj,
          material: mat,
          contact_quality: advanced ? contactQuality : null,
          noise_level: advanced ? noise : 1,
          ambient_temperature: advanced ? ambient : null,
          persist,
        }),
      );
    } else if (source === "UPLOADED" && dataset && row) {
      run.run(uploadedRowSource({ datasetId: dataset.id, datasetName: dataset.name, row, objectId: obj, persist, sourceDetail: "virtual_lab" }));
    } else if (source === "LIVE") {
      run.run(liveSource({ objectId: obj, persist }));
    }
  };

  if (catalog.error) return <ErrorState error={catalog.error} onRetry={catalog.refetch} title="Could not load the object catalogue" />;
  if (!catalog.ready) return <LoadingBlock label="Loading virtual lab…" className="min-h-[60vh]" />;

  const knownMaterial = source === "SIMULATED" ? (run.sample?.groundTruth ?? effectiveMaterial ?? null) : (run.sample?.groundTruth ?? null);

  const controls = (
    <Panel
      title="Experiment controls"
      icon={<SlidersHorizontal className="h-4 w-4" />}
      actions={
        <>
          <Segmented size="sm" label="Playback speed" value={String(speed)} onChange={(v) => setSpeed(Number(v))} options={SPEEDS.map((s) => ({ value: String(s), label: `${s}x` }))} />
          <Button size="sm" variant="ghost" onClick={run.reset} icon={<RotateCcw className="h-3.5 w-3.5" />}>
            Reset
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented
          label="Data source"
          value={source}
          onChange={(v) => {
            run.reset();
            setSource(v);
          }}
          options={[
            { value: "SIMULATED", label: "SIMULATED", icon: <Sparkles className="h-3.5 w-3.5" /> },
            { value: "UPLOADED", label: "UPLOAD DATA", icon: <Database className="h-3.5 w-3.5" /> },
            { value: "LIVE", label: "LIVE SENSOR", icon: <Radio className="h-3.5 w-3.5" /> },
          ]}
        />
        <ObjectPicker objects={catalog.objects} value={objectId} onChange={setObjectId} disabled={busy} />

        {source === "SIMULATED" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Object material (ground truth for the simulator)" htmlFor="mat" hint="The model never sees this label — it only sees the sensor reading.">
              <Select id="mat" value={material} onChange={(e) => setMaterial(e.target.value as Material | "")} disabled={busy}>
                <option value="">Default for object ({object?.default_material})</option>
                {MATERIAL_ORDER.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="space-y-2">
              <Toggle checked={advanced} onChange={setAdvanced} label="Sensor conditions" description="Degrade contact or add noise to test low-confidence handling." />
              <Toggle checked={persist} onChange={setPersist} label="Save to history" />
            </div>
            {advanced && (
              <div className="grid gap-3 rounded-xl border border-line bg-surface-2/50 p-3 sm:col-span-2 sm:grid-cols-3">
                <Field label={`Contact quality: ${contactQuality === null ? "random (realistic)" : contactQuality.toFixed(2)}`} htmlFor="cq">
                  <input id="cq" type="range" min={0.2} max={1} step={0.05} value={contactQuality ?? 1} onChange={(e) => setContactQuality(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
                </Field>
                <Field label={`Sensor noise: ${noise.toFixed(1)}×`} htmlFor="nz">
                  <input id="nz" type="range" min={0} max={4} step={0.1} value={noise} onChange={(e) => setNoise(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
                </Field>
                <Field label={`Ambient: ${ambient === null ? "random (22±2 °C)" : `${ambient} °C`}`} htmlFor="amb">
                  <input id="amb" type="range" min={-5} max={55} step={1} value={ambient ?? 22} onChange={(e) => setAmbient(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
                </Field>
                <div className="sm:col-span-3">
                  <Button size="sm" variant="ghost" onClick={() => { setContactQuality(null); setNoise(1); setAmbient(null); }}>
                    Restore realistic defaults
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {source === "UPLOADED" && (
          <div className="space-y-3">
            {datasets.isLoading && <LoadingBlock label="Loading datasets…" />}
            {datasets.data && datasets.data.datasets.length === 0 && (
              <Notice>
                No uploaded datasets yet. Upload a CSV/JSON in the <Link className="font-medium text-accent hover:underline" to="/data-studio">External Data Studio</Link>.
              </Notice>
            )}
            {dataset && (
              <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                <Field label="Dataset" htmlFor="ds">
                  <Select id="ds" value={dataset.id} onChange={(e) => { setDatasetId(Number(e.target.value)); setRowIndex(0); }}>
                    {datasets.data!.datasets.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.row_count} rows)
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={`Row (0–${dataset.row_count - 1})`} htmlFor="row">
                  <Input id="row" type="number" min={0} max={dataset.row_count - 1} value={rowIndex} onChange={(e) => setRowIndex(Math.max(0, Math.min(dataset.row_count - 1, Number(e.target.value) || 0)))} />
                </Field>
              </div>
            )}
            {row && (
              <div className="rounded-xl border border-line bg-surface-2/50 px-3 py-2 font-mono text-[12px] text-ink-2">
                row_id {row.row_id} · {FEATURE_ORDER.map((f) => `${f}=${formatFeature(f, row.features[f])}`).join(" · ")}
                {row.label && <> · label={row.label}</>} · <Badge tone={row.status === "invalid" ? "bad" : row.status === "warning" ? "warn" : "good"}>{row.status}</Badge>
              </div>
            )}
            <Toggle checked={persist} onChange={setPersist} label="Save to history" />
          </div>
        )}

        {source === "LIVE" && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={live.status?.connected ? "good" : "warn"} dot>
                {live.status?.connected ? "CONNECTED" : live.status?.state ?? "NO DATA"}
              </Badge>
              <Badge tone="neutral">transport: {live.transport}</Badge>
              {live.status?.connected && <Badge tone={live.status.is_simulated ? "violet" : "accent"}>{live.status.source}</Badge>}
              {live.status?.connected && <span className="font-mono text-xs text-muted">{live.status.rate_hz.toFixed(1)} Hz</span>}
            </div>
            {!live.status?.connected && (
              <Notice tone="warn">
                No live data is arriving. Start the <span className="font-medium">simulated live stream</span> or connect a device in the{" "}
                <Link to="/simulator" className="font-medium text-accent hover:underline">Sensor Simulator</Link>.
                <div className="mt-2">
                  <Button size="sm" onClick={() => api.streamStart().catch(() => undefined)} icon={<Radio className="h-3.5 w-3.5" />}>
                    Start simulated live stream
                  </Button>
                </div>
              </Notice>
            )}
            {latestLive && (
              <div className="rounded-xl border border-line bg-surface-2/50 px-3 py-2 font-mono text-[12px] text-ink-2">
                latest #{latestLive.seq} · {latestLive.prediction?.display_label} {((latestLive.prediction?.confidence ?? 0) * 100).toFixed(0)}% · {latestLive.source}
              </div>
            )}
            <Toggle checked={persist} onChange={setPersist} label="Save to history" />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button
            variant="primary"
            size="lg"
            onClick={() => start()}
            loading={busy}
            disabled={busy || (source === "UPLOADED" && (!row || row.status === "invalid"))}
            icon={<Play className="h-4 w-4" />}
            data-testid="run-grasp"
          >
            {source === "UPLOADED" ? "SIMULATE THIS SAMPLE" : source === "LIVE" ? "GRASP WITH LIVE SAMPLE" : "RUN GRASP SIMULATION"}
          </Button>
          {source === "SIMULATED" && (
            <>
              <Button disabled={busy} onClick={() => { setMaterial(""); start("glass"); }}>
                Demo 1: Glass
              </Button>
              <Button disabled={busy} onClick={() => { setMaterial(""); start("bottle"); }}>
                Demo 2: Bottle
              </Button>
            </>
          )}
        </div>
      </div>
    </Panel>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Virtual Prosthetic Lab</h1>
          <p className="text-sm text-muted">Every grasp sends a real sensor reading through the backend pipeline; the hand executes the returned command.</p>
        </div>
        <Badge tone="neutral">{catalog.gripNote ? "grip = normalised %" : ""}</Badge>
      </div>
      <SimulationWorkbench run={run} object={object} knownMaterial={knownMaterial} source={source} controls={controls} sceneHeight="h-[420px] lg:h-[480px]" />
    </div>
  );
}
