/**
 * Visual "does this look like metal?" cue, measured from the camera pixels inside an
 * object's box. Polished/stainless steel is grey-silver (low colour saturation), shows bright
 * specular highlights and strong light/dark reflection bands (high brightness contrast).
 * Painted or coloured objects fail the saturation test; matte white/grey ones fail the
 * contrast and highlight tests; black print fails the dark-area test. Reflections on a metal
 * bottle or mug form long parallel bands, so brightness changes run mostly in one direction
 * (high coherence), unlike a football pattern or printed label (edges in every direction). It is a visual cue, not a measurement of the material.
 */
export interface MetalLook {
  /** 0..1, how metallic the object looks. */
  score: number;
  /** Share of grey/silver pixels (saturation < 0.2). */
  grey: number;
  /** Brightness standard deviation (reflection bands). */
  contrast: number;
  /** Share of bright, colourless pixels (specular highlights). */
  shine: number;
  /** 0..1, how much the brightness changes run in one direction (reflection bands on a bottle). */
  coherence: number;
}

const ramp = (v: number, lo: number, hi: number) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));

/** RGBA pixel data (e.g. from canvas getImageData) -> metallic look. */
export function metallicLook(rgba: Uint8ClampedArray): MetalLook {
  const n = rgba.length / 4;
  if (n === 0) return { score: 0, grey: 0, contrast: 0, shine: 0, coherence: 0 };
  const vals = new Float32Array(n);
  const sats = new Float32Array(n);
  let sumV = 0;
  let sumV2 = 0;
  let grey = 0;
  let dark = 0;
  for (let i = 0, k = 0; i < rgba.length; i += 4, k++) {
    const r = rgba[i] / 255;
    const g = rgba[i + 1] / 255;
    const b = rgba[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    vals[k] = max;
    sats[k] = sat;
    sumV += max;
    sumV2 += max * max;
    if (sat < 0.2 && max > 0.12) grey++;
    if (max < 0.12) dark++;
  }
  const mean = sumV / n;
  const contrast = Math.sqrt(Math.max(0, sumV2 / n - mean * mean));
  // Specular highlights: colourless spots much brighter than the object's average brightness.
  const shineLevel = Math.min(0.97, mean + 0.25);
  let shine = 0;
  for (let k = 0; k < n; k++) if (vals[k] > shineLevel && sats[k] < 0.15) shine++;
  const greyFrac = grey / n;
  const shineFrac = shine / n;
  // Metal needs reflections (contrast + highlights); a grey/silver colour strengthens the verdict.
  const reflections = 0.55 * ramp(contrast, 0.08, 0.22) + 0.45 * ramp(shineFrac, 0.01, 0.08);
  // Large near-black areas (black print, black/white patterns like a football) are not steel:
  // even dark reflections on steel stay mid-grey.
  const notPrinted = 1 - ramp(dark / n, 0.1, 0.3);
  const coherence = gradientCoherence(vals, Math.round(Math.sqrt(n)));
  const banded = 0.15 + 0.85 * ramp(coherence, 0.12, 0.35);
  const score = (0.3 + 0.7 * ramp(greyFrac, 0.35, 0.75)) * reflections * notPrinted * banded;
  return { score, grey: greyFrac, contrast, shine: shineFrac, coherence };
}

/** Structure-tensor coherence of a square brightness image: 1 = all edges parallel, 0 = no direction. */
function gradientCoherence(v: Float32Array, size: number): number {
  let jxx = 0;
  let jyy = 0;
  let jxy = 0;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      const gx = (v[i + 1] - v[i - 1]) / 2;
      const gy = (v[i + size] - v[i - size]) / 2;
      jxx += gx * gx;
      jyy += gy * gy;
      jxy += gx * gy;
    }
  }
  const tr = jxx + jyy;
  if (tr <= 1e-9) return 0;
  const disc = Math.sqrt(Math.max(0, (tr / 2) ** 2 - (jxx * jyy - jxy * jxy)));
  return (2 * disc) / tr;
}

/** Hysteresis so the verdict does not flicker near the threshold. */
export const METAL_ON = 0.62;
export const METAL_OFF = 0.48;
