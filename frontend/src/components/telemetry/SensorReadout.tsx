import { Fingerprint } from "lucide-react";
import type { FeatureName, Features } from "@/api/types";
import { Badge, SimulatedTag, cx } from "@/components/ui";
import { FEATURE_META, FEATURE_ORDER, formatFeature } from "@/lib/format";

/** SENSE: exactly which sensor values entered the pipeline. */
export function SensorReadout({
  features,
  sourceLabel,
  simulated,
  className,
  highlight,
}: {
  features: Partial<Features> | null;
  sourceLabel?: string;
  simulated?: boolean;
  className?: string;
  highlight?: FeatureName[];
}) {
  return (
    <div className={cx("rounded-2xl border border-line bg-surface p-3.5 shadow-panel", className)} aria-label="Sensor readings">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-display text-[14px] font-semibold">
          <Fingerprint className="h-4 w-4 text-accent" aria-hidden /> Virtual tactile sensors
        </div>
        {simulated ? <SimulatedTag label={sourceLabel ?? "SIMULATED SENSOR DATA"} /> : sourceLabel ? <Badge tone="accent">{sourceLabel}</Badge> : null}
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="sensor-readout">
        {FEATURE_ORDER.map((f) => (
          <div key={f} className={cx("rounded-lg border px-2.5 py-2", highlight?.includes(f) ? "border-warn/50 bg-warn-soft" : "border-line bg-surface-2/60")}>
            <dt className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">{FEATURE_META[f].label}</dt>
            <dd className="mt-0.5 font-mono text-[15px] font-semibold tabular text-ink" data-feature={f}>
              {features ? formatFeature(f, features[f] as number) : "—"}
              <span className="ml-1 text-[10.5px] font-normal text-muted">{FEATURE_META[f].unit}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
