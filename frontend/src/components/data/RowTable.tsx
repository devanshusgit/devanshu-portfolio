import { ChevronLeft, ChevronRight } from "lucide-react";
import type { RowView } from "@/api/types";
import { Badge, Button, LoadingBlock, Segmented, cx } from "@/components/ui";
import { FEATURE_META, FEATURE_ORDER, formatFeature } from "@/lib/format";

export type StatusFilter = "all" | "valid" | "warning" | "invalid";

export function RowTable({
  rows,
  total,
  offset,
  limit,
  loading,
  selected,
  onSelect,
  onPage,
  filter,
  onFilter,
}: {
  rows: RowView[];
  total: number;
  offset: number;
  limit: number;
  loading?: boolean;
  selected: number | null;
  onSelect: (row: RowView) => void;
  onPage: (offset: number) => void;
  filter: StatusFilter;
  onFilter: (f: StatusFilter) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Segmented
          size="sm"
          label="Row status filter"
          value={filter}
          onChange={onFilter}
          options={[
            { value: "all", label: "All" },
            { value: "valid", label: "Valid" },
            { value: "warning", label: "Warnings" },
            { value: "invalid", label: "Invalid" },
          ]}
        />
        <div className="flex items-center gap-2 text-xs text-muted">
          {total > 0 ? `${offset + 1}–${Math.min(offset + limit, total)} of ${total}` : "0 rows"}
          <Button size="sm" variant="ghost" aria-label="Previous page" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - limit))} icon={<ChevronLeft className="h-4 w-4" />} />
          <Button size="sm" variant="ghost" aria-label="Next page" disabled={offset + limit >= total} onClick={() => onPage(offset + limit)} icon={<ChevronRight className="h-4 w-4" />} />
        </div>
      </div>
      {loading ? (
        <LoadingBlock label="Loading rows…" />
      ) : (
        <div className="max-h-[420px] overflow-auto rounded-xl border border-line">
          <table className="w-full min-w-[720px] text-[12.5px]" data-testid="row-table">
            <caption className="sr-only">Dataset preview. Select a row to inspect and simulate it.</caption>
            <thead className="sticky top-0 z-10 bg-surface-2">
              <tr className="text-left text-[10.5px] uppercase tracking-wider text-muted">
                <th scope="col" className="px-2.5 py-2">#</th>
                <th scope="col" className="px-2.5 py-2">row id</th>
                {FEATURE_ORDER.map((f) => (
                  <th key={f} scope="col" className="px-2.5 py-2 text-right">
                    {FEATURE_META[f].label} <span className="normal-case">({FEATURE_META[f].unit})</span>
                  </th>
                ))}
                <th scope="col" className="px-2.5 py-2">label</th>
                <th scope="col" className="px-2.5 py-2">status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isSel = r.row_index === selected;
                return (
                  <tr
                    key={r.row_index}
                    tabIndex={0}
                    aria-selected={isSel}
                    data-row-index={r.row_index}
                    onClick={() => onSelect(r)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(r))}
                    className={cx(
                      "cursor-pointer border-t border-line font-mono tabular outline-none transition-colors focus-visible:bg-accent-soft",
                      isSel ? "bg-accent-soft" : "hover:bg-surface-2",
                    )}
                  >
                    <td className="px-2.5 py-1.5 text-muted">{r.row_index}</td>
                    <td className="px-2.5 py-1.5 text-ink">{r.row_id}</td>
                    {FEATURE_ORDER.map((f) => {
                      const bad = r.issues.some((i) => i.feature === f);
                      const ood = r.out_of_distribution.some((o) => o.feature === f);
                      return (
                        <td key={f} className={cx("px-2.5 py-1.5 text-right", bad ? "text-bad" : ood ? "text-warn" : "text-ink-2")}>
                          {r.features[f] === null ? <span title={r.issues.find((i) => i.feature === f)?.message}>{bad ? "✕" : "—"}</span> : formatFeature(f, r.features[f])}
                        </td>
                      );
                    })}
                    <td className="px-2.5 py-1.5 font-sans text-ink-2">{r.label ?? (r.raw_label ? <span className="text-warn">{r.raw_label}?</span> : "—")}</td>
                    <td className="px-2.5 py-1.5">
                      <Badge tone={r.status === "valid" ? "good" : r.status === "warning" ? "warn" : "bad"}>{r.status}</Badge>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-muted">
                    No rows match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
