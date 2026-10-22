import { useQuery } from "@tanstack/react-query";
import { Camera, Database, Play, Radio, RotateCcw, SlidersHorizontal, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { api, errorMessage } from "@/api/client";
import type { DataSource, Material, PredictionResult } from "@/api/types";
import type { HandState } from "@/sim/stateMachine";
import { WebcamControl, type WebcamFrame } from "@/components/hand/WebcamControl";
import type { ObjectGuess } from "@/lib/objectMap";
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

type LabSource = DataSource | "WEBCAM";

/** Webcam mode: fingers touch the object at this much hand closure; closing further asks for grip force. */
const CONTACT_AT = 0.4;

export default function Lab() {
  const catalog = useCatalog();
  // Only the fields used here, so a theme switch does not re-render the 3D lab.
  const prefs = usePrefs(useShallow((s) => ({ default_object: s.default_object, playback_speed: s.playback_speed, auto_save_history: s.auto_save_history })));
  const reduced = useReducedMotion();
  const [source, setSource] = useState<LabSource>("SIMULATED");
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

  // WEBCAM: the user's real hand (MediaPipe landmarks) is the grip command; the AI pipeline
  // decides the material and the safe grip limit, and the hand never exceeds that limit.
  const [camResult, setCamResult] = useState<PredictionResult | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [camView, setCamView] = useState<{ closure: number | null; intent: number; applied: number }>({ closure: null, intent: 0, applied: 0 });
  const [camSense, setCamSense] = useState(0);
  const [autoDetect, setAutoDetect] = useState(true);
  type CamEvent = { id: number; at: Date; guess: ObjectGuess; result: PredictionResult | null };
  const [camEvents, setCamEvents] = useState<CamEvent[]>([]);
  const pendingEvent = useRef<number | null>(null);
  const camResultRef = useRef<PredictionResult | null>(null);
  camResultRef.current = camResult;
  const camShownAt = useRef(0);
  useEffect(() => {
    if (source !== "WEBCAM") return;
    let cancelled = false;
    setCamError(null);
    api
      .simulate({
        object_id: objectId,
        material: material || null,
        contact_quality: 0.95,
        // Readings triggered by a camera detection are saved, so History shows each live event.
        persist: pendingEvent.current !== null,
        source_detail: pendingEvent.current !== null ? "webcam_auto_detect" : "webcam_control",
      })
      .then((r) => {
        if (cancelled) return;
        setCamResult(r);
        const evId = pendingEvent.current;
        pendingEvent.current = null;
        if (evId !== null) setCamEvents((evs) => evs.map((e) => (e.id === evId ? { ...e, result: r } : e)));
      })
      .catch((e) => !cancelled && setCamError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [source, objectId, material, camSense]);
  useEffect(() => {
    if (source !== "WEBCAM") return;
    run.reset();
    const id = setTimeout(() => run.motion.to("approach", 1, 1000).catch(() => undefined), 750);
    return () => {
      clearTimeout(id);
      run.reset();
    };
  }, [source]); // eslint-disable-line react-hooks/exhaustive-deps

  const onCamObject = (guess: ObjectGuess) => {
    const id = Date.now();
    pendingEvent.current = id;
    setCamEvents((evs) => [{ id, at: new Date(), guess, result: null }, ...evs].slice(0, 6));
    setObjectId(guess.objectId);
    setMaterial(guess.material);
    setCamSense((n) => n + 1);
  };

  const onCamFrame = (f: WebcamFrame) => {
    const m = run.motion;
    const allowed = camResultRef.current?.grip.grip_percent ?? 0;
    const c = f.closure ?? 0;
    const intent = Math.max(0, (c - CONTACT_AT) / (1 - CONTACT_AT)) * 100;
    const applied = Math.min(intent, allowed);
    m.set("closure", Math.min(1, c / CONTACT_AT));
    m.set("squeeze", allowed > 0 ? applied / allowed : 0);
    m.set("sensors", c >= CONTACT_AT ? 1 : 0.25);
    const now = performance.now();
    if (now - camShownAt.current > 90 || f.closure === null) {
      camShownAt.current = now;
      setCamView({ closure: f.closure, intent, applied });
    }
  };
  const camAllowed = camResult?.grip.grip_percent ?? 0;
  const camLimited = camView.closure !== null && camView.intent > camAllowed + 0.5;
  const camState: HandState = !camResult || camView.closure === null ? "IDLE" : camView.closure < CONTACT_AT ? "OPEN" : camLimited || camView.applied >= camAllowed - 0.5 ? "HOLDING" : "GRIPPING";


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
            { value: "WEBCAM", label: "WEBCAM CONTROL", icon: <Camera className="h-3.5 w-3.5" /> },
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

        {source === "WEBCAM" && (
          <div className="space-y-3" data-testid="webcam-panel">
            <WebcamControl onFrame={onCamFrame} onObject={onCamObject} detectObjects={autoDetect} />
            <Toggle
              checked={autoDetect}
              onChange={setAutoDetect}
              label="Recognise objects automatically"
              description="Hold an object (bottle, cup, glass, spoon, scissors, ball, phone, book…) in front of the camera."
            />
            {camError && <Notice tone="bad">{camError}</Notice>}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-line bg-surface-2/50 p-3">
                <div className="text-xs text-muted">Your grip command (webcam)</div>
                <div className="font-mono text-2xl font-semibold">{camView.closure === null ? "–" : `${camView.intent.toFixed(0)}%`}</div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full bg-accent" style={{ width: `${camView.closure === null ? 0 : camView.intent}%` }} />
                </div>
                <div className="mt-1 text-[11px] text-muted">hand closed {camView.closure === null ? "–" : `${(camView.closure * 100).toFixed(0)}%`}</div>
              </div>
              <div className="rounded-xl border border-line bg-surface-2/50 p-3">
                <div className="text-xs text-muted">NeuroGrip safe limit (AI)</div>
                <div className="font-mono text-2xl font-semibold">{camResult ? `${camAllowed.toFixed(0)}%` : "…"}</div>
                <div className="mt-1 text-[11px] text-muted">
                  {camResult ? `${camResult.prediction.display_label} · ${(camResult.prediction.confidence * 100).toFixed(0)}% · ${camResult.grip.grip_mode}` : "sensing object…"}
                </div>
              </div>
              <div className={`rounded-xl border p-3 ${camLimited ? "border-warn/60 bg-warn/10" : "border-line bg-surface-2/50"}`}>
                <div className="text-xs text-muted">Grip applied by the hand</div>
                <div className="font-mono text-2xl font-semibold">{camView.closure === null ? "–" : `${camView.applied.toFixed(0)}%`}</div>
                <div className="mt-1 text-[11px]">{camLimited ? <span className="font-medium text-warn">LIMITED BY SAFETY: {camResult?.prediction.display_label} is protected</span> : <span className="text-muted">follows your hand</span>}</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setCamSense((n) => n + 1)} icon={<Sparkles className="h-3.5 w-3.5" />}>
                Re-sense object
              </Button>
              <span className="text-xs text-muted">
                {autoDetect ? "Show an object to the camera, then close your hand around it." : "Pick an object above. Open your hand, then slowly close it into a fist in front of the camera."}
              </span>
            </div>
            {camEvents.length > 0 && (
              <div className="space-y-1" data-testid="camera-events">
                <div className="text-xs font-medium uppercase tracking-wide text-muted">Live camera events</div>
                {camEvents.map((e) => (
                  <div key={e.id} className="flex flex-wrap justify-between gap-2 rounded-xl border border-line bg-surface-2/50 px-3 py-1.5 font-mono text-[12px] text-ink-2">
                    <span>
                      {e.at.toLocaleTimeString()} · camera saw <span className="font-semibold text-ink">{e.guess.coco}</span> {(e.guess.score * 100).toFixed(0)}% → {e.guess.label}
                    </span>
                    <span>
                      {e.result
                        ? `AI: ${e.result.prediction.display_label} ${(e.result.prediction.confidence * 100).toFixed(0)}% · safe grip ${e.result.grip.grip_percent.toFixed(0)}%${e.result.id ? ` · saved #${e.result.id}` : ""}`
                        : "analysing…"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className={source === "WEBCAM" ? "hidden" : "flex flex-wrap items-center gap-2 border-t border-line pt-4"}>
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
      <SimulationWorkbench run={source === "WEBCAM" ? { ...run, result: camResult, state: camState, visits: [] } : run} object={object} knownMaterial={knownMaterial} source={source === "WEBCAM" ? "LIVE" : source} controls={controls} sceneHeight="h-[420px] lg:h-[480px]" />
    </div>
  );
}
