import { Box, Cylinder, GlassWater, Milk, Package, Volleyball } from "lucide-react";
import type { ReactNode } from "react";
import type { VirtualObject } from "@/api/types";
import { cx } from "@/components/ui";

export const OBJECT_ICON: Record<string, ReactNode> = {
  glass: <GlassWater className="h-5 w-5" aria-hidden />,
  bottle: <Milk className="h-5 w-5" aria-hidden />,
  cube: <Box className="h-5 w-5" aria-hidden />,
  ball: <Volleyball className="h-5 w-5" aria-hidden />,
  container: <Package className="h-5 w-5" aria-hidden />,
  steel: <Cylinder className="h-5 w-5" aria-hidden />,
};

export function ObjectPicker({
  objects,
  value,
  onChange,
  disabled,
}: {
  objects: VirtualObject[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Virtual object" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {objects.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          disabled={disabled}
          onClick={() => onChange(o.id)}
          title={`${o.profile.name}: ${o.profile.description}`}
          className={cx(
            "flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-center transition-colors disabled:opacity-50",
            value === o.id ? "border-accent/60 bg-accent-soft text-ink" : "border-line bg-surface-2/60 text-ink-2 hover:border-line-strong hover:text-ink",
          )}
        >
          <span className={value === o.id ? "text-accent" : "text-muted"}>{OBJECT_ICON[o.id]}</span>
          <span className="text-[12px] font-medium leading-tight">{o.name}</span>
        </button>
      ))}
    </div>
  );
}
