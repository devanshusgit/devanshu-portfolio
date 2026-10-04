import { motion as m } from "framer-motion";
import { Activity, BrainCircuit, Cpu, Fingerprint, Gauge, Hand, OctagonAlert } from "lucide-react";
import type { TraceStage } from "@/api/types";
import { cx } from "@/components/ui";
import { useReducedMotion } from "@/lib/prefs";
import { pipelineStageFor, type HandState } from "@/sim/stateMachine";

const STAGES = [
  { key: "sensors", label: "Tactile sensors", icon: Fingerprint, trace: [] as string[] },
  { key: "processing", label: "Data processing", icon: Cpu, trace: ["validation", "preprocessing"] },
  { key: "classifier", label: "AI classifier", icon: BrainCircuit, trace: ["inference"] },
  { key: "recognition", label: "Material recognition", icon: Activity, trace: ["recognition"] },
  { key: "grip", label: "Grip engine", icon: Gauge, trace: ["grip"] },
  { key: "response", label: "Prosthetic response", icon: Hand, trace: ["command"] },
];

/**
 * SENSE -> UNDERSTAND -> DECIDE -> ACT. The active stage follows the real hand
 * state; per-stage timings and details come from the backend's pipeline trace.
 */
export function PipelineVisualizer({ state, trace, error, compact }: { state: HandState; trace?: TraceStage[]; error?: string | null; compact?: boolean }) {
  const reduced = useReducedMotion();
  const active = pipelineStageFor(state);
  // While ANALYZING the request covers processing + classifier.
  const isActive = (i: number) => (state === "COMPLETED" ? false : state === "ANALYZING" ? i === 1 || i === 2 : i === active);
  const done = (i: number) => (state === "ANALYZING" ? i < 1 : active > i) || (state === "COMPLETED" && i <= 5);
  const traceFor = (keys: string[]) => trace?.filter((t) => keys.includes(t.stage)) ?? [];

  return (
    <div className="relative" aria-label="AI pipeline" role="list">
      <div className={cx("grid gap-2", compact ? "grid-cols-3 sm:grid-cols-6" : "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6")}>
        {STAGES.map((s, i) => {
          const items = traceFor(s.trace);
          const ms = items.reduce((a, t) => a + t.duration_ms, 0);
          const on = isActive(i);
          const ok = done(i) && !on;
          const failed = state === "ERROR" && i === Math.max(active, 1);
          const Icon = failed ? OctagonAlert : s.icon;
          return (
            <div
              key={s.key}
              role="listitem"
              aria-current={on ? "step" : undefined}
              className={cx(
                "relative overflow-hidden rounded-xl border px-3 py-2.5 transition-colors",
                on && "border-accent/60 bg-accent-soft",
                ok && "border-good/30 bg-good-soft/50",
                failed && "border-bad/50 bg-bad-soft",
                !on && !ok && !failed && "border-line bg-surface-2/50",
              )}
            >
              {on && !reduced && (
                <m.div
                  className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-accent/25 to-transparent"
                  initial={{ x: "-100%" }}
                  animate={{ x: "300%" }}
                  transition={{ repeat: Infinity, duration: 1.1, ease: "linear" }}
                />
              )}
              <div className="relative flex items-center gap-2">
                <span className={cx("flex h-6 w-6 items-center justify-center rounded-md", on ? "bg-accent text-[#04121a]" : ok ? "bg-good/20 text-good" : failed ? "bg-bad/20 text-bad" : "bg-surface-3 text-muted")}>
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </span>
                <span className="font-mono text-[10px] text-muted">0{i + 1}</span>
              </div>
              <div className={cx("relative mt-1.5 text-[12.5px] font-semibold leading-tight", on || ok ? "text-ink" : "text-ink-2")}>{s.label}</div>
              {!compact && (
                <div className="relative mt-0.5 min-h-[30px] text-[11px] leading-snug text-muted">
                  {i === 0 && (state === "SENSING" ? "acquiring reading…" : active >= 0 || state === "COMPLETED" ? "reading captured" : "waiting")}
                  {i > 0 && items.length > 0 && ok && (
                    <>
                      <span className="font-mono text-ink-2">{ms < 1 ? ms.toFixed(2) : ms.toFixed(1)} ms</span>
                      <span className="block truncate" title={items.map((t) => t.detail).join(" · ")}>
                        {items[items.length - 1].detail}
                      </span>
                    </>
                  )}
                  {i > 0 && on && "processing…"}
                  {i > 0 && !on && !ok && (failed ? <span className="text-bad">failed</span> : "—")}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && state === "ERROR" && (
        <div role="alert" className="mt-2 rounded-lg border border-bad/40 bg-bad-soft px-3 py-2 text-[12.5px] text-ink">
          Pipeline error: {error}
        </div>
      )}
    </div>
  );
}
