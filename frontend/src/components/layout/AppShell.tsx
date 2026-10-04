import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BarChart3,
  BrainCircuit,
  Database,
  FlaskConical,
  Hand,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Radio,
  Settings,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { useAuth } from "@/lib/auth";
import { useLive } from "@/lib/live";
import { usePrefs } from "@/lib/prefs";
import { Badge, Button, LoadingBlock, cx } from "@/components/ui";
import { Logo } from "./Logo";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/lab", label: "Virtual Prosthetic Lab", icon: Hand },
  { to: "/data-studio", label: "External Data Studio", icon: Database },
  { to: "/simulator", label: "Sensor Simulator", icon: Radio },
  { to: "/experiments", label: "Experiments", icon: FlaskConical },
  { to: "/history", label: "Predictions / History", icon: History },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/model", label: "ML Model", icon: BrainCircuit },
  { to: "/settings", label: "Settings", icon: Settings },
];

function SystemStatus() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 15000, retry: 0 });
  const ok = health.data?.status === "ok";
  const down = health.isError;
  return (
    <div className="hidden items-center gap-2 md:flex" aria-live="polite">
      <Badge tone={down ? "bad" : ok ? "good" : "warn"} dot>
        {down ? "API offline" : ok ? "API online" : "API degraded"}
      </Badge>
      {health.data?.model.version && (
        <Badge tone="violet" title={health.data.model.version}>
          <BrainCircuit className="h-3 w-3" aria-hidden />
          {health.data.model.training ? "training…" : "model ready"}
        </Badge>
      )}
      {health.data?.live.connected && (
        <Badge tone="accent" dot>
          <Activity className="h-3 w-3" aria-hidden /> live
        </Badge>
      )}
    </div>
  );
}

function ThemeToggle() {
  const theme = usePrefs((s) => s.theme);
  const set = usePrefs((s) => s.set);
  const dark = theme !== "light";
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => {
        const next = dark ? "light" : "dark";
        set({ theme: next });
        api.saveSettings({ theme: next }).catch(() => undefined);
      }}
      icon={dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    />
  );
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const user = useAuth((s) => s.user);
  const items = user?.role === "ADMIN" ? [...NAV, { to: "/admin", label: "Admin", icon: ShieldCheck }] : NAV;
  return (
    <nav aria-label="Main" className="space-y-0.5">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cx(
              "group flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors",
              isActive ? "bg-accent-soft text-ink ring-1 ring-accent/25" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon className={cx("h-4 w-4 shrink-0", isActive ? "text-accent" : "text-muted group-hover:text-ink-2")} aria-hidden />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pub = useQuery({ queryKey: ["public-settings"], queryFn: api.publicSettings, staleTime: 60000 });
  const current = [...NAV, { to: "/admin", label: "Admin" }].find((n) => location.pathname.startsWith(n.to));

  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen bg-bg bg-lab-grid">
      <a href="#main" className="sr-only z-50 rounded bg-accent px-3 py-2 text-black focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface/95 backdrop-blur lg:flex">
        <div className="flex h-16 items-center border-b border-line px-5">
          <Logo />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <NavItems />
        </div>
        <div className="border-t border-line p-3">
          <div className="rounded-xl border border-line bg-surface-2 p-3 text-xs leading-relaxed text-muted">
            Research prototype. Sensor data is <span className="font-medium text-accent-2">simulated</span> unless hardware is connected. Grip values are normalised
            simulation percentages — not clinical.
          </div>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="absolute inset-0 bg-black/50" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full w-72 border-r border-line bg-surface p-3">
            <div className="mb-3 flex items-center justify-between px-2 py-2">
              <Logo />
              <Button variant="ghost" size="sm" aria-label="Close navigation" onClick={() => setMobileOpen(false)} icon={<X className="h-4 w-4" />} />
            </div>
            <NavItems onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-md sm:px-6">
          <Button variant="ghost" size="sm" className="lg:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)} icon={<Menu className="h-5 w-5" />} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-[15px] font-semibold tracking-tight">{current?.label ?? "NeuroGrip"}</div>
          </div>
          <SystemStatus />
          <ThemeToggle />
          <div className="hidden text-right sm:block">
            <div className="text-xs font-medium text-ink">{user?.full_name || user?.email}</div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted">{user?.role}</div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Sign out"
            onClick={() => {
              useLive.getState().disconnect();
              logout();
              navigate("/login");
            }}
            icon={<LogOut className="h-4 w-4" />}
          />
        </header>
        {pub.data?.announcement && (
          <div className="border-b border-warn/30 bg-warn-soft px-6 py-2 text-center text-sm text-ink" role="status">
            {pub.data.announcement}
          </div>
        )}
        <main id="main" className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6">
          <Suspense fallback={<LoadingBlock label="Loading module…" className="min-h-[50vh]" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
