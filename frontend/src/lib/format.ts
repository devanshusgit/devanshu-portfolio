import type { FeatureName, Material, SafetyStatus } from "@/api/types";

export const MATERIAL_ORDER: Material[] = ["Glass", "Wood", "Plastic", "Rubber", "Fabric", "Steel"];

/** Validated categorical palette (CSS variables switch per theme). */
export const MATERIAL_COLOR: Record<string, string> = {
  Glass: "var(--m-glass)",
  Wood: "var(--m-wood)",
  Plastic: "var(--m-plastic)",
  Rubber: "var(--m-rubber)",
  Fabric: "var(--m-fabric)",
  Steel: "var(--m-steel)",
  Uncertain: "var(--m-uncertain)",
};

export const SOURCE_COLOR: Record<string, string> = {
  SIMULATED: "var(--m-glass)",
  UPLOADED: "var(--m-wood)",
  LIVE: "var(--m-plastic)",
};

export const FEATURE_META: Record<FeatureName, { label: string; short: string; unit: string }> = {
  pressure: { label: "Pressure", short: "P", unit: "kPa" },
  temperature: { label: "Temperature", short: "T", unit: "°C" },
  vibration: { label: "Vibration", short: "V", unit: "Hz" },
  conductivity: { label: "Conductivity", short: "σ", unit: "S/m" },
  contact_duration: { label: "Contact duration", short: "t", unit: "s" },
};

export const FEATURE_ORDER: FeatureName[] = ["pressure", "temperature", "vibration", "conductivity", "contact_duration"];

export function formatFeature(name: FeatureName, value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  switch (name) {
    case "pressure":
      return value.toFixed(1);
    case "temperature":
      return value.toFixed(2);
    case "vibration":
      return value >= 1000 ? value.toFixed(0) : value.toFixed(1);
    case "conductivity":
      return formatSci(value);
    case "contact_duration":
      return value.toFixed(3);
  }
}

export function formatSci(value: number): string {
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 0.01 && abs < 10000) return value.toPrecision(3);
  const exp = Math.floor(Math.log10(abs));
  const mant = value / 10 ** exp;
  return `${mant.toFixed(2)}e${exp}`;
}

export const pct = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`);

export const SAFETY_TONE: Record<SafetyStatus, "good" | "warn" | "bad"> = { NOMINAL: "good", CAUTION: "warn", WARNING: "bad" };

export function confidenceTone(level: string): "good" | "warn" | "bad" {
  return level === "HIGH" ? "good" : level === "MODERATE" ? "warn" : "bad";
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 2) return "just now";
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

export function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const INJECTION = /^[=+\-@\t\r]/;

/** CSV cell escaping with spreadsheet formula-injection protection. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (typeof value === "string" && INJECTION.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  return [columns.join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
}

export function objectName(id: string | null | undefined): string {
  const names: Record<string, string> = {
    glass: "Glass",
    bottle: "Bottle",
    cube: "Cube",
    ball: "Ball",
    container: "Plastic Container",
    steel: "Steel Object",
  };
  return id ? (names[id] ?? id) : "—";
}
