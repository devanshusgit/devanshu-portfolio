import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronsLeft, ChevronsRight, Database, Download, FileWarning, Pause, Play, RotateCcw, StepBack, StepForward, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "@/api/client";
import type { Dataset, RowView } from "@/api/types";
import { BatchPanel } from "@/components/data/BatchPanel";
import { MappingEditor } from "@/components/data/MappingEditor";
import { RowTable, type StatusFilter } from "@/components/data/RowTable";
import { UploadDropzone } from "@/components/data/UploadDropzone";
import { SimulationWorkbench } from "@/components/hand/SimulationWorkbench";
import { Badge, Button, EmptyState, ErrorState, Field, LoadingBlock, Notice, Panel, Segmented, Select, Stat, Toggle, cx } from "@/components/ui";
import { useCatalog } from "@/lib/catalog";
import { FEATURE_META, FEATURE_ORDER, formatFeature, relativeTime } from "@/lib/format";
import { usePrefs, useReducedMotion } from "@/lib/prefs";
import { uploadedRowSource } from "@/sim/sources";
import { useGraspRun, type GraspSource } from "@/sim/useGraspRun";

const PAGE = 50;
const SPEEDS = ["0.5", "1", "2", "5"];

function DatasetSummary({ ds }: { ds: Dataset }) {
  const s = ds.summary;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Rows" value={s.row_count} sub={`${ds.format.toUpperCase()} · ${(ds.size_bytes / 1024).toFixed(1)} KB`} />
        <Stat label="Valid" value={s.valid_rows} tone="good" />
        <Stat label="Warnings" value={s.warning_rows} tone={s.warning_rows ? "warn" : undefined} sub="out of training range / labels" />
        <Stat label="Invalid" value={s.invalid_rows} tone={s.invalid_rows ? "bad" : undefined} sub="cannot be simulated" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted">Detected features:</span>
        {FEATURE_ORDER.map((f) => (
          <Badge key={f} tone={s.detected_features.includes(f) ? "good" : "bad"}>
            {FEATURE_META[f].label}
          </Badge>
        ))}
        <Badge tone={s.has_labels ? "violet" : "neutral"}>{s.has_labels ? `labels: ${Object.entries(s.label_distribution).map(([k, v]) => `${k} ${v}`).join(", ")}` : "no labels"}</Badge>
      </div>
      {(Object.values(s.missing_by_feature).some(Boolean) || Object.values(s.invalid_by_feature).some(Boolean)) && (
        <div className="grid grid-cols-5 gap-1.5 text-center text-[11px]">
          {FEATURE_ORDER.map((f) => (
            <div key={f} className="rounded-lg border border-line bg-surface-2/50 px-1 py-1.5">
              <div className="truncate text-muted">{FEATURE_META[f].label}</div>
              <div className="font-mono">
                <span className={s.missing_by_feature[f] ? "text-warn" : "text-muted"}>{s.missing_by_feature[f]} missing</span>
                <br />
                <span className={s.invalid_by_feature[f] ? "text-bad" : "text-muted"}>{s.invalid_by_feature[f]} invalid</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {ds.parse_notes.length > 0 && <Notice tone="warn">{ds.parse_notes.join(" · ")}</Notice>}
      {s.issues_sample.length > 0 && (
        <details className="text-[12.5px]">
          <summary className="cursor-pointer text-muted hover:text-ink">
            <FileWarning className="mr-1 inline h-3.5 w-3.5" /> First {s.issues_sample.length} validation issues
          </summary>
          <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-auto font-mono text-[11.5px] text-ink-2">
            {s.issues_sample.map((i, k) => (
              <li key={k}>
                row {i.row_id}: {i.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function DataStudio() {
  const qc = useQueryClient();
  const catalog = useCatalog();
  const prefs = usePrefs();
  const reduced = useReducedMotion();
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<RowView | null>(null);
  const [objectChoice, setObjectChoice] = useState<string>("auto");
  const [persist, setPersist] = useState(prefs.auto_save_history);
  const [speed, setSpeed] = useState(String(prefs.playback_speed || 1));
  const [playlist, setPlaylist] = useState<number[] | null>(null);
  const [lockedObject, setLockedObject] = useState<string | null>(null);
  const run = useGraspRun({ speed: Number(speed), reducedMotion: reduced });
  const playing = run.running && playlist !== null;

  const datasets = useQuery({ queryKey: ["datasets"], queryFn: api.datasets });
  const list = datasets.data?.datasets ?? [];
  const activeId = datasetId ?? list[0]?.id ?? null;
  const dataset = useQuery({ queryKey: ["dataset", activeId], queryFn: () => api.dataset(activeId!), enabled: activeId !== null });
  const rows = useQuery({
    queryKey: ["dataset-rows", activeId, offset, filter, dataset.data?.mapping],
    queryFn: () => api.datasetRows(activeId!, offset, PAGE, filter),
    enabled: activeId !== null && !!dataset.data,
  });
  const ds = dataset.data;

  useEffect(() => {
    // Pre-select the first row of a freshly loaded dataset.
    if (rows.data && !selected && rows.data.rows[0]) setSelected(rows.data.rows[0]);
  }, [rows.data, selected]);

  const upload = useMutation({
    mutationFn: api.upload,
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["datasets"] });
      qc.setQueryData(["dataset", d.id], d);
      setDatasetId(d.id);
      setOffset(0);
      setFilter("all");
      setSelected(d.preview?.[0] ?? null);
      run.reset();
    },
  });
  const saveMapping = useMutation({
    mutationFn: (m: Parameters<typeof api.updateMapping>[1]) => api.updateMapping(activeId!, m),
    onSuccess: (d) => {
      qc.setQueryData(["dataset", d.id], d);
      setSelected(d.preview?.find((r) => r.row_index === selected?.row_index) ?? d.preview?.[0] ?? null);
    },
  });
  const resetMapping = useMutation({
    mutationFn: () => api.resetMapping(activeId!),
    onSuccess: (d) => qc.setQueryData(["dataset", d.id], d),
  });
  const remove = useMutation({
    mutationFn: api.deleteDataset,
    onSuccess: () => {
      setDatasetId(null);
      setSelected(null);
      run.reset();
      qc.invalidateQueries({ queryKey: ["datasets"] });
    },
  });

  const resolveObject = (row: RowView | null) =>
    objectChoice !== "auto" ? objectChoice : row?.label ? (catalog.defaultObjectForMaterial[row.label] ?? "cube") : "cube";
  const objectId = lockedObject ?? resolveObject(selected);
  const object = catalog.objectById[objectId];

  const sourceForIndex = (idx: number): GraspSource => {
    const base = { kind: "UPLOADED" as const };
    let rowView: RowView | null = null;
    return {
      ...base,
      acquire: async () => {
        rowView = (await api.datasetRows(ds!.id, idx, 1)).rows[0];
        setSelected(rowView);
        return uploadedRowSource({ datasetId: ds!.id, datasetName: ds!.name, row: rowView, objectId, persist: persist && prefs.record_playback, sourceDetail: "playback" }).acquire();
      },
      analyze: () => api.simulateRow(ds!.id, idx, { object_id: objectId, persist: persist && prefs.record_playback, source_detail: "playback" }),
    };
  };

  const simulateSelected = () => {
    if (!ds || !selected) return;
    setPlaylist(null);
    setLockedObject(null);
    run.run(uploadedRowSource({ datasetId: ds.id, datasetName: ds.name, row: selected, objectId: resolveObject(selected), persist }));
  };

  /** Simulatable rows (valid + warning), used for playback navigation. */
  const loadPlaylist = async (): Promise<number[]> => {
    if (!ds) return [];
    const [v, w] = await Promise.all([api.datasetRows(ds.id, 0, 200, "valid"), api.datasetRows(ds.id, 0, 200, "warning")]);
    return [...v.rows, ...w.rows].map((r) => r.row_index).sort((a, b) => a - b);
  };
  const playlistQuery = useQuery({ queryKey: ["playlist", ds?.id, ds?.mapping], queryFn: loadPlaylist, enabled: !!ds });
  const playable = useMemo(() => playlistQuery.data ?? [], [playlistQuery.data]);

  const selectIndex = async (idx: number | undefined) => {
    if (idx === undefined || !ds) return;
    const r = (await api.datasetRows(ds.id, idx, 1)).rows[0];
    setSelected(r);
    setOffset(Math.floor(idx / PAGE) * PAGE);
  };
  const pos = selected ? playable.findIndex((i) => i >= selected.row_index) : 0;
  const exact = selected ? playable.indexOf(selected.row_index) : -1;
  const prevIdx = exact >= 0 ? playable[exact - 1] : playable.filter((i) => i < (selected?.row_index ?? 0)).at(-1);
  const nextIdx = exact >= 0 ? playable[exact + 1] : playable.find((i) => i > (selected?.row_index ?? -1));

  const play = () => {
    if (run.paused) return run.setPaused(false);
    if (!ds || !playable.length) return;
    const startPos = Math.max(0, pos);
    const items = playable.slice(startPos);
    setPlaylist(items);
    setLockedObject(resolveObject(selected));
    run.playback(items.length, (i) => sourceForIndex(items[i]), (i) => setOffset(Math.floor(items[i] / PAGE) * PAGE)).finally(() => setLockedObject(null));
  };

  const stopAll = () => {
    run.reset();
    setPlaylist(null);
    setLockedObject(null);
    selectIndex(playable[0]);
  };

  const controls = ds && (
    <Panel
      title="Selected sample"
      icon={<Database className="h-4 w-4" />}
      subtitle={selected ? `Row index ${selected.row_index} · row id ${selected.row_id} · ${ds.name}` : "Select a row in the preview table"}
      tag={selected && <Badge tone={selected.status === "valid" ? "good" : selected.status === "warning" ? "warn" : "bad"}>{selected.status}</Badge>}
    >
      {selected ? (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="selected-row-values">
            {FEATURE_ORDER.map((f) => (
              <div key={f} className="rounded-lg border border-line bg-surface-2/60 px-2.5 py-2">
                <dt className="text-[10px] uppercase tracking-[0.12em] text-muted">{FEATURE_META[f].label}</dt>
                <dd className={cx("font-mono text-[14px] font-semibold tabular", selected.features[f] === null ? "text-bad" : "text-ink")} data-feature={f}>
                  {formatFeature(f, selected.features[f])} <span className="text-[10px] font-normal text-muted">{FEATURE_META[f].unit}</span>
                </dd>
                {selected.conversions[f] && <dd className="text-[10px] text-warn">converted: {selected.conversions[f]}</dd>}
              </div>
            ))}
          </dl>
          <details className="text-[12px]">
            <summary className="cursor-pointer text-muted hover:text-ink">Raw row as uploaded</summary>
            <pre className="mt-1.5 max-h-32 overflow-auto rounded-lg bg-surface-2 p-2 font-mono text-[11px] text-ink-2">{JSON.stringify(selected.raw, null, 2)}</pre>
          </details>
          {selected.issues.length > 0 && (
            <Notice tone={selected.status === "invalid" ? "bad" : "warn"}>{selected.issues.map((i) => i.message).join(" · ")}</Notice>
          )}
          {selected.out_of_distribution.length > 0 && (
            <Notice tone="warn">Outside the training distribution: {selected.out_of_distribution.map((o) => FEATURE_META[o.feature].label).join(", ")} — the grip engine will add a safety margin.</Notice>
          )}
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label="Object form in the 3D scene" htmlFor="obj" hint="The row only contains tactile readings. 'Auto' uses the row's label if present, otherwise a neutral cube.">
              <Select id="obj" value={objectChoice} onChange={(e) => setObjectChoice(e.target.value)} disabled={run.running}>
                <option value="auto">Auto ({catalog.objectById[resolveObject(selected)]?.name})</option>
                {catalog.objects.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Toggle checked={persist} onChange={setPersist} label="Save to history" />
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <Button
              variant="primary"
              size="lg"
              data-testid="simulate-sample"
              onClick={simulateSelected}
              disabled={run.running || selected.status === "invalid"}
              loading={run.running && !playlist}
              icon={<Play className="h-4 w-4" />}
            >
              SIMULATE THIS SAMPLE
            </Button>
            {selected.status === "invalid" && <span className="text-sm text-bad">This row is invalid and cannot enter the pipeline.</span>}
          </div>
          <div className="rounded-xl border border-line bg-surface-2/50 p-3" aria-label="Dataset playback">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[13px] font-medium">
                Dataset playback{" "}
                <span className="font-normal text-muted">
                  — {playable.length} simulatable rows{playable.length >= 200 ? " (first 400 max)" : ""}; each row re-enters the full pipeline
                </span>
              </div>
              <Segmented size="sm" label="Playback speed" value={speed} onChange={setSpeed} options={SPEEDS.map((s) => ({ value: s, label: `${s}x` }))} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" aria-label="First row" disabled={playing} onClick={() => selectIndex(playable[0])} icon={<ChevronsLeft className="h-4 w-4" />}>
                First
              </Button>
              <Button size="sm" aria-label="Previous row" disabled={playing || prevIdx === undefined} onClick={() => selectIndex(prevIdx)} icon={<StepBack className="h-4 w-4" />}>
                Previous
              </Button>
              {playing && !run.paused ? (
                <Button size="sm" variant="primary" onClick={() => run.setPaused(true)} icon={<Pause className="h-4 w-4" />}>
                  Pause
                </Button>
              ) : (
                <Button size="sm" variant="primary" data-testid="playback-play" disabled={(run.running && !run.paused) || !playable.length} onClick={play} icon={<Play className="h-4 w-4" />}>
                  {run.paused ? "Resume" : "Play"}
                </Button>
              )}
              <Button size="sm" aria-label="Next row" disabled={playing || nextIdx === undefined} onClick={() => selectIndex(nextIdx)} icon={<StepForward className="h-4 w-4" />}>
                Next
              </Button>
              <Button size="sm" aria-label="Last row" disabled={playing} onClick={() => selectIndex(playable.at(-1))} icon={<ChevronsRight className="h-4 w-4" />}>
                Last
              </Button>
              <Button size="sm" variant="ghost" onClick={stopAll} icon={<RotateCcw className="h-4 w-4" />}>
                Reset
              </Button>
              {playing && <Badge tone="accent">{run.paused ? "paused (after current row)" : `playing row ${selected?.row_id ?? ""}`}</Badge>}
            </div>
          </div>
        </div>
      ) : (
        <EmptyState title="No row selected">Click a row in the preview table to inspect its sensor values.</EmptyState>
      )}
    </Panel>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">External Data Studio</h1>
          <p className="text-sm text-muted">Upload CSV/JSON tactile datasets, map columns, and push any exact row through the real prediction pipeline.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface-2 px-3 text-xs font-medium hover:bg-surface-3" href={api.templateUrl("csv")} download>
            <Download className="h-3.5 w-3.5" /> Sample CSV
          </a>
          <a className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface-2 px-3 text-xs font-medium hover:bg-surface-3" href={api.templateUrl("json")} download>
            <Download className="h-3.5 w-3.5" /> Sample JSON
          </a>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Panel title="Upload dataset" subtitle="Columns: pressure, temperature, vibration, conductivity, contact_duration (+ optional material, row_id)">
            <UploadDropzone onFile={(f) => upload.mutate(f)} busy={upload.isPending} />
            {upload.isError && <ErrorState className="mt-3" title="Upload rejected" error={new Error(errorMessage(upload.error))} />}
          </Panel>
          <Panel title="Your datasets">
            {datasets.isLoading && <LoadingBlock />}
            {datasets.isError && <ErrorState error={datasets.error} onRetry={() => datasets.refetch()} />}
            {datasets.data && list.length === 0 && <EmptyState title="No datasets yet">Upload a file or download the sample CSV to try the workflow.</EmptyState>}
            <ul className="space-y-1.5">
              {list.map((d) => (
                <li key={d.id}>
                  <div className={cx("flex items-center gap-2 rounded-xl border px-3 py-2", d.id === activeId ? "border-accent/50 bg-accent-soft" : "border-line bg-surface-2/50")}>
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        setDatasetId(d.id);
                        setOffset(0);
                        setSelected(null);
                        run.reset();
                      }}
                    >
                      <div className="truncate text-[13px] font-medium">{d.name}</div>
                      <div className="text-[11px] text-muted">
                        {d.row_count} rows · {d.summary.simulatable_rows} simulatable · {relativeTime(d.created_at)}
                      </div>
                    </button>
                    <Button size="sm" variant="ghost" aria-label={`Delete ${d.name}`} onClick={() => confirm(`Delete dataset "${d.name}"?`) && remove.mutate(d.id)} icon={<Trash2 className="h-3.5 w-3.5" />} />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <div className="min-w-0 space-y-4">
          {!activeId && <EmptyState icon={<Database className="h-6 w-6" />} title="Upload a dataset to begin" className="min-h-64" />}
          {activeId && dataset.isLoading && <LoadingBlock label="Loading dataset…" className="min-h-64" />}
          {dataset.isError && <ErrorState error={dataset.error} onRetry={() => dataset.refetch()} />}
          {ds && (
            <>
              <Panel title={ds.name} subtitle="Parsed, validated and schema-mapped on the server" tag={<Badge tone="accent">dataset #{ds.id}</Badge>}>
                <DatasetSummary ds={ds} />
              </Panel>
              <MappingEditor dataset={ds} onSave={(m) => saveMapping.mutate(m)} onReset={() => resetMapping.mutate()} saving={saveMapping.isPending || resetMapping.isPending} />
              {saveMapping.isError && <ErrorState title="Mapping rejected" error={new Error(errorMessage(saveMapping.error))} />}
            </>
          )}
        </div>
      </div>

      {ds && (
        <Panel title="Dataset preview" subtitle="Values shown after mapping and unit conversion — exactly what the pipeline receives. Click a row to select it.">
          {rows.isError && <ErrorState error={rows.error} onRetry={() => rows.refetch()} />}
          <RowTable
            rows={rows.data?.rows ?? []}
            total={rows.data?.total ?? 0}
            offset={offset}
            limit={PAGE}
            loading={rows.isLoading}
            selected={selected?.row_index ?? null}
            onSelect={(r) => !playing && setSelected(r)}
            onPage={setOffset}
            filter={filter}
            onFilter={(f) => {
              setFilter(f);
              setOffset(0);
            }}
          />
        </Panel>
      )}

      {ds && <SimulationWorkbench run={run} object={object} knownMaterial={run.sample?.groundTruth ?? null} source="UPLOADED" controls={controls} />}

      {ds && <BatchPanel dataset={ds} objectId={objectChoice === "auto" ? null : objectChoice} />}
    </div>
  );
}
