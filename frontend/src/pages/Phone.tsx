import { Mic, MicOff, Smartphone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "@/api/client";
import type { PhoneTap } from "@/api/types";
import { Logo } from "@/components/layout/Logo";
import { Badge, Button, Notice, Segmented, Toggle } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { FEEL_LABEL, type FeelOption, type TapMeasurement, TapSensor, tapToFeatures } from "@/lib/tapSensor";

const DEVICE = /iphone|ipad/i.test(navigator.userAgent) ? "iPhone" : /android/i.test(navigator.userAgent) ? "Android phone" : "Phone";

type Sent = { tap: PhoneTap | null; m: TapMeasurement; ms: number; error?: string };

/** Mobile page: the phone becomes a real tap sensor and streams each tap to NeuroGrip. */
export default function Phone() {
  const user = useAuth((s) => s.user);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [threshold, setThreshold] = useState(0.15);
  const [feel, setFeel] = useState<FeelOption>("cool");
  const [metal, setMetal] = useState(false);
  const [sent, setSent] = useState<Sent[]>([]);
  const [online, setOnline] = useState(false);

  const sensor = useRef<TapSensor | null>(null);
  const manual = useRef({ feel, metal });
  manual.current = { feel, metal };
  const levelMax = useRef(0);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (sensor.current) sensor.current.threshold = threshold;
  }, [threshold]);

  // Heartbeat: tells the dashboard the phone is connected and shows its live mic level.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const lv = levelMax.current;
      levelMax.current = 0;
      api
        .phoneHeartbeat({ device: DEVICE, level: Math.min(1, lv), listening: true })
        .then(() => setOnline(true))
        .catch(() => setOnline(false));
    }, 700);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => () => sensor.current?.stop(), []);

  const onTap = async (m: TapMeasurement) => {
    const features = tapToFeatures(m, manual.current);
    const t0 = performance.now();
    try {
      const tap = await api.phoneTap({
        device: DEVICE,
        features,
        measurements: {
          dominant_hz: m.dominantHz,
          decay_ms: m.decayMs,
          rise_ms: m.riseMs,
          peak: m.peak,
          sample_rate: m.sampleRate,
          feel: manual.current.feel,
          metal: manual.current.metal,
        },
      });
      setSent((s) => [{ tap, m, ms: performance.now() - t0 }, ...s].slice(0, 6));
      navigator.vibrate?.(40);
    } catch (e) {
      setSent((s) => [{ tap: null, m, ms: performance.now() - t0, error: errorMessage(e) }, ...s].slice(0, 6));
    }
  };

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      const s = new TapSensor({
        threshold,
        onTap: (m) => void onTap(m),
        onLevel: (lv) => {
          setLevel(lv);
          levelMax.current = Math.max(levelMax.current, lv);
        },
      });
      await s.start();
      sensor.current = s;
      setRunning(true);
      try {
        wake.current = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null;
      } catch {
        /* screen may still dim; keep the page in front */
      }
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow microphone access for this site in the browser settings, then try again."
          : errorMessage(e),
      );
    } finally {
      setStarting(false);
    }
  };

  const stop = () => {
    sensor.current?.stop();
    sensor.current = null;
    wake.current?.release().catch(() => undefined);
    wake.current = null;
    setRunning(false);
    setOnline(false);
    setLevel(0);
    api.phoneHeartbeat({ device: DEVICE, level: 0, listening: false }).catch(() => undefined);
  };

  const last = sent[0];

  return (
    <div className="mx-auto min-h-screen max-w-md space-y-4 bg-bg px-4 py-5 text-ink">
      <header className="flex items-center justify-between">
        <Logo />
        <Badge tone={running ? (online ? "good" : "warn") : "neutral"} dot>
          {running ? (online ? "STREAMING" : "CONNECTING") : "OFF"}
        </Badge>
      </header>

      <div>
        <h1 className="flex items-center gap-2 font-display text-xl font-semibold">
          <Smartphone className="h-5 w-5 text-accent" /> Phone tap sensor
        </h1>
        <p className="mt-1 text-sm text-muted">
          Your phone's microphone measures each tap for real and sends it to NeuroGrip. Open the{" "}
          <span className="font-medium text-ink">Virtual Lab → PHONE</span> on the laptop to watch the hand react.
          {user && <> Signed in as {user.email}.</>}
        </p>
      </div>

      {error && <Notice tone="bad">{error}</Notice>}

      {!running ? (
        <Button variant="primary" size="lg" className="w-full" onClick={start} loading={starting} icon={<Mic className="h-4 w-4" />}>
          START SENSOR
        </Button>
      ) : (
        <Button size="lg" className="w-full" onClick={stop} icon={<MicOff className="h-4 w-4" />}>
          Stop
        </Button>
      )}

      <section className="space-y-2 rounded-xl border border-line bg-surface p-3">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>Live microphone level</span>
          <span className="font-mono">{(level * 100).toFixed(0)}%</span>
        </div>
        <div className="relative h-3 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full bg-accent transition-[width] duration-100" style={{ width: `${Math.min(100, level * 100)}%` }} />
          <div className="absolute inset-y-0 w-0.5 bg-warn" style={{ left: `${threshold * 100}%` }} title="tap threshold" />
        </div>
        <label className="block text-xs text-muted">
          Tap sensitivity (orange line): {(threshold * 100).toFixed(0)}%
          <input type="range" min={0.04} max={0.6} step={0.01} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="mt-1 w-full accent-[var(--accent)]" />
        </label>
        <p className="text-xs text-muted">Tap the object firmly on the table right next to the phone's bottom edge (where the microphone is).</p>
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-surface p-3">
        <div className="text-xs font-medium uppercase tracking-wide text-muted">Your touch (manual: phones have no thermometer or electrodes)</div>
        <Segmented
          label="How does the object feel?"
          size="sm"
          value={feel}
          onChange={setFeel}
          options={(Object.keys(FEEL_LABEL) as FeelOption[]).map((k) => ({ value: k, label: FEEL_LABEL[k] }))}
        />
        <Toggle checked={metal} onChange={setMetal} label="Metal (conducts electricity)" />
      </section>

      {last && (
        <section className="space-y-2 rounded-xl border border-line bg-surface p-3" data-testid="phone-last-tap">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">Last tap</span>
            <span className="font-mono text-xs text-muted">sent in {last.ms.toFixed(0)} ms</span>
          </div>
          {last.tap?.prediction ? (
            <div className="flex items-baseline justify-between">
              <span className="font-display text-2xl font-semibold">{last.tap.prediction.display_label}</span>
              <span className="font-mono text-sm text-ink-2">
                {(last.tap.prediction.confidence * 100).toFixed(0)}% · grip {last.tap.prediction.grip_percent.toFixed(0)}%
              </span>
            </div>
          ) : (
            <Notice tone="bad">{last.error ?? "Not classified"}</Notice>
          )}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[12px] text-ink-2">
            <span>pitch {last.m.dominantHz} Hz</span>
            <span>ring decay {last.m.decayMs} ms</span>
            <span>impact rise {last.m.riseMs} ms</span>
            <span>peak {(last.m.peak * 100).toFixed(0)}%</span>
          </div>
        </section>
      )}

      {sent.length > 1 && (
        <section className="space-y-1 text-[12px]">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Earlier taps</div>
          {sent.slice(1).map((s, i) => (
            <div key={i} className="flex justify-between rounded-lg bg-surface-2/60 px-2 py-1 font-mono text-ink-2">
              <span>{s.tap?.prediction?.display_label ?? "error"}</span>
              <span>
                {s.m.dominantHz} Hz · {s.m.decayMs} ms
              </span>
            </div>
          ))}
        </section>
      )}

      <p className="pt-2 text-center text-xs text-muted">
        <Link to="/lab" className="text-accent hover:underline">
          Open the Virtual Lab
        </Link>
      </p>
    </div>
  );
}
