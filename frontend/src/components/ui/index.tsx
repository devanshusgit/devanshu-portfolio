import { clsx } from "clsx";
import { AlertTriangle, CheckCircle2, Info, Loader2, OctagonAlert, RefreshCw, X } from "lucide-react";
import { forwardRef, useEffect, useId, useRef } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export const cx = clsx;

/* ------------------------------------------------------------------ Panel */
export function Panel({
  title,
  subtitle,
  icon,
  actions,
  children,
  className,
  bodyClassName,
  tag,
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  tag?: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className={cx("rounded-2xl border border-line bg-surface shadow-panel", className)} aria-label={typeof title === "string" ? title : undefined}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex min-w-0 items-start gap-2.5">
            {icon && <span className="mt-0.5 text-accent">{icon}</span>}
            <div className="min-w-0">
              <h2 className="flex flex-wrap items-center gap-2 font-display text-[15px] font-semibold tracking-tight text-ink">
                {title}
                {tag}
              </h2>
              {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ----------------------------------------------------------------- Button */
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg"; loading?: boolean; icon?: ReactNode }
>(function Button({ variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "h-8 px-3 text-xs",
        size === "md" && "h-9 px-3.5 text-sm",
        size === "lg" && "h-11 px-5 text-sm tracking-wide",
        variant === "primary" && "bg-accent text-[#04121a] hover:brightness-110 shadow-[0_0_0_1px_rgba(34,211,238,0.3),0_8px_24px_-8px_rgba(34,211,238,0.55)]",
        variant === "secondary" && "border border-line-strong bg-surface-2 text-ink hover:bg-surface-3",
        variant === "ghost" && "text-ink-2 hover:bg-surface-2 hover:text-ink",
        variant === "danger" && "border border-bad/40 bg-bad-soft text-bad hover:bg-bad/20",
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------ Badge */
export type Tone = "neutral" | "accent" | "good" | "warn" | "bad" | "violet";
const toneClass: Record<Tone, string> = {
  neutral: "border-line-strong bg-surface-2 text-ink-2",
  accent: "border-accent/30 bg-accent-soft text-accent",
  good: "border-good/30 bg-good-soft text-good",
  warn: "border-warn/40 bg-warn-soft text-warn",
  bad: "border-bad/40 bg-bad-soft text-bad",
  violet: "border-accent-2/30 bg-accent-2/10 text-accent-2",
};

export function Badge({ tone = "neutral", children, className, dot, title }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-wider", toneClass[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

/** Status always carries an icon + label, never color alone. */
export function StatusPill({ status, className }: { status: "NOMINAL" | "CAUTION" | "WARNING" | string; className?: string }) {
  const tone: Tone = status === "NOMINAL" ? "good" : status === "CAUTION" ? "warn" : status === "WARNING" ? "bad" : "neutral";
  const Icon = status === "NOMINAL" ? CheckCircle2 : status === "CAUTION" ? AlertTriangle : OctagonAlert;
  return (
    <Badge tone={tone} className={className}>
      <Icon className="h-3 w-3" aria-hidden />
      {status}
    </Badge>
  );
}

export function MaterialSwatch({ material, className }: { material: string; className?: string }) {
  return <span aria-hidden className={cx("inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]", className)} style={{ background: `var(--m-${material.toLowerCase()}, var(--m-uncertain))` }} />;
}

export function MaterialLabel({ material, className }: { material: string; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5", className)}>
      <MaterialSwatch material={material} />
      {material}
    </span>
  );
}

/* ------------------------------------------------------------- Stat tile */
export function Stat({ label, value, sub, tone, className, mono = true }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone; className?: string; mono?: boolean }) {
  return (
    <div className={cx("rounded-xl border border-line bg-surface-2/60 px-3 py-2.5", className)}>
      <div className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted">{label}</div>
      <div
        className={cx(
          "mt-1 truncate text-xl font-semibold text-ink",
          mono && "font-mono tabular",
          tone === "good" && "text-good",
          tone === "warn" && "text-warn",
          tone === "bad" && "text-bad",
          tone === "accent" && "text-accent",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}

/* --------------------------------------------------------- state blocks */
export function Spinner({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cx("flex items-center gap-2 text-sm text-muted", className)}>
      <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden />
      {label}
    </div>
  );
}

export function LoadingBlock({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={cx("flex min-h-28 items-center justify-center rounded-xl border border-dashed border-line", className)}>
      <Spinner label={label} />
    </div>
  );
}

export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line px-6 py-10 text-center", className)}>
      {icon && <div className="text-muted">{icon}</div>}
      <div className="font-medium text-ink">{title}</div>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className, title = "Something went wrong" }: { error: unknown; onRetry?: () => void; className?: string; title?: string }) {
  const msg = error instanceof Error ? error.message : String(error ?? "Unknown error");
  return (
    <div role="alert" className={cx("flex items-start gap-3 rounded-xl border border-bad/40 bg-bad-soft px-4 py-3 text-sm", className)}>
      <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0 text-bad" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-ink">{title}</div>
        <div className="mt-0.5 break-words text-ink-2">{msg}</div>
      </div>
      {onRetry && (
        <Button size="sm" variant="ghost" onClick={onRetry} icon={<RefreshCw className="h-3.5 w-3.5" />}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Notice({ tone = "accent", children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  const Icon = tone === "bad" ? OctagonAlert : tone === "warn" ? AlertTriangle : tone === "good" ? CheckCircle2 : Info;
  return (
    <div className={cx("flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-[13px] leading-relaxed", toneClass[tone], className)}>
      <span className="mt-0.5 shrink-0">{icon ?? <Icon className="h-4 w-4" aria-hidden />}</span>
      <div className="min-w-0 text-ink-2">{children}</div>
    </div>
  );
}

/* --------------------------------------------------------------- inputs */
export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted">{hint}</p>
      )}
    </div>
  );
}

const inputBase =
  "w-full rounded-lg border border-line-strong bg-surface-2 px-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(inputBase, "h-9", className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(inputBase, "h-9 pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx("relative h-6 w-11 shrink-0 rounded-full border transition-colors", checked ? "border-accent/50 bg-accent" : "border-line-strong bg-surface-3", disabled && "opacity-50")}
      >
        <span className={cx("absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-5.5" : "translate-x-0.5")} />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode; disabled?: boolean }[];
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("inline-flex flex-wrap gap-1 rounded-xl border border-line bg-surface-2 p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-40",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-[13px]",
            value === o.value ? "bg-surface text-ink shadow-sm ring-1 ring-line-strong" : "text-muted hover:text-ink",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({ value, max = 100, color, label, className }: { value: number; max?: number; color?: string; label?: string; className?: string }) {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cx("h-2 w-full overflow-hidden rounded-full bg-surface-3", className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${w}%`, background: color ?? "var(--accent)" }} />
    </div>
  );
}

/* ---------------------------------------------------------------- Drawer */
export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" aria-label="Close" onClick={onClose} />
      <div ref={ref} tabIndex={-1} className="relative flex h-full w-full max-w-xl flex-col border-l border-line bg-surface shadow-2xl outline-none">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="font-display text-base font-semibold">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close panel" icon={<X className="h-4 w-4" />} />
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function SimulatedTag({ label = "SIMULATED", className }: { label?: string; className?: string }) {
  return (
    <Badge tone="violet" className={className} title="Values are generated by the physics-inspired simulator, not measured by physical hardware.">
      <span className="h-1.5 w-1.5 animate-ng-pulse rounded-full bg-current" aria-hidden />
      {label}
    </Badge>
  );
}

export function KeyValue({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cx("grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]", className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-right font-mono text-ink tabular">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
