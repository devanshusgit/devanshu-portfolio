import { useMutation } from "@tanstack/react-query";
import { Download, Layers, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { api, errorMessage } from "@/api/client";
import type { BatchResponse, Dataset } from "@/api/types";
import { ConfusionMatrix } from "@/components/charts/ConfusionMatrix";
import { Badge, Button, EmptyState, ErrorState, MaterialLabel, Notice, Panel, Segmented, Stat, StatusPill, Toggle } from "@/components/ui";
import { downloadText, FEATURE_ORDER, pct, toCsv } from "@/lib/format";

type Filter = "all" | "ok" | "invalid" | "uncertain" | "incorrect";
const PAGE = 50;

export function exportBatch(batch: BatchResponse, format: "csv" | "json") {
  const base = (batch.dataset_name || "dataset").replace(/\.[^.]+$/, "");
  if (format === "json") {
    downloadText(`${base}_neurogrip_results.json`, JSON.stringify({ model_version: batch.model_version, evaluation: batch.evaluation, results: batch.results }, null, 2), "application/json");
    return;
  }
  const materials = ["Glass", "Steel", "Plastic", "Wood", "Rubber", "Fabric"];
  const columns = [
    "row_index", "row_id", "status", ...FEATURE_ORDER, "predicted_material", "display_label", "confidence", "confidence_level",
    ...materials.map((m) => `p_${m}`), "grip_percent", "grip_mode", "grasp_type", "safety_status", "warnings", "action", "ground_truth", "correct", "errors",
  ];
  const rows = batch.results.map((r) => ({
    ...r,
    ...(r.features ?? {}),
    ...Object.fromEntries(materials.map((m) => [`p_${m}`, r.probabilities?.[m as keyof typeof r.probabilities]])),
    warnings: r.warnings?.join("|"),
    errors: r.errors?.map((e) => e.message).join("|"),
  }));
  downloadText(`${base}_neurogrip_results.csv`, toCsv(columns, rows as Record<string, unknown>[]), "text/csv");
}

export function BatchPanel({ dataset, objectId }: { dataset: Dataset; objectId: string | null }) {
  const [persist, setPersist] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const batch = useMutation({ mutationFn: () => api.processBatch({ dataset_id: dataset.id, persist, object_id: objectId }) });
  const data = batch.data?.dataset_id === dataset.id ? batch.data : undefined;

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.results.filter((r) =>
      filter === "all" ? true : filter === "ok" ? r.status === "ok" : filter === "invalid" ? r.status === "invalid" : filter === "uncertain" ? r.is_uncertain : r.correct === false,
    );
  }, [data, filter]);
  const pageRows = filtered.slice(page * PAGE, (page + 1) * PAGE);
  const ev = data?.evaluation;

  return (
    <Panel
      title="Batch processing"
      icon={<Layers className="h-4 w-4" />}
      subtitle="Runs every row through the same validation → preprocessing → random forest → grip engine pipeline"
      actions={
        <>
          <Toggle checked={persist} onChange={setPersist} label="Record in history" />
          <Button variant="primary" size="sm" loading={batch.isPending} onClick={() => batch.mutate()} icon={<Play className="h-3.5 w-3.5" />} data-testid="process-batch">
            Process all {dataset.row_count} rows
          </Button>
        </>
      }
    >
      {batch.isError && <ErrorState error={new Error(errorMessage(batch.error))} title="Batch processing failed" onRetry={() => batch.mutate()} />}
      {!data && !batch.isPending && !batch.isError && (
        <EmptyState icon={<Layers className="h-6 w-6" />} title="No batch results yet">
          Process the whole dataset to get per-row predictions, grip decisions{dataset.summary.has_labels ? " and evaluation metrics against your labels" : ""}.
        </EmptyState>
      )}
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Stat label="Processed" value={data.processed} />
            <Stat label="Predicted" value={data.ok} tone="good" />
            <Stat label="Invalid rows" value={data.invalid} tone={data.invalid ? "bad" : undefined} />
            <Stat label="Mean confidence" value={pct(data.summary.mean_confidence)} />
            <Stat label="Pipeline time" value={`${data.elapsed_ms.toFixed(0)} ms`} sub={`${data.per_row_ms.toFixed(2)} ms / row · ${data.persisted} saved`} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(data.summary.materials).map(([m, c]) => (
              <Badge key={m} tone="neutral">
                <MaterialLabel material={m} /> {c}
              </Badge>
            ))}
            {Object.entries(data.summary.safety).map(([s, c]) => (
              <span key={s} className="inline-flex items-center gap-1 text-xs text-muted">
                <StatusPill status={s} /> {c}
              </span>
            ))}
          </div>
          {ev ? (
            <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Accuracy" value={pct(ev.accuracy)} tone="accent" sub={`${ev.labeled_rows} labelled rows`} />
                  <Stat label="Macro F1" value={pct(ev.f1_macro)} />
                  <Stat label="Macro precision" value={pct(ev.precision_macro)} />
                  <Stat label="Macro recall" value={pct(ev.recall_macro)} />
                  <Stat label="Coverage (not uncertain)" value={pct(ev.coverage)} sub={`${ev.uncertain_rows} uncertain`} />
                  <Stat label="Accuracy when confident" value={pct(ev.accuracy_when_confident)} />
                </div>
                <p className="text-[11px] text-muted">{ev.note}</p>
              </div>
              <ConfusionMatrix data={ev.confusion_matrix} />
            </div>
          ) : (
            <Notice>This dataset has no usable ground-truth labels, so only predictions are shown — no evaluation metrics are invented.</Notice>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented
              size="sm"
              label="Result filter"
              value={filter}
              onChange={(v) => {
                setFilter(v);
                setPage(0);
              }}
              options={[
                { value: "all", label: `All (${data.results.length})` },
                { value: "ok", label: "Predicted" },
                { value: "invalid", label: "Invalid" },
                { value: "uncertain", label: "Uncertain" },
                ...(ev ? [{ value: "incorrect" as Filter, label: "Incorrect" }] : []),
              ]}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => exportBatch(data, "csv")} icon={<Download className="h-3.5 w-3.5" />}>
                Export CSV
              </Button>
              <Button size="sm" onClick={() => exportBatch(data, "json")} icon={<Download className="h-3.5 w-3.5" />}>
                Export JSON
              </Button>
            </div>
          </div>
          <div className="max-h-[440px] overflow-auto rounded-xl border border-line">
            <table className="w-full min-w-[900px] text-[12px]" data-testid="batch-table">
              <thead className="sticky top-0 bg-surface-2 text-left text-[10.5px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-2.5 py-2">row id</th>
                  <th className="px-2.5 py-2">predicted</th>
                  <th className="px-2.5 py-2 text-right">confidence</th>
                  <th className="px-2.5 py-2">probabilities</th>
                  <th className="px-2.5 py-2 text-right">grip</th>
                  <th className="px-2.5 py-2">mode</th>
                  <th className="px-2.5 py-2">safety</th>
                  <th className="px-2.5 py-2">action</th>
                  {ev && <th className="px-2.5 py-2">truth</th>}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.row_index} className="border-t border-line align-top">
                    <td className="px-2.5 py-1.5 font-mono">{r.row_id}</td>
                    {r.status === "invalid" ? (
                      <td colSpan={ev ? 8 : 7} className="px-2.5 py-1.5 text-bad">
                        invalid — {r.errors?.map((e) => e.message).join("; ")}
                      </td>
                    ) : (
                      <>
                        <td className="px-2.5 py-1.5">
                          <MaterialLabel material={r.display_label!} />
                        </td>
                        <td className="px-2.5 py-1.5 text-right font-mono tabular">{pct(r.confidence)}</td>
                        <td className="px-2.5 py-1.5 font-mono text-[10.5px] text-muted">
                          {Object.entries(r.probabilities ?? {})
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 3)
                            .map(([m, p]) => `${m} ${(p * 100).toFixed(0)}%`)
                            .join(" · ")}
                        </td>
                        <td className="px-2.5 py-1.5 text-right font-mono tabular">{r.grip_percent?.toFixed(1)}%</td>
                        <td className="px-2.5 py-1.5">{r.grip_mode_label}</td>
                        <td className="px-2.5 py-1.5">
                          <StatusPill status={r.safety_status!} />
                        </td>
                        <td className="max-w-[280px] px-2.5 py-1.5 text-ink-2">{r.action}</td>
                        {ev && (
                          <td className={r.correct ? "px-2.5 py-1.5 text-good" : r.correct === false ? "px-2.5 py-1.5 text-bad" : "px-2.5 py-1.5 text-muted"}>
                            {r.ground_truth ?? "—"} {r.correct ? "✓" : r.correct === false ? "✕" : ""}
                          </td>
                        )}
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > PAGE && (
            <div className="flex items-center justify-end gap-2 text-xs text-muted">
              page {page + 1} / {Math.ceil(filtered.length / PAGE)}
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Prev
              </Button>
              <Button size="sm" variant="ghost" disabled={(page + 1) * PAGE >= filtered.length} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
