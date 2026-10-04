import { AlertTriangle, Gauge, Info, OctagonAlert } from "lucide-react";
import type { PredictionResult } from "@/api/types";
import { Badge, EmptyState, Panel, ProgressBar, StatusPill, cx } from "@/components/ui";
import { FEATURE_META, objectName } from "@/lib/format";

function Term({ label, value, sign, muted }: { label: string; value: number; sign?: "+" | "−" | "="; muted?: boolean }) {
  return (
    <div className={cx("flex items-center justify-between gap-3 py-1 text-[13px]", muted && "text-muted")}>
      <span className="flex items-center gap-2">
        <span className="w-3 text-center font-mono text-muted">{sign}</span>
        {label}
      </span>
      <span className="font-mono tabular">{value >= 0 ? (sign === "=" ? "" : "+") : ""}{value.toFixed(1)}%</span>
    </div>
  );
}

/** DECIDE: why the hand chose this grip - the grip engine's actual decomposition. */
export function GripPanel({ result, className }: { result: PredictionResult | null; className?: string }) {
  if (!result) {
    return (
      <Panel title="Grip decision" icon={<Gauge className="h-4 w-4" />} className={className}>
        <EmptyState icon={<Gauge className="h-6 w-6" />} title="No grip decision yet">
          The grip engine runs right after the material prediction.
        </EmptyState>
      </Panel>
    );
  }
  const g = result.grip;
  const clamped = Math.max(0, Math.min(100, g.raw_grip));
  const capped = g.grip_percent < clamped - 0.05;
  const floored = g.grip_percent > clamped + 0.05;
  return (
    <Panel title="Grip decision" icon={<Gauge className="h-4 w-4" />} className={className} tag={<StatusPill status={g.safety_status} />}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted">Commanded grip</div>
          <div data-testid="grip-percent" className="font-mono text-4xl font-semibold tabular text-ink">
            {g.grip_percent.toFixed(1)}
            <span className="text-xl text-muted">%</span>
          </div>
        </div>
        <div className="text-right">
          <Badge tone={g.is_uncertain ? "bad" : "accent"}>{g.grip_mode_label}</Badge>
          <div className="mt-1 text-xs text-ink-2">{g.grasp_type}</div>
          <div className="text-[11px] text-muted">
            {objectName(g.object_id)}
            {g.object_auto_selected && " (auto)"}
          </div>
        </div>
      </div>
      <ProgressBar value={g.grip_percent} className="mt-2" label="Grip percentage" color={g.is_uncertain ? "var(--bad)" : "var(--accent)"} />
      <p className="mt-1 text-[11px] text-muted">Normalised simulation value (0–100 % actuator range) — not a force in newtons.</p>

      <div className="mt-3 rounded-xl border border-line bg-surface-2/60 px-3 py-1.5" aria-label="Grip calculation">
        <Term label={`Material base (${g.material})`} value={g.base_grip} />
        <Term label="Sensor adjustment" value={g.sensor_adjustment} sign={g.sensor_adjustment >= 0 ? "+" : "−"} />
        <div className="ml-5 flex flex-wrap gap-x-3 pb-1 text-[11px] text-muted">
          {Object.entries(g.sensor_breakdown).map(([f, v]) => (
            <span key={f}>
              {FEATURE_META[f as keyof typeof FEATURE_META]?.label ?? f} {v >= 0 ? "+" : ""}
              {v.toFixed(1)}
            </span>
          ))}
        </div>
        <Term label="Fragility protection" value={-g.fragility_protection} sign="−" />
        <Term label="Confidence adjustment" value={g.confidence_adjustment} sign={g.confidence_adjustment >= 0 ? "+" : "−"} />
        <div className="my-1 border-t border-line" />
        <Term label="Raw grip" value={g.raw_grip} sign="=" muted />
        <div className="flex items-center justify-between py-1 text-[13px] font-semibold">
          <span className="ml-5">Final (clamped 0–100{capped ? `, capped at ${g.grip_percent.toFixed(0)}` : ""}{floored ? ", secure-hold floor" : ""})</span>
          <span className="font-mono tabular">{g.grip_percent.toFixed(1)}%</span>
        </div>
      </div>

      {g.warnings.length > 0 && (
        <ul className="mt-3 space-y-1.5" aria-label="Safety warnings">
          {g.warnings.map((w) => {
            const Icon = w.severity === "WARNING" ? OctagonAlert : w.severity === "CAUTION" ? AlertTriangle : Info;
            return (
              <li
                key={w.code}
                className={cx(
                  "flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[12.5px]",
                  w.severity === "WARNING" ? "border-bad/40 bg-bad-soft" : w.severity === "CAUTION" ? "border-warn/40 bg-warn-soft" : "border-line bg-surface-2",
                )}
              >
                <Icon className={cx("mt-0.5 h-3.5 w-3.5 shrink-0", w.severity === "WARNING" ? "text-bad" : w.severity === "CAUTION" ? "text-warn" : "text-muted")} aria-hidden />
                <span>
                  <span className="font-mono text-[10.5px] font-semibold tracking-wide">{w.code}</span> — {w.message}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 rounded-lg border border-accent/25 bg-accent-soft px-3 py-2 text-[12.5px] text-ink">
        <span className="font-mono text-[10.5px] font-semibold tracking-wider text-accent">ACTION</span> {g.action}
      </div>
      <details className="mt-2 text-[12px] text-ink-2">
        <summary className="cursor-pointer select-none text-muted hover:text-ink">Engine reasoning ({g.explanation.length} steps)</summary>
        <ol className="mt-1.5 list-decimal space-y-1 pl-5">
          {g.explanation.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ol>
        <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[11px] text-muted">
          <span>closure speed {result.command.closure_speed.toFixed(2)}</span>
          <span>lift speed {result.command.lift_speed.toFixed(2)}</span>
          <span>hold {result.command.hold_ms} ms</span>
          <span>object limit {g.structural_limit.toFixed(0)}%</span>
        </div>
      </details>
    </Panel>
  );
}
