import { create } from "zustand";
import { api, errorMessage } from "@/api/client";
import type { PhoneFeed, PhoneTap } from "@/api/types";

/**
 * Dashboard side of the phone sensor: polls /api/phone/feed (database-backed, so it works
 * across server instances) and keeps the recent taps plus the phone's live status.
 */
interface PhoneFeedState {
  taps: PhoneTap[];
  device: PhoneFeed["device"] | null;
  error: string | null;
  active: boolean;
  /** Round trip of the last poll (ms). */
  pollMs: number | null;
  start: () => void;
  stop: () => void;
}

const POLL_MS = 400;
let timer: ReturnType<typeof setTimeout> | null = null;
let users = 0;

export const usePhoneFeed = create<PhoneFeedState>((set, get) => {
  const tick = async () => {
    if (!get().active) return;
    const last = get().taps.at(-1)?.id ?? 0;
    const t0 = performance.now();
    try {
      const r = await api.phoneFeed(last);
      const seen = new Set(get().taps.map((t) => t.id));
      const merged = [...get().taps, ...r.taps.filter((t) => !seen.has(t.id))].slice(-50);
      set({ taps: merged, device: r.device, error: null, pollMs: performance.now() - t0 });
    } catch (e) {
      set({ error: errorMessage(e) });
    }
    if (get().active) timer = setTimeout(tick, POLL_MS);
  };

  return {
    taps: [],
    device: null,
    error: null,
    active: false,
    pollMs: null,
    start: () => {
      users++;
      if (get().active) return;
      set({ active: true });
      tick();
    },
    stop: () => {
      users = Math.max(0, users - 1);
      if (users > 0) return;
      if (timer) clearTimeout(timer);
      timer = null;
      set({ active: false });
    },
  };
});
