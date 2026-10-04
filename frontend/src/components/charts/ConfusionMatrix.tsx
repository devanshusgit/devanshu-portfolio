import { useState } from "react";
import type { ConfusionMatrix as CM } from "@/api/types";
import { cx } from "@/components/ui";

/**
 * Confusion matrix heatmap. Sequential single-hue encoding (accent), row-normalised
 * so each true class reads as recall; counts are always printed (never color alone).
 */
export function ConfusionMatrix({ data, caption, className }: { data: CM; caption?: string; className?: string }) {
  const [hover, setHover] = useState<[number, number] | null>(null);
  const n = data.labels.length;
  const rowSums = data.matrix.map((r) => r.reduce((a, b) => a + b, 0));
  const total = rowSums.reduce((a, b) => a + b, 0);
  if (!total) return <p className="text-sm text-muted">No labelled samples yet.</p>;
  return (
    <figure className={cx("overflow-x-auto", className)}>
      <table className="w-full border-separate border-spacing-[2px] text-[11.5px]" aria-label="Confusion matrix (rows: true class, columns: predicted class)">
        <thead>
          <tr>
            <th className="w-20 p-1 text-left font-normal text-muted">
              <span className="sr-only">True class</span>true ↓ / pred →
            </th>
            {data.labels.map((l) => (
              <th key={l} scope="col" className="p-1 text-center font-medium text-ink-2">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.matrix.map((row, i) => (
            <tr key={data.labels[i]}>
              <th scope="row" className="p-1 text-left font-medium text-ink-2">
                {data.labels[i]}
              </th>
              {row.map((v, j) => {
                const share = rowSums[i] ? v / rowSums[i] : 0;
                const diag = i === j;
                const active = hover && hover[0] === i && hover[1] === j;
                return (
                  <td
                    key={j}
                    onMouseEnter={() => setHover([i, j])}
                    onMouseLeave={() => setHover(null)}
                    title={`true ${data.labels[i]} → predicted ${data.labels[j]}: ${v} (${(share * 100).toFixed(1)}% of ${data.labels[i]})`}
                    className={cx("h-9 min-w-10 rounded-[4px] text-center font-mono tabular transition-shadow", active && "ring-2 ring-ink/60")}
                    style={{
                      background: v === 0 ? "var(--surface-2)" : `color-mix(in oklab, ${diag ? "var(--accent)" : "var(--bad)"} ${Math.round(12 + share * 78)}%, var(--surface))`,
                      color: share > 0.55 ? "#04121a" : "var(--text)",
                    }}
                  >
                    {v}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <figcaption className="mt-1.5 text-[11px] text-muted">
        {caption ?? "Rows: true class · columns: predicted class · shading = share of the true class."} {n}×{n}, {total} samples.
      </figcaption>
    </figure>
  );
}
