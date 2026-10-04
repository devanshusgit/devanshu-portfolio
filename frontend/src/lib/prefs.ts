import { useEffect, useSyncExternalStore } from "react";
import { create } from "zustand";
import type { UserSettings } from "@/api/types";

export type Theme = "dark" | "light" | "system";

const DEFAULTS: UserSettings = {
  theme: "dark",
  reduced_motion: false,
  default_object: "glass",
  playback_speed: 1,
  auto_save_history: true,
  record_playback: true,
  show_sensor_labels: true,
};

function readTheme(): Theme {
  try {
    const t = localStorage.getItem("ng-theme");
    if (t === "light" || t === "dark" || t === "system") return t;
  } catch {
    /* ignore */
  }
  return "dark";
}

export function applyTheme(theme: Theme) {
  const resolved = theme === "system" ? (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark") : theme;
  const root = document.documentElement;
  if (root.dataset.theme !== resolved) {
    // Swap the palette in a single paint: otherwise every transition-colors element
    // animates at once over a full-page repaint, which stalls weaker GPUs.
    root.dataset.themeSwitching = "";
    root.dataset.theme = resolved;
    requestAnimationFrame(() => requestAnimationFrame(() => delete root.dataset.themeSwitching));
  }
  try {
    localStorage.setItem("ng-theme", theme);
  } catch {
    /* ignore */
  }
}

interface PrefsState extends UserSettings {
  loaded: boolean;
  set: (patch: Partial<UserSettings>) => void;
  hydrate: (s: UserSettings) => void;
}

export const usePrefs = create<PrefsState>((set) => ({
  ...DEFAULTS,
  theme: readTheme(),
  loaded: false,
  set: (patch) => set(patch),
  hydrate: (s) => set({ ...s, loaded: true }),
}));

/** Keep <html data-theme / data-reduced-motion> in sync with preferences. */
export function usePrefsEffects() {
  const theme = usePrefs((s) => s.theme);
  const reduced = usePrefs((s) => s.reduced_motion);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const on = () => applyTheme("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reduced);
  }, [reduced]);
}

function subscribeMotion(cb: () => void) {
  const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  mq?.addEventListener("change", cb);
  return () => mq?.removeEventListener("change", cb);
}

/** True when either the OS or the user's NeuroGrip setting asks for reduced motion. */
export function useReducedMotion(): boolean {
  const os = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    () => false,
  );
  const user = usePrefs((s) => s.reduced_motion);
  return os || user;
}

export function resolvedThemeIsDark(): boolean {
  return document.documentElement.dataset.theme !== "light";
}
