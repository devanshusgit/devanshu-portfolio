import { useEffect, useState } from "react";
import type { ReactNode } from "react";

const VARS = [
  "--m-glass",
  "--m-wood",
  "--m-plastic",
  "--m-rubber",
  "--m-fabric",
  "--m-steel",
  "--m-uncertain",
  "--chart-grid",
  "--chart-axis",
  "--accent",
  "--accent-2",
  "--good",
  "--warn",
  "--bad",
  "--text",
  "--text-2",
  "--surface",
  "--border-strong",
] as const;

export type ThemeColors = Record<(typeof VARS)[number], string>;

function read(): ThemeColors {
  const cs = getComputedStyle(document.documentElement);
  return Object.fromEntries(VARS.map((v) => [v, cs.getPropertyValue(v).trim() || "#888"])) as ThemeColors;
}

/** Resolved theme colours for SVG charts; updates when the theme toggles. */
export function useThemeColors(): ThemeColors {
  const [colors, setColors] = useState<ThemeColors>(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setColors(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return colors;
}

export function materialColor(c: ThemeColors, material: string): string {
  const key = `--m-${material.toLowerCase()}` as keyof ThemeColors;
  return c[key] ?? c["--m-uncertain"];
}

export function sourceColor(c: ThemeColors, source: string): string {
  return source === "SIMULATED" ? c["--m-glass"] : source === "UPLOADED" ? c["--m-wood"] : c["--m-plastic"];
}

export const axisProps = (c: ThemeColors) => ({
  stroke: c["--chart-axis"],
  tick: { fill: c["--chart-axis"], fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: c["--border-strong"] },
});

export function ChartTooltip({ active, payload, label, unit, formatter }: { active?: boolean; payload?: { name?: string; value?: number; color?: string; payload?: Record<string, unknown> }[]; label?: ReactNode; unit?: string; formatter?: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-xs shadow-xl">
      {label !== undefined && <div className="mb-1 font-medium text-ink">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-ink-2">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
          <span>{p.name}</span>
          <span className="ml-auto pl-3 font-mono text-ink">
            {typeof p.value === "number" ? (formatter ? formatter(p.value) : p.value) : String(p.value)}
            {unit}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-ink-2" aria-label="Legend">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: i.color }} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
