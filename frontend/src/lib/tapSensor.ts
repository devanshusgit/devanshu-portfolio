/**
 * Phone microphone as a real tactile "tap" sensor.
 *
 * Tap an object against (or right next to) the phone. For every tap we measure, from the
 * raw audio samples:
 *  - dominantHz: strongest frequency of the ring (FFT)  -> vibration feature (Hz)
 *  - decayMs:    time for the ring to fall to 10 % of its peak (damping)
 *  - riseMs:     time for the impact to reach its peak (impact sharpness)
 *  - peak:       peak level 0..1 (how hard the tap was)
 * These are real measurements; `tapToFeatures` turns them into the model's five inputs.
 */

import type { Features } from "@/api/types";

export interface TapMeasurement {
  dominantHz: number;
  decayMs: number;
  riseMs: number;
  peak: number;
  sampleRate: number;
}

export type FeelOption = "cold" | "cool" | "neutral" | "warm";

/** What the person reports by touch: phones have no contact thermometer or electrodes. */
export interface ManualInputs {
  feel: FeelOption;
  metal: boolean;
}

export const FEEL_TEMPERATURE: Record<FeelOption, number> = {
  cold: 24.0, // metals pull heat from the finger
  cool: 27.5, // glass, stone
  neutral: 29.8, // plastic, wood, rubber
  warm: 32.0, // fabric, foam
};

export const FEEL_LABEL: Record<FeelOption, string> = {
  cold: "Cold (metal)",
  cool: "Cool (glass)",
  neutral: "Neutral (plastic / wood / rubber)",
  warm: "Warm (fabric)",
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Measured tap -> model features.
 * - vibration = measured ring frequency (Hz).
 * - contact_duration: soft (viscoelastic) materials damp the ring quickly AND settle slowly
 *   under a fingertip, so settling time is taken as inversely proportional to the decay time.
 * - pressure: stiffer objects give a shorter, sharper impact (Hertzian contact time), so a
 *   faster rise means higher contact pressure.
 * - temperature / conductivity come from the manual inputs.
 */
export function tapToFeatures(m: TapMeasurement, manual: ManualInputs): Features {
  return {
    pressure: Math.round(clamp(260 - 40 * m.riseMs, 30, 260) * 10) / 10,
    temperature: FEEL_TEMPERATURE[manual.feel],
    vibration: Math.round(clamp(m.dominantHz, 5, 8000)),
    conductivity: manual.metal ? 1.0e6 : 2.0e-12,
    contact_duration: Math.round(clamp(0.1 + 6 / Math.max(m.decayMs, 1), 0.1, 1.3) * 1000) / 1000,
  };
}

// ------------------------------------------------------------------ FFT (radix-2)
function fftMagnitudes(input: Float32Array): Float32Array {
  const n = input.length;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) re[i] = input[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))); // Hann
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  const mags = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) mags[i] = Math.hypot(re[i], im[i]);
  return mags;
}

/** Analyse one captured tap (raw samples starting shortly before the onset). */
export function analyseTap(x: Float32Array, sampleRate: number): TapMeasurement {
  let peakIdx = 0;
  let peak = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > peak) {
      peak = a;
      peakIdx = i;
    }
  }
  // Dominant frequency of the ring: FFT over ~85 ms (4096 @ 48 kHz) from just before the peak.
  const n = sampleRate > 30000 ? 4096 : 2048;
  const from = clamp(peakIdx - 32, 0, Math.max(0, x.length - n));
  const frame = new Float32Array(n);
  frame.set(x.subarray(from, from + n));
  const mags = fftMagnitudes(frame);
  const binHz = sampleRate / n;
  const lo = Math.max(1, Math.floor(80 / binHz));
  const hi = Math.min(mags.length - 2, Math.ceil(8000 / binHz));
  let best = lo;
  for (let i = lo; i <= hi; i++) if (mags[i] > mags[best]) best = i;
  // Parabolic interpolation around the peak bin.
  const a = mags[best - 1];
  const b = mags[best];
  const c = mags[best + 1];
  const denom = a - 2 * b + c;
  const offset = denom !== 0 ? clamp((0.5 * (a - c)) / denom, -0.5, 0.5) : 0;
  const dominantHz = (best + offset) * binHz;

  // Rise: from the impact onset (first sample above 20 % of the peak) to the peak.
  let onset = 0;
  while (onset < peakIdx && Math.abs(x[onset]) < 0.2 * peak) onset++;
  const riseMs = ((peakIdx - onset) / sampleRate) * 1000;

  // Decay: envelope blocks (>= 1 ms and >= ~1 ring cycle) after the peak until the block max < 10 % of the peak.
  const block = Math.max(Math.round(sampleRate / 1000), Math.ceil((1.2 * sampleRate) / Math.max(dominantHz, 80)));
  let decayMs = ((x.length - peakIdx) / sampleRate) * 1000;
  for (let s0 = peakIdx; s0 + block <= x.length; s0 += block) {
    let m = 0;
    for (let i = s0; i < s0 + block; i++) m = Math.max(m, Math.abs(x[i]));
    if (m < 0.1 * peak) {
      decayMs = ((s0 - peakIdx) / sampleRate) * 1000;
      break;
    }
  }

  return {
    dominantHz: Math.round(dominantHz),
    decayMs: Math.round(decayMs),
    riseMs: Math.round(riseMs * 100) / 100,
    peak: Math.round(peak * 1000) / 1000,
    sampleRate,
  };
}

// ------------------------------------------------------------------ live capture
export interface TapSensorOptions {
  /** Minimum sample peak (0..1) for a tap. */
  threshold: number;
  onTap: (m: TapMeasurement, samples: Float32Array) => void;
  onLevel?: (level: number) => void;
}

const CAPTURE_S = 0.45;
const PRE_S = 0.004;
const REFRACTORY_S = 0.6;

export class TapSensor {
  threshold: number;
  private opts: TapSensorOptions;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private history = new Float32Array(4096);
  private historyPos = 0;
  private capture: Float32Array | null = null;
  private capturePos = 0;
  private quietUntil = 0;
  private sampleClock = 0;
  private noise = 0.01;
  private levelMax = 0;
  private levelTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: TapSensorOptions) {
    this.opts = opts;
    this.threshold = opts.threshold;
  }

  get running(): boolean {
    return this.ctx !== null;
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 0;
  }

  /** Must be called from a user gesture (button click), required by iOS/Android browsers. */
  async start(): Promise<void> {
    if (this.ctx) return;
    const Ctor: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    await ctx.resume();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const src = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(1024, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.onaudioprocess = (ev) => {
      this.process(ev.inputBuffer.getChannelData(0), ctx.sampleRate);
      ev.outputBuffer.getChannelData(0).fill(0);
    };
    src.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);
    this.ctx = ctx;
    this.stream = stream;
    this.node = node;
    this.levelTimer = setInterval(() => {
      this.opts.onLevel?.(Math.min(1, this.levelMax));
      this.levelMax = 0;
    }, 150);
  }

  stop(): void {
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.levelTimer = null;
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.node = null;
    this.stream = null;
    this.capture = null;
  }

  private process(buf: Float32Array, sr: number): void {
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i];
      const a = Math.abs(v);
      if (a > this.levelMax) this.levelMax = a;
      this.history[this.historyPos] = v;
      this.historyPos = (this.historyPos + 1) % this.history.length;
      this.sampleClock++;

      if (this.capture) {
        this.capture[this.capturePos++] = v;
        if (this.capturePos >= this.capture.length) {
          const samples = this.capture;
          this.capture = null;
          this.quietUntil = this.sampleClock + Math.round(REFRACTORY_S * sr);
          try {
            this.opts.onTap(analyseTap(samples, sr), samples);
          } catch {
            /* ignore a bad capture */
          }
        }
        continue;
      }

      // Background noise estimate (slow), used to ignore steady loud environments.
      this.noise = this.noise * 0.9995 + a * 0.0005;
      if (this.sampleClock < this.quietUntil) continue;
      if (a >= this.threshold && a > 6 * this.noise) {
        const pre = Math.round(PRE_S * sr);
        const cap = new Float32Array(Math.round(CAPTURE_S * sr));
        for (let k = pre; k > 0; k--) {
          const idx = (this.historyPos - 1 - k + this.history.length * 2) % this.history.length;
          cap[pre - k] = this.history[idx];
        }
        cap[pre] = v;
        this.capture = cap;
        this.capturePos = pre + 1;
      }
    }
  }
}
