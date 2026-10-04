import { useMutation } from "@tanstack/react-query";
import { Activity, Cpu, PlugZap, Radio, Sparkles, Square, Unplug, Wifi } from "lucide-react";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, errorMessage } from "@/api/client";
import type { FeatureName, Material } from "@/api/types";
import { axisProps, ChartTooltip, useThemeColors } from "@/components/charts/chartKit";
import { ObjectPicker } from "@/components/hand/ObjectPicker";
import { Badge, Button, ErrorState, Field, KeyValue, LoadingBlock, MaterialLabel, Notice, Panel, Select, SimulatedTag, Stat, StatusPill } from "@/components/ui";
import { useCatalog } from "@/lib/catalog";
import { confidenceTone, FEATURE_META, FEATURE_ORDER, formatFeature, MATERIAL_ORDER, pct, relativeTime } from "@/lib/format";
import { useLive } from "@/lib/live";

function TelemetryChart({ feature, data, color }: { feature: FeatureName; data: { seq: number; v: number | null }[]; color: string }) {
  const c = useThemeColors();
  const log = feature === "conductivity";
  const last = [...data].reverse().find((d) => d.v !== null)?.v ?? null;
  return (
    <div className="rounded-xl border border-line bg-surface-2/50 p-2.5">
      <div className="flex items-baseline justify-between px-1">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{FEATURE_META[feature].label}</span>
        <span className="font-mono text-[13px] font-semibold tabular">
          {last === null ? "—" : log ? formatFeature(feature, 10 ** last) : formatFeature(feature, last)}
          <span className="ml-1 text-[10px] font-normal text-muted">{log ? "S/m (log axis)" : FEATURE_META[feature].unit}</span>
        </span>
      </div>
      <div className="h-24">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={c["--chart-grid"]} vertical={false} />
            <XAxis dataKey="seq" hide />
            <YAxis {...axisProps(c)} width={40} tickCount={4} tickFormatter={(v: number) => (log ? `1e${Math.round(v)}` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v * 10) / 10))} domain={log ? [-13, 8] : ["auto", "auto"]} allowDataOverflow={log} />
            <Tooltip content={<ChartTooltip formatter={(v) => (log ? formatFeature(feature, 10 ** v) : formatFeature(feature, v))} />} labelFormatter={(l) => `sample #${l}`} />
            <Line dataKey="v" name={FEATURE_META[feature].label} stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const CURL = `curl -X POST http://<host>:8000/api/sensors/data \\
  -H "X-Device-Key: $SENSOR_DEVICE_KEY" -H "Content-Type: application/json" \\
  -d '{"device_id":"esp32-fingertip-01","samples":[{"pressure":231.4,
       "temperature":27.1,"vibration":2810,"conductivity":1.8e-12,
       "contact_duration":0.142}]}'`;

export default function SensorSimulator() {
  const catalog = useCatalog();
  const c = useThemeColors();
  const live = useLive();
  const [material, setMaterial] = useState<Material | "">("");
  const [objectId, setObjectId] = useState("glass");
  const [contactQuality, setContactQuality] = useState<number | null>(null);
  const [noise, setNoise] = useState(1);
  const [rate, setRate] = useState("4");

  const sim = useMutation({
    mutationFn: () =>
      api.simulate({ object_id: objectId, material: material || null, contact_quality: contactQuality, noise_level: noise, persist: false, source_detail: "sensor_simulator" }),
  });
  const stream = useMutation({ mutationFn: (start: boolean) => (start ? api.streamStart(Number(rate)) : api.streamStop()) });

  const series = useMemo(() => {
    const recent = live.samples.slice(-120);
    return Object.fromEntries(
      FEATURE_ORDER.map((f) => [
        f,
        recent.map((s) => {
          const raw = s.features[f];
          const v = typeof raw === "number" ? raw : null;
          return { seq: s.seq, v: v === null ? null : f === "conductivity" ? Math.log10(Math.max(v, 1e-15)) : v };
        }),
      ]),
    ) as Record<FeatureName, { seq: number; v: number | null }[]>;
  }, [live.samples]);
  const feed = live.samples.slice(-14).reverse();
  const st = live.status;
  const colors = [c["--m-glass"], c["--m-wood"], c["--m-plastic"], c["--m-steel"], c["--m-fabric"]];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Sensor Simulator & Live Sensors</h1>
        <p className="text-sm text-muted">The sensor provider layer: a physics-inspired simulated fingertip, and the live channel that real hardware would use.</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <Panel title="Simulated sensor provider" icon={<Sparkles className="h-4 w-4" />} tag={<SimulatedTag label="SIMULATED SENSOR DATA" />}>
          {!catalog.ready ? (
            <LoadingBlock />
          ) : (
            <div className="space-y-4">
              <ObjectPicker objects={catalog.objects} value={objectId} onChange={setObjectId} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Material (ground truth)" htmlFor="sm-mat">
                  <Select id="sm-mat" value={material} onChange={(e) => setMaterial(e.target.value as Material | "")}>
                    <option value="">Object default ({catalog.objectById[objectId]?.default_material})</option>
                    {MATERIAL_ORDER.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={`Contact quality: ${contactQuality === null ? "realistic random" : contactQuality.toFixed(2)}`} htmlFor="sm-cq">
                  <input id="sm-cq" type="range" min={0.2} max={1} step={0.05} value={contactQuality ?? 1} onChange={(e) => setContactQuality(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
                </Field>
                <Field label={`Sensor noise: ${noise.toFixed(1)}×`} htmlFor="sm-nz">
                  <input id="sm-nz" type="range" min={0} max={4} step={0.1} value={noise} onChange={(e) => setNoise(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
                </Field>
              </div>
              <Button variant="primary" onClick={() => sim.mutate()} loading={sim.isPending} icon={<Activity className="h-4 w-4" />}>
                Acquire reading & run pipeline
              </Button>
              {sim.isError && <ErrorState error={new Error(errorMessage(sim.error))} />}
              {sim.data && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <h3 className="text-xs font-medium uppercase tracking-wider text-muted">Generated reading</h3>
                    <KeyValue items={FEATURE_ORDER.map((f) => [`${FEATURE_META[f].label} (${FEATURE_META[f].unit})`, formatFeature(f, sim.data.sample[f])])} />
                    <h3 className="pt-2 text-xs font-medium uppercase tracking-wider text-muted">Latent physics behind it</h3>
                    <KeyValue
                      items={[
                        ["Young’s modulus", `${Number(sim.data.reading?.provenance.latent_modulus_gpa).toPrecision(3)} GPa`],
                        ["Density", `${Number(sim.data.reading?.provenance.latent_density).toFixed(0)} kg/m³`],
                        ["Thermal effusivity", `${Number(sim.data.reading?.provenance.latent_effusivity).toFixed(0)} W·s½/m²K`],
                        ["log10 conductivity", Number(sim.data.reading?.provenance.latent_log10_conductivity).toFixed(2)],
                        ["Relaxation time", `${Number(sim.data.reading?.provenance.latent_relaxation_s).toFixed(3)} s`],
                        ["Ambient / humidity", `${Number(sim.data.reading?.provenance.env_ambient_temperature).toFixed(1)} °C · ${(Number(sim.data.reading?.provenance.env_humidity) * 100).toFixed(0)} %`],
                        ["Probe force / contact", `${Number(sim.data.reading?.provenance.env_probe_force).toFixed(2)} N · q=${Number(sim.data.reading?.provenance.env_contact_quality).toFixed(2)}`],
                        ["Surface variant", String(sim.data.reading?.provenance.variant ?? "standard")],
                      ]}
                    />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xs font-medium uppercase tracking-wider text-muted">Pipeline result</h3>
                    <div className="rounded-xl border border-line bg-surface-2/60 p-3">
                      <div className="flex items-center justify-between">
                        <MaterialLabel material={sim.data.prediction.display_label} className="text-xl font-semibold" />
                        <Badge tone={confidenceTone(sim.data.prediction.confidence_level)}>{pct(sim.data.prediction.confidence)}</Badge>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-sm">
                        <span>
                          Grip <span className="font-mono font-semibold">{sim.data.grip.grip_percent.toFixed(1)}%</span> · {sim.data.grip.grip_mode_label}
                        </span>
                        <StatusPill status={sim.data.grip.safety_status} />
                      </div>
                      <div className="mt-2 text-xs text-muted">
                        truth {sim.data.ground_truth} — <span className={sim.data.correct ? "text-good" : "text-bad"}>{sim.data.correct ? "correct" : "incorrect"}</span> · {sim.data.latency_ms.toFixed(1)} ms
                      </div>
                    </div>
                    <p className="text-[11.5px] text-muted">Lower the contact quality or raise the noise to see confidence drop and the grip engine switch to conservative behaviour.</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </Panel>

        <Panel
          title="Live sensor channel"
          icon={<Radio className="h-4 w-4" />}
          tag={<Badge tone={st?.connected ? "good" : st?.state === "STALE" ? "warn" : "neutral"} dot>{st?.connected ? "LIVE · CONNECTED" : st?.state ?? "NOT CONNECTED"}</Badge>}
        >
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {live.transport === "disconnected" ? (
                <Button size="sm" variant="primary" onClick={live.connect} icon={<PlugZap className="h-3.5 w-3.5" />} data-testid="live-connect">
                  Connect
                </Button>
              ) : (
                <Button size="sm" onClick={live.disconnect} icon={<Unplug className="h-3.5 w-3.5" />}>
                  Disconnect
                </Button>
              )}
              <Button size="sm" onClick={() => live.testConnection()} icon={<Wifi className="h-3.5 w-3.5" />}>
                Test connection
              </Button>
            </div>
            {live.lastTest && <Notice tone={live.lastTest.ok ? "good" : "bad"}>{live.lastTest.message}</Notice>}
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Transport" value={live.transport} mono={false} sub={live.error ?? "WebSocket /ws/sensors"} />
              <Stat label="Source" value={st?.last_source ? (st.is_simulated ? "SIMULATED" : "DEVICE") : "—"} mono={false} sub={st?.device_id ?? "no device"} tone={st?.is_simulated ? undefined : "accent"} />
              <Stat label="Data rate" value={`${(st?.rate_hz ?? 0).toFixed(1)} Hz`} />
              <Stat label="Samples received" value={st?.samples_received ?? 0} />
              <Stat label="Last update" value={relativeTime(st?.last_update)} mono={false} />
              <Stat label="Latency" value={live.latencyMs !== null ? `${live.latencyMs.toFixed(1)} ms` : "—"} sub="test round-trip" />
            </div>
            <div className="rounded-xl border border-accent-2/30 bg-accent-2/5 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-medium">Simulated live stream</span>
                <SimulatedTag label="NOT PHYSICAL HARDWARE" />
              </div>
              <p className="mb-2 text-[11.5px] text-muted">
                A server-side emulator that touches objects in sequence and pushes readings through the exact ingestion path a real device uses.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Select aria-label="Stream rate" value={rate} onChange={(e) => setRate(e.target.value)} className="h-8 w-24">
                  {["1", "2", "4", "8", "10"].map((r) => (
                    <option key={r} value={r}>
                      {r} Hz
                    </option>
                  ))}
                </Select>
                {st?.simulated_stream.running ? (
                  <Button size="sm" onClick={() => stream.mutate(false)} loading={stream.isPending} icon={<Square className="h-3.5 w-3.5" />}>
                    Stop stream
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    data-testid="stream-start"
                    onClick={() => {
                      live.connect();
                      stream.mutate(true);
                    }}
                    loading={stream.isPending}
                    icon={<Radio className="h-3.5 w-3.5" />}
                  >
                    Start simulated stream
                  </Button>
                )}
                {st?.simulated_stream.running && (
                  <span className="text-xs text-muted">touching: {st.simulated_stream.current_object ? `${st.simulated_stream.current_object} (${st.simulated_stream.current_material})` : "no contact"}</span>
                )}
              </div>
              {stream.isError && <p className="mt-2 text-sm text-bad">{errorMessage(stream.error)}</p>}
            </div>
          </div>
        </Panel>
      </div>

      <Panel
        title="Sensor telemetry"
        subtitle="Last 120 live samples (gaps = no contact). Each in-contact sample is classified by the same pipeline."
        tag={st?.connected ? (st.is_simulated ? <SimulatedTag label="SIMULATED LIVE STREAM" /> : <Badge tone="accent">EXTERNAL DEVICE</Badge>) : undefined}
      >
        {live.samples.length === 0 ? (
          <p className="text-sm text-muted">No live samples yet. Connect and start the simulated stream, or post from a device (see below).</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {FEATURE_ORDER.map((f, i) => (
              <TelemetryChart key={f} feature={f} data={series[f]} color={colors[i]} />
            ))}
          </div>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Panel title="Live predictions feed" subtitle="Newest first — telemetry is not saved to history (use the Lab’s LIVE mode to record a grasp)">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[12px]" data-testid="live-feed">
              <thead className="text-left text-[10.5px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="py-1.5">#</th>
                  <th className="py-1.5">Received</th>
                  <th className="py-1.5">Source</th>
                  <th className="py-1.5">Prediction</th>
                  <th className="px-2 py-1.5 text-right">Conf.</th>
                  <th className="px-2 py-1.5 text-right">Grip</th>
                  <th className="py-1.5">Safety</th>
                  <th className="py-1.5">Truth</th>
                </tr>
              </thead>
              <tbody>
                {feed.map((s) => (
                  <tr key={s.seq} className="border-t border-line">
                    <td className="py-1.5 font-mono text-muted">{s.seq}</td>
                    <td className="py-1.5 text-ink-2">{new Date(s.received_at).toLocaleTimeString()}</td>
                    <td className="max-w-[160px] truncate py-1.5 text-muted" title={s.source}>
                      {s.source}
                    </td>
                    {s.prediction ? (
                      <>
                        <td className="py-1.5">
                          <MaterialLabel material={s.prediction.display_label} />
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">{pct(s.prediction.confidence, 0)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{s.prediction.grip_percent.toFixed(0)}%</td>
                        <td className="py-1.5">
                          <StatusPill status={s.prediction.safety_status} />
                        </td>
                        <td className={s.prediction.correct ? "py-1.5 text-good" : s.prediction.correct === false ? "py-1.5 text-bad" : "py-1.5 text-muted"}>{s.ground_truth ?? "—"}</td>
                      </>
                    ) : (
                      <td colSpan={5} className="py-1.5 text-muted">
                        {s.errors[0]?.message ?? "not classified"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Connecting real hardware" icon={<Cpu className="h-4 w-4" />}>
          <div className="space-y-3 text-[13px] text-ink-2">
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11.5px]">
              <span className="text-muted">NOW</span>
              <span>Simulated sensor → Sensor provider → ML model → Grip engine → Virtual hand</span>
              <span className="text-muted">NEXT</span>
              <span>Real sensor → ESP32/Arduino → <span className="text-accent">LiveSensorProvider</span> → ML model → Grip engine → Motor controller → Physical hand</span>
            </div>
            <p>
              A device only needs to send readings; classification, grip and safety logic stay on the server unchanged. Authenticate with the <code className="font-mono">X-Device-Key</code> header
              (REST) or <code className="font-mono">?device_key=</code> (WebSocket, message <code className="font-mono">{`{"type":"sample","data":{…}}`}</code>).
            </p>
            <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-ink">{CURL}</pre>
            <p className="text-[12px] text-muted">
              The repository ships <code className="font-mono">backend/scripts/mock_sensor_device.py</code> (an external process that emulates an ESP32 over HTTP) and an ESP32 reference sketch in{" "}
              <code className="font-mono">hardware/</code>. Physical deployment would additionally require sensor calibration and hardware safety validation.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
