import { describe, expect, it } from "vitest";
import { analyseTap, tapToFeatures } from "./tapSensor";

/** A tap: fast attack, exponentially decaying ring at `hz`. */
function ring(hz: number, decayTauMs: number, sr = 48000, seconds = 0.45, riseMs = 0.3): Float32Array {
  const x = new Float32Array(Math.round(sr * seconds));
  const onset = Math.round(0.004 * sr);
  const rise = Math.max(1, Math.round((riseMs / 1000) * sr));
  for (let i = onset; i < x.length; i++) {
    const t = (i - onset) / sr;
    const attack = Math.min(1, (i - onset) / rise);
    x[i] = 0.8 * attack * Math.exp(-(t * 1000) / decayTauMs) * Math.sin(2 * Math.PI * hz * t);
  }
  return x;
}

describe("analyseTap", () => {
  it("measures the ring frequency and a long decay for a glass-like tap", () => {
    const m = analyseTap(ring(3000, 80), 48000);
    expect(Math.abs(m.dominantHz - 3000)).toBeLessThan(30);
    expect(m.decayMs).toBeGreaterThan(120); // 10 % of an 80 ms time constant ≈ 184 ms
    expect(m.peak).toBeGreaterThan(0.5);
  });

  it("measures a short decay and slower rise for a soft thud", () => {
    const m = analyseTap(ring(400, 3, 48000, 0.45, 4), 48000);
    expect(Math.abs(m.dominantHz - 400)).toBeLessThan(40);
    expect(m.decayMs).toBeLessThan(25);
    expect(m.riseMs).toBeGreaterThan(1.5);
  });

  it("maps measurements into the model's feature ranges", () => {
    const f = tapToFeatures({ dominantHz: 3000, decayMs: 200, riseMs: 0.3, peak: 0.8, sampleRate: 48000 }, { feel: "cool", metal: false });
    expect(f.vibration).toBe(3000);
    expect(f.temperature).toBe(27.5);
    expect(f.conductivity).toBeLessThan(1e-9);
    expect(f.contact_duration).toBeCloseTo(0.13, 2);
    expect(f.pressure).toBeGreaterThan(240);
  });
});
