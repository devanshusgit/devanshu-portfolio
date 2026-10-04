import { create } from "zustand";
import { api, errorMessage, wsUrl } from "@/api/client";
import type { LiveSample, LiveStatus } from "@/api/types";
import { useAuth } from "./auth";

export type Transport = "disconnected" | "connecting" | "websocket" | "polling";

interface LiveState {
  transport: Transport;
  status: LiveStatus | null;
  samples: LiveSample[];
  latencyMs: number | null;
  lastTest: { ok: boolean; message: string; at: number } | null;
  error: string | null;
  connect: () => void;
  disconnect: () => void;
  testConnection: () => Promise<void>;
}

const MAX_SAMPLES = 240;
let socket: WebSocket | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let manualClose = false;
let pingSent: Record<number, (ms: number) => void> = {};

function addSamples(state: LiveState, incoming: LiveSample[]): LiveSample[] {
  if (!incoming.length) return state.samples;
  const seen = new Set(state.samples.map((s) => s.seq));
  const merged = [...state.samples, ...incoming.filter((s) => !seen.has(s.seq))].sort((a, b) => a.seq - b.seq);
  return merged.slice(-MAX_SAMPLES);
}

export const useLive = create<LiveState>((set, get) => {
  const startPolling = (reason: string) => {
    if (pollTimer) return;
    set({ transport: "polling", error: reason });
    const tick = async () => {
      const last = get().samples.at(-1)?.seq ?? 0;
      try {
        const r = await api.liveLatest(last);
        set((s) => ({ status: r.status, samples: addSamples(s, r.samples) }));
      } catch (e) {
        set({ error: errorMessage(e) });
      }
    };
    tick();
    pollTimer = setInterval(tick, 1000);
  };

  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };

  return {
    transport: "disconnected",
    status: null,
    samples: [],
    latencyMs: null,
    lastTest: null,
    error: null,

    connect: () => {
      const token = useAuth.getState().token;
      if (!token || socket) return;
      manualClose = false;
      set({ transport: "connecting", error: null });
      let opened = false;
      try {
        socket = new WebSocket(wsUrl("/ws/sensors", { token }));
      } catch {
        socket = null;
        startPolling("WebSocket unavailable — using REST polling fallback");
        return;
      }
      socket.onopen = () => {
        opened = true;
        stopPolling();
        set({ transport: "websocket", error: null });
      };
      socket.onmessage = (ev) => {
        let msg: { type: string; t?: number } & Record<string, unknown>;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === "status") set({ status: msg as unknown as LiveStatus });
        else if (msg.type === "sample") set((s) => ({ samples: addSamples(s, [msg as unknown as LiveSample]) }));
        else if (msg.type === "pong" && typeof msg.t === "number") {
          const cb = pingSent[msg.t];
          if (cb) {
            cb(performance.now() - msg.t);
            delete pingSent[msg.t];
          }
        }
      };
      socket.onclose = () => {
        socket = null;
        if (manualClose) return set({ transport: "disconnected" });
        // Unexpected close (proxy without WS support, network drop): fall back to polling.
        startPolling(opened ? "WebSocket closed — switched to REST polling" : "WebSocket blocked — using REST polling fallback");
      };
      socket.onerror = () => {
        set({ error: "WebSocket error" });
      };
    },

    disconnect: () => {
      manualClose = true;
      stopPolling();
      socket?.close();
      socket = null;
      pingSent = {};
      set({ transport: "disconnected" });
    },

    testConnection: async () => {
      const started = performance.now();
      try {
        if (socket && socket.readyState === WebSocket.OPEN) {
          const t = performance.now();
          const ms = await new Promise<number>((resolve, reject) => {
            pingSent[t] = resolve;
            socket!.send(JSON.stringify({ type: "ping", t }));
            setTimeout(() => reject(new Error("WebSocket ping timed out")), 4000);
          });
          set({ latencyMs: ms, lastTest: { ok: true, message: `WebSocket round-trip ${ms.toFixed(1)} ms`, at: Date.now() } });
        } else {
          const status = await api.liveStatus();
          const ms = performance.now() - started;
          set({ status, latencyMs: ms, lastTest: { ok: true, message: `REST round-trip ${ms.toFixed(1)} ms (WebSocket not open)`, at: Date.now() } });
        }
      } catch (e) {
        set({ lastTest: { ok: false, message: errorMessage(e), at: Date.now() } });
      }
    },
  };
});

/** Latest buffered live sample that is in contact and was classified. */
export function latestClassified(samples: LiveSample[]): LiveSample | null {
  for (let i = samples.length - 1; i >= 0; i--) if (samples[i].prediction) return samples[i];
  return null;
}
