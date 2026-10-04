import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BrainCircuit, Database, Hand, Radio, Server } from "lucide-react";
import { Link } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/api/client";
import { axisProps, ChartTooltip, useThemeColors } from "@/components/charts/chartKit";
import { useLatestSimulation } from "@/components/hand/SimulationWorkbench";
import { SensorReadout } from "@/components/telemetry/SensorReadout";
import { Badge, EmptyState, ErrorState, KeyValue, LoadingBlock, MaterialLabel, Panel, Stat, StatusPill } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { confidenceTone, pct, relativeTime } from "@/lib/format";
import { useLive } from "@/lib/live";

function QuickLink({ to, icon, title, text }: { to: string; icon: React.ReactNode; title: string; text: string }) {
  return (
    <Link to={to} className="group flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 shadow-panel transition-colors hover:border-accent/50">
      <span className="rounded-lg bg-accent-soft p-2 text-accent">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 font-medium text-ink">
          {title} <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
        <span className="block text-xs text-muted">{text}</span>
      </span>
    </Link>
  );
}

export default function Dashboard() {
  const user = useAuth((s) => s.user);
  const c = useThemeColors();
  const latestSim = useLatestSimulation();
  const live = useLive((s) => s.status);
  const history = useQuery({ queryKey: ["history", "dashboard"], queryFn: () => api.history({ limit: 30, offset: 0 }), refetchInterval: 10000 });
  const model = useQuery({ queryKey: ["model-status"], queryFn: api.modelStatus });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 15000 });
  const metrics = useQuery({ queryKey: ["metrics", "me", "14"], queryFn: () => api.metrics("me", 14) });

  const lastStored = history.data?.items[0];
  // Prefer the in-session simulation result; fall back to the latest stored prediction.
  const cur = latestSim.result
    ? {
        label: latestSim.result.prediction.display_label,
        conf: latestSim.result.prediction.confidence,
        level: latestSim.result.prediction.confidence_level,
        grip: latestSim.result.grip.grip_percent,
        mode: latestSim.result.grip.grip_mode_label,
        safety: latestSim.result.grip.safety_status,
        source: latestSim.result.data_source,
        features: latestSim.result.sample,
        when: latestSim.result.timestamp,
      }
    : lastStored
      ? {
          label: lastStored.display_label,
          conf: lastStored.confidence,
          level: lastStored.confidence_level,
          grip: lastStored.grip_percent,
          mode: lastStored.grip_mode,
          safety: lastStored.safety_status,
          source: lastStored.data_source,
          features: lastStored.features,
          when: lastStored.created_at,
        }
      : null;
  const trend = [...(history.data?.items ?? [])].reverse().map((h, i) => ({ i: i + 1, confidence: h.confidence * 100, grip: h.grip_percent }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Welcome{user?.full_name ? `, ${user.full_name.split(" ")[0]}` : ""}</h1>
          <p className="text-sm text-muted">Current state of the prosthetic intelligence pipeline.</p>
        </div>
        {cur && <span className="text-xs text-muted">latest result {relativeTime(cur.when)}</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Current material" value={cur ? <MaterialLabel material={cur.label} /> : "—"} mono={false} />
        <Stat label="Confidence" value={cur ? pct(cur.conf) : "—"} tone={cur ? confidenceTone(cur.level) : undefined} sub={cur?.level} />
        <Stat label="Grip" value={cur ? `${cur.grip.toFixed(1)}%` : "—"} sub="normalised" />
        <Stat label="Grip mode" value={cur?.mode ?? "—"} mono={false} />
        <Stat label="Safety" value={cur ? <StatusPill status={cur.safety} /> : "—"} mono={false} />
        <Stat label="Hand state" value={latestSim.state} sub={latestSim.at ? `this session · ${relativeTime(new Date(latestSim.at).toISOString())}` : "no run this session"} />
        <Stat label="Data source" value={cur?.source ?? "—"} mono={false} sub={live?.connected ? `live: ${live.rate_hz.toFixed(1)} Hz` : "live: idle"} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <QuickLink to="/lab" icon={<Hand className="h-5 w-5" />} title="Virtual Prosthetic Lab" text="Run a full SENSE → ACT grasp cycle in 3D" />
        <QuickLink to="/data-studio" icon={<Database className="h-5 w-5" />} title="External Data Studio" text="Upload CSV/JSON and simulate exact rows" />
        <QuickLink to="/simulator" icon={<Radio className="h-5 w-5" />} title="Live sensors" text="Stream telemetry through the pipeline" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <SensorReadout features={cur?.features ?? null} sourceLabel={cur ? `${cur.source} · latest` : undefined} simulated={cur?.source === "SIMULATED"} />
          <Panel title="Recent confidence & grip" subtitle="Last 30 stored predictions (oldest → newest)">
            {history.isLoading ? (
              <LoadingBlock />
            ) : trend.length < 2 ? (
              <EmptyState title="Not enough history yet">Run a few grasps to see the trend.</EmptyState>
            ) : (
              <div className="h-48">
                <ResponsiveContainer>
                  <LineChart data={trend} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid stroke={c["--chart-grid"]} vertical={false} />
                    <XAxis dataKey="i" {...axisProps(c)} />
                    <YAxis domain={[0, 100]} {...axisProps(c)} unit="%" />
                    <ReferenceLine y={80} stroke={c["--good"]} strokeDasharray="3 4" />
                    <ReferenceLine y={60} stroke={c["--warn"]} strokeDasharray="3 4" />
                    <Tooltip content={<ChartTooltip unit="%" formatter={(v) => v.toFixed(1)} />} labelFormatter={(l) => `prediction ${l}`} />
                    <Line dataKey="confidence" name="Confidence" stroke={c["--accent-2"]} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
                    <Line dataKey="grip" name="Grip" stroke={c["--accent"]} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="mt-1 flex gap-4 text-[11.5px] text-ink-2">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c["--accent-2"] }} />Confidence</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c["--accent"] }} />Grip</span>
              <span className="text-muted">dashed: 80 % / 60 % confidence thresholds</span>
            </div>
          </Panel>
          <Panel title="Recent predictions" actions={<Link to="/history" className="text-xs font-medium text-accent hover:underline">All history →</Link>}>
            {history.isError && <ErrorState error={history.error} />}
            {history.data && history.data.items.length === 0 && <EmptyState title="No predictions yet">Your stored results will appear here.</EmptyState>}
            {history.data && history.data.items.length > 0 && (
              <ul className="divide-y divide-line">
                {history.data.items.slice(0, 7).map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px]">
                    <MaterialLabel material={h.display_label} className="w-28 font-medium" />
                    <Badge tone={confidenceTone(h.confidence_level)}>{pct(h.confidence)}</Badge>
                    <span className="font-mono text-ink-2">{h.grip_percent.toFixed(1)}%</span>
                    <StatusPill status={h.safety_status} />
                    <Badge>{h.data_source}</Badge>
                    <span className="ml-auto text-xs text-muted">{relativeTime(h.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="Model status" icon={<BrainCircuit className="h-4 w-4" />} actions={<Link to="/model" className="text-xs font-medium text-accent hover:underline">Details →</Link>}>
            {model.isLoading && <LoadingBlock />}
            {model.data?.ready && (
              <>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <Stat label="Test accuracy" value={pct(model.data.metrics?.accuracy)} tone="accent" />
                  <Stat label="Macro F1" value={pct(model.data.metrics?.f1_macro)} />
                </div>
                <KeyValue
                  items={[
                    ["Type", "Random forest (100 trees, depth 12)"],
                    ["Version", model.data.version],
                    ["Trained", relativeTime(model.data.trained_at)],
                    ["Dataset", `${model.data.dataset?.n_samples} simulated samples`],
                  ]}
                />
              </>
            )}
          </Panel>
          <Panel title="System status" icon={<Server className="h-4 w-4" />}>
            {health.isError && <ErrorState error={health.error} title="Backend unreachable" />}
            {health.data && (
              <KeyValue
                items={[
                  ["API", <StatusPill key="a" status={health.data.status === "ok" ? "NOMINAL" : "CAUTION"} />],
                  ["Database", `${health.data.database.backend} · ${health.data.database.ok ? "ok" : "error"}`],
                  ["Model", health.data.model.ready ? "loaded" : "not ready"],
                  ["Live channel", health.data.live.connected ? "receiving data" : "idle"],
                  ["Simulated stream", health.data.live.stream_running ? "running" : "stopped"],
                  ["Uptime", `${Math.round(health.data.uptime_s / 60)} min`],
                  ["Environment", health.data.environment],
                ]}
              />
            )}
          </Panel>
          {metrics.data && metrics.data.total_predictions > 0 && (
            <Panel title="Your activity (14 days)">
              <div className="grid grid-cols-3 gap-2">
                {metrics.data.source_distribution.map((s) => (
                  <Stat key={s.source} label={s.source} value={s.count} />
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">
                Labelled accuracy: {pct(metrics.data.labeled_evaluation.accuracy)} over {metrics.data.labeled_evaluation.labeled_predictions} predictions with ground truth.
              </p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
