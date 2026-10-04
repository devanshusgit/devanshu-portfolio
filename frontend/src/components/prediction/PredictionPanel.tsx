import { BrainCircuit, CheckCircle2, CircleHelp, XCircle } from "lucide-react";
import type { PredictionResult } from "@/api/types";
import { Badge, EmptyState, MaterialSwatch, Notice, Panel, cx } from "@/components/ui";
import { confidenceTone, FEATURE_META, formatFeature, MATERIAL_COLOR, pct } from "@/lib/format";

export function ProbabilityBars({ probabilities, highlight }: { probabilities: Record<string, number>; highlight?: string }) {
  const rows = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  return (
    <ul className="space-y-1.5" aria-label="Class probabilities">
      {rows.map(([m, p]) => (
        <li key={m} className="grid grid-cols-[84px_1fr_52px] items-center gap-2 text-[12.5px]">
          <span className={cx("flex items-center gap-1.5", m === highlight ? "font-semibold text-ink" : "text-ink-2")}>
            <MaterialSwatch material={m} />
            {m}
          </span>
          <span className="h-2 overflow-hidden rounded-full bg-surface-3">
            <span className="block h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(p * 100, 0.5)}%`, background: MATERIAL_COLOR[m] }} />
          </span>
          <span className="text-right font-mono tabular text-ink-2">{(p * 100).toFixed(1)}%</span>
        </li>
      ))}
    </ul>
  );
}

/** UNDERSTAND: what the AI predicted and how confident it is (actual model output). */
export function PredictionPanel({ result, pending, className }: { result: PredictionResult | null; pending?: boolean; className?: string }) {
  if (!result) {
    return (
      <Panel title="Material recognition" icon={<BrainCircuit className="h-4 w-4" />} className={className}>
        <EmptyState icon={<CircleHelp className="h-6 w-6" />} title={pending ? "Waiting for the model…" : "No prediction yet"}>
          {pending ? "The sample is being validated, preprocessed and classified by the random forest." : "Run a grasp cycle to send a sensor reading through the classifier."}
        </EmptyState>
      </Panel>
    );
  }
  const p = result.prediction;
  const tone = confidenceTone(p.confidence_level);
  return (
    <Panel
      title="Material recognition"
      icon={<BrainCircuit className="h-4 w-4" />}
      className={className}
      tag={<Badge tone="violet">Random forest · 100 trees</Badge>}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted">Predicted material</div>
          <div data-testid="predicted-material" className="mt-0.5 flex items-center gap-2 font-display text-3xl font-semibold tracking-tight">
            {p.is_uncertain ? <CircleHelp className="h-6 w-6 text-bad" aria-hidden /> : <MaterialSwatch material={p.material} className="h-4 w-4 rounded" />}
            {p.display_label}
          </div>
          {p.is_uncertain && <div className="text-xs text-muted">most likely: {p.material} (not trusted)</div>}
        </div>
        <div className="text-right">
          <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted">Confidence</div>
          <div data-testid="prediction-confidence" className={cx("font-mono text-3xl font-semibold tabular", tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : "text-bad")}>
            {pct(p.confidence)}
          </div>
          <Badge tone={tone}>{p.confidence_level === "LOW" ? "LOW · UNCERTAIN" : p.confidence_level}</Badge>
        </div>
      </div>
      <div className="mt-4">
        <ProbabilityBars probabilities={p.probabilities} highlight={p.material} />
      </div>
      <p className="mt-2 text-[11px] text-muted">Confidence = maximum class probability from predict_proba. ≥80% high · 60–79% moderate · &lt;60% uncertain.</p>
      {result.ground_truth && (
        <div className={cx("mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px]", result.correct ? "border-good/30 bg-good-soft" : "border-bad/40 bg-bad-soft")}>
          {result.correct ? <CheckCircle2 className="h-4 w-4 text-good" aria-hidden /> : <XCircle className="h-4 w-4 text-bad" aria-hidden />}
          <span>
            Ground truth <span className="font-semibold">{result.ground_truth}</span> — prediction {result.correct ? "correct" : "incorrect"}
          </span>
        </div>
      )}
      {p.out_of_distribution.length > 0 && (
        <Notice tone="warn" className="mt-3">
          Outside the training range:{" "}
          {p.out_of_distribution.map((o) => `${FEATURE_META[o.feature].label} ${formatFeature(o.feature, o.value)} ${FEATURE_META[o.feature].unit}`).join(", ")}
        </Notice>
      )}
    </Panel>
  );
}
