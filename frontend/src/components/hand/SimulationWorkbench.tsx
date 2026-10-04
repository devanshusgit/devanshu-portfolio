import { Database, ExternalLink, Radio, Sparkles } from "lucide-react";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { create } from "zustand";
import type { DataSource, Material, PredictionResult, VirtualObject } from "@/api/types";
import { PipelineVisualizer } from "@/components/pipeline/PipelineVisualizer";
import { GripPanel } from "@/components/prediction/GripPanel";
import { PredictionPanel } from "@/components/prediction/PredictionPanel";
import { StateTimeline } from "@/components/prediction/StateTimeline";
import { SensorReadout } from "@/components/telemetry/SensorReadout";
import { Badge, LoadingBlock, Panel, SimulatedTag } from "@/components/ui";
import { useCatalog } from "@/lib/catalog";
import { usePrefs } from "@/lib/prefs";
import type { HandState } from "@/sim/stateMachine";
import type { GraspRun } from "@/sim/useGraspRun";
import { HandScene } from "./HandScene";
import type { Appearance } from "./materials";

/** Last simulation snapshot, shared with the dashboard (in-memory, this session). */
export const useLatestSimulation = create<{ state: HandState; result: PredictionResult | null; source: DataSource | null; at: number | null; set: (p: Partial<{ state: HandState; result: PredictionResult | null; source: DataSource }>) => void }>(
  (set) => ({ state: "IDLE", result: null, source: null, at: null, set: (p) => set({ ...p, at: Date.now() }) }),
);

const SOURCE_ICON: Record<DataSource, ReactNode> = {
  SIMULATED: <Sparkles className="h-3 w-3" aria-hidden />,
  UPLOADED: <Database className="h-3 w-3" aria-hidden />,
  LIVE: <Radio className="h-3 w-3" aria-hidden />,
};

export function SimulationWorkbench({
  run,
  object,
  knownMaterial,
  source,
  controls,
  sceneHeight = "h-[440px]",
}: {
  run: GraspRun;
  object: VirtualObject | undefined;
  knownMaterial?: Material | null;
  source: DataSource;
  controls?: ReactNode;
  sceneHeight?: string;
}) {
  const { materialByName } = useCatalog();
  const showLabels = usePrefs((s) => s.show_sensor_labels);
  const setLatest = useLatestSimulation((s) => s.set);
  const { state, result, sample, visits, error } = run;

  useEffect(() => {
    if (state !== "IDLE") setLatest({ state, result, source });
  }, [state, result, source, setLatest]);

  const predicted = result?.prediction.material ?? null;
  const appearance: Appearance = knownMaterial ?? (result ? (predicted as Material) : "Unknown");
  const inferredAppearance = !knownMaterial && !!result;
  const compliance = result ? (materialByName[result.grip.material]?.compliance ?? 0) : 0;
  const showResult = result && !["SENSING", "CONTACT", "ANALYZING"].includes(state) ? result : state === "ANALYZING" ? null : result;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-4">
        <Panel bodyClassName="p-0" className="overflow-hidden">
          <div className="relative">
            {object ? (
              <HandScene
                className={`${sceneHeight} w-full`}
                object={object}
                appearance={appearance}
                motion={run.motion}
                command={result?.command ?? null}
                compliance={compliance}
                state={state}
                showLabels={showLabels}
              />
            ) : (
              <LoadingBlock label="Loading 3D scene…" className={`${sceneHeight} rounded-none border-0`} />
            )}
            <div className="pointer-events-none absolute left-3 right-3 top-3 flex flex-wrap gap-1.5 md:right-auto">
              <Badge tone="neutral" className="bg-[#0b1220]/80 text-slate-200">
                {object?.name ?? "—"} · {object?.profile.grasp_type}
              </Badge>
              <Badge tone="neutral" className="bg-[#0b1220]/80 text-slate-200">
                material look: {appearance === "Unknown" ? "unknown until recognised" : `${appearance}${inferredAppearance ? " (inferred)" : knownMaterial ? " (ground truth)" : ""}`}
              </Badge>
            </div>
            <div className="pointer-events-none absolute right-3 top-3 hidden flex-col items-end gap-1.5 md:flex">
              {source === "SIMULATED" ? (
                <SimulatedTag label="SIMULATED SENSOR DATA" className="bg-[#0b1220]/80" />
              ) : (
                <Badge tone="accent" className="bg-[#0b1220]/80">
                  {SOURCE_ICON[source]} {source === "UPLOADED" ? "UPLOADED EXTERNAL DATA" : "LIVE SENSOR STREAM"}
                </Badge>
              )}
            </div>
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-cyan-400/30 bg-[#0b1220]/80 px-2 py-1 font-mono text-[10px] tracking-[0.14em] text-cyan-300">
              ◉ 8 VIRTUAL TACTILE SENSORS · 5 fingertip + 3 palm
            </div>
            <div className="pointer-events-none absolute bottom-3 right-3 hidden font-mono text-[10px] text-slate-400 md:block">drag to orbit · scroll to zoom</div>
          </div>
          <div className="border-t border-line px-4 py-3">
            <StateTimeline state={state} visits={visits} />
          </div>
        </Panel>
        {controls}
        <Panel title="AI pipeline" subtitle="SENSE → UNDERSTAND → DECIDE → ACT · stage timings measured by the backend" bodyClassName="p-3">
          <PipelineVisualizer state={state} trace={result?.trace} error={error} />
        </Panel>
        <SensorReadout
          features={sample?.features ?? null}
          sourceLabel={sample?.sourceLabel}
          simulated={sample ? sample.simulated : source === "SIMULATED"}
          highlight={result?.prediction.out_of_distribution.map((o) => o.feature)}
        />
      </div>
      <div className="min-w-0 space-y-4">
        <PredictionPanel result={showResult} pending={state === "ANALYZING"} />
        <GripPanel result={showResult} />
        {result?.persisted && result.id && (
          <div className="flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-2 text-[12.5px] text-ink-2">
            <span>
              Stored in history as <span className="font-mono text-ink">#{result.id}</span> · {result.data_source}
            </span>
            <Link to="/history" className="inline-flex items-center gap-1 text-accent hover:underline">
              History <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
