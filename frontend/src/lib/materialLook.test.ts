import { describe, expect, it } from "vitest";
import { metallicLook, METAL_OFF, METAL_ON } from "./materialLook";

/** 64x64 RGBA image from a pixel function. */
function img(px: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(64 * 64 * 4);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const [r, g, b] = px(x, y);
      d.set([r, g, b, 255], (y * 64 + x) * 4);
    }
  return d;
}

describe("metallicLook", () => {
  it("brushed steel (grey bands + bright highlights) looks metallic", () => {
    const steel = img((x) => {
      const v = x % 16 < 2 ? 245 : 70 + 120 * Math.abs(Math.sin(x / 6)); // reflection bands + specular lines
      return [v, v, v + 4];
    });
    expect(metallicLook(steel).score).toBeGreaterThan(METAL_ON);
  });

  it("a blue plastic bottle does not", () => {
    const blue = img((x) => [40, 110 + (x % 10), 220]);
    expect(metallicLook(blue).score).toBeLessThan(METAL_OFF);
  });

  it("a matte white bottle does not (no reflections)", () => {
    const white = img(() => [228, 226, 222]);
    expect(metallicLook(white).score).toBeLessThan(METAL_OFF);
  });
});

describe("metallicLook edge cases", () => {
  it("a colourful label with glare is not metal", () => {
    const label = img((x, y) => (x % 20 < 2 && y < 20 ? [250, 250, 250] : [200, 40 + (x % 30), 60]));
    expect(metallicLook(label).score).toBeLessThan(METAL_OFF);
  });
});

describe("metallicLook black/white patterns", () => {
  it("a black-and-white football pattern is not metal", () => {
    const ball = img((x, y) => (((x >> 3) + (y >> 3)) % 3 === 0 ? [15, 15, 15] : [240, 240, 238]));
    expect(metallicLook(ball).score).toBeLessThan(METAL_OFF);
  });
});

describe("metallicLook reflection bands", () => {
  it("tilted steel bands still count as metal", () => {
    const tilted = img((x, y) => {
      const v = (x + y) % 22 < 3 ? 248 : 80 + 110 * Math.abs(Math.sin((x + y) / 7));
      return [v, v, v + 3];
    });
    const look = metallicLook(tilted);
    expect(look.coherence).toBeGreaterThan(0.6);
    expect(look.score).toBeGreaterThan(METAL_ON);
  });

  it("a grey-and-white patch pattern (like a football) is not metal", () => {
    const ball = img((x, y) => (((x >> 3) + (y >> 3)) % 3 === 0 ? [70, 70, 70] : [235, 235, 232]));
    expect(metallicLook(ball).score).toBeLessThan(METAL_OFF);
  });
});
